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
const initials = (n) => (n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
function routeHtml(r) {
  if (!r.legs?.length) return '<span class="muted">Route TBC</span>';
  const pts = r.legs.map((l) => l.from).concat(r.legs[r.legs.length - 1].to);
  return pts.map((p) => `<span>${esc(p)}</span>`).join('<span class="arrow">→</span>');
}
function sheet(html, onMount) {
  const s = $('#sheet'); $('#sheetCard').innerHTML = html; s.hidden = false;
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
  const shown = reqFilter === 'all' ? reqs : reqFilter === 'open' ? open : reqs.filter((r) => r.status === reqFilter);
  view.innerHTML = `
    ${!state.outlook.live ? `<div class="banner">Demo mode: Outlook isn't connected. RFQs are simulated. <a href="#/settings"><u>Connect Outlook</u></a> or use <b>Simulate email</b> in Settings.</div>` : ''}
    <div class="stats">
      <div class="stat"><b>${open.length}</b><span>Open requests</span></div>
      <div class="stat"><b>${reqs.reduce((n, r) => n + r.quotes.length, 0)}</b><span>Quotes in</span></div>
      <div class="stat"><b>${reqs.filter((r) => r.status === 'won').length}</b><span>Won</span></div>
    </div>
    <div class="chips">${Object.entries(filters).map(([k, v]) => `<button class="chip ${k === reqFilter ? 'on' : ''}" data-f="${k}">${v}</button>`).join('')}</div>
    ${shown.length ? shown.map((r) => {
      const best = r.quotes.filter((q) => q.price).sort((a, b) => a.price - b.price)[0];
      return `<a class="card" href="#/req/${r.id}">
        <div class="row between"><span class="small muted">${esc(r.ref)} · ${ago(r.createdAt)}</span><span class="badge ${r.status}">${STATUS[r.status]}</span></div>
        <div class="route" style="margin-top:6px">${routeHtml(r)}</div>
        <div class="meta"><span>${fmtDate(r.legs[0]?.date)}</span><span>${r.pax ?? '?'} pax</span>${r.category ? `<span>${esc(r.category)}</span>` : ''}<span>${esc(r.client?.name || r.client?.email || '')}</span></div>
        <div class="meta"><span>📤 ${r.rfqCount || 0} RFQs</span><span>💬 ${r.quotes.length} quotes</span>${best ? `<span style="color:var(--green)">Best ${money(best.price, best.currency)}</span>` : ''}</div>
      </a>`;
    }).join('') : `<div class="empty">No requests here yet.<br><span class="small">New charter enquiries arriving in your inbox appear automatically.</span></div>`}
    <button class="fab" id="newReq" aria-label="New request"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
  view.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { reqFilter = b.dataset.f; renderRequests(); }));
  $('#newReq').onclick = newRequestSheet;
}

function legEditor(legs) {
  return `<div id="legs">${(legs.length ? legs : [{}]).map((l, i) => `
    <div class="card" style="padding:10px" data-leg>
      <div class="grid2"><input placeholder="From (e.g. LTN)" value="${esc(l.from)}" data-k="from"><input placeholder="To (e.g. NCE)" value="${esc(l.to)}" data-k="to"></div>
      <div class="grid2" style="margin-top:8px"><input type="date" value="${esc(l.date)}" data-k="date"><input type="time" value="${esc(l.time)}" data-k="time"></div>
    </div>`).join('')}</div>
    <button class="btn sm" type="button" id="addLeg">+ Add leg</button>`;
}
const readLegs = (root) => [...root.querySelectorAll('[data-leg]')].map((el) => Object.fromEntries([...el.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value || null]))).filter((l) => l.from && l.to);
function wireLegs(root) {
  $('#addLeg', root).onclick = () => { const legs = readLegs(root); legs.push({}); $('#legs', root).outerHTML = legEditor(legs).split('<button')[0]; wireLegs(root); };
}

