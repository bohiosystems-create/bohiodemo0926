/* SkyDesk – mobile CRM front end (vanilla JS, hash routing). */
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { new: 'New', rfq_sent: 'RFQ sent', quoting: 'Quoting', proposal: 'Proposal', won: 'Won', lost: 'Lost' };
const TYPES = { broker: 'Broker', operator: 'Operator', client: 'Client' };
let state = null;
let lastSync = 0;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/login') { renderLogin(); throw new Error('auth'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}
const ago = (iso) => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`; return new Date(iso).toLocaleDateString();
};
const fmtDate = (d) => d ? new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Date TBC';
const money = (n, c) => n == null ? '—' : `${c || ''} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim();
const curOptions = (sel) => [...new Set([...Pricing.CURRENCIES, ...Object.keys(state?.business?.fxRates || {}), sel].filter(Boolean))].sort()
  .map((c) => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
const apCode = (a) => a && (a.iata || a.icao);
// One leg endpoint for display: exact airport, or a city whose airport the client hasn't chosen.
function endpointHtml(e) {
  if (!e) return '';
  if (e.status === 'airport') return `<b>${esc(e.airport.city && !e.airport.name.includes(e.airport.city) ? e.airport.city + ' · ' : '')}${esc(e.airport.name)}</b> <span class="code">${esc([e.airport.iata, e.airport.icao].filter(Boolean).join(' / '))}</span>`;
  if (e.status === 'city') return `<b>${esc(e.city.name)}</b> <span class="tbc">airport not specified · ${e.options.length} airports</span>`;
  return `<b>${esc(e.text)}</b> <span class="tbc">airport not recognised</span>`;
}
const minsLeft = (iso) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 60000));
function offerState(r) {
  if (r.proposal?.status === 'pending') return { kind: 'pending', text: 'Offer ready: needs your approval' };
  if (r.proposal?.status === 'sent') return { kind: r.proposal.needsReview ? 'pending' : 'sent', text: r.proposal.needsReview ? `Client replied: check quotation ${r.proposal.quotationNumber || ''}` : `Quotation ${r.proposal.quotationNumber || ''} sent · awaiting client` };
  if (r.proposal?.status === 'accepted') return { kind: 'pending', text: `Client accepted ${r.proposal.quotationNumber}: confirm to send invoice` };
  if (r.proposal?.status === 'awarded') return { kind: 'sent', text: `Awarded · invoice ${r.proposal.invoiceNumber || ''} ${r.proposal.invoiceSentAt ? 'sent' : 'issued'}` };
  if (r.proposal?.status === 'declined') return { kind: 'sent', text: 'Client declined the quotation' };
  if (r.quoteWindow) { const m = minsLeft(r.quoteWindow.closesAt); return { kind: 'window', text: m ? `Collecting quotes · ${m} min left` : 'Picking the best quote…' }; }
  return null;
}
const initials = (n) => (n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
function routeHtml(r) {
  if (!r.legs?.length) return '<span class="muted">Route TBC</span>';
  const pts = r.legs.map((l) => l.from).concat(r.legs[r.legs.length - 1].to);
  return pts.map((p) => `<span>${esc(p)}</span>`).join('<span class="arrow">→</span>');
}
function sheet(html, onMount) {
  const s = $('#sheet'); $('#sheetCard').innerHTML = `<button class="sheet-close" aria-label="Close" type="button">×</button>${html}`; s.hidden = false;
  $('.sheet-close', s).onclick = closeSheet;
  s.onclick = (e) => { if (e.target === s) closeSheet(); };
  onMount && onMount($('#sheetCard'));
}
const closeSheet = () => ($('#sheet').hidden = true);

// ---------- sync indicator / live refresh ----------
async function refreshState() {
  try { state = await api('/state'); } catch { return; }
  updateSync();
}
function updateSync() {
  if (!state) return;
  const s = state.settings, dot = $('#syncDot');
  dot.className = 'dot ' + (s.lastPollStatus === 'error' ? 'err' : s.lastPollStatus === 'ok' ? 'ok' : '');
  const mode = state.outlook.live ? 'Inbox' : 'Demo inbox';
  $('#syncText').textContent = s.lastPollStatus === 'error' ? 'Sync error' : `${mode} · ${ago(s.lastPollAt)}`;
}
$('#syncBtn').onclick = async () => {
  $('#syncDot').className = 'dot spin'; $('#syncText').textContent = 'Checking…';
  try {
    const r = await api('/poll', { method: 'POST' });
    toast(r.skipped ? 'Already checking…' : `Checked ${r.checked} new email${r.checked === 1 ? '' : 's'}`);
  } catch (e) { toast(e.message); }
  await refreshState(); route();
};
function connectLive() {
  try {
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === 'request') toast('✈ New charter request received');
      if (e.type === 'quote') toast('New quote received');
      if (e.type === 'proposal') toast('Offer ready for your approval');
      if (e.type === 'award') toast('Flight awarded: invoice sent to the client');
      if (e.type === 'accepted') toast('Client accepted a quotation: confirm to send the invoice');
      clearTimeout(connectLive.t);
      connectLive.t = setTimeout(() => { refreshState(); if (!$('#sheet').hidden || document.activeElement?.matches('input,textarea,select')) return; route(); }, 400);
    };
  } catch {}
}
setInterval(updateSync, 5000);
setInterval(() => { refreshState(); if (location.hash === '' || location.hash === '#/') route(); }, 60000);

// ---------- views ----------
let reqFilter = 'open';
async function renderRequests() {
  const reqs = await api('/requests');
  const open = reqs.filter((r) => !['won', 'lost'].includes(r.status));
  const filters = { open: 'Open', all: 'All', ...STATUS };
  // Trips waiting on you (offer to approve, client acceptance to confirm, unclear reply) first, then other open trips, then won/lost.
  const needsYou = (r) => r.proposal?.status === 'pending' || r.proposal?.status === 'accepted' || !!r.proposal?.needsReview;
  const shown = [...open.filter(needsYou), ...open.filter((r) => !needsYou(r)), ...reqs.filter((r) => !open.includes(r))];
  view.innerHTML = `
    <div class="hero" aria-hidden="true"></div>
    <div class="stats">
      <div class="stat"><b>${open.length}</b><span>Open requests</span></div>
      <div class="stat"><b>${reqs.reduce((n, r) => n + r.quotes.length, 0)}</b><span>Quotes in</span></div>
      <div class="stat"><b>${reqs.filter((r) => r.status === 'won').length}</b><span>Won</span></div>
    </div>
    ${shown.length ? shown.map((r) => {
      const best = Pricing.compareQuotes(r, state.business).best;
      const tbc = (r.legInfo || []).some((x) => x.from.status !== 'airport' || x.to.status !== 'airport');
      return `<a class="card trip-card" href="#/req/${r.id}">
        <div class="small muted">${esc(r.ref)}</div>
        <div class="route" style="margin-top:4px">${routeHtml(r)}</div>
        <div class="trip-ac">${esc(r.category || 'Aircraft type to confirm')}</div>
      </a>`;
    }).join('') : `<div class="empty">No requests here yet.<br><span class="small">New charter enquiries arriving in your inbox appear automatically.</span></div>`}
    <button class="fab" id="newReq" aria-label="New request"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
  $('#newReq').onclick = newRequestSheet;
}

function legEditor(legs) {
  return `<div id="legs">${(legs.length ? legs : [{}]).map((l, i) => `
    <div class="card" style="padding:10px" data-leg>
      <div class="grid2"><input placeholder="From (e.g. Luton or LTN)" value="${esc(l.from)}" data-k="from" data-code="fromCode"><input placeholder="To (e.g. NCE)" value="${esc(l.to)}" data-k="to" data-code="toCode"></div>
      <input type="hidden" data-k="fromCode" value="${esc(l.fromCode || '')}"><input type="hidden" data-k="toCode" value="${esc(l.toCode || '')}">
      <div class="grid2" style="margin-top:8px"><input type="date" value="${esc(l.date)}" data-k="date"><input type="time" value="${esc(l.time)}" data-k="time"></div>
    </div>`).join('')}</div>
    <button class="btn sm" type="button" id="addLeg">+ Add leg</button>`;
}
const readLegs = (root) => [...root.querySelectorAll('[data-leg]')].map((el) => Object.fromEntries([...el.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value || null]))).filter((l) => l.from && l.to);
function wireLegs(root) {
  // Typing a new place clears the airport code chosen earlier for it.
  root.querySelectorAll('[data-code]').forEach((i) => (i.oninput = () => { const h = i.closest('[data-leg]').querySelector(`[data-k="${i.dataset.code}"]`); if (h) h.value = ''; }));
  $('#addLeg', root).onclick = () => { const legs = readLegs(root); legs.push({}); $('#legs', root).outerHTML = legEditor(legs).split('<button')[0]; wireLegs(root); };
}

function newRequestSheet() {
  sheet(`<h2>New request</h2>
    <label>Client name</label><input id="cn"><label>Client email</label><input id="ce" type="email">
    <label>Itinerary</label>${legEditor([])}
    <div class="grid2"><div><label>Passengers</label><input id="px" type="number" min="1"></div>
    <div><label>Category</label><select id="cat"><option value="">Any</option>${['Turboprop', 'Light', 'Midsize', 'Super Midsize', 'Heavy', 'Ultra Long Range', 'Airliner'].map((c) => `<option>${c}</option>`).join('')}</select></div></div>
    <label>Client currency</label><select id="ccy">${curOptions(state.business.baseCurrency)}</select>
    <label>Notes</label><textarea id="nt" style="min-height:70px"></textarea>
    <div class="row" style="margin-top:14px"><button class="btn grow" id="save">Save</button><button class="btn primary grow" id="saveSend">Save & send RFQs</button></div>`, (root) => {
    wireLegs(root);
    const go = async (sendRfq) => {
      const legs = readLegs(root);
      if (!legs.length) return toast('Add at least one leg');
      const r = await api('/requests', { method: 'POST', body: { client: { name: $('#cn').value, email: $('#ce').value }, legs, pax: +$('#px').value || null, category: $('#cat').value || null, notes: $('#nt').value || null, currency: $('#ccy').value, sendRfq } });
      closeSheet(); toast(sendRfq ? 'RFQs queued' : 'Saved'); location.hash = `#/req/${r.id}`;
    };
    $('#save').onclick = () => go(false); $('#saveSend').onclick = () => go(true);
  });
}

