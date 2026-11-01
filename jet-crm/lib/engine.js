// Inbox poller, request/quote pipeline and rate-limited RFQ send queue.
const store = require('./store');
const graph = require('./graph');
const { parseEmail } = require('./parser');
const routing = require('./routing');
const geo = require('./geo');
const Proposal = require('../public/shared/proposal');

const SENDS_PER_MINUTE = Number(process.env.SENDS_PER_MINUTE || 25); // Exchange Online caps at 30/min
const listeners = new Set();
const notify = (event) => listeners.forEach((fn) => fn(event));

const live = () => Boolean(graph.account());

// ---------- helpers ----------
function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '').toString());
}

function routeLabel(req) {
  if (!req.legs.length) return 'TBC';
  return req.legs.map((l) => l.from).concat(req.legs[req.legs.length - 1].to).join(' – ');
}

function upsertContact(data) {
  const db = store.load();
  const email = (data.email || '').toLowerCase();
  let c = email && db.contacts.find((x) => x.email === email);
  if (!c) {
    c = { id: store.id('con'), type: 'client', rfqEnabled: false, createdAt: new Date().toISOString(), ...data, email };
    db.contacts.push(c);
  } else {
    for (const k of ['name', 'phone', 'company']) if (!c[k] && data[k]) c[k] = data[k];
  }
  return c;
}

function rfqRecipients(excludeEmail) {
  return store.load().contacts.filter((c) =>
    (c.type === 'broker' || c.type === 'operator') && c.rfqEnabled !== false && c.email && c.email !== excludeEmail
    && !(c.demo && live()));
}

// ---------- RFQ dispatch ----------
// Queues RFQ emails to the given contacts (ids chosen by routing or by hand).
function queueRfqs(req, { onlyContactIds = [], reasons = {} } = {}) {
  const db = store.load();
  const t = db.settings.template;
  const eligible = rfqRecipients(req.client.email);
  const recipients = onlyContactIds.map((id) => eligible.find((c) => c.id === id)).filter(Boolean); // keep priority order
  const already = new Set(db.outbox.filter((o) => o.requestId === req.id).map((o) => o.contactId));
  const legs = req.legs.map((l, i) => `  ${i + 1}. ${geo.describe(l.from, l.fromCode)} → ${geo.describe(l.to, l.toCode)}  ${l.date || 'date TBC'}${l.time ? ' ' + l.time : ''}`).join('\n');
  let n = 0;
  for (const c of recipients) {
    if (already.has(c.id)) continue;
    const vars = {
      ref: req.ref, route: routeLabel(req), date: req.legs[0]?.date || 'TBC', pax: req.pax ?? 'TBC',
      legs, category: req.category || 'Any suitable', notes: req.notes || '-',
      contactName: c.name?.split(' ')[0] || 'Team', company: c.company || '', senderName: db.settings.senderName,
    };
    db.outbox.push({
      id: store.id('out'), requestId: req.id, contactId: c.id, to: c.email, toName: c.name,
      subject: fill(t.subject, vars), body: fill(t.body, vars), status: 'queued', queuedAt: new Date().toISOString(),
      reason: reasons[c.id] || 'chosen manually', foundOnline: c.source === 'web',
    });
    n++;
  }
  if (n) {
    req.status = req.status === 'new' ? 'rfq_sent' : req.status;
    req.rfqCount = (req.rfqCount || 0) + n;
    store.log('rfq', `Queued ${n} RFQs for ${req.ref}`, { requestId: req.id });
  }
  store.save();
  return n;
}