function newRequestSheet() {
  sheet(`<h2>New request</h2>
    <label>Client name</label><input id="cn"><label>Client email</label><input id="ce" type="email">
    <label>Itinerary</label>${legEditor([])}
    <div class="grid2"><div><label>Passengers</label><input id="px" type="number" min="1"></div>
    <div><label>Category</label><select id="cat"><option value="">Any</option>${['Turboprop', 'Light', 'Midsize', 'Super Midsize', 'Heavy', 'Ultra Long Range', 'Airliner'].map((c) => `<option>${c}</option>`).join('')}</select></div></div>
    <label>Notes</label><textarea id="nt" style="min-height:70px"></textarea>
    <div class="row" style="margin-top:14px"><button class="btn grow" id="save">Save</button><button class="btn primary grow" id="saveSend">Save & send RFQs</button></div>`, (root) => {
    wireLegs(root);
    const go = async (sendRfq) => {
      const legs = readLegs(root);
      if (!legs.length) return toast('Add at least one leg');
      const r = await api('/requests', { method: 'POST', body: { client: { name: $('#cn').value, email: $('#ce').value }, legs, pax: +$('#px').value || null, category: $('#cat').value || null, notes: $('#nt').value || null, sendRfq } });
      closeSheet(); toast(sendRfq ? 'RFQs queued' : 'Saved'); location.hash = `#/req/${r.id}`;
    };
    $('#save').onclick = () => go(false); $('#saveSend').onclick = () => go(true);
  });
}

async function renderRequest(id) {
  const r = await api(`/requests/${id}`);
  const quotes = [...r.quotes].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  const bestId = quotes.find((q) => q.price)?.id;
  const sent = r.outbox.filter((o) => ['sent', 'simulated'].includes(o.status)).length;
  const queued = r.outbox.filter((o) => o.status === 'queued').length;
  const repliedFrom = new Set(r.quotes.map((q) => q.fromEmail));
  view.innerHTML = `
    <a class="back" href="#/">‹ Requests</a>
    <div class="row between"><span class="muted small">${esc(r.ref)} · via ${r.engine === 'claude' ? 'AI parsing' : r.engine === 'manual' ? 'manual entry' : 'rule parsing'}</span>
      <select id="status" style="width:auto;padding:6px 10px;font-size:14px">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="route" style="font-size:22px;margin:10px 0 4px">${routeHtml(r)}</div>
    <div class="card"><div class="legs">${r.legs.map((l) => `<div class="leg"><b>${esc(l.from)} → ${esc(l.to)}</b><div class="small muted">${fmtDate(l.date)}${l.time ? ' · ' + esc(l.time) : ''}</div></div>`).join('') || '<span class="muted">No legs parsed. Tap Edit to add them.</span>'}</div>
      <div class="kv" style="margin-top:12px"><div><span>Passengers</span><b>${r.pax ?? 'TBC'}</b></div><div><span>Category</span><b>${esc(r.category || 'Any')}</b></div></div>
      ${r.notes ? `<p class="small" style="margin:10px 0 0">${esc(r.notes)}</p>` : ''}
      <button class="btn sm" style="margin-top:10px" id="edit">Edit trip</button></div>

    <h3>Client</h3>
    <div class="card row"><div class="avatar">${initials(r.client?.name)}</div><div class="grow"><b>${esc(r.client?.name || 'Unknown')}</b><div class="small muted">${esc(r.client?.company || '')} ${esc(r.client?.email || '')}</div></div>
      ${r.client?.phone ? `<a class="btn sm" href="tel:${esc(r.client.phone)}">Call</a>` : ''}${r.client?.email ? `<a class="btn sm" href="mailto:${esc(r.client.email)}?subject=${encodeURIComponent('Your charter: ' + r.legs.map((l) => l.from + '-' + l.to).join(', '))}">Email</a>` : ''}</div>

    <h3>Quotes (${quotes.length})</h3>
    ${quotes.length ? quotes.map((q) => `<div class="card quote">
      <div class="avatar">${initials(q.company)}</div>
      <div class="grow"><div class="row between"><b>${esc(q.company || q.fromName)}</b>${q.status === 'selected' ? '<span class="badge selected">Selected</span>' : q.id === bestId ? '<span class="best">BEST PRICE</span>' : ''}</div>
        <div class="small muted">${esc([q.aircraft, q.year, q.tail].filter(Boolean).join(' · ') || 'Aircraft not stated')}</div>
        <div class="row between" style="margin-top:6px"><span class="price">${money(q.price, q.currency)}</span>
          <span class="row"><button class="btn sm" data-view="${q.id}">View</button>${q.status !== 'selected' ? `<button class="btn sm primary" data-pick="${q.id}">Select</button>` : ''}</span></div>
        ${q.status === 'selected' && q.price ? `<div class="small" style="margin-top:6px">Client price at ${r.margin ?? 10}% margin: <b>${money(q.price * (1 + (r.margin ?? 10) / 100), q.currency)}</b> <button class="btn sm" id="margin">Change</button></div>` : ''}
      </div></div>`).join('') : `<div class="card muted small">No quotes yet. Replies to the RFQ (with ${esc(r.ref)} in the subject) are attached here automatically.</div>`}

    <h3>RFQ distribution</h3>
    <div class="card"><div class="row between"><div><b>${sent}</b> sent${queued ? ` · <b>${queued}</b> queued` : ''} · <b>${repliedFrom.size}</b> replied</div><button class="btn sm primary" id="rfq">Send RFQ</button></div>
      <div class="rfq-list">${r.outbox.map((o) => `<div><span>${esc(o.toName || o.to)}${repliedFrom.has(o.to) ? ' <span style="color:var(--green)">· replied</span>' : ''}</span><span class="badge ${o.status}">${o.status}</span></div>`).join('') || '<div class="muted">Not sent yet</div>'}</div></div>

    ${r.source?.body ? `<h3>Original email</h3><div class="small muted" style="margin-bottom:6px">${esc(r.source.subject)} · ${ago(r.source.receivedAt)}</div><div class="email-src">${esc(r.source.body)}</div>` : ''}
    <button class="btn danger block" style="margin-top:24px" id="del">Delete request</button>`;

  $('#status').onchange = async (e) => { await api(`/requests/${id}`, { method: 'PATCH', body: { status: e.target.value } }); toast('Status updated'); };
  view.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = async () => { await api(`/requests/${id}/quotes/${b.dataset.pick}`, { method: 'PATCH', body: { status: 'selected' } }); renderRequest(id); }));
  view.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { const q = r.quotes.find((x) => x.id === b.dataset.view); sheet(`<h2>${esc(q.company)}</h2><div class="small muted">${esc(q.fromEmail)} · ${ago(q.receivedAt)}</div><div class="email-src" style="margin-top:10px">${esc(q.snippet)}</div><a class="btn block" style="margin-top:12px" href="mailto:${esc(q.fromEmail)}?subject=${encodeURIComponent('RE: ' + r.ref)}">Reply</a>`); }));
  const m = $('#margin'); if (m) m.onclick = async () => { const v = prompt('Margin %', r.margin ?? 10); if (v != null && !isNaN(+v)) { await api(`/requests/${id}`, { method: 'PATCH', body: { margin: +v } }); renderRequest(id); } };
  $('#del').onclick = async () => { if (confirm(`Delete ${r.ref}?`)) { await api(`/requests/${id}`, { method: 'DELETE' }); location.hash = '#/'; } };
  $('#rfq').onclick = () => rfqSheet(r);
  $('#edit').onclick = () => sheet(`<h2>Edit trip</h2>${legEditor(r.legs)}
    <div class="grid2"><div><label>Passengers</label><input id="px" type="number" value="${r.pax ?? ''}"></div><div><label>Category</label><input id="cat" value="${esc(r.category || '')}"></div></div>
    <label>Notes</label><textarea id="nt" style="min-height:70px">${esc(r.notes || '')}</textarea>
    <button class="btn primary block" style="margin-top:12px" id="sv">Save</button>`, (root) => {
    wireLegs(root);
    $('#sv').onclick = async () => { await api(`/requests/${id}`, { method: 'PATCH', body: { legs: readLegs(root), pax: +$('#px').value || null, category: $('#cat').value || null, notes: $('#nt').value || null } }); closeSheet(); renderRequest(id); };
  });
}