async function renderRequest(id) {
  const r = await api(`/requests/${id}`);
  const biz = state.business;
  const cmp = Pricing.compareQuotes(r, biz);
  const quotes = cmp.rows;
  const rule = cmp.rule;
  const feeLabel = rule.type === 'fixed' ? money(rule.value, biz.baseCurrency) + ' fixed' : `${rule.value}%${rule.min ? ` (min ${money(rule.min, '')})` : ''}`;
  const rfqs = r.outbox.filter((o) => (o.kind || 'rfq') === 'rfq');
  const chasersOf = (o) => r.outbox.filter((x) => x.kind === 'followup' && x.parentId === o.id);
  const sent = rfqs.filter((o) => ['sent', 'simulated'].includes(o.status)).length;
  const queued = rfqs.filter((o) => o.status === 'queued').length;
  const fu = state.settings.followUp || {};
  const repliedFrom = new Set(r.quotes.map((q) => q.fromEmail));
  view.innerHTML = `
    <a class="back" href="#/">‹ Requests</a>
    <div class="row between"><span class="muted small">${esc(r.ref)} · via ${r.engine === 'claude' ? 'AI parsing' : r.engine === 'manual' ? 'manual entry' : 'rule parsing'}</span>
      <select id="status" style="width:auto;padding:6px 10px;font-size:14px">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="route" style="font-size:22px;margin:10px 0 4px">${routeHtml(r)}</div>
    <div class="card"><div class="legs">${r.legs.map((l, i) => { const li = r.legInfo[i]; return `<div class="leg">
        <div class="small muted">Leg ${i + 1} · ${fmtDate(l.date)}${l.time ? ' · ' + esc(l.time) : ''}</div>
        <div class="ep">${endpointHtml(li.from)}${li.from.status === 'city' ? `<button class="btn sm" data-pick-ap="${i}:from">Choose airport</button>` : ''}</div>
        <div class="ep"><span class="arrow">→</span> ${endpointHtml(li.to)}${li.to.status === 'city' ? `<button class="btn sm" data-pick-ap="${i}:to">Choose airport</button>` : ''}</div></div>`; }).join('') || '<span class="muted">No legs parsed. Tap Edit to add them.</span>'}</div>
      ${(r.legInfo || []).some((x) => x.from.status === 'city' || x.to.status === 'city') ? '<div class="small muted" style="margin-top:8px">The client named a city with several airports. RFQs say "airport flexible" and list them; choose one once the client confirms.</div>' : ''}
      <div class="kv" style="margin-top:12px"><div><span>Passengers</span><b>${r.pax ?? 'TBC'}</b></div><div><span>Category</span><b>${esc(r.category || 'Any')}</b></div>
        <div><span>Client currency</span><b>${esc(Pricing.clientCurrency(r, biz))} <button class="btn sm" id="ccy">Change</button></b></div></div>
      ${r.notes ? `<p class="small" style="margin:10px 0 0">${esc(r.notes)}</p>` : ''}
      <button class="btn sm" style="margin-top:10px" id="edit">Edit trip</button></div>

    <h3>Client</h3>
    <div class="card row"><div class="avatar">${initials(r.client?.name)}</div><div class="grow"><b>${esc(r.client?.name || 'Unknown')}</b><div class="small muted">${esc(r.client?.company || '')} ${esc(r.client?.email || '')}</div></div>
      ${r.client?.phone ? `<a class="btn sm" href="tel:${esc(r.client.phone)}">Call</a>` : ''}${r.client?.email ? `<a class="btn sm" href="mailto:${esc(r.client.email)}?subject=${encodeURIComponent('Your charter: ' + r.legs.map((l) => l.from + '-' + l.to).join(', '))}">Email</a>` : ''}</div>

    ${offerCard(r)}
    <div class="row between"><h3>Quote comparison (${quotes.length})</h3><button class="chip" id="fee">Fee ${esc(feeLabel)}${r.fee ? '' : ' · default'}</button></div>
    ${cmp.missingRates.length ? `<div class="banner">No exchange rate for ${cmp.missingRates.join(', ')}, so ${cmp.missingRates.length === 1 ? 'that quote' : 'those quotes'} can't be compared in ${esc(cmp.target)}. Refresh rates or add one in Settings → Tax & currency.</div>` : ''}
    ${cmp.mixedCurrencies || quotes.some((q) => q.converted) ? `<div class="small muted" style="margin:-4px 0 8px">Client prices converted to ${esc(cmp.target)}${biz.fxBufferPct ? ` with a ${biz.fxBufferPct}% FX buffer` : ''} · rates ${biz.fxUpdatedAt ? `${esc(biz.fxSource)}, ${ago(biz.fxUpdatedAt)}` : 'entered manually'}</div>` : ''}
    ${quotes.length ? quotes.map((q) => `<div class="card quote ${q.isBest ? 'is-best' : ''}">
      <div class="avatar">${initials(q.company)}</div>
      <div class="grow">
        <div class="row between"><b>${esc(q.company || q.fromName)}</b>${q.status === 'selected' ? '<span class="badge selected">Selected</span>' : q.isBest ? '<span class="best">BEST FOR CLIENT</span>' : q.deltaPct != null ? `<span class="small muted">+${q.deltaPct}% vs best</span>` : ''}</div>
        <div class="small muted">${esc([q.aircraft, q.year && 'YOM ' + q.year, q.tail].filter(Boolean).join(' · ') || 'Aircraft not stated')}${q.ageYears != null && q.ageYears > 15 ? ` <span style="color:var(--amber)">· ${q.ageYears} yrs old</span>` : ''}</div>
        ${q.price != null ? `<div class="pricegrid">
          <div><span>Operator</span><b>${money(q.price, q.currency)}</b></div>
          <div><span>Your fee</span><b>${money(q.fee, q.currency)}</b></div>
          <div><span>Client price</span><b class="price">${q.clientPriceTarget != null ? money(q.clientPriceTarget, cmp.target) : money(q.clientPrice, q.currency)}</b>${q.converted && q.clientPriceTarget != null ? `<small>from ${money(q.clientPrice, q.currency)}</small>` : ''}</div>
        </div>` : '<div class="small" style="color:var(--amber);margin-top:6px">No price found in this reply. Tap Edit to enter it.</div>'}
        <div class="row" style="margin-top:8px;justify-content:flex-end">
          <button class="btn sm" data-view="${q.id}">Email</button><button class="btn sm" data-qedit="${q.id}">Edit</button>
          ${r.invoiceId && q.status === 'selected' ? `<button class="btn sm primary" data-inv="${r.invoiceId}">View invoice</button>` : q.price != null ? `<button class="btn sm primary" data-issue="${q.id}">Invoice client</button>` : ''}
        </div>
      </div></div>`).join('') : `<div class="card muted small">No quotes yet. Replies to the RFQ (with ${esc(r.ref)} in the subject) are attached and compared here automatically.</div>`}

    <h3>RFQ routing</h3>
    <div class="card">
      ${r.routing ? `<div class="route-head">
          <div><span class="small muted">Departure</span><b>${r.routing.area ? esc(`${r.routing.area.name} area`) : r.routing.airport ? esc(`${r.routing.airport.name} (${r.routing.airport.iata || r.routing.airport.icao})`) : 'Not recognised'}</b>${r.routing.area ? `<span class="small muted">Airport flexible · distances from the nearest of ${esc(r.routing.area.airports.join(', '))}</span>` : r.routing.airport ? `<span class="small muted">${esc(r.routing.airport.country)}</span>` : ''}</div>
        </div>
        <div class="route-stats"><div><b>${r.routing.nearby}</b><span>operators within ${r.routing.radiusKm} km</span></div><div><b>${r.routing.capable ?? '–'}</b><span>with a suitable fleet</span></div><div><b>${r.routing.worldwide}</b><span>worldwide brokers</span></div></div>
        <div class="small muted" style="margin-top:6px">${r.routing.needs ? `Trip needs: ${r.routing.needs.pax ?? '?'} seats${r.routing.needs.category ? `, ${esc(r.routing.needs.category)} or larger` : ''}${r.routing.needs.longestLegKm ? `, ${r.routing.needs.longestLegKm.toLocaleString()} km longest leg` : ''}.` : ''}${r.routing.discovered ? ` ${r.routing.discovered} operator${r.routing.discovered === 1 ? '' : 's'} found online.` : ''}${r.routing.excludedUnsuitable ? ` ${r.routing.excludedUnsuitable} nearby operator${r.routing.excludedUnsuitable === 1 ? '' : 's'} skipped: fleet can't do this trip.` : ''}</div>
        ${r.routing.discoveryNote ? `<div class="small muted" style="margin-top:6px">Online search: ${esc(r.routing.discoveryNote)}</div>` : ''}`
      : r.status === 'new' && r.legs.length && state.settings.autoSendRfq ? '<div class="small muted">Finding operators near the departure airport…</div>' : ''}
      <div style="margin-top:12px"><b>${sent}</b> sent${queued ? ` · <b>${queued}</b> queued` : ''} · <b>${repliedFrom.size}</b> replied</div>
      <div class="grid2" style="margin-top:8px"><button class="btn sm" id="disco">Find operators online</button><button class="btn sm primary" id="rfq">Send RFQ</button></div>
      ${fu.enabled ? `<div class="small muted" style="margin-top:6px">Operators who haven't replied are chased every ${fu.everyMinutes} min, up to ${fu.maxPerOperator} times.</div>` : ''}
      <div class="rfq-list">${rfqs.map((o) => { const reply = r.quotes.find((q) => q.fromEmail === o.to); const ch = chasersOf(o); return `<details class="rfq-item">
        <summary><span class="grow">${esc(o.toName || o.to)}${o.foundOnline ? ' <span class="badge web">online</span>' : ''}${reply ? ' <span style="color:var(--green)">· replied</span>' : ch.length ? ` <span class="tbc">· chased ${ch.length}×</span>` : ''}<small>${esc(o.reason || '')}</small></span><span class="badge ${o.status}">${o.status}</span><svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></summary>
        <div class="mail">
          <div class="mail-head"><span>Sent to</span> ${esc(o.toName || '')} &lt;${esc(o.to)}&gt;${o.sentAt ? ` · ${ago(o.sentAt)}` : ''}</div>
          <div class="mail-head"><span>Subject</span> ${esc(o.subject)}</div>
          <div class="email-src">${esc(o.body)}</div>
          ${ch.map((x) => `<div class="mail-head" style="margin-top:10px"><span>Follow-up ${x.followUpNo}</span> ${x.status === 'queued' ? 'sending…' : ago(x.sentAt)}</div><div class="email-src">${esc(x.body.split('---- Original request ----')[0].trim())}</div>`).join('')}
          ${reply ? `<div class="mail-head" style="margin-top:10px"><span>Reply</span> ${esc(reply.fromName || reply.company)} · ${ago(reply.receivedAt)}</div><div class="email-src">${esc(reply.snippet)}</div>` : ''}
          ${o.error ? `<div class="small" style="color:var(--red);margin-top:6px">${esc(o.error)}</div>` : ''}
        </div></details>`; }).join('') || '<div class="muted">Not sent yet</div>'}</div>
      ${r.outbox.length ? '<div class="small muted" style="margin-top:6px">Tap a contact to see the email they were sent.</div>' : ''}</div>

    ${r.source?.body ? `<h3>Client emails</h3><div class="card thread">
      <details class="rfq-item" open><summary><span class="grow"><b>${esc(r.client?.name || 'Client')}</b> · request<small>${esc(r.source.subject)} · ${ago(r.source.receivedAt)}</small></span><svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></summary>
        <div class="mail"><div class="email-src">${esc(r.source.body)}</div></div></details>
      ${r.ack ? `<details class="rfq-item"><summary><span class="grow"><b>Instant reply</b> <span style="color:var(--green)">· ${r.ack.error ? '' : r.ack.simulated ? 'sent (demo)' : 'sent'}</span>${r.ack.error ? ' <span style="color:var(--red)">· failed</span>' : ''}<small>to ${esc(r.ack.to)} · ${ago(r.ack.at)}</small></span><svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></summary>
        <div class="mail"><div class="mail-head"><span>Subject</span> ${esc(r.ack.subject)}</div><div class="email-src">${esc(r.ack.body)}</div>${r.ack.error ? `<div class="small" style="color:var(--red);margin-top:6px">${esc(r.ack.error)}</div>` : ''}</div></details>` : ''}
      ${(r.clientMessages || []).map((m) => `<details class="rfq-item"><summary><span class="grow"><b>${esc(r.client?.name || 'Client')}</b> · reply<small>${esc(m.subject)} · ${ago(m.at)}</small></span><svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></summary><div class="mail"><div class="email-src">${esc(m.body)}</div></div></details>`).join('')}
    </div>` : ''}
    <button class="btn danger block" style="margin-top:24px" id="del">Delete request</button>`;

  $('#status').onchange = async (e) => { await api(`/requests/${id}`, { method: 'PATCH', body: { status: e.target.value } }); toast('Status updated'); };
  const ap = $('#approve'); if (ap) ap.onclick = () => approveSheet(r);
  const aw = $('#awardBtn'); if (aw) aw.onclick = async () => { if (!confirm(`Award ${r.ref} and email the invoice to ${r.client?.email || 'the client'}?`)) return; aw.disabled = true; try { const x = await api(`/requests/${id}/award`, { method: 'POST' }); toast(`Awarded: invoice ${x.proposal.invoiceNumber} sent`); renderRequest(id); } catch (e) { toast(e.message); aw.disabled = false; } };
  const dc = $('#declineBtn'); if (dc) dc.onclick = async () => { if (!confirm('Mark the quotation as declined? The trip moves to Lost.')) return; await api(`/requests/${id}/decline`, { method: 'POST' }); renderRequest(id); };
  const pn = $('#pickNow'); if (pn) pn.onclick = async () => { await api(`/requests/${id}/proposal/now`, { method: 'POST' }); renderRequest(id); };
  view.querySelectorAll('[data-issue]').forEach((b) => (b.onclick = () => issueSheet(r, quotes.find((q) => q.id === b.dataset.issue))));
  view.querySelectorAll('[data-inv]').forEach((b) => (b.onclick = async () => invoiceSheet(await api(`/invoices/${b.dataset.inv}`))));
  view.querySelectorAll('[data-qedit]').forEach((b) => (b.onclick = () => quoteEditSheet(r, r.quotes.find((q) => q.id === b.dataset.qedit))));
  $('#fee').onclick = () => feeSheet(r);
  $('#ccy').onclick = () => sheet(`<h2>Client currency</h2><p class="small muted">Quotes are compared, and the invoice is issued, in this currency. Operator quotes in other currencies are converted at the current rate${biz.fxBufferPct ? ` plus your ${biz.fxBufferPct}% FX buffer` : ''}.</p>
    <select id="ccysel">${curOptions(Pricing.clientCurrency(r, biz))}</select>
    <label class="row" style="margin-top:12px;color:var(--text)"><input type="checkbox" id="ccydef" style="width:auto"> Remember for ${esc(r.client?.name || 'this client')}</label>
    <button class="btn primary block" style="margin-top:12px" id="ccysv">Save</button>`, () => {
    $('#ccysv').onclick = async () => {
      const cur = $('#ccysel').value;
      await api(`/requests/${id}`, { method: 'PATCH', body: { currency: cur } });
      if ($('#ccydef').checked && r.client?.id) await api(`/contacts/${r.client.id}`, { method: 'PATCH', body: { preferredCurrency: cur } }).catch(() => {});
      closeSheet(); renderRequest(id);
    };
  });
  view.querySelectorAll('[data-pick-ap]').forEach((b) => (b.onclick = () => {
    const [i, side] = b.dataset.pickAp.split(':'); const ep = r.legInfo[+i][side];
    sheet(`<h2>${esc(ep.city.name)}: which airport?</h2><p class="small muted">Leg ${+i + 1} ${side === 'from' ? 'departure' : 'arrival'}. Business-aviation airports are listed first.</p>
      ${ep.options.map((a) => `<button class="list-item ap-opt" data-ap="${esc(a.icao)}"><div class="avatar">${esc(apCode(a))}</div><div class="grow" style="text-align:left"><b>${esc(a.name)}</b><div class="small muted">${esc([a.iata, a.icao].filter(Boolean).join(' / '))} · ${esc(a.city)}</div></div></button>`).join('')}
      <p class="small muted" style="margin-top:12px">Or keep it flexible: operators are told any of these airports works.</p>`, (root) => {
      root.querySelectorAll('[data-ap]').forEach((o) => (o.onclick = async () => {
        const legs = r.legs.map((l, k) => (k === +i ? { ...l, [side + 'Code']: o.dataset.ap } : l));
        await api(`/requests/${id}`, { method: 'PATCH', body: { legs } }); closeSheet(); toast('Airport set'); renderRequest(id);
      }));
    });
  }));
  view.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { const q = r.quotes.find((x) => x.id === b.dataset.view); sheet(`<h2>${esc(q.company)}</h2><div class="small muted">${esc(q.fromEmail)} · ${ago(q.receivedAt)}</div><div class="email-src" style="margin-top:10px">${esc(q.snippet)}</div><a class="btn block" style="margin-top:12px" href="mailto:${esc(q.fromEmail)}?subject=${encodeURIComponent('RE: ' + r.ref)}">Reply</a>`); }));
  $('#del').onclick = async () => { if (confirm(`Delete ${r.ref}?`)) { await api(`/requests/${id}`, { method: 'DELETE' }); location.hash = '#/'; } };
  $('#rfq').onclick = () => rfqSheet(r);
  $('#disco').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Searching the web…';
    try { const x = await api(`/requests/${id}/discover`, { method: 'POST' }); toast(x.added ? `Added ${x.added} operators near ${x.airport.iata || x.airport.icao}` : 'No new verified operators found'); rfqSheet(r); }
    catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Find operators online'; }
  };
  $('#edit').onclick = () => sheet(`<h2>Edit trip</h2>${legEditor(r.legs)}
    <div class="grid2"><div><label>Passengers</label><input id="px" type="number" value="${r.pax ?? ''}"></div><div><label>Category</label><input id="cat" value="${esc(r.category || '')}"></div></div>
    <label>Notes</label><textarea id="nt" style="min-height:70px">${esc(r.notes || '')}</textarea>
    <button class="btn primary block" style="margin-top:12px" id="sv">Save</button>`, (root) => {
    wireLegs(root);
    $('#sv').onclick = async () => { await api(`/requests/${id}`, { method: 'PATCH', body: { legs: readLegs(root), pax: +$('#px').value || null, category: $('#cat').value || null, notes: $('#nt').value || null } }); closeSheet(); renderRequest(id); };
  });
}

function offerCard(r) {
  const p = r.proposal, w = r.quoteWindow;
  if (p?.status === 'pending') return `<h3>Offer to client</h3><div class="card offer pending">
      <div class="small muted">Recommended after ${p.quotesConsidered} quote${p.quotesConsidered === 1 ? '' : 's'}${p.updatedAt ? ' · updated ' + ago(p.updatedAt) : ''}</div>
      <div class="offer-main"><b>${esc(p.company)}</b><span>${esc(p.aircraft || 'Aircraft TBC')}</span></div>
      <div class="offer-price">${money(p.clientPrice, p.currency)} <span class="small muted">to client at ${p.feePct}% fee</span></div>
      <div class="small" style="margin-top:6px">${esc(p.why)}</div>
      <button class="btn primary block" style="margin-top:12px" id="approve">Review & approve</button>
      <div class="small muted" style="margin-top:6px">Nothing is sent to the client until you approve.</div></div>`;
  if (['sent', 'accepted', 'awarded', 'declined'].includes(p?.status)) {
    const expired = p.status === 'sent' && p.validUntil && Date.now() > Date.parse(p.validUntil);
    const badge = p.status === 'awarded' ? 'awarded' : p.status === 'accepted' ? 'client accepted' : p.status === 'declined' ? 'declined' : expired ? 'expired' : 'awaiting client';
    const validTxt = p.validUntil ? new Date(p.validUntil).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return `<h3>Quotation</h3><div class="card offer ${['sent', 'accepted'].includes(p.status) ? 'pending' : ''}">
      <div class="row between"><b>${esc(p.quotationNumber || 'Offer')}</b><span class="badge ${p.status === 'awarded' ? 'selected' : ''}">${badge}</span></div>
      <div class="small muted">${esc(p.company)} · ${esc(p.aircraft || '')} · ${p.feePct}% fee · sent ${ago(p.sentAt)}${p.simulated ? ' (demo)' : ''}${validTxt && p.status === 'sent' ? ` · valid until ${esc(validTxt)}` : ''}</div>
      <div class="offer-price">${money(p.clientPrice, p.currency)}</div>
      ${p.needsReview ? `<div class="banner" style="margin-top:8px">${esc(p.needsReview)}</div>` : ''}
      ${p.status === 'accepted' ? `<div class="accepted-box"><b>${esc((r.client?.name || 'The client').split(' ')[0])} accepted ${ago(p.acceptedAt)}</b><div class="small">${esc((p.acceptSource || '').replace(/^./, (c) => c.toUpperCase()))}. Confirm to award the flight and email invoice for ${money(p.clientPrice, p.currency)} (same amounts as the quotation).</div>
        ${(r.clientMessages || []).slice(-1).map((m) => `<div class="email-src" style="margin-top:8px">${esc(m.body)}</div>`).join('')}
        <button class="btn primary block" style="margin-top:10px" id="awardBtn">Confirm & send invoice</button><button class="btn block" style="margin-top:8px" id="declineBtn">Don't proceed</button></div>` : ''}
      ${p.status === 'sent' ? `<div class="small" style="margin-top:6px">When ${esc((r.client?.name || 'the client').split(' ')[0])} replies "Confirmed", you'll be asked to confirm, then the invoice is issued from this quotation and emailed.</div>
        <div class="grid2" style="margin-top:10px"><button class="btn primary" id="awardBtn">Awarded: send invoice</button><button class="btn" id="declineBtn">Client declined</button></div>` : ''}
      ${p.status === 'awarded' ? `<div class="small" style="margin-top:6px">Awarded ${ago(p.awardedAt)} (${esc(p.awardSource || '')}). Invoice <b>${esc(p.invoiceNumber || '')}</b> ${p.invoiceSentAt ? 'emailed to ' + esc(r.client?.email || '') : 'issued'}${p.invoiceError ? ' · ' + esc(p.invoiceError) : ''}.</div>
        <button class="btn block" style="margin-top:10px" data-inv="${p.invoiceId}">View invoice</button>` : ''}
      ${p.quotationId ? `<a class="btn sm" style="margin-top:10px" href="/quotations/${p.quotationId}.pdf" target="_blank" rel="noopener">Quotation PDF</a>` : ''}
      <details class="rfq-item"><summary><span class="grow">Email sent to ${esc(r.client?.email || '')}<small>${esc(p.subject)}</small></span><svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></summary><div class="mail"><div class="email-src">${esc(p.body)}</div></div></details></div>`;
  }
  if (w) {
    const m = minsLeft(w.closesAt);
    return `<h3>Offer to client</h3><div class="card offer">
      <b>${m ? `Collecting quotes · ${m} min left` : 'Picking the best quote…'}</b>
      <div class="small muted" style="margin-top:4px">The window opened with the first quote ${ago(w.opensAt)}. When it closes, the agent recommends the best quote on price and fit to the request, and asks for your approval.</div>
      ${r.quotes.length ? `<button class="btn block" style="margin-top:10px" id="pickNow">Recommend now (${r.quotes.length} quote${r.quotes.length === 1 ? '' : 's'} in)</button>` : ''}</div>`;
  }
  return '';
}

function approveSheet(r) {
  const biz = state.business, needs = r.routing?.needs || { pax: r.pax, category: r.category };
  let feePct = r.proposal.feePct ?? biz.feeValue, chosen = r.proposal.quoteId, edited = false;
  const draw = (root) => {
    const ev = Proposal.evaluate(r, biz, needs, feePct);
    const row = ev.rows.find((x) => x.id === chosen) || ev.best;
    const draft = Proposal.draftEmail(r, row, biz, { senderName: state.settings.senderName, routeText: r.legs.map((l) => `${l.from} → ${l.to}`).join(', ') });
    $('#ap_list', root).innerHTML = ev.rows.map((x) => `<label class="ap-row ${x.disqualified ? 'dq' : ''}"><input type="radio" name="ap" value="${x.id}" ${x.id === row.id ? 'checked' : ''} ${x.disqualified ? 'disabled' : ''} style="width:auto">
      <div class="grow"><div class="row between"><b>${esc(x.company)}</b><b>${x.clientPriceTarget != null ? money(x.clientPriceTarget, ev.target) : '—'}</b></div>
      <div class="small muted">${esc([x.aircraft, x.year && 'YOM ' + x.year].filter(Boolean).join(' · ') || 'Aircraft not stated')}${x.id === ev.best?.id ? ' · <b>agent\'s pick</b>' : ''}</div>
      ${x.disqualified ? `<div class="small">Not offered: ${esc(x.disqualified)}</div>` : ''}${x.penalties.length && !x.disqualified ? `<div class="small">Watch: ${esc(x.penalties.map((p) => p.text).join(', '))}</div>` : ''}${x.notes.length ? `<div class="small muted">${esc(x.notes.join(', '))}</div>` : ''}</div></label>`).join('');
    $('#ap_sum', root).innerHTML = `<div class="row between"><span>Operator price</span><b>${money(row.price, row.currency)}</b></div>
      <div class="row between"><span>Your fee (${feePct}%)</span><b>${money(row.fee, row.currency)}</b></div>
      <div class="row between" style="font-size:18px;margin-top:6px"><span>Client pays</span><b>${money(row.clientPriceTarget, ev.target)}</b></div>`;
    if (!edited) { $('#ap_subj', root).value = draft.subject; $('#ap_body', root).value = draft.body; }
    root.querySelectorAll('input[name=ap]').forEach((i) => (i.onchange = () => { chosen = i.value; edited = false; draw(root); }));
  };
  sheet(`<h2>Approve offer</h2><p class="small muted">${esc(r.ref)} · ${esc(r.client?.name || '')} · ${r.quotes.length} quote${r.quotes.length === 1 ? '' : 's'} ranked by client price and fit to the request.</p>
    <h3>Quote</h3><div id="ap_list"></div>
    <h3>Brokerage fee</h3><div class="row"><input id="ap_fee" type="number" step="0.5" min="0" max="50" value="${feePct}" style="max-width:110px"><span>%</span><span class="small muted grow">Standard is ${biz.feeValue}%.</span></div>
    <div class="card" id="ap_sum" style="margin-top:10px"></div>
    <h3>Email to ${esc(r.client?.email || 'client')}</h3>
    <input id="ap_subj"><textarea id="ap_body" style="min-height:240px;margin-top:8px"></textarea>
    <div class="small muted">The operator's name and tail number are not shown to the client.</div>
    <div class="small muted" style="margin-top:6px">Sent as a numbered quotation with a PDF attached, valid for ${state.settings.quoteValidityHours ?? 48} hours.</div>
    <button class="btn primary block" style="margin-top:12px" id="ap_go">Approve fee & send quotation</button>`, (root) => {
    $('#ap_fee').oninput = (e) => { feePct = Math.max(0, +e.target.value || 0); edited = false; draw(root); };
    ['ap_subj', 'ap_body'].forEach((k) => ($('#' + k).oninput = () => (edited = true)));
    $('#ap_go').onclick = async () => {
      try {
        await api(`/requests/${r.id}/proposal/approve`, { method: 'POST', body: { quoteId: chosen, feePct, subject: $('#ap_subj').value, body: $('#ap_body').value } });
        closeSheet(); toast('Quotation sent to the client'); renderRequest(r.id);
      } catch (e) { toast(e.message); }
    };
    draw(root);
  });
}

function feeSheet(r) {
  const biz = state.business, f = r.fee || { type: biz.feeType, value: biz.feeValue, min: biz.feeMin };
  sheet(`<h2>Brokerage fee for ${esc(r.ref)}</h2>
    <p class="small muted">Added on top of every operator price on this trip. Your default is ${biz.feeType === 'fixed' ? money(biz.feeValue, biz.baseCurrency) : biz.feeValue + '%'}.</p>
    <div class="grid2"><div><label>Type</label><select id="ft"><option value="percent" ${f.type === 'percent' ? 'selected' : ''}>Percentage</option><option value="fixed" ${f.type === 'fixed' ? 'selected' : ''}>Fixed amount</option></select></div>
    <div><label>Value</label><input id="fv" type="number" step="0.01" value="${f.value ?? 0}"></div></div>
    <label>Minimum fee (percentage only)</label><input id="fm" type="number" value="${f.min || 0}">
    <div class="row" style="margin-top:14px"><button class="btn grow" id="fdef">Use default</button><button class="btn primary grow" id="fsv">Apply to this trip</button></div>`, () => {
    $('#fsv').onclick = async () => { await api(`/requests/${r.id}`, { method: 'PATCH', body: { fee: { type: $('#ft').value, value: +$('#fv').value || 0, min: +$('#fm').value || 0 } } }); closeSheet(); renderRequest(r.id); };
    $('#fdef').onclick = async () => { await api(`/requests/${r.id}`, { method: 'PATCH', body: { fee: null } }); closeSheet(); renderRequest(r.id); };
  });
}

function quoteEditSheet(r, q) {
  sheet(`<h2>Edit quote</h2><p class="small muted">${esc(q.company)}: correct anything the email parser missed.</p>
    <div class="grid2"><div><label>Price</label><input id="qp" type="number" step="0.01" value="${q.price ?? ''}"></div><div><label>Currency</label><input id="qc" value="${esc(q.currency || state.business.baseCurrency)}" maxlength="3"></div></div>
    <label>Aircraft</label><input id="qa" value="${esc(q.aircraft || '')}">
    <button class="btn primary block" style="margin-top:14px" id="qsv">Save</button>`, () => {
    $('#qsv').onclick = async () => {
      await api(`/requests/${r.id}/quotes/${q.id}`, { method: 'PATCH', body: { price: $('#qp').value === '' ? null : +$('#qp').value, currency: $('#qc').value.toUpperCase(), aircraft: $('#qa').value } });
      closeSheet(); renderRequest(r.id);
    };
  });
}

function issueSheet(r, q) {
  const biz = state.business;
  const t = Pricing.invoiceTotals(q, Pricing.effectiveFee(r, biz), biz, Pricing.clientCurrency(r, biz));
  if (t.error) return toast(t.error);
  const missing = [!r.client?.email && 'client email', !biz.name ? 'business name' : null, !biz.iban && 'bank details'].filter(Boolean);
  const tbcAirports = (r.legInfo || []).flatMap((x) => [x.from, x.to]).filter((e) => e.status !== 'airport').map((e) => (e.city ? e.city.name : e.text));
  sheet(`<h2>Invoice ${esc(r.client?.name || 'client')}</h2>
    <p class="small muted">Issued under <b>${esc(biz.name)}</b> for the ${esc(q.company)} quote.</p>
    ${tbcAirports.length ? `<div class="banner">Airport not confirmed for ${esc([...new Set(tbcAirports)].join(', '))}. The invoice will show the city only; choose the airport on the trip first if you want it printed.</div>` : ''}
    ${missing.length ? `<div class="banner">Missing: ${missing.join(', ')}. ${missing.includes('client email') ? 'Edit the trip' : 'Fill in Settings → Business & invoicing'} before sending.</div>` : ''}
    <div class="card">
      ${t.lines.map((l) => `<div class="row between"><span>${l.kind === 'fee' ? 'Brokerage fee' : biz.feeDisplay === 'separate' ? 'Charter (operator price)' : 'Private charter (fee included)'}</span><b>${money(l.amount, t.currency)}</b></div>`).join('')}
      ${t.vatRate ? `<div class="row between small muted" style="margin-top:6px"><span>VAT ${t.vatRate}%${biz.vatOn === 'fee' ? ' on fee' : ''}</span><span>${money(t.vat, t.currency)}</span></div>` : ''}
      <div class="row between" style="margin-top:10px;font-size:18px"><span>Total</span><b>${money(t.total, t.currency)}</b></div>
      <div class="small muted" style="margin-top:6px">You keep ${money(t.fee, t.currency)}${t.fx && t.fx.bufferAmount ? ` + ${money(t.fx.bufferAmount, t.currency)} FX buffer` : ''} · operator receives ${t.fx ? money(t.fx.operatorPriceOriginal, t.fx.from) : money(t.operatorPrice, t.currency)}</div>
      ${t.fx ? `<div class="fxnote">Converted from ${esc(t.fx.from)} at 1 ${esc(t.fx.from)} = ${t.fx.rate} ${esc(t.fx.to)}${t.fx.bufferPct ? ` + ${t.fx.bufferPct}% FX buffer` : ''}. The rate is fixed on the invoice when you issue it. Pay the operator in ${esc(t.fx.from)}.</div>` : ''}
    </div>
    <button class="btn primary block" id="iss">Issue invoice</button>`, () => {
    $('#iss').onclick = async () => {
      try { const inv = await api(`/requests/${r.id}/invoice`, { method: 'POST', body: { quoteId: q.id } }); toast(`Invoice ${inv.number} issued`); await renderRequest(r.id); invoiceSheet(inv); }
      catch (e) { toast(e.message); }
    };
  });
}

function invoiceHtml(inv) {
  const s = inv.seller;
  return `<div class="invoice">
    <div class="inv-head"><div><b class="inv-biz">${esc(s.name)}</b><div class="inv-small">${esc(s.address || '').replace(/\n/g, '<br>')}${s.taxId ? `<br>VAT / Tax no. ${esc(s.taxId)}` : ''}${s.regNo ? `<br>Reg. ${esc(s.regNo)}` : ''}</div></div>
      <div style="text-align:right"><div class="inv-title">INVOICE</div><div class="inv-small">No. ${esc(inv.number)}<br>Issued ${esc(inv.issueDate)}<br>Due ${esc(inv.dueDate)}${inv.quotationNumber ? `<br>Quotation ${esc(inv.quotationNumber)}` : ''}${inv.requestRef ? `<br>Ref ${esc(inv.requestRef)}` : ''}</div></div></div>
    <div class="inv-small" style="margin:14px 0 4px;letter-spacing:.6px">BILL TO</div>
    <div>${[inv.billTo.company, inv.billTo.name, inv.billTo.email].filter(Boolean).map(esc).join('<br>')}</div>
    <table class="inv-table"><thead><tr><th>Description</th><th>${esc(inv.currency)}</th></tr></thead><tbody>
      ${inv.lines.map((l) => `<tr><td><b>${esc(l.description)}</b>${l.detail ? `<div class="inv-small">${esc(l.detail)}</div>` : ''}</td><td>${money(l.amount, '')}</td></tr>`).join('')}
      <tr class="sub"><td>Subtotal</td><td>${money(inv.subtotal, '')}</td></tr>
      ${inv.vatRate ? `<tr class="sub"><td>VAT ${inv.vatRate}%${s.vatOn === 'fee' ? ' on fee' : ''}</td><td>${money(inv.vat, '')}</td></tr>` : ''}
      <tr class="tot"><td>Total due</td><td>${money(inv.total, inv.currency)}</td></tr></tbody></table>
    ${s.iban ? `<div class="inv-small">${[s.accountName, s.bankName, s.iban && 'IBAN ' + s.iban, s.swift && 'SWIFT ' + s.swift].filter(Boolean).map(esc).join(' · ')} · Ref ${esc(inv.number)}</div>` : ''}
    ${s.invoiceNotes ? `<div class="inv-small" style="margin-top:8px">${esc(s.invoiceNotes)}</div>` : ''}
  </div>`;
}

function invoiceSheet(inv) {
  sheet(`<div class="row between"><h2>${esc(inv.number)}</h2><span class="badge inv-${inv.status}">${inv.status}${inv.sentSimulated ? ' (demo)' : ''}</span></div>
    ${invoiceHtml(inv)}
    ${inv.fx ? `<div class="fxnote">Internal note (not on the invoice): operator quote ${money(inv.fx.operatorPriceOriginal, inv.fx.from)} converted at 1 ${esc(inv.fx.from)} = ${inv.fx.rate} ${esc(inv.fx.to)}${inv.fx.bufferPct ? ` + ${inv.fx.bufferPct}% buffer` : ''} (${esc(inv.fx.source)}${inv.fx.at ? ', ' + esc(inv.fx.at.slice(0, 10)) : ''}).</div>` : ''}
    <div class="grid2" style="margin-top:12px"><a class="btn" href="/invoices/${inv.id}.pdf" target="_blank" rel="noopener" id="pdf">Open PDF</a>
      <button class="btn primary" id="snd">${inv.sentAt ? 'Send again' : 'Email to client'}</button></div>
    <div class="grid2" style="margin-top:8px">${inv.status !== 'paid' ? '<button class="btn" id="paid">Mark paid</button>' : '<span></span>'}${inv.status !== 'void' && inv.status !== 'paid' ? '<button class="btn danger" id="void">Void</button>' : ''}</div>`, () => {
    $('#snd').onclick = async () => { try { const x = await api(`/invoices/${inv.id}/send`, { method: 'POST' }); toast(x.sentSimulated ? 'Sent (demo, no real email)' : `Emailed to ${x.billTo.email}`); invoiceSheet(x); } catch (e) { toast(e.message); } };
    const p = $('#paid'); if (p) p.onclick = async () => { invoiceSheet(await api(`/invoices/${inv.id}`, { method: 'PATCH', body: { status: 'paid' } })); toast('Marked paid · trip set to Won'); };
    const v = $('#void'); if (v) v.onclick = async () => { if (confirm(`Void ${inv.number}?`)) invoiceSheet(await api(`/invoices/${inv.id}`, { method: 'PATCH', body: { status: 'void' } })); };
  });
}

async function renderInvoices() {
  const list = await api('/invoices');
  const biz = state.business, base = biz.baseCurrency;
  const total = (items) => { const s = Pricing.sumIn(items, base, biz); return `${s.missing.length ? '' : '≈ '}${money(s.total, base)}${s.missing.length ? ` <small>+ ${s.missing.join(', ')}</small>` : ''}`; };
  const byCur = (items) => { const by = {}; items.forEach((x) => (by[x.currency] = (by[x.currency] || 0) + x.amount)); return Object.keys(by).length > 1 ? Object.entries(by).map(([c, n]) => money(n, c)).join(' · ') : ''; };
  const open = list.filter((i) => ['issued', 'sent'].includes(i.status)).map((i) => ({ amount: i.total, currency: i.currency }));
  const feeItems = list.filter((i) => i.status !== 'void').map((i) => ({ amount: i.fee, currency: i.currency }));
  view.innerHTML = `
    <div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b style="font-size:17px">${total(open)}</b><span>Outstanding${byCur(open) ? `<br>${byCur(open)}` : ''}</span></div><div class="stat"><b style="font-size:17px">${total(feeItems)}</b><span>Brokerage fees invoiced${byCur(feeItems) ? `<br>${byCur(feeItems)}` : ''}</span></div></div>
    <p class="small muted" style="margin-top:-4px">Totals in ${esc(base)} at today's rates. Each invoice keeps its own currency.</p>
    ${list.map((i) => `<div class="list-item" data-open="${i.id}"><div class="grow"><b>${esc(i.number)}</b> <span class="badge inv-${i.status}">${i.status}</span><div class="small muted">${esc(i.billTo.company || i.billTo.name || i.billTo.email || '')}${i.requestRef ? ' · ' + esc(i.requestRef) : ''} · due ${esc(i.dueDate)}</div></div><b>${money(i.total, i.currency)}</b></div>`).join('') || '<div class="empty">No invoices yet.<br><span class="small">Open a trip, compare quotes and tap <b>Invoice client</b>.</span></div>'}`;
  view.querySelectorAll('[data-open]').forEach((el) => (el.onclick = () => invoiceSheet(list.find((i) => i.id === el.dataset.open))));
  view.insertAdjacentHTML('beforeend', '<button class="fab" id="newInv" aria-label="New invoice"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>');
  $('#newInv').onclick = newInvoiceSheet;
}

async function newInvoiceSheet() {
  const biz = state.business;
  const [contacts, reqs] = await Promise.all([api('/contacts'), api('/requests')]);
  const clients = contacts.filter((c) => c.type === 'client');
  const KINDS = { charter: 'Charter', fee: 'Brokerage fee', other: 'Other' };
  const lineRow = (l = {}) => `<div class="card inv-line" style="padding:10px" data-line>
      <div class="grid2"><select data-k="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === (l.kind || 'charter') ? 'selected' : ''}>${v}</option>`).join('')}</select><input data-k="amount" type="number" step="0.01" inputmode="decimal" placeholder="Amount" value="${l.amount ?? ''}"></div>
      <input data-k="description" style="margin-top:8px" placeholder="Description, e.g. Private jet charter LTN → NCE" value="${esc(l.description || '')}">
      <input data-k="detail" style="margin-top:8px" placeholder="Detail (optional), e.g. Challenger 350 · 6 passengers" value="${esc(l.detail || '')}">
      <button class="btn sm danger" type="button" data-rm style="margin-top:8px">Remove line</button></div>`;
  sheet(`<h2>New invoice</h2>
    <p class="small muted">Issued by <b>${esc(biz.name)}</b>, ${esc((biz.address || '').replace(/\n/g, ', '))}.</p>
    <label>Bill to (pick a client or type)</label>
    <select id="ni_pick"><option value="">New / other</option>${clients.map((c) => `<option value="${c.id}">${esc(c.name || c.email)}${c.company ? ' · ' + esc(c.company) : ''}</option>`).join('')}</select>
    <div class="grid2"><div><label>Name</label><input id="ni_name"></div><div><label>Company</label><input id="ni_company"></div></div>
    <div class="grid2"><div><label>Email</label><input id="ni_email" type="email"></div><div><label>Phone</label><input id="ni_phone" type="tel"></div></div>
    <div class="grid2"><div><label>Currency</label><select id="ni_cur">${curOptions(biz.baseCurrency)}</select></div>
      <div><label>Link to trip (optional)</label><select id="ni_req"><option value="">None</option>${reqs.map((r) => `<option value="${r.id}">${esc(r.ref)} · ${esc(r.client?.name || '')}</option>`).join('')}</select></div></div>
    <h3>Lines</h3><div id="ni_lines">${lineRow({ kind: 'charter' })}</div>
    <button class="btn sm" type="button" id="ni_add">+ Add line</button>
    <label>Note on the invoice (optional)</label><textarea id="ni_notes" style="min-height:60px"></textarea>
    <div class="card" id="ni_tot" style="margin-top:12px"></div>
    <button class="btn primary block" id="ni_go">Issue invoice</button>`, (root) => {
    const readLines = () => [...root.querySelectorAll('[data-line]')].map((el) => Object.fromEntries([...el.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value])));
    const totals = () => {
      const cur = $('#ni_cur').value, t = Pricing.manualTotals(readLines(), biz);
      $('#ni_tot').innerHTML = `<div class="row between"><span>Subtotal</span><b>${money(t.subtotal, cur)}</b></div>
        ${t.vatRate ? `<div class="row between small muted"><span>VAT ${t.vatRate}%${biz.vatOn === 'fee' ? ' on fee' : ''}</span><span>${money(t.vat, cur)}</span></div>` : ''}
        <div class="row between" style="font-size:18px;margin-top:6px"><span>Total</span><b>${money(t.total, cur)}</b></div>`;
    };
    const wire = () => { root.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { if (root.querySelectorAll('[data-line]').length > 1) b.closest('[data-line]').remove(); totals(); })); root.querySelectorAll('[data-line] input, [data-line] select').forEach((i) => (i.oninput = totals)); };
    $('#ni_add').onclick = () => { $('#ni_lines').insertAdjacentHTML('beforeend', lineRow({ kind: 'fee' })); wire(); totals(); };
    $('#ni_cur').onchange = totals;
    $('#ni_pick').onchange = (e) => { const c = clients.find((x) => x.id === e.target.value) || {}; $('#ni_name').value = c.name || ''; $('#ni_company').value = c.company || ''; $('#ni_email').value = c.email || ''; $('#ni_phone').value = c.phone || ''; if (c.preferredCurrency) { $('#ni_cur').value = c.preferredCurrency; totals(); } };
    $('#ni_req').onchange = (e) => { const r = reqs.find((x) => x.id === e.target.value); if (!r) return; if (!$('#ni_name').value) { $('#ni_name').value = r.client?.name || ''; $('#ni_email').value = r.client?.email || ''; $('#ni_company').value = r.client?.company || ''; } if (r.currency) { $('#ni_cur').value = r.currency; totals(); } };
    $('#ni_go').onclick = async () => {
      try {
        const inv = await api('/invoices', { method: 'POST', body: { billTo: { name: $('#ni_name').value, company: $('#ni_company').value, email: $('#ni_email').value, phone: $('#ni_phone').value },
          currency: $('#ni_cur').value, requestId: $('#ni_req').value || null, lines: readLines(), notes: $('#ni_notes').value } });
        toast(`Invoice ${inv.number} issued`); await renderInvoices(); invoiceSheet(inv);
      } catch (e) { toast(e.message); }
    };
    wire(); totals();
  });
}

async function rfqSheet(r) {
  const rv = await api(`/requests/${r.id}/routing`);
  const open = rv.rows.filter((x) => !x.sent && x.reason !== 'RFQs switched off');
  const tier = (n) => open.filter((x) => x.include && x.tier === n);
  const unsuitable = open.filter((x) => !x.include && x.fit === 'unsuitable'), far = open.filter((x) => !x.include && x.fit !== 'unsuitable');
  const row = (x) => `<label class="list-item" style="margin:0;color:var(--text)"><input type="checkbox" ${x.include ? 'checked' : ''} value="${x.id}" style="width:auto">
    <div class="grow"><b>${esc(x.company || x.name)}</b>${x.foundOnline ? ' <span class="badge web">online</span>' : ''}${x.tier === 1 ? ' <span class="badge selected">fleet fits</span>' : ''}<div class="small muted">${TYPES[x.type]} · ${esc(x.reason)}</div></div></label>`;
  const group = (title, list) => (list.length ? `<h3>${title} (${list.length})</h3>${list.map(row).join('')}` : '');
  const needs = rv.needs || {};
  sheet(`<h2>Send RFQ</h2>
    <p class="muted small">${rv.area ? `Departing the ${esc(rv.area.name)} area (${esc(rv.area.airports.join(', '))}).` : ''}${rv.airport && !rv.area ? `Departing ${esc(rv.airport.name)} (${esc(rv.airport.iata || rv.airport.icao)}).` : ''}${rv.airport ? ` Operators within ${rv.radiusKm} km and worldwide brokers are ticked.` : 'Departure airport not recognised, so everyone is ticked. Edit the trip to add an airport code.'} Each contact gets their own email.</p>
    <p class="small muted">Sent in this order: nearby operators whose fleet fits (${needs.pax ?? '?'} seats${needs.category ? `, ${esc(needs.category)}+` : ''}${needs.longestLegKm ? `, ${needs.longestLegKm.toLocaleString()} km` : ''}), then nearby operators with no fleet on file, then worldwide brokers.</p>
    ${group('1 · Nearby, fleet fits', tier(1))}${group('2 · Nearby, fleet unknown', tier(2))}${group('3 · Worldwide brokers', tier(3))}
    ${group('Not suitable, fleet can\'t do this trip', unsuitable)}${group('Outside the area', far)}
    ${!open.length ? '<p class="muted">Every active broker/operator has already been sent this RFQ.</p>' : ''}
    ${!tier(1).length && !tier(2).length && rv.airport ? '<div class="banner" style="margin-top:12px">No nearby operator with a suitable fleet on file. Add fleets to your operators in Contacts, or use <b>Find operators online</b>.</div>' : ''}
    ${rv.airport && rv.nearby < rv.minOperators ? `<div class="banner" style="margin-top:12px">Only ${rv.nearby} operator${rv.nearby === 1 ? '' : 's'} on file near ${esc(rv.airport.iata || rv.airport.icao)}. Use <b>Find operators online</b> on the trip to search the web for more.</div>` : ''}
    <button class="btn primary block" style="margin-top:14px" id="go" ${open.length ? '' : 'disabled'}>Send to selected</button>`, (root) => {
    $('#go', root).onclick = async () => {
      const order = rv.rows.map((x) => x.id); // priority order from the routing
      const ids = [...root.querySelectorAll('input:checked')].map((i) => i.value).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const { queued } = await api(`/requests/${r.id}/rfq`, { method: 'POST', body: { contactIds: ids } });
      closeSheet(); toast(`${queued} RFQs queued`); setTimeout(() => renderRequest(r.id), 800);
    };
  });
}

let contactType = 'supplier', contactQ = '';
async function renderContacts() {
  const all = await api('/contacts');
  const list = all.filter((c) => (contactType === 'all' || (contactType === 'supplier' ? c.type !== 'client' : c.type === 'client')))
    .filter((c) => !contactQ || `${c.name} ${c.company} ${c.email} ${c.region}`.toLowerCase().includes(contactQ.toLowerCase()))
    .sort((a, b) => (a.company || a.name || '').localeCompare(b.company || b.name || ''));
  const noBase = all.filter((c) => c.type === 'operator' && !(c.global) && !c.bases && !c.region).length;
  view.innerHTML = `<div class="row" style="justify-content:flex-end"><button class="btn sm" id="imp">Import contacts</button></div>
    ${noBase ? `<div class="banner">${noBase} operator${noBase === 1 ? ' has' : 's have'} no base airport, so ${noBase === 1 ? 'it' : 'they'} won't receive routed RFQs. Tap one to add its base (e.g. EGLF).</div>` : ''}
    <input placeholder="Search name, company, region…" id="q" value="${esc(contactQ)}">
    <div class="chips" style="margin-top:10px">${[['supplier', 'Brokers & operators'], ['client', 'Clients'], ['all', 'All']].map(([k, v]) => `<button class="chip ${k === contactType ? 'on' : ''}" data-t="${k}">${v}</button>`).join('')}</div>
    ${list.map((c) => `<div class="list-item"><div class="avatar">${initials(c.company || c.name)}</div>
      <div class="grow" data-edit="${c.id}"><b>${esc(c.company || c.name)}</b>${c.demo ? ' <span class="badge">demo</span>' : ''}${c.source === 'web' ? ' <span class="badge web">found online</span>' : ''}
        <div class="small muted">${esc(c.name !== c.company ? c.name + ' · ' : '')}${TYPES[c.type] || c.type}${c.type !== 'client' ? ` · ${(c.global ?? c.type === 'broker') ? 'worldwide' : c.bases ? 'base ' + esc(c.bases) : '<span style="color:var(--amber)">no base airport</span>'}` : ''}</div><div class="small muted">${esc(c.email)}</div>${c.type === 'operator' ? `<div class="small muted">${c.fleet ? 'Fleet: ' + esc(c.fleet) : '<span style="color:var(--amber)">no fleet on file</span>'}</div>` : ''}</div>
      ${c.type !== 'client' ? `<label class="switch" title="Include in automatic RFQs"><input type="checkbox" data-rfq="${c.id}" ${c.rfqEnabled !== false ? 'checked' : ''}><span></span></label>` : ''}</div>`).join('') || '<div class="empty">No contacts.</div>'}
    <p class="small muted">Toggle = can receive RFQs. Operators get RFQs for trips departing within ${state.settings.routing.radiusKm} km of their base; worldwide brokers get every RFQ.</p>
    <button class="fab" id="add" aria-label="Add contact"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
  $('#q').oninput = (e) => { contactQ = e.target.value; clearTimeout(renderContacts.t); renderContacts.t = setTimeout(async () => { await renderContacts(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); };
  view.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { contactType = b.dataset.t; renderContacts(); }));
  view.querySelectorAll('[data-rfq]').forEach((i) => (i.onchange = () => api(`/contacts/${i.dataset.rfq}`, { method: 'PATCH', body: { rfqEnabled: i.checked } })));
  view.querySelectorAll('[data-edit]').forEach((el) => (el.onclick = () => contactSheet(all.find((c) => c.id === el.dataset.edit))));
  $('#add').onclick = () => contactSheet();
  $('#imp').onclick = importSheet;
}
const hasPicker = () => 'contacts' in navigator && 'ContactsManager' in window;
async function pickFromPhone(multiple) {
  const list = await navigator.contacts.select(['name', 'email', 'tel'], { multiple });
  return VCard.fromPicker(list);
}

function importSheet() {
  sheet(`<h2>Import contacts</h2>
    <button class="btn import-opt" id="imp_phone"><svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg><span><b>Choose from iPhone contacts</b><br><span class="small muted">${hasPicker() ? 'Opens your contact list so you can tick who to add.' : 'Needs Safari\'s Contact Picker setting. Tap for how to turn it on.'}</span></span></button>
    <label class="btn import-opt" for="imp_vcf" style="cursor:pointer"><svg viewBox="0 0 24 24"><path d="M6 2.5h8l4 4V21.5H6z"/><circle cx="12" cy="11" r="2.5"/><path d="M8.5 17.5c.6-1.8 1.9-2.7 3.5-2.7s2.9.9 3.5 2.7"/></svg><span><b>Import a contacts file (.vcf)</b><br><span class="small muted">A vCard exported from iPhone or iCloud. Works on every phone.</span></span></label>
    <input type="file" id="imp_vcf" accept=".vcf,text/vcard,text/x-vcard" multiple hidden>
    <label class="btn import-opt" for="imp_csv" style="cursor:pointer"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14"/></svg><span><b>Import a spreadsheet (.csv)</b><br><span class="small muted">From Outlook, Excel or another CRM. Columns: name, email, company, phone, type, base, worldwide, fleet.</span></span></label>
    <input type="file" id="imp_csv" accept=".csv,text/csv" hidden>
    <details class="rfq-item"><summary><span class="grow"><b>How to get a .vcf from your iPhone</b></span><svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></summary><div class="mail small">
      <p><b>A few contacts:</b> open Contacts, open a contact, tap <b>Share Contact</b> → <b>Save to Files</b>. Repeat, or select several in a list (two-finger drag) and share them together.</p>
      <p><b>All contacts:</b> on a computer go to icloud.com/contacts, select all, then <b>⚙ → Export vCard</b>. Send the file to yourself and open it here.</p>
      <p>Only contacts with an email address are added. Nothing on your phone is changed.</p></div></details>`, (root) => {
    $('#imp_phone').onclick = async () => {
      if (!hasPicker()) return sheet(`<h2>Turn on the Contact Picker</h2><p class="small">Safari on iPhone can open your contacts for a web app once this setting is on:</p>
        <ol class="small"><li>Open the iPhone <b>Settings</b> app.</li><li>Go to <b>Apps → Safari → Advanced → Feature Flags</b> (on older iOS: Safari → Advanced → Experimental Features).</li><li>Switch on <b>Contact Picker API</b>.</li><li>Come back here and tap <b>Choose from iPhone contacts</b> again.</li></ol>
        <p class="small muted">Or use the .vcf file option, which needs no setting.</p><button class="btn block" id="bk">Back</button>`, () => { $('#bk').onclick = importSheet; });
      try { reviewImport(await pickFromPhone(true), 'iPhone contacts'); } catch (e) { if (e.name !== 'AbortError' && e.name !== 'InvalidStateError') toast(e.message); }
    };
    $('#imp_vcf').onchange = async (e) => {
      const files = [...e.target.files]; let all = [];
      for (const f of files) all = all.concat(VCard.parse(await f.text()));
      if (!all.length) return toast('No contacts found in that file');
      reviewImport(all, files.length === 1 ? files[0].name : `${files.length} files`);
    };
    $('#imp_csv').onchange = async (e) => {
      const csv = await e.target.files[0].text();
      sheet(`<h2>Import spreadsheet</h2><label>Type for rows without a "type" column</label><select id="dt"><option value="operator">Operator</option><option value="broker">Broker</option><option value="client">Client</option></select>
        <button class="btn primary block" style="margin-top:12px" id="go">Import</button>`, () => {
        $('#go').onclick = async () => { const r = await api('/contacts/import', { method: 'POST', body: { csv, type: $('#dt').value } }); closeSheet(); toast(`${r.added} added, ${r.updated} updated`); renderContacts(); };
      });
    };
  });
}

// Shows what was found, lets you untick people and choose whether they are clients, operators or brokers.
function reviewImport(list, from) {
  const usable = list.filter((c) => c.email), none = list.length - usable.length;
  sheet(`<h2>Add ${usable.length} contact${usable.length === 1 ? '' : 's'}</h2>
    <p class="small muted">From ${esc(from)}.${none ? ` ${none} without an email address ${none === 1 ? 'is' : 'are'} left out.` : ''}</p>
    <label>Add them as</label><select id="ri_type"><option value="client">Clients</option><option value="operator">Operators</option><option value="broker">Brokers</option></select>
    <div style="margin-top:10px">${list.map((c, i) => `<label class="pick-row ${c.email ? '' : 'off'}"><input type="checkbox" data-i="${i}" ${c.email ? 'checked' : 'disabled'} style="width:auto"><div class="grow"><b>${esc(c.name || '(no name)')}</b><div class="small muted">${esc([c.company, c.email || 'no email', c.phone].filter(Boolean).join(' · '))}</div></div></label>`).join('')}</div>
    <button class="btn primary block" style="margin-top:12px" id="ri_go" ${usable.length ? '' : 'disabled'}>Add to contacts</button>`, (root) => {
    $('#ri_go').onclick = async () => {
      const chosen = [...root.querySelectorAll('input[data-i]:checked')].map((i) => list[+i.dataset.i]);
      const r = await api('/contacts/bulk', { method: 'POST', body: { contacts: chosen, type: $('#ri_type').value } });
      closeSheet(); toast(`${r.added} added${r.updated ? `, ${r.updated} updated` : ''}`); renderContacts();
    };
  });
}

function contactSheet(c = {}) {
  sheet(`<h2>${c.id ? 'Edit contact' : 'New contact'}</h2>
    ${!c.id && hasPicker() ? '<button class="btn sm" id="fromPhone" style="margin-bottom:6px">Fill from iPhone contacts</button>' : ''}
    <label>Name</label><input id="n" value="${esc(c.name)}"><label>Company</label><input id="co" value="${esc(c.company)}">
    <label>Email</label><input id="e" type="email" value="${esc(c.email)}"><label>Phone</label><input id="p" type="tel" value="${esc(c.phone)}">
    <div class="grid2"><div><label>Type</label><select id="t">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === (c.type || 'operator') ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div><label>Base airports</label><input id="bs" placeholder="EGLF, LTN" value="${esc(c.bases)}"></div></div>
    <label>Region / city</label><input id="rg" value="${esc(c.region)}">
    <div class="row between" style="margin-top:12px"><div class="grow"><b>Covers worldwide</b><div class="small muted">Gets every RFQ regardless of departure (typical for brokers).</div></div><label class="switch"><input type="checkbox" id="gl" ${(c.global ?? (c.type || 'operator') === 'broker') ? 'checked' : ''}><span></span></label></div>
    <label>Fleet (aircraft types, e.g. Citation XLS+, Challenger 350)</label><input id="f" value="${esc(c.fleet)}">
    <label>Preferred currency (clients)</label><select id="pc"><option value="">Use base currency</option>${curOptions(c.preferredCurrency)}</select>
    ${c.source === 'web' ? `<p class="small muted">Found online for ${esc(c.foundFor || '')}. Source: <a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener"><u>${esc(c.sourceUrl)}</u></a></p>` : ''}
    <button class="btn primary block" style="margin-top:14px" id="sv">Save</button>
    ${c.id ? '<button class="btn danger block" style="margin-top:8px" id="dl">Delete</button>' : ''}`, () => {
    const fp = $('#fromPhone'); if (fp) fp.onclick = async () => { try { const [x] = await pickFromPhone(false); if (x) { $('#n').value = x.name; $('#e').value = x.email; $('#p').value = x.phone; } } catch {} };
    $('#sv').onclick = async () => {
      const body = { name: $('#n').value, company: $('#co').value, email: $('#e').value, phone: $('#p').value, type: $('#t').value, region: $('#rg').value, bases: $('#bs').value.toUpperCase(), global: $('#gl').checked, fleet: $('#f').value, preferredCurrency: $('#pc').value || null };
      try { await api(c.id ? `/contacts/${c.id}` : '/contacts', { method: c.id ? 'PATCH' : 'POST', body }); closeSheet(); renderContacts(); } catch (e) { toast(e.message); }
    };
    if (c.id) $('#dl').onclick = async () => { if (confirm('Delete contact?')) { await api(`/contacts/${c.id}`, { method: 'DELETE' }); closeSheet(); renderContacts(); } };
  });
}

async function renderOutbox() {
  const [out, act] = await Promise.all([api('/outbox'), api('/activity')]);
  view.innerHTML = `
    ${out.length ? out.slice(0, 60).map((o) => `<div class="list-item"><div class="grow"><b>${esc(o.toName || o.to)}</b> <span class="badge ${o.status}">${o.kind === 'followup' ? `follow-up ${o.followUpNo} · ` : ''}${o.status}</span><div class="small muted">${esc(o.subject)}</div>${o.error ? `<div class="small" style="color:var(--red)">${esc(o.error)}</div>` : ''}</div><span class="small muted">${ago(o.sentAt || o.queuedAt)}</span></div>`).join('') : '<div class="empty">No RFQs sent yet.</div>'}
    <h3>Activity</h3>
    ${act.map((a) => `<div class="list-item small"><div class="grow">${a.requestId ? `<a href="#/req/${a.requestId}">${esc(a.text)}</a>` : esc(a.text)}</div><span class="muted">${ago(a.at)}</span></div>`).join('') || '<p class="muted">Nothing yet.</p>'}`;
}

async function renderSettings() {
  await refreshState();
  const s = state.settings, o = state.outlook, b = state.business;
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  view.innerHTML = `
    ${params.get('error') ? `<div class="banner">${esc(params.get('error'))}</div>` : ''}
    <h3>Outlook mailbox</h3>
    <div class="card">${o.live
      ? `<div class="row between"><div><b>${esc(o.account.name)}</b><div class="small muted">${esc(o.account.email)}</div></div><span class="badge sent">Connected</span></div>
         <div class="small muted" style="margin-top:8px">Inbox checked every ${s.pollSeconds}s · last ${ago(s.lastPollAt)}${s.lastPollError ? ` · <span style="color:var(--red)">${esc(s.lastPollError)}</span>` : ''}</div>
         <button class="btn sm danger" style="margin-top:10px" id="disc">Disconnect</button>`
      : o.configured ? `<p class="small muted" style="margin-top:0">Sign in with your Microsoft 365 / Outlook account. SkyDesk reads new inbox mail every minute and sends RFQs from your mailbox.</p><a class="btn primary block" href="/auth/login">Connect Outlook</a>`
      : `<p class="small" style="margin:0">Outlook isn't configured on the server yet. Set <code>MS_CLIENT_ID</code> and <code>MS_CLIENT_SECRET</code> (see README) and restart. Until then SkyDesk runs on a demo inbox.</p>`}</div>

    <h3>Automation</h3>
    <div class="card"><div class="row between"><div class="grow"><b>Auto-send RFQs</b><div class="small muted">When a charter request arrives, route it and email the matching brokers & operators automatically.</div></div><label class="switch"><input type="checkbox" id="auto" ${s.autoSendRfq ? 'checked' : ''}><span></span></label></div>
      <div class="small muted" style="margin-top:8px">AI email parsing: <b>${state.aiEnabled ? 'Claude (on)' : 'off, using rule-based parsing (set ANTHROPIC_API_KEY)'}</b></div></div>

    <h3>RFQ routing</h3>
    <div class="card">
      <label style="margin-top:0">Send RFQs to</label>
      <select id="r_mode"><option value="nearby" ${s.routing.mode === 'nearby' ? 'selected' : ''}>Operators near the departure airport + worldwide brokers</option><option value="all" ${s.routing.mode === 'all' ? 'selected' : ''}>Every active broker & operator</option></select>
      <div class="grid2"><div><label>Radius (km)</label><input id="r_radius" type="number" value="${s.routing.radiusKm}"></div><div><label>Min. nearby operators</label><input id="r_min" type="number" value="${s.routing.minOperators}"></div></div>
      <div class="row between" style="margin-top:12px"><div class="grow"><b>Search the web when too few</b><div class="small muted">If fewer nearby operators are on file than the minimum, Claude searches the internet for operators based near the departure airport and adds them to Contacts. Only emails published on the operator's own website are kept. ${state.aiEnabled ? '' : '<span style="color:var(--amber)">Needs ANTHROPIC_API_KEY.</span>'}</div></div><label class="switch"><input type="checkbox" id="r_web" ${s.routing.webDiscovery ? 'checked' : ''}><span></span></label></div>
      <div class="row between" style="margin-top:12px"><div class="grow"><b>Email operators found online straight away</b><div class="small muted">Off = they're added to Contacts switched off, for you to review first.</div></div><label class="switch"><input type="checkbox" id="r_auto" ${s.routing.emailWebContacts ? 'checked' : ''}><span></span></label></div>
      <button class="btn primary block" style="margin-top:12px" id="rsv">Save routing</button>
    </div>

    <h3>Business & invoicing</h3>
    <div class="card">
      <label style="margin-top:0">Business name (appears on invoices)</label><input id="b_name" value="${esc(b.name)}">
      <label>Address</label><textarea id="b_address" style="min-height:70px">${esc(b.address)}</textarea>
      <div class="grid2"><div><label>VAT / tax number</label><input id="b_taxId" value="${esc(b.taxId)}"></div><div><label>Company reg. no.</label><input id="b_regNo" value="${esc(b.regNo)}"></div></div>
      <div class="grid2"><div><label>Email</label><input id="b_email" value="${esc(b.email)}"></div><div><label>Phone</label><input id="b_phone" value="${esc(b.phone)}"></div></div>
      <div class="grid2"><div><label>Bank</label><input id="b_bankName" value="${esc(b.bankName)}"></div><div><label>Account name</label><input id="b_accountName" value="${esc(b.accountName)}"></div></div>
      <div class="grid2"><div><label>IBAN</label><input id="b_iban" value="${esc(b.iban)}"></div><div><label>SWIFT / BIC</label><input id="b_swift" value="${esc(b.swift)}"></div></div>
      <h3 style="margin-top:18px">Brokerage fee (default)</h3>
      <div class="grid2"><div><label>Type</label><select id="b_feeType"><option value="percent" ${b.feeType === 'percent' ? 'selected' : ''}>Percentage</option><option value="fixed" ${b.feeType === 'fixed' ? 'selected' : ''}>Fixed amount</option></select></div>
        <div><label>Value</label><input id="b_feeValue" type="number" step="0.01" value="${b.feeValue}"></div></div>
      <div class="grid2"><div><label>Minimum fee</label><input id="b_feeMin" type="number" value="${b.feeMin}"></div>
        <div><label>On invoice</label><select id="b_feeDisplay"><option value="bundled" ${b.feeDisplay === 'bundled' ? 'selected' : ''}>Included in charter price</option><option value="separate" ${b.feeDisplay === 'separate' ? 'selected' : ''}>Separate fee line</option></select></div></div>
      <h3 style="margin-top:18px">Tax & currency</h3>
      <div class="grid2"><div><label>VAT rate %</label><input id="b_vatRate" type="number" step="0.01" value="${b.vatRate}"></div>
        <div><label>VAT applies to</label><select id="b_vatOn"><option value="total" ${b.vatOn === 'total' ? 'selected' : ''}>Whole invoice</option><option value="fee" ${b.vatOn === 'fee' ? 'selected' : ''}>Brokerage fee only</option></select></div></div>
      <div class="grid2"><div><label>Base currency</label><select id="b_baseCurrency">${curOptions(b.baseCurrency)}</select></div><div><label>Payment terms (days)</label><input id="b_paymentTermsDays" type="number" value="${b.paymentTermsDays}"></div></div>
      <div class="row between" style="margin-top:12px"><div class="grow"><b>Live exchange rates</b><div class="small muted">${b.fxUpdatedAt ? `${Object.keys(b.fxLive || {}).length} currencies from ${esc(b.fxSource)}, updated ${ago(b.fxUpdatedAt)}. Refreshed every 6 hours.` : 'Not loaded yet.'}${b.fxError ? ` <span style="color:var(--amber)">Last refresh failed: ${esc(b.fxError)}</span>` : ''}</div></div><label class="switch"><input type="checkbox" id="b_fxAuto" ${b.fxAuto !== false ? 'checked' : ''}><span></span></label></div>
      <button class="btn sm" style="margin-top:8px" id="fxr">Refresh rates now</button>
      ${['USD', 'EUR', 'GBP', 'AED', 'SAR', 'CHF'].filter((c) => c !== b.baseCurrency && b.fxRates?.[c]).length ? `<div class="fxgrid">${['USD', 'EUR', 'GBP', 'AED', 'SAR', 'CHF'].filter((c) => c !== b.baseCurrency && b.fxRates?.[c]).map((c) => `<div><span>1 ${c}</span><b>${Number(b.fxRates[c]).toFixed(4)} ${esc(b.baseCurrency)}</b></div>`).join('')}</div>` : ''}
      <label>Manual rates (override live rates; units of ${esc(b.baseCurrency)} per 1 unit)</label><input id="b_fx" placeholder="USD=3.75, EUR=4.05" value="${esc(Object.entries(b.fxOverrides || {}).map(([k, v]) => `${k}=${v}`).join(', '))}">
      <label>FX buffer % (added when converting a quote into the client's currency)</label><input id="b_fxBufferPct" type="number" step="0.1" value="${b.fxBufferPct || 0}">
      <div class="grid2"><div><label>Invoice prefix</label><input id="b_invoicePrefix" value="${esc(b.invoicePrefix)}"></div><div><label>Next invoice no.</label><input id="b_nextInvoiceNo" type="number" value="${b.nextInvoiceNo}"></div></div>
      <label>Invoice footer / terms</label><textarea id="b_invoiceNotes" style="min-height:70px">${esc(b.invoiceNotes)}</textarea>
      <button class="btn primary block" style="margin-top:12px" id="bsv">Save business details</button>
    </div>

    <h3>Client replies & operator follow-ups</h3>
    <div class="card">
      <div class="row between"><div class="grow"><b>Reply to the client instantly</b><div class="small muted">As soon as a request arrives, reply in the client's email thread to confirm you're on it.</div></div><label class="switch"><input type="checkbox" id="ack_on" ${s.autoAck ? 'checked' : ''}><span></span></label></div>
      <label>Wait for more quotes before recommending one (minutes after the first quote)</label><input id="qw_min" type="number" min="0" max="240" value="${s.quoteWindowMinutes ?? 30}">
      <label>Quotations are valid for (hours)</label><input id="qv_hours" type="number" min="1" max="720" value="${s.quoteValidityHours ?? 48}">
      <label>Reply text</label><textarea id="ack_tpl" style="min-height:200px">${esc(s.ackTemplate || '')}</textarea>
      <div class="small muted">Placeholders: {{clientFirstName}} {{clientName}} {{ref}} {{route}} {{date}} {{pax}} {{senderName}}</div>
      <div class="row between" style="margin-top:16px"><div class="grow"><b>Chase operators who haven't replied</b><div class="small muted">Sends a short follow-up in the same thread until they reply, the trip moves to Proposal/Won/Lost, or the limit is reached.</div></div><label class="switch"><input type="checkbox" id="fu_on" ${s.followUp?.enabled ? 'checked' : ''}><span></span></label></div>
      <div class="grid2"><div><label>Every (minutes)</label><input id="fu_every" type="number" min="5" value="${s.followUp?.everyMinutes ?? 15}"></div><div><label>Max per operator</label><input id="fu_max" type="number" min="1" max="10" value="${s.followUp?.maxPerOperator ?? 3}"></div></div>
      <button class="btn primary block" style="margin-top:12px" id="acksv">Save</button>
    </div>

    <h3>RFQ email template</h3>
    <div class="card"><label style="margin-top:0">Your name / signature</label><input id="sn" value="${esc(s.senderName)}">
      <label>Subject</label><input id="ts" value="${esc(s.template.subject)}"><label>Body</label><textarea id="tb" style="min-height:220px">${esc(s.template.body)}</textarea>
      <div class="small muted">Placeholders: {{ref}} {{route}} {{date}} {{pax}} {{legs}} {{category}} {{notes}} {{contactName}} {{company}} {{senderName}}. Keep {{ref}} in the subject so replies match the request.</div>
      <div class="row" style="margin-top:10px"><button class="btn grow" id="rst">Reset</button><button class="btn primary grow" id="svt">Save</button></div></div>

    ${!o.live ? `<h3>Simulate incoming email</h3>
    <div class="card"><label style="margin-top:0">From</label><div class="grid2"><input id="dn" value="Alexander Grant"><input id="de" value="alex.grant@example.org"></div>
      <label>Subject</label><input id="ds" value="Jet needed London to Nice">
      <label>Body</label><textarea id="db">Hi,

Could you please quote a private jet from London Luton (LTN) to Nice (NCE) on 14 Dec 2026 around 10:00, returning Nice to London on 18 Dec 2026.
We are 6 passengers with ski bags. Midsize or larger preferred.

Thanks,
Alexander Grant
+44 7700 900123</textarea>
      <button class="btn primary block" style="margin-top:10px" id="sim">Drop into demo inbox</button>
      <div class="small muted" style="margin-top:6px">Demo brokers reply with simulated quotes within about a minute.</div></div>` : ''}
    <p class="small muted" style="text-align:center;margin-top:26px">Tip: on your phone, use "Add to Home Screen" to install SkyDesk as an app.</p>`;

  $('#acksv').onclick = async () => {
    state = await api('/settings', { method: 'PUT', body: { quoteWindowMinutes: +$('#qw_min').value, quoteValidityHours: +$('#qv_hours').value, autoAck: $('#ack_on').checked, ackTemplate: $('#ack_tpl').value, followUp: { enabled: $('#fu_on').checked, everyMinutes: +$('#fu_every').value, maxPerOperator: +$('#fu_max').value } } });
    toast('Saved');
  };
  $('#auto').onchange = async (e) => { await api('/settings', { method: 'PUT', body: { autoSendRfq: e.target.checked } }); toast(e.target.checked ? 'Auto-RFQ on' : 'Auto-RFQ off'); };
  $('#rsv').onclick = async () => {
    state = await api('/settings', { method: 'PUT', body: { routing: { mode: $('#r_mode').value, radiusKm: +$('#r_radius').value, minOperators: +$('#r_min').value, webDiscovery: $('#r_web').checked, emailWebContacts: $('#r_auto').checked } } });
    toast('Routing saved');
  };
  $('#fxr').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Refreshing…';
    try { const x = await api('/fx/refresh', { method: 'POST' }); state = x; toast(`Rates updated from ${x.source}`); } catch (err) { toast(`Couldn't refresh: ${err.message}`); }
    renderSettings();
  };
  $('#bsv').onclick = async () => {
    const body = { fxText: $('#b_fx').value, fxAuto: $('#b_fxAuto').checked };
    ['fxBufferPct', 'name', 'address', 'taxId', 'regNo', 'email', 'phone', 'bankName', 'accountName', 'iban', 'swift', 'feeType', 'feeValue', 'feeMin', 'feeDisplay', 'vatRate', 'vatOn', 'baseCurrency', 'paymentTermsDays', 'invoicePrefix', 'nextInvoiceNo', 'invoiceNotes']
      .forEach((k) => (body[k] = $('#b_' + k).value));
    state = await api('/business', { method: 'PUT', body }); toast('Business details saved');
  };
  $('#svt').onclick = async () => { await api('/settings', { method: 'PUT', body: { senderName: $('#sn').value, template: { subject: $('#ts').value, body: $('#tb').value } } }); toast('Template saved'); };
  $('#rst').onclick = async () => { if (confirm('Reset template to default?')) { await api('/settings', { method: 'PUT', body: { resetTemplate: true } }); renderSettings(); } };
  const d = $('#disc'); if (d) d.onclick = async () => { if (confirm('Disconnect Outlook?')) { await fetch('/auth/disconnect', { method: 'POST' }); renderSettings(); } };
  const sim = $('#sim'); if (sim) sim.onclick = async () => {
    sim.disabled = true;
    const r = await api('/demo/email', { method: 'POST', body: { fromName: $('#dn').value, fromEmail: $('#de').value, subject: $('#ds').value, body: $('#db').value } });
    toast(r.request ? 'Request created, RFQs sent' : 'Email processed (not a charter request)');
    sim.disabled = false; if (r.request) location.hash = '#/';
  };
}

function renderLogin() {
  view.innerHTML = `<div class="login"><svg viewBox="0 0 24 24" style="width:54px;height:54px;fill:var(--gold);stroke:none;transform:rotate(45deg)"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>
    <h2>SkyDesk</h2><p class="muted">Charter broker CRM</p><input type="password" id="pw" placeholder="Password" autofocus><button class="btn primary block" style="margin-top:10px" id="li">Sign in</button></div>`;
  const go = async () => { try { await api('/login', { method: 'POST', body: { password: $('#pw').value } }); boot(); } catch (e) { toast(e.message); } };
  $('#li').onclick = go; $('#pw').onkeydown = (e) => e.key === 'Enter' && go();
}

// ---------- router ----------
async function route() {
  const h = location.hash.slice(1) || '/';
  const [path] = h.split('?');
  const tab = path.startsWith('/invoices') ? 'invoices' : path.startsWith('/contacts') ? 'contacts' : path.startsWith('/outbox') ? 'outbox' : path.startsWith('/settings') ? 'settings' : 'requests';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  document.body.classList.toggle('solid', tab !== 'requests' || path.startsWith('/req/'));
  try {
    if (path.startsWith('/req/')) await renderRequest(path.split('/')[2]);
    else if (tab === 'contacts') await renderContacts();
    else if (tab === 'invoices') await renderInvoices();
    else if (tab === 'outbox') await renderOutbox();
    else if (tab === 'settings') await renderSettings();
    else await renderRequests();
  } catch (e) { if (e.message !== 'auth') view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', () => { closeSheet(); route(); window.scrollTo(0, 0); });

// Launch splash: the poster stays at least 1.6 s (or until tapped), then fades into the app.
const splashShown = Date.now();
function hideSplash() {
  const el = document.getElementById('splash'); if (!el || el.classList.contains('out')) return;
  el.classList.add('out'); setTimeout(() => el.remove(), 600);
}
(() => { const el = document.getElementById('splash'); if (el) { el.onclick = hideSplash; setTimeout(hideSplash, 6000); } })();

async function boot() {
  try { state = await api('/state'); } catch { hideSplash(); return; }
  updateSync(); connectLive(); await route();
  setTimeout(hideSplash, Math.max(0, 1600 - (Date.now() - splashShown)));
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