// Picks recipients by geography (searching the web if too few nearby operators are on file), then queues.
async function autoRoute(req) {
  const { contactIds, summary } = await routing.route(req, { live: live() });
  const db = store.load();
  const fresh = db.requests.find((r) => r.id === req.id);
  if (!fresh) return 0;
  fresh.routing = summary;
  const where = summary.airport ? `${summary.airport.iata || summary.airport.icao}` : 'unknown departure';
  store.log('routing', `${fresh.ref}: ${summary.nearby} operators within ${summary.radiusKm} km of ${where} (${summary.capable} with a suitable fleet), ${summary.worldwide} worldwide brokers${summary.discovered ? `, ${summary.discovered} found online` : ''}${summary.excludedUnsuitable ? `, ${summary.excludedUnsuitable} skipped: fleet can't do it` : ''}`, { requestId: fresh.id });
  const n = queueRfqs(fresh, { onlyContactIds: contactIds, reasons: summary.reasons });
  drainOutbox();
  notify({ type: 'request', requestId: fresh.id });
  return n;
}

// ---------- instant reply to the client ----------
function ackText(req) {
  const db = store.load();
  const pt = (text, code) => { const e = geo.endpoint(text, code); return e.status === 'airport' ? `${e.airport.city || e.airport.name} (${e.airport.iata || e.airport.icao})` : text; };
  const vars = {
    clientFirstName: (req.client?.name || '').split(' ')[0] || 'Sir/Madam', clientName: req.client?.name || '', ref: req.ref,
    route: req.legs.map((l) => `${pt(l.from, l.fromCode)} → ${pt(l.to, l.toCode)}`).join(', ') || 'Your trip',
    date: req.legs[0]?.date || 'date to be confirmed', pax: req.pax ?? 'TBC', senderName: db.settings.senderName,
  };
  return fill(db.settings.ackTemplate, vars);
}
async function acknowledge(req, email) {
  const db = store.load();
  if (!db.settings.autoAck || !email?.fromEmail) return;
  const body = ackText(req);
  req.ack = { at: new Date().toISOString(), to: email.fromEmail, subject: `RE: ${email.subject}`, body, simulated: !live() };
  try {
    if (live()) await graph.reply(email.id, body.replace(/\n/g, '<br>'));
    store.log('ack', `Replied to ${req.client.name || email.fromEmail}: we're on it (${req.ref})${live() ? '' : ' [demo]'}`, { requestId: req.id });
  } catch (e) {
    req.ack.error = e.message;
    store.log('ack', `Couldn't send the instant reply for ${req.ref}: ${e.message}`, { requestId: req.id });
  }
  store.save();
}

// ---------- chase operators who haven't replied ----------
// ---------- proposals: collect quotes for a while, pick the best, wait for the broker's approval ----------
const legText = (req) => req.legs.map((l) => { const e = (t, c) => { const x = geo.endpoint(t, c); return x.status === 'airport' ? `${x.airport.city || x.airport.name} (${x.airport.iata || x.airport.icao})` : t; }; return `${e(l.from, l.fromCode)} → ${e(l.to, l.toCode)}`; }).join(', ');
function openQuoteWindow(req) {
  if (req.quoteWindow || req.proposal) return;
  const mins = Number(store.load().settings.quoteWindowMinutes) || 30;
  const now = Date.now();
  req.quoteWindow = { opensAt: new Date(now).toISOString(), closesAt: new Date(now + mins * 60000).toISOString() };
  store.log('proposal', `${req.ref}: first quote in, collecting more for ${mins} minutes before recommending one`, { requestId: req.id });
}
function buildProposal(req, { feePct } = {}) {
  const db = store.load();
  const ev = Proposal.evaluate(req, db.business, routing.tripNeeds(req), feePct);
  if (!ev.best) return null;
  const draft = Proposal.draftEmail(req, ev.best, db.business, { senderName: db.settings.senderName, routeText: legText(req) });
  return { quoteId: ev.best.id, company: ev.best.company, aircraft: ev.best.aircraft, clientPrice: ev.best.clientPriceTarget, currency: ev.target,
    feePct: ev.fee.value, why: Proposal.why(ev), quotesConsidered: req.quotes.length, subject: draft.subject, body: draft.body };
}
function runProposals() {
  const db = store.load();
  let changed = 0;
  for (const req of db.requests) {
    if (!req.quotes.some((q) => q.price != null)) continue;
    if (!req.quoteWindow && !req.proposal) { openQuoteWindow(req); changed++; }
    const p = req.proposal;
    if (!p && req.quoteWindow && Date.now() >= Date.parse(req.quoteWindow.closesAt)) {
      const rec = buildProposal(req);
      if (!rec) continue;
      req.proposal = { status: 'pending', createdAt: new Date().toISOString(), ...rec };
      store.log('proposal', `${req.ref}: recommending ${rec.company} (${rec.aircraft || 'aircraft TBC'}), ${rec.currency} ${Math.round(rec.clientPrice).toLocaleString('en-US')} to client. Waiting for your approval.`, { requestId: req.id });
      notify({ type: 'proposal', requestId: req.id });
      changed++;
    } else if (p && p.status === 'pending' && p.quotesConsidered !== req.quotes.length) {
      // more quotes arrived while waiting for approval: refresh the recommendation
      const rec = buildProposal(req, { feePct: p.feePct });
      if (rec) { Object.assign(p, rec, { updatedAt: new Date().toISOString() }); store.log('proposal', `${req.ref}: recommendation updated with a new quote (${rec.company})`, { requestId: req.id }); notify({ type: 'proposal', requestId: req.id }); changed++; }
    }
  }
  if (changed) store.save();
}
async function approveProposal(req, { quoteId, feePct, subject, body }) {
  const db = store.load();
  const q = req.quotes.find((x) => x.id === quoteId);
  if (!q) throw Object.assign(new Error('Quote not found'), { status: 404 });
  if (!req.client?.email) throw Object.assign(new Error('The client has no email address. Add one on the trip first.'), { status: 400 });
  const fee = Number(feePct);
  if (!(fee >= 0 && fee <= 50)) throw Object.assign(new Error('Enter a brokerage fee between 0 and 50%.'), { status: 400 });
  req.fee = { type: 'percent', value: fee, min: Number(db.business.feeMin) || 0 };
  const ev = Proposal.evaluate(req, db.business, routing.tripNeeds(req));
  const row = ev.rows.find((r) => r.id === quoteId);
  if (!row || row.clientPriceTarget == null) throw Object.assign(new Error('This quote has no usable price.'), { status: 400 });
  const draft = Proposal.draftEmail(req, row, db.business, { senderName: db.settings.senderName, routeText: legText(req) });
  const mail = { to: req.client.email, toName: req.client.name, subject: subject || draft.subject, body: body || draft.body };
  if (live()) await graph.sendMail(mail);
  req.quotes.forEach((x) => (x.status = x.id === quoteId ? 'selected' : x.status === 'selected' ? 'received' : x.status));
  req.proposal = { ...(req.proposal || {}), status: 'sent', quoteId, company: q.company, aircraft: q.aircraft, clientPrice: row.clientPriceTarget, currency: ev.target,
    feePct: fee, subject: mail.subject, body: mail.body, approvedAt: new Date().toISOString(), sentAt: new Date().toISOString(), simulated: !live() };
  req.status = 'proposal';
  req.updatedAt = new Date().toISOString();
  store.log('proposal', `${req.ref}: you approved ${q.company} at ${fee}% fee; offer of ${ev.target} ${Math.round(row.clientPriceTarget).toLocaleString('en-US')} ${live() ? 'emailed' : 'sent (demo)'} to ${req.client.email}`, { requestId: req.id });
  store.save();
  notify({ type: 'request', requestId: req.id });
  return req;
}
function proposeNow(req) {
  if (!req.quoteWindow) openQuoteWindow(req);
  req.quoteWindow.closesAt = new Date().toISOString();
  runProposals();
  return req;
}

const CHASEABLE = new Set(['rfq_sent', 'quoting']);
function runFollowUps() {
  const db = store.load();
  const cfg = db.settings.followUp;
  if (!cfg?.enabled) return 0;
  const every = Math.max(5, Number(cfg.everyMinutes) || 15) * 60000;
  const today = new Date().toISOString().slice(0, 10);
  let queued = 0;
  for (const req of db.requests) {
    if (!CHASEABLE.has(req.status)) continue;
    if (req.legs[0]?.date && req.legs[0].date < today) continue; // trip date passed
    const replied = new Set(req.quotes.map((q) => q.fromEmail));
    for (const o of db.outbox.filter((x) => x.requestId === req.id && (x.kind || 'rfq') === 'rfq' && ['sent', 'simulated'].includes(x.status))) {
      if (replied.has(o.to)) continue;
      const chasers = db.outbox.filter((x) => x.kind === 'followup' && x.parentId === o.id);
      if (chasers.length >= (Number(cfg.maxPerOperator) || 3)) continue;
      if (chasers.some((x) => x.status === 'queued')) continue;
      const last = Math.max(Date.parse(o.sentAt), ...chasers.map((x) => Date.parse(x.sentAt || x.queuedAt)));
      if (Date.now() - last < every) continue;
      const n = chasers.length + 1;
      const first = (o.toName || '').split(' ')[0] || 'Team';
      db.outbox.push({
        id: store.id('out'), kind: 'followup', parentId: o.id, followUpNo: n, requestId: req.id, contactId: o.contactId, to: o.to, toName: o.toName,
        subject: `RE: ${o.subject}`, status: 'queued', queuedAt: new Date().toISOString(), reason: `follow-up ${n}`,
        body: `Dear ${first},\n\nFollowing up on ${req.ref} below: ${routeLabel(req)}, ${req.legs[0]?.date || 'date TBC'}, ${req.pax ?? 'TBC'} passengers.\n\nOur client is waiting on options. Could you send aircraft, price and availability? If you can't operate this trip, a quick "no" is appreciated too.\n\nKind regards,\n${db.settings.senderName}\n\n---- Original request ----\n${o.body}`,
      });
      queued++;
    }
  }
  if (queued) { store.log('followup', `Queued ${queued} follow-up${queued === 1 ? '' : 's'} to operators who haven't replied`); store.save(); }
  return queued;
}

let sending = false;
async function drainOutbox() {
  if (sending) return;
  sending = true;
  try {
    const db = store.load();
    const minuteAgo = Date.now() - 60000;
    let budget = SENDS_PER_MINUTE - db.outbox.filter((o) => o.sentAt && Date.parse(o.sentAt) > minuteAgo).length;
    for (const o of db.outbox) {
      if (budget <= 0) break;
      if (o.status !== 'queued') continue;
      try {
        if (live()) await graph.sendMail(o);
        else scheduleDemoQuote(o, o.kind === 'followup' ? 0.4 : 0.65);
        o.status = live() ? 'sent' : 'simulated';
        o.sentAt = new Date().toISOString();
        budget--;
      } catch (e) {
        o.attempts = (o.attempts || 0) + 1;
        o.error = e.message;
        if (o.attempts >= 3) o.status = 'failed';
        console.error('[send]', o.to, e.message);
      }
      store.save();
    }
  } finally {
    sending = false;
    notify({ type: 'outbox' });
  }
}

// ---------- inbound processing ----------
async function handleEmail(email) {
  const db = store.load();
  const me = graph.account()?.email?.toLowerCase();
  if (me && email.fromEmail === me) return 'own';

  const refMatch = email.subject.match(/RFQ-\d+/i);
  const req = refMatch && db.requests.find((r) => r.ref.toUpperCase() === refMatch[0].toUpperCase());
  const parsed = await parseEmail(email);

  if (req && email.fromEmail === (req.client?.email || '').toLowerCase()) {
    req.clientMessages = req.clientMessages || [];
    req.clientMessages.push({ at: email.receivedAt, subject: email.subject, body: email.body.slice(0, 4000) });
    req.updatedAt = new Date().toISOString();
    store.log('client', `${req.client.name || req.client.email} replied about ${req.ref}`, { requestId: req.id });
    store.save();
    notify({ type: 'request', requestId: req.id });
    return 'client';
  }
  if (req) {
    const sender = db.contacts.find((c) => c.email === email.fromEmail);
    const q = parsed.quote || {};
    req.quotes.push({
      id: store.id('quo'), receivedAt: email.receivedAt, fromEmail: email.fromEmail,
      fromName: sender?.name || email.fromName, company: sender?.company || q.operator || email.fromName,
      aircraft: q.aircraft, year: q.year, tail: q.tail, price: q.price, currency: q.currency,
      notes: q.notes, snippet: email.body.slice(0, 600), status: 'received',
    });
    if (['new', 'rfq_sent'].includes(req.status)) req.status = 'quoting';
    openQuoteWindow(req);
    req.updatedAt = new Date().toISOString();
    store.log('quote', `Quote from ${sender?.company || email.fromName} for ${req.ref}${q.price ? `: ${q.currency || ''} ${q.price.toLocaleString()}` : ''}`, { requestId: req.id });
    store.save();
    notify({ type: 'quote', requestId: req.id });
    return 'quote';
  }

  const senderContact = db.contacts.find((c) => c.email === email.fromEmail);
  const fromSupplier = senderContact && senderContact.type !== 'client';
  if (parsed.kind !== 'charter_request' || fromSupplier) return 'ignored';

  const client = upsertContact({
    name: parsed.client?.name || email.fromName, email: parsed.client?.email || email.fromEmail,
    phone: parsed.client?.phone, company: parsed.client?.company, type: 'client',
  });
  const newReq = {
    id: store.id('req'), ref: store.nextRef(), status: 'new', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: { messageId: email.id, subject: email.subject, receivedAt: email.receivedAt, body: email.body.slice(0, 8000) },
    client: { id: client.id, name: client.name, email: client.email, phone: client.phone, company: client.company },
    legs: parsed.legs || [], pax: parsed.pax, category: parsed.category, notes: parsed.notes,
    currency: (parsed.currency || client.preferredCurrency || db.business.baseCurrency || 'EUR').toUpperCase(),
    engine: parsed.engine, quotes: [], rfqCount: 0,
  };
  db.requests.unshift(newReq);
  store.log('request', `New request ${newReq.ref} from ${client.name || client.email}: ${routeLabel(newReq)}`, { requestId: newReq.id });
  store.save();
  await acknowledge(newReq, email);
  if (db.settings.autoSendRfq && newReq.legs.length) {
    autoRoute(newReq).catch((e) => { console.error('[route]', e); store.log('routing', `Routing failed for ${newReq.ref}: ${e.message}`, { requestId: newReq.id }); store.save(); });
  }
  notify({ type: 'request', requestId: newReq.id });
  return 'request';
}

let polling = false;
async function poll() {
  if (polling) return { skipped: true };
  polling = true;
  const db = store.load();
  const started = new Date();
  const summary = { checked: 0, request: 0, quote: 0, ignored: 0 };
  try {
    const since = db.settings.lastPollAt
      ? new Date(Date.parse(db.settings.lastPollAt) - 5 * 60000).toISOString() // overlap; dedup by id
      : new Date(Date.now() - 24 * 3600000).toISOString();
    const messages = live() ? await graph.fetchNewMessages(since) : takeDemoInbox();
    const seen = new Set(db.processedMessageIds);
    for (const m of messages) {
      if (seen.has(m.id)) continue;
      summary.checked++;
      try {
        const r = await handleEmail(m);
        summary[r] = (summary[r] || 0) + 1;
      } catch (e) {
        console.error('[poll] message failed', m.subject, e.message);
      }
      db.processedMessageIds.push(m.id);
    }
    db.processedMessageIds = db.processedMessageIds.slice(-5000);
    db.settings.lastPollAt = started.toISOString();
    db.settings.lastPollStatus = 'ok';
    db.settings.lastPollError = null;
  } catch (e) {
    db.settings.lastPollStatus = 'error';
    db.settings.lastPollError = e.message;
    console.error('[poll]', e.message);
  } finally {
    store.save();
    polling = false;
  }
  runFollowUps();
  runProposals();
  await drainOutbox();
  notify({ type: 'poll', summary });
  return summary;
}

// ---------- demo mailbox (used when Outlook is not connected) ----------
const demoInbox = [];
function takeDemoInbox() {
  return demoInbox.splice(0, demoInbox.length);
}
function injectDemoEmail(email) {
  demoInbox.push({ id: store.id('demo'), receivedAt: new Date().toISOString(), ...email, fromEmail: email.fromEmail.toLowerCase() });
}
const AIRCRAFT = [['Citation XLS+', 'Midsize', 'OE-GXL'], ['Challenger 350', 'Super Midsize', '9H-CLA'], ['Global 6000', 'Heavy', 'G-GLBL'], ['Phenom 300E', 'Light', 'CS-PHC'], ['Falcon 7X', 'Heavy', 'HB-JFX']];
function scheduleDemoQuote(o, chance = 0.65) {
  if (Math.random() > chance) return; // not everyone replies
  const [ac, , tail] = AIRCRAFT[Math.floor(Math.random() * AIRCRAFT.length)];
  const price = Math.round((18000 + Math.random() * 90000) / 500) * 500;
  setTimeout(() => injectDemoEmail({
    fromName: o.toName, fromEmail: o.to, subject: `RE: ${o.subject}`,
    body: `Hi,\n\nPleased to offer ${ac}, YOM 2019, reg ${tail}.\nTotal price EUR ${price.toLocaleString('en-US')} all-inclusive, subject to availability.\n\nBest regards,\n${o.toName}`,
  }), 15000 + Math.random() * 60000);
}

// ---------- lifecycle ----------
let timer = null;
function start() {
  const tick = () => poll().catch((e) => console.error(e));
  tick();
  const every = Math.max(30, store.load().settings.pollSeconds || 60) * 1000;
  timer = setInterval(tick, every);
  setInterval(() => drainOutbox().catch(() => {}), 10000);
}

module.exports = { start, poll, queueRfqs, autoRoute, runFollowUps, ackText, runProposals, approveProposal, proposeNow, buildProposal, drainOutbox, injectDemoEmail, routeLabel, live, onEvent: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