async function rfqSheet(r) {
  const contacts = (await api('/contacts')).filter((c) => c.type !== 'client' && c.rfqEnabled !== false && !(c.demo && state.outlook.live));
  const done = new Set(r.outbox.map((o) => o.contactId));
  const todo = contacts.filter((c) => !done.has(c.id));
  sheet(`<h2>Send RFQ</h2><p class="muted small">Each contact gets an individual email (no shared recipients) using your RFQ template.</p>
    ${todo.length ? todo.map((c) => `<label class="list-item" style="margin:0;color:var(--text)"><input type="checkbox" checked value="${c.id}" style="width:auto"><div class="grow"><b>${esc(c.company || c.name)}</b><div class="small muted">${esc(c.name)} · ${TYPES[c.type]}${c.region ? ' · ' + esc(c.region) : ''}</div></div></label>`).join('') : '<p class="muted">Every active broker/operator has already been sent this RFQ.</p>'}
    <button class="btn primary block" style="margin-top:14px" id="go" ${todo.length ? '' : 'disabled'}>Send to selected</button>`, (root) => {
    $('#go', root).onclick = async () => {
      const ids = [...root.querySelectorAll('input:checked')].map((i) => i.value);
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
  view.innerHTML = `<div class="row between"><h2>Contacts</h2><button class="btn sm" id="imp">Import CSV</button></div>
    <input placeholder="Search name, company, region…" id="q" value="${esc(contactQ)}">
    <div class="chips" style="margin-top:10px">${[['supplier', 'Brokers & operators'], ['client', 'Clients'], ['all', 'All']].map(([k, v]) => `<button class="chip ${k === contactType ? 'on' : ''}" data-t="${k}">${v}</button>`).join('')}</div>
    ${list.map((c) => `<div class="list-item"><div class="avatar">${initials(c.company || c.name)}</div>
      <div class="grow" data-edit="${c.id}"><b>${esc(c.company || c.name)}</b>${c.demo ? ' <span class="badge">demo</span>' : ''}<div class="small muted">${esc(c.name)} · ${TYPES[c.type] || c.type}${c.region ? ' · ' + esc(c.region) : ''}</div><div class="small muted">${esc(c.email)}</div></div>
      ${c.type !== 'client' ? `<label class="switch" title="Include in automatic RFQs"><input type="checkbox" data-rfq="${c.id}" ${c.rfqEnabled !== false ? 'checked' : ''}><span></span></label>` : ''}</div>`).join('') || '<div class="empty">No contacts.</div>'}
    <p class="small muted">Toggle = included in automatic RFQ blasts.</p>
    <button class="fab" id="add" aria-label="Add contact"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
  $('#q').oninput = (e) => { contactQ = e.target.value; clearTimeout(renderContacts.t); renderContacts.t = setTimeout(async () => { await renderContacts(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); };
  view.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { contactType = b.dataset.t; renderContacts(); }));
  view.querySelectorAll('[data-rfq]').forEach((i) => (i.onchange = () => api(`/contacts/${i.dataset.rfq}`, { method: 'PATCH', body: { rfqEnabled: i.checked } })));
  view.querySelectorAll('[data-edit]').forEach((el) => (el.onclick = () => contactSheet(all.find((c) => c.id === el.dataset.edit))));
  $('#add').onclick = () => contactSheet();
  $('#imp').onclick = () => sheet(`<h2>Import contacts</h2><p class="small muted">Paste CSV, or pick a file exported from Outlook, Excel or your old CRM. Columns recognised: name, email, company, phone, type (broker/operator/client), region, fleet.</p>
    <input type="file" accept=".csv,text/csv" id="file"><textarea id="csv" placeholder="name,email,company,type,region&#10;Jane Doe,jane@op.com,Op Air,operator,Geneva"></textarea>
    <label>Default type when no "type" column</label><select id="dt"><option value="operator">Operator</option><option value="broker">Broker</option><option value="client">Client</option></select>
    <button class="btn primary block" style="margin-top:12px" id="go">Import</button>`, () => {
    $('#file').onchange = async (e) => { $('#csv').value = await e.target.files[0].text(); };
    $('#go').onclick = async () => { const r = await api('/contacts/import', { method: 'POST', body: { csv: $('#csv').value, type: $('#dt').value } }); closeSheet(); toast(`${r.added} added, ${r.updated} updated`); renderContacts(); };
  });
}
function contactSheet(c = {}) {
  sheet(`<h2>${c.id ? 'Edit contact' : 'New contact'}</h2>
    <label>Name</label><input id="n" value="${esc(c.name)}"><label>Company</label><input id="co" value="${esc(c.company)}">
    <label>Email</label><input id="e" type="email" value="${esc(c.email)}"><label>Phone</label><input id="p" type="tel" value="${esc(c.phone)}">
    <div class="grid2"><div><label>Type</label><select id="t">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === (c.type || 'operator') ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div><label>Region / base</label><input id="rg" value="${esc(c.region)}"></div></div>
    <label>Fleet / notes</label><input id="f" value="${esc(c.fleet)}">
    <button class="btn primary block" style="margin-top:14px" id="sv">Save</button>
    ${c.id ? '<button class="btn danger block" style="margin-top:8px" id="dl">Delete</button>' : ''}`, () => {
    $('#sv').onclick = async () => {
      const body = { name: $('#n').value, company: $('#co').value, email: $('#e').value, phone: $('#p').value, type: $('#t').value, region: $('#rg').value, fleet: $('#f').value };
      try { await api(c.id ? `/contacts/${c.id}` : '/contacts', { method: c.id ? 'PATCH' : 'POST', body }); closeSheet(); renderContacts(); } catch (e) { toast(e.message); }
    };
    if (c.id) $('#dl').onclick = async () => { if (confirm('Delete contact?')) { await api(`/contacts/${c.id}`, { method: 'DELETE' }); closeSheet(); renderContacts(); } };
  });
}

async function renderOutbox() {
  const [out, act] = await Promise.all([api('/outbox'), api('/activity')]);
  view.innerHTML = `<h2>RFQ log</h2>
    ${out.length ? out.slice(0, 60).map((o) => `<div class="list-item"><div class="grow"><b>${esc(o.toName || o.to)}</b> <span class="badge ${o.status}">${o.status}</span><div class="small muted">${esc(o.subject)}</div>${o.error ? `<div class="small" style="color:var(--red)">${esc(o.error)}</div>` : ''}</div><span class="small muted">${ago(o.sentAt || o.queuedAt)}</span></div>`).join('') : '<div class="empty">No RFQs sent yet.</div>'}
    <h3>Activity</h3>
    ${act.map((a) => `<div class="list-item small"><div class="grow">${a.requestId ? `<a href="#/req/${a.requestId}">${esc(a.text)}</a>` : esc(a.text)}</div><span class="muted">${ago(a.at)}</span></div>`).join('') || '<p class="muted">Nothing yet.</p>'}`;
}

async function renderSettings() {
  await refreshState();
  const s = state.settings, o = state.outlook;
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  view.innerHTML = `<h2>Settings</h2>
    ${params.get('error') ? `<div class="banner">${esc(params.get('error'))}</div>` : ''}
    <h3>Outlook mailbox</h3>
    <div class="card">${o.live
      ? `<div class="row between"><div><b>${esc(o.account.name)}</b><div class="small muted">${esc(o.account.email)}</div></div><span class="badge sent">Connected</span></div>
         <div class="small muted" style="margin-top:8px">Inbox checked every ${s.pollSeconds}s · last ${ago(s.lastPollAt)}${s.lastPollError ? ` · <span style="color:var(--red)">${esc(s.lastPollError)}</span>` : ''}</div>
         <button class="btn sm danger" style="margin-top:10px" id="disc">Disconnect</button>`
      : o.configured ? `<p class="small muted" style="margin-top:0">Sign in with your Microsoft 365 / Outlook account. SkyDesk reads new inbox mail every minute and sends RFQs from your mailbox.</p><a class="btn primary block" href="/auth/login">Connect Outlook</a>`
      : `<p class="small" style="margin:0">Outlook isn't configured on the server yet. Set <code>MS_CLIENT_ID</code> and <code>MS_CLIENT_SECRET</code> (see README) and restart. Until then SkyDesk runs on a demo inbox.</p>`}</div>

    <h3>Automation</h3>
    <div class="card"><div class="row between"><div class="grow"><b>Auto-send RFQs</b><div class="small muted">When a charter request arrives, email every active broker & operator automatically.</div></div><label class="switch"><input type="checkbox" id="auto" ${s.autoSendRfq ? 'checked' : ''}><span></span></label></div>
      <div class="small muted" style="margin-top:8px">AI email parsing: <b>${state.aiEnabled ? 'Claude (on)' : 'off, using rule-based parsing (set ANTHROPIC_API_KEY)'}</b></div></div>

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

  $('#auto').onchange = async (e) => { await api('/settings', { method: 'PUT', body: { autoSendRfq: e.target.checked } }); toast(e.target.checked ? 'Auto-RFQ on' : 'Auto-RFQ off'); };
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
  const tab = path.startsWith('/contacts') ? 'contacts' : path.startsWith('/outbox') ? 'outbox' : path.startsWith('/settings') ? 'settings' : 'requests';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  try {
    if (path.startsWith('/req/')) await renderRequest(path.split('/')[2]);
    else if (tab === 'contacts') await renderContacts();
    else if (tab === 'outbox') await renderOutbox();
    else if (tab === 'settings') await renderSettings();
    else await renderRequests();
  } catch (e) { if (e.message !== 'auth') view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', () => { closeSheet(); route(); window.scrollTo(0, 0); });

async function boot() {
  try { state = await api('/state'); } catch { return; }
  updateSync(); connectLive(); route();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
