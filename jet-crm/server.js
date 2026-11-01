// SkyDesk – private jet charter broker CRM. Zero-framework Node server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const graph = require('./lib/graph');
const engine = require('./lib/engine');
const { aiEnabled } = require('./lib/parser');
const seed = require('./lib/seed');
const invoices = require('./lib/invoice');
const Pricing = require('./public/shared/pricing');
const routing = require('./lib/routing');
const geo = require('./lib/geo');

const PORT = Number(process.env.PORT || 3000);
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PUBLIC = path.join(__dirname, 'public');

// ---------- auth ----------
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const sessionCookie = () => { const v = `ok.${Date.now()}`; return `${v}.${sign(v)}`; };
function authed(req) {
  if (!APP_PASSWORD) return true;
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('sd='));
  if (!raw) return false;
  const val = decodeURIComponent(raw.slice(3));
  const i = val.lastIndexOf('.');
  const body = val.slice(0, i), mac = val.slice(i + 1);
  return mac.length === 64 && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(body)));
}

// ---------- utils ----------
const send = (res, code, data, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 2e6) req.destroy(); });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(new Error('Invalid JSON')); } });
});
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return serveStatic(req, res, '/'); // SPA fallback
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...data] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()])));
}

const CONTACT_FIELDS = ['name', 'email', 'phone', 'company', 'type', 'rfqEnabled', 'region', 'fleet', 'notes', 'tags', 'bases', 'global', 'website'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

function routingView(r) {
  const plan = routing.candidates(r, { live: engine.live() });
  const sentTo = new Set(store.load().outbox.filter((o) => o.requestId === r.id).map((o) => o.contactId));
  return {
    airport: geo.brief(plan.dep), radiusKm: plan.cfg.radiusKm, nearby: plan.nearbyOperators, minOperators: plan.cfg.minOperators, aiEnabled: routing.aiEnabled(),
    rows: plan.rows.map((x) => ({ id: x.contact.id, name: x.contact.name, company: x.contact.company, type: x.contact.type, include: x.include, reason: x.reason,
      distanceKm: x.distanceKm, global: x.global, foundOnline: x.contact.source === 'web', sent: sentTo.has(x.contact.id) })),
  };
}

function publicState() {
  const db = store.load();
  const { template, ...settings } = db.settings;
  return {
    business: db.business,
    settings: { ...settings, template },
    outlook: { configured: graph.configured(), account: graph.account(), live: engine.live() },
    aiEnabled: aiEnabled(),
    counts: {
      open: db.requests.filter((r) => !['won', 'lost'].includes(r.status)).length,
      quotes: db.requests.reduce((n, r) => n + r.quotes.length, 0),
      suppliers: db.contacts.filter((c) => c.type !== 'client').length,
      queued: db.outbox.filter((o) => o.status === 'queued').length,
    },
  };
}

// ---------- SSE ----------
const clients = new Set();
engine.onEvent((e) => { const msg = `data: ${JSON.stringify(e)}\n\n`; clients.forEach((r) => r.write(msg)); });
setInterval(() => clients.forEach((r) => r.write(': ping\n\n')), 25000);

// ---------- routes ----------
async function api(req, res, url) {
  const db = store.load();
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [a, b, c, d] = parts;
  const M = req.method;

  if (a === 'login' && M === 'POST') {
    const { password } = await readBody(req);
    const ok = APP_PASSWORD && password && crypto.timingSafeEqual(Buffer.from(sign(password)), Buffer.from(sign(APP_PASSWORD)));
    if (!ok) return send(res, 401, { error: 'Wrong password' });
    return send(res, 200, { ok: true }, { 'Set-Cookie': `sd=${encodeURIComponent(sessionCookie())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.PUBLIC_BASE_URL?.startsWith('https') ? '; Secure' : ''}` });
  }
  if (!authed(req)) return send(res, 401, { error: 'auth' });

  if (a === 'state' && M === 'GET') return send(res, 200, publicState());
  if (a === 'events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 5000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (a === 'poll' && M === 'POST') return send(res, 200, await engine.poll());

  // requests
  if (a === 'requests') {
    if (!b && M === 'GET') return send(res, 200, db.requests.map(({ source, ...r }) => r));
    if (!b && M === 'POST') {
      const body = await readBody(req);
      const r = {
        id: store.id('req'), ref: store.nextRef(), status: 'new', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { subject: 'Manual entry', body: '' }, client: body.client || {}, legs: body.legs || [], pax: body.pax ?? null,
        category: body.category || null, notes: body.notes || null, engine: 'manual', quotes: [], rfqCount: 0,
      };
      db.requests.unshift(r);
      store.log('request', `Manual request ${r.ref} created`, { requestId: r.id });
      store.save();
      if (body.sendRfq) engine.autoRoute(r).catch((e) => console.error('[route]', e));
      return send(res, 201, r);
    }
    const r = db.requests.find((x) => x.id === b);
    if (!r) return send(res, 404, { error: 'Not found' });
    if (!c && M === 'GET') return send(res, 200, { ...r, outbox: db.outbox.filter((o) => o.requestId === r.id) });
    if (!c && M === 'PATCH') {
      Object.assign(r, pick(await readBody(req), ['status', 'notes', 'legs', 'pax', 'category', 'client', 'fee']));
      r.updatedAt = new Date().toISOString();
      store.save();
      return send(res, 200, r);
    }
    if (!c && M === 'DELETE') { db.requests = db.requests.filter((x) => x !== r); store.save(); return send(res, 200, { ok: true }); }
    if (c === 'routing' && M === 'GET') return send(res, 200, routingView(r));
    if (c === 'discover' && M === 'POST') {
      const dep = routing.departure(r);
      if (!dep) return send(res, 400, { error: 'Departure airport not recognised. Edit the trip and use an airport code like EGLF or LTN.' });
      if (!routing.aiEnabled()) return send(res, 400, { error: 'Finding operators online needs ANTHROPIC_API_KEY on the server.' });
      delete (db.discoveries || {})[dep.icao];
      const out = await routing.discoverNearby(dep, db.settings.routing.minOperators);
      return send(res, 200, { added: out.added.length, ...routingView(r) });
    }
    if (c === 'route' && M === 'POST') return send(res, 200, { queued: await engine.autoRoute(r) });
    if (c === 'rfq' && M === 'POST') {
      const body = await readBody(req);
      const n = engine.queueRfqs(r, { onlyContactIds: body.contactIds || [] });
      engine.drainOutbox();
      return send(res, 200, { queued: n });
    }
    if (c === 'invoice' && M === 'POST') {
      const { quoteId } = await readBody(req);
      try { return send(res, 201, invoices.create(r, quoteId)); }
      catch (e) { return send(res, e.status || 400, { error: e.message }); }
    }
    if (c === 'quotes' && d && M === 'PATCH') {
      const q = r.quotes.find((x) => x.id === d);
      if (!q) return send(res, 404, { error: 'Not found' });
      const body = await readBody(req);
      Object.assign(q, pick(body, ['status', 'price', 'currency', 'aircraft', 'notes']));
      if (body.status === 'selected') {
        r.quotes.forEach((x) => { if (x !== q && x.status === 'selected') x.status = 'received'; });
        r.status = 'proposal';
      }
      store.save();
      return send(res, 200, r);
    }
  }

  // contacts
  if (a === 'contacts') {
    if (!b && M === 'GET') return send(res, 200, db.contacts);
    if (b === 'import' && M === 'POST') {
      const { csv, type } = await readBody(req);
      let added = 0, updated = 0;
      for (const row of parseCsv(csv || '')) {
        const email = (row.email || row['e-mail'] || row['email address'] || '').toLowerCase();
        if (!/@/.test(email)) continue;
        const data = {
          name: row.name || [row['first name'], row['last name']].filter(Boolean).join(' ') || email,
          company: row.company || row.organization || row.operator || '', phone: row.phone || row.mobile || '',
          type: ['broker', 'operator', 'client'].includes((row.type || '').toLowerCase()) ? row.type.toLowerCase() : (type || 'operator'),
          region: row.region || row.city || row.country || '', bases: row.bases || row.base || row.icao || row.airport || '',
          fleet: row.fleet || row.aircraft || '', email,
          ...(row.worldwide || row.global ? { global: /^(y|yes|true|1)$/i.test(row.worldwide || row.global) } : {}),
        };
        const ex = db.contacts.find((x) => x.email === email);
        if (ex) { Object.assign(ex, Object.fromEntries(Object.entries(data).filter(([, v]) => v))); updated++; }
        else { db.contacts.push({ id: store.id('con'), rfqEnabled: data.type !== 'client', createdAt: new Date().toISOString(), ...data }); added++; }
      }
      store.save();
      return send(res, 200, { added, updated });
    }
    if (!b && M === 'POST') {
      const body = pick(await readBody(req), CONTACT_FIELDS);
      body.email = (body.email || '').toLowerCase().trim();
      if (!/@/.test(body.email)) return send(res, 400, { error: 'Valid email required' });
      if (db.contacts.some((x) => x.email === body.email)) return send(res, 409, { error: 'Contact already exists' });
      const con = { id: store.id('con'), type: 'operator', rfqEnabled: true, createdAt: new Date().toISOString(), ...body };
      db.contacts.push(con);
      store.save();
      return send(res, 201, con);
    }
    const con = db.contacts.find((x) => x.id === b);
    if (!con) return send(res, 404, { error: 'Not found' });
    if (M === 'PATCH') { Object.assign(con, pick(await readBody(req), CONTACT_FIELDS)); store.save(); return send(res, 200, con); }
    if (M === 'DELETE') { db.contacts = db.contacts.filter((x) => x !== con); store.save(); return send(res, 200, { ok: true }); }
  }

  if (a === 'business' && M === 'PUT') {
    const body = await readBody(req);
    const fields = ['name', 'address', 'taxId', 'regNo', 'email', 'phone', 'website', 'bankName', 'accountName', 'iban', 'swift',
      'baseCurrency', 'feeType', 'feeValue', 'feeMin', 'feeDisplay', 'vatRate', 'vatOn', 'invoicePrefix', 'nextInvoiceNo', 'paymentTermsDays', 'invoiceNotes'];
    Object.assign(db.business, pick(body, fields));
    for (const k of ['feeValue', 'feeMin', 'vatRate', 'nextInvoiceNo', 'paymentTermsDays']) db.business[k] = Number(db.business[k]) || 0;
    if (body.fxText !== undefined) db.business.fxRates = Pricing.parseFx(body.fxText);
    db.business.baseCurrency = String(db.business.baseCurrency || 'EUR').toUpperCase();
    store.save();
    return send(res, 200, publicState());
  }

  if (a === 'invoices') {
    if (!b && M === 'GET') return send(res, 200, db.invoices);
    const inv = db.invoices.find((x) => x.id === b);
    if (!inv) return send(res, 404, { error: 'Invoice not found' });
    if (!c && M === 'GET') return send(res, 200, inv);
    if (!c && M === 'PATCH') {
      const { status } = await readBody(req);
      if (!['issued', 'sent', 'paid', 'void'].includes(status)) return send(res, 400, { error: 'Unknown status' });
      inv.status = status;
      if (status === 'paid') {
        inv.paidAt = new Date().toISOString();
        const r = db.requests.find((x) => x.id === inv.requestId);
        if (r) r.status = 'won';
      }
      store.log('invoice', `Invoice ${inv.number} marked ${status}`, { requestId: inv.requestId });
      store.save();
      return send(res, 200, inv);
    }
    if (c === 'send' && M === 'POST') {
      if (!inv.billTo.email) return send(res, 400, { error: 'The client has no email address. Add one on the request first.' });
      const body = `Dear ${inv.billTo.name?.split(' ')[0] || 'Sir/Madam'},\n\nPlease find attached invoice ${inv.number} for your private charter (ref ${inv.requestRef}).\n\nTotal due: ${inv.currency} ${inv.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}\nDue date: ${inv.dueDate}\n\nKind regards,\n${db.settings.senderName}\n${inv.seller.name}`;
      if (engine.live()) {
        const buf = await invoices.pdf(inv);
        await graph.sendMail({ to: inv.billTo.email, toName: inv.billTo.name, subject: `Invoice ${inv.number} | ${inv.seller.name}`, body,
          attachments: [{ name: `${inv.number}.pdf`, contentType: 'application/pdf', base64: buf.toString('base64') }] });
      }
      inv.status = inv.status === 'paid' ? 'paid' : 'sent';
      inv.sentAt = new Date().toISOString();
      inv.sentSimulated = !engine.live();
      store.log('invoice', `Invoice ${inv.number} ${engine.live() ? 'emailed' : 'sent (simulated)'} to ${inv.billTo.email}`, { requestId: inv.requestId });
      store.save();
      return send(res, 200, inv);
    }
  }

  if (a === 'outbox' && M === 'GET') return send(res, 200, db.outbox.slice(-300).reverse());
  if (a === 'activity' && M === 'GET') return send(res, 200, db.activity.slice(0, 100));

  if (a === 'settings' && M === 'PUT') {
    const body = await readBody(req);
    Object.assign(db.settings, pick(body, ['autoSendRfq', 'senderName']));
    if (body.routing) {
      const rt = body.routing;
      db.settings.routing = {
        mode: rt.mode === 'all' ? 'all' : 'nearby', radiusKm: Math.max(50, Number(rt.radiusKm) || 800),
        minOperators: Math.max(0, Number(rt.minOperators) || 0), webDiscovery: Boolean(rt.webDiscovery), emailWebContacts: Boolean(rt.emailWebContacts),
      };
    }
    if (body.template?.subject && body.template?.body) db.settings.template = { subject: body.template.subject, body: body.template.body };
    if (body.resetTemplate) db.settings.template = store.DEFAULT_TEMPLATE;
    store.save();
    return send(res, 200, publicState());
  }

  if (a === 'demo' && b === 'email' && M === 'POST') {
    if (engine.live()) return send(res, 400, { error: 'Demo inbox is disabled while Outlook is connected' });
    const body = await readBody(req);
    engine.injectDemoEmail({ fromName: body.fromName || 'Demo Client', fromEmail: body.fromEmail || 'client@example.com', subject: body.subject || 'Charter enquiry', body: body.body || '' });
    return send(res, 200, await engine.poll());
  }

  return send(res, 404, { error: 'Not found' });
}

const oauthStates = new Map();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);

    const pdfMatch = url.pathname.match(/^\/invoices\/(inv_[a-f0-9]+)\.pdf$/);
    if (pdfMatch) {
      if (!authed(req)) return send(res, 401, { error: 'auth' });
      const inv = store.load().invoices.find((x) => x.id === pdfMatch[1]);
      if (!inv) return send(res, 404, { error: 'Invoice not found' });
      const buf = await invoices.pdf(inv);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${inv.number}.pdf"`, 'Cache-Control': 'no-store' });
      return res.end(buf);
    }
    if (url.pathname === '/auth/login') {
      if (!authed(req)) return res.writeHead(302, { Location: '/' }).end();
      if (!graph.configured()) return send(res, 400, { error: 'Set MS_CLIENT_ID and MS_CLIENT_SECRET first' });
      const state = crypto.randomBytes(16).toString('hex');
      oauthStates.set(state, Date.now());
      return res.writeHead(302, { Location: graph.authUrl(state) }).end();
    }
    if (url.pathname === '/auth/callback') {
      const state = url.searchParams.get('state');
      if (!oauthStates.delete(state)) return res.writeHead(400).end('Invalid OAuth state');
      if (url.searchParams.get('error')) return res.writeHead(302, { Location: `/#/settings?error=${encodeURIComponent(url.searchParams.get('error_description') || 'denied')}` }).end();
      await graph.exchangeCode(url.searchParams.get('code'));
      store.load().settings.lastPollAt = new Date(Date.now() - 3600000).toISOString(); // start with last hour of mail
      store.save();
      engine.poll();
      return res.writeHead(302, { Location: '/#/settings?connected=1' }).end();
    }
    if (url.pathname === '/auth/disconnect' && req.method === 'POST') {
      if (!authed(req)) return send(res, 401, { error: 'auth' });
      graph.disconnect();
      return send(res, 200, { ok: true });
    }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

seed.ensure();
server.listen(PORT, () => {
  console.log(`SkyDesk CRM on http://localhost:${PORT}  (Outlook: ${engine.live() ? 'connected' : graph.configured() ? 'not connected' : 'demo mode'}, AI parsing: ${aiEnabled() ? 'Claude' : 'rules'})`);
  engine.start();
});
