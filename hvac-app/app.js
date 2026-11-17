/* Bohio HVAC app: Quote wizard, saved quotes, consumption tracker. Vanilla JS, no build step.
   Pricing comes from pricing.js (verbatim from the quoting wizard); maths for the tracker from tracker.js. */
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (v) => '$' + Math.round(v).toLocaleString('en-US');
const num = (v, d = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (d) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- persistence ---------- */
const KEY = 'bohioHvacApp.v1';
const DEF = { btype: null, bms: null, bmsType: null, bmsAccess: null, equip: null, fcuComm: null, fcuChoice: 'wireless', splitChoice: null, cooling: 'dc',
  flats: 20, perFlat: 3, common: 7, floors: 5, occ: false, balc: false, warr: false, sizeTouched: false, bmsFixed: '', client: '', building: '' };
let S = { tab: 'quote', st: { ...DEF }, p: { ...P0 }, cur: 0, saved: [], seq: 0, sites: [], site: null, range: 30, view: null };
try { const x = JSON.parse(localStorage.getItem(KEY) || 'null'); if (x) { S = { ...S, ...x, st: { ...DEF, ...x.st }, p: { ...P0, ...x.p }, view: null }; } } catch (e) { /* private mode */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...S, view: null })); } catch (e) { /* ignore */ } };
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }

/* ======================================================================
   QUOTE WIZARD
   ====================================================================== */
const Q = {
  btype: { t: 'What type of building is it?', h: 'This decides which occupancy sensors are used and how the building is sized.', o: [['apartment', 'Residential apartments', 'Flats with their own thermostats, shared lobby and corridors'], ['office', 'Commercial office', 'Desks and meeting rooms; people sit still for hours'], ['hotel', 'Hotel or serviced apartments', 'Guest rooms that are often empty during the day'], ['retail', 'Retail or mall units', 'Shops with fixed opening hours'], ['villa', 'Villa compound', 'Individual houses, often empty during travel']] },
  bms: { t: 'Does the building have a BMS?', h: 'A building management system: a central PC or panel that runs the HVAC. Check the plant room or ask the facility manager.', o: [['yes', 'Yes', 'Central controls, a BMS screen or controllers in a panel'], ['no', 'No', 'Each room has its own thermostat or AC remote'], ['unsure', 'Not sure yet', 'Quoted as no BMS until confirmed']] },
  bmsType: { t: 'What kind of BMS is it?', h: 'Look at the brand on the screen or controllers, or ask the BMS contractor.', o: [['open', 'Modern and open', 'BACnet/IP or Tridium Niagara, installed in the last ~15 years'], ['legacy', 'Legacy or proprietary', 'Older panels, N2, LON or a closed vendor system'], ['unsure', 'Not sure', 'Quoted as modern; confirm with the contractor']] },
  bmsAccess: { t: 'Can setpoints be written to the BMS?', h: 'The building owner and BMS contractor must agree to supervisory write access.', o: [['write', 'Yes, write access', 'AI adjusts setpoints directly. Needs a fixed BMS-contractor price'], ['read', 'Read-only for now', 'AI recommends, the facility team applies the changes']] },
  equip: { t: 'What cooling equipment serves the flats?', h: 'Check the indoor unit or the thermostat on the wall.', o: [['fcu', 'Chilled-water fan coils', 'Wall thermostats with fan speeds; district cooling or a central chiller'], ['split', 'Wall-mounted split ACs', 'Each AC has its own hand-held remote'], ['ducted', 'Ducted DX or packaged units', '24 V thermostats, often marked with stages (STG 1)'], ['vrf', 'VRF system', 'Many indoor units on one outdoor system with a central controller']] },
  fcuComm: { t: 'Do the existing thermostats have Modbus terminals?', h: 'With power off, look behind the thermostat for RS485 terminals marked A/B or + and -.', o: [['yes', 'Yes, A/B or RS485 terminals', 'Keep them and wire a communication bus'], ['no', 'No, only power and fan/valve wires', 'Thermostats are replaced with wireless units'], ['unsure', 'Not sure', 'Quoted as replacement until checked']] },
  cooling: { t: 'How is cooling metered?', h: 'Savings must be measured to be credible.', o: [['dc', 'District cooling with a BTU meter', 'Empower, Tabreed or similar'], ['elec', 'Electricity bill only', 'Sample metering with current clamps']] },
};
const LBL = { btype: 'Building', bms: 'BMS', bmsType: 'BMS type', bmsAccess: 'Access', equip: 'Equipment', fcuComm: 'Thermostats', cooling: 'Metering', size: 'Size', options: 'Options', quote: 'Quote' };
/* Wired-Modbus (B3) is not offered at launch, so there is no "wired or wireless" step. */
function steps() {
  const s = ['btype', 'bms'], st = S.st;
  if (st.bms === 'yes') s.push('bmsType', 'bmsAccess');
  else if (st.bms) { s.push('equip'); if (st.equip === 'fcu') s.push('fcuComm'); s.push('cooling'); }
  s.push('size', 'options', 'quote'); return s;
}
function route(st = S.st) {
  if (st.bms === 'yes') return st.bmsType === 'legacy' ? 'A2' : (st.bmsAccess === 'read' ? 'A3' : (st.bmsAccess === 'write' ? 'A1' : null));
  if (!st.bms || !st.equip) return null;
  if (st.equip === 'fcu') return st.fcuComm == null ? null : (st.fcuComm === 'yes' ? 'B1' : 'B2');
  if (st.equip === 'split') return 'C1';
  return st.equip === 'ducted' ? 'D1' : 'E1';
}
const fixedOK = () => Number(S.st.bmsFixed) > 0;
/* Launch-phase gate. Returns a reason string if the route may not be quoted, else null. */
function gate(code, needFixed) {
  if (!code) return null;
  if (code === 'A1') return needFixed && !fixedOK() ? 'Enter the fixed BMS-contractor price under Options.' : null;
  if (OFFERED.includes(code)) return null;
  return `Route ${code}`;
}
const priceParams = () => (S.st.bmsFixed !== '' && Number(S.st.bmsFixed) > 0 ? { ...S.p, contractor: Number(S.st.bmsFixed) } : S.p);
const quoteFor = (code) => price(code, S.st, priceParams());
const answered = (k) => (Q[k] ? S.st[k] != null : true);
function pick(k, v) {
  const st = S.st; st[k] = v;
  if (k === 'bms' && v !== 'yes') { st.bmsType = null; st.bmsAccess = null; }
  if ((k === 'equip' || k === 'btype') && !st.sizeTouched) { const d = TYPES[st.btype || 'apartment']; st.flats = d[2]; st.common = d[4]; st.perFlat = st.equip === 'ducted' ? 1 : d[3]; }
  save(); render();
}
const kind = () => S.st.btype || 'apartment';

function renderQuote() {
  const st = S.st, T = steps(); if (S.cur >= T.length) S.cur = T.length - 1;
  const k = T[S.cur], c = route(), g = gate(c, false);
  const prog = '';
  const back = S.cur > 0 ? '<button class="btn ghost" data-act="back">Back</button>' : '';
  let body = '', next = 'Next', canNext = true;
  if (Q[k]) {
    const d = Q[k]; canNext = answered(k);
    body = `<h2>${d.t}</h2><div class="opts">${d.o.map(([v, l, s]) => `<button class="opt ${st[k] === v ? 'on' : ''}" data-act="pick" data-k="${k}" data-v="${v}"><span class="ring"></span><span><b>${l}</b></span></button>`).join('')}</div>`;
    if (g && c !== 'A1' && canNext && (k === 'bmsType' || k === 'equip')) { body += `<div class="block"><b>Not offered</b></div>`; canNext = false; }
  } else if (k === 'size') {
    const N = st.flats * st.perFlat + st.common, Ty = TYPES[kind()];
    body = `<h2>How big is the building?</h2>
    <div class="fields"><label class="f">${Ty[0]}<input type="number" inputmode="numeric" min="1" data-bind="flats" value="${st.flats}"></label>
    <label class="f">Units per ${Ty[1]}<input type="number" inputmode="numeric" min="0" data-bind="perFlat" value="${st.perFlat}"></label>
    <label class="f">Common-area units<input type="number" inputmode="numeric" min="0" data-bind="common" value="${st.common}"></label>
    <label class="f">Floors<input type="number" inputmode="numeric" min="1" data-bind="floors" value="${st.floors}"></label></div>
    <p class="note">Total indoor units: <b id="nUnits">${N}</b></p>`;
  } else if (k === 'options') {
    const ck = (id, l, s) => `<label class="chk"><input type="checkbox" data-bind="${id}" ${st[id] ? 'checked' : ''}><div><b>${l}</b></div></label>`;
    body = `<h2>Any optional extras?</h2>
    ${kind() === 'apartment' ? ck('occ', 'Occupancy sensor in each flat', 'Detects empty flats for automatic setback; needs tenant consent') : ''}${BALC[kind()] ? ck('balc', BALC[kind()], 'Pauses cooling while the door is open') : ''}${ck('warr', 'Extended warranty, years 2-3', 'Hardware replacement and on-site visits')}
    ${c === 'A1' ? `<label class="f" style="margin-top:16px">Fixed BMS-contractor price, USD<input type="number" inputmode="decimal" min="0" data-bind="bmsFixed" placeholder="e.g. 6500" value="${esc(st.bmsFixed)}"></label>` : ''}
    <details><summary>Pricing assumptions</summary><div class="fields" style="margin-top:10px">
    <label class="f">Hardware margin %<input type="number" inputmode="decimal" data-bind="p_margin" value="${S.p.margin}"></label><label class="f">Shipping + customs %<input type="number" inputmode="decimal" data-bind="p_landed" value="${S.p.landed}"></label>
    <label class="f">Thermostat swap, USD<input type="number" inputmode="decimal" data-bind="p_tstat" value="${S.p.tstat}"></label><label class="f">RS485 cable per unit, USD<input type="number" inputmode="decimal" data-bind="p_cable" value="${S.p.cable}"></label>
    <label class="f">Platform fee / unit / month<input type="number" inputmode="decimal" step="0.5" data-bind="p_platform" value="${S.p.platform}"></label></div>
    <button class="btn danger sm" data-act="reset" style="margin-top:10px">Reset everything</button></details>`;
    next = 'See the quote';
  } else { $('#app').innerHTML = prog + quoteView(back); setBar(); return; }
  $('#app').innerHTML = prog + body + `<div class="row">${back}<button class="btn" data-act="next" ${canNext ? '' : 'disabled'}>${next}</button></div>`;
  setBar();
}

/* sticky bottom bar: live total */
function setBar() {
  const bar = $('#bar'), c = route();
  if (S.tab !== 'quote' || !c || steps()[S.cur] === 'quote') { bar.hidden = true; document.documentElement.style.setProperty('--barh', '0px'); return; }
  const g = gate(c, false);
  if (c === 'A1' && !fixedOK()) bar.innerHTML = `<div class="tot"><small>Route A1</small>Needs contractor price</div>`;
  else if (g && c !== 'A1') bar.innerHTML = `<div class="tot"><small>Route ${c}</small>Not offered</div>`;
  else { const r = quoteFor(c); bar.innerHTML = `<div class="tot"><small>Route ${c} · one-time, excl. VAT</small>${usd(r.one)}</div><div style="text-align:right"><small style="color:var(--mute);font-size:12px;font-weight:600">Monthly</small><br><b>${usd(r.monthly)}</b></div>`; }
  bar.hidden = false; document.documentElement.style.setProperty('--barh', '58px');
}

/* itemised quote, shared by the live quote and saved quotes (frozen r) */
function quoteBody(r, meta) {
  const li = (x) => `<div class="li"><div>${esc(x.n)}<small>${x.q} × ${usd(x.u)}</small></div><b>${usd(x.t)}</b></div>`;
  const grp = (t, a, sub, lbl) => `<div class="sec">${t}</div>${a.map(li).join('')}<div class="li tot"><div>${lbl}</div><b>${usd(sub)}</b></div>`;
  return `${grp('Hardware', r.hw, r.H, 'Hardware subtotal')}${grp('Installation and setup', r.sv, r.S, 'Services subtotal')}${r.op.length ? grp('Optional extras', r.op, r.O, 'Options subtotal') : ''}
  <div class="sec">Totals</div><div class="li"><div>One-time, excl. VAT</div><b>${usd(r.one)}</b></div><div class="li"><div>VAT 5%</div><b>${usd(r.one * 0.05)}</b></div>
  <div class="li tot"><div>One-time, incl. VAT</div><b>${usd(r.one * 1.05)}</b></div>
  <div class="li"><div>Monthly service<small>${r.N} units × $${r.mo} + $40 connectivity</small></div><b>${usd(r.monthly)} / mo</b></div><div class="li"><div>Annual service</div><b>${usd(r.monthly * 12)}</b></div>
  `;
}
function quoteText(r, m) {
  const l = (x) => `- ${x.n}: ${x.q} × ${usd(x.u)} = ${usd(x.t)}`;
  return [`Bohio Systems: HVAC optimisation quote${m.no ? ' ' + m.no : ''} (route ${m.code})`, NAMES[m.code], m.client ? `For: ${m.client}${m.building ? ', ' + m.building : ''}` : '', `${TYPES[m.btype][0]}: ${m.flats}, ${r.N} indoor units, ${m.floors} floors. US dollars, excl. VAT.`, '', 'Hardware', ...r.hw.map(l), `Hardware subtotal: ${usd(r.H)}`, '', 'Installation and setup', ...r.sv.map(l), `Services subtotal: ${usd(r.S)}`,
    ...(r.op.length ? ['', 'Optional extras', ...r.op.map(l), `Options subtotal: ${usd(r.O)}`] : []), '', `One-time excl. VAT: ${usd(r.one)}`, `VAT 5%: ${usd(r.one * 0.05)}`, `One-time incl. VAT: ${usd(r.one * 1.05)}`, `Monthly service: ${usd(r.monthly)} / month`, '', ...r.notes, 'Estimates; confirm quantities and allowances after a site survey. Savings target 15-25%, not guaranteed.'].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
}
function currentMeta() { const st = S.st; return { code: route(), btype: kind(), flats: st.flats, floors: st.floors, client: st.client.trim(), building: st.building.trim() }; }
const OFFERED_ALL = () => ['A1', ...OFFERED];
function compareState(code) { // each A-route needs its own BMS answers, otherwise A3 would price as A1
  const st = { ...S.st };
  if (code === 'A1') { st.bmsType = 'open'; st.bmsAccess = 'write'; } else if (code === 'A3') { st.bmsType = 'open'; st.bmsAccess = 'read'; }
  return st;
}
function quoteView(back) {
  const c = route(), st = S.st;
  if (!c) return `<h2>Not enough answers yet</h2><div class="row">${back}</div>`;
  const g = gate(c, true);
  if (g) return `<h2>Route ${c}</h2><div class="block"><b>${c === 'A1' ? 'Fixed contractor price needed' : 'Not offered'}</b>${c === 'A1' ? g : ''}</div><div class="row">${back}</div>`;
  const r = quoteFor(c), m = currentMeta();
  const cmp = OFFERED_ALL().filter((k) => k !== 'A1' || fixedOK()).map((k) => ({ k, v: price(k, compareState(k), priceParams()).one })), max = Math.max(...cmp.map((x) => x.v));
  return `<h2>Quote: route ${c}</h2><div class="hero"><span class="code">${c}</span>
  <p style="margin:8px 0 0;font-weight:600">${NAMES[c]}</p><div class="big">${usd(r.one)}</div><p class="note" style="margin:0 0 10px">one-time, excl. VAT · ${usd(r.monthly)} / month</p>
  <div class="kv"><span>${TYPES[m.btype][0]}</span><b>${m.flats}</b></div><div class="kv"><span>Indoor units</span><b>${r.N}</b></div><div class="kv"><span>Per ${TYPES[m.btype][1]}, one-time</span><b>${usd(r.perFlat)}</b></div></div>
  ${quoteBody(r, m)}
  <div class="sec">Other offered routes, same building</div><div class="cmp">${cmp.map((x) => `<div class="c ${x.k === c ? 'me' : ''}"><div><span>${x.k} · ${NAMES[x.k]}</span><span>${usd(x.v)}</span></div><div class="bar2"><i style="width:${(x.v / max * 100).toFixed(1)}%"></i></div></div>`).join('')}</div>
  <div class="row noprint"><button class="btn" data-act="saveQuote">Save quote</button><button class="btn ghost" data-act="shareQuote">Share</button><button class="btn ghost" data-act="print">Print / PDF</button></div>${back ? `<div class="row noprint">${back}</div>` : ''}`;
}
function freeze() { const c = route(), m = currentMeta(); return { m, r: quoteFor(c) }; }
function saveQuote() {
  const { m, r } = freeze(); S.seq++;
  const no = `BOH-Q-${new Date().getFullYear()}-${String(S.seq).padStart(3, '0')}`;
  S.saved.unshift({ id: uid(), no, at: new Date().toISOString(), m: { ...m, no }, r, snap: { st: { ...S.st }, p: { ...S.p } } });
  save(); toast(`Saved as ${no}`); updateBadge();
}
async function share(text, title) {
  try { if (navigator.share) { await navigator.share({ title, text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Quote copied. Paste it into an email or message.'); } catch (e) { toast('Copy was blocked by the browser.'); }
}

/* ======================================================================
   SAVED QUOTES
   ====================================================================== */
function renderSaved() {
  const id = S.view && S.view.saved, q = id && S.saved.find((x) => x.id === id);
  if (q) {
    $('#app').innerHTML = `<button class="btn ghost sm noprint" data-act="savedBack">‹ All quotes</button><h2 style="margin-top:12px">${esc(q.no)}</h2><p class="help">${q.m.client ? esc(q.m.client) + (q.m.building ? ', ' + esc(q.m.building) : '') + ' · ' : ''}${new Date(q.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
    <div class="hero"><span class="code">${q.m.code}</span><p style="margin:8px 0 0;font-weight:600">${NAMES[q.m.code]}</p><div class="big">${usd(q.r.one)}</div><p class="note" style="margin:0">one-time, excl. VAT · ${usd(q.r.monthly)} / month</p></div>
    ${quoteBody(q.r, q.m)}
    <div class="row noprint"><button class="btn" data-act="shareSaved" data-id="${q.id}">Share</button><button class="btn ghost" data-act="print">Print / PDF</button></div>
    <div class="row noprint"><button class="btn ghost" data-act="editSaved" data-id="${q.id}">Edit as new quote</button><button class="btn danger" data-act="delSaved" data-id="${q.id}">Delete</button></div>`;
    return;
  }
  if (!S.saved.length) { $('#app').innerHTML = `<div class="empty"><b>No saved quotes</b></div>`; return; }
  $('#app').innerHTML = `<h2>Saved quotes</h2>` + S.saved.map((q) => `<button class="card click" data-act="openSaved" data-id="${q.id}"><div class="top2"><span class="nm">${esc(q.m.client || q.no)}</span><b>${usd(q.r.one)}</b></div><div class="sub">${esc(q.no)} · route ${q.m.code} · ${q.r.N} units · ${new Date(q.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div></button>`).join('');
}
const updateBadge = () => { $('#savedN').textContent = S.saved.length || ''; };

/* ======================================================================
   CONSUMPTION TRACKER
   ====================================================================== */
const site = () => S.sites.find((s) => s.id === S.site) || null;
const newSite = (name) => ({ id: uid(), name, tariff: 0.38, grid: 0.40, baseline: [], actual: [], meter: {} });
function trackerKpis(s) {
  const d = Tracker.daily(s.actual); if (!d.length) return null;
  const take = (a) => a.reduce((t, x) => t + x[1], 0), last = d.slice(-7), prev = d.slice(-14, -7);
  const l7 = take(last), p7 = prev.length === 7 ? take(prev) : null;
  return { l7, p7, delta: p7 ? ((l7 - p7) / p7) * 100 : null, avg: l7 / last.length, days: last.length, cost: l7 * s.tariff, latest: d[d.length - 1][0], total: take(d), nDays: d.length };
}
function dailyChart(s) {
  let a = Tracker.daily(s.actual), b = Tracker.daily(s.baseline); if (!a.length && !b.length) return '';
  const all = [...new Set([...a.map((x) => x[0]), ...b.map((x) => x[0])])].sort(), days = S.range === 0 ? all : all.slice(-S.range);
  const am = new Map(a), bm = new Map(b), W = 600, H = 190, L = 34, R = 6, T = 8, B = 22, iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...days.map((d) => Math.max(am.get(d) || 0, bm.get(d) || 0))), mag = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / (mag / 2)) * (mag / 2);
  const y = (v) => T + ih - (v / top) * ih, bw = iw / days.length;
  const bars = days.map((d, i) => am.has(d) ? `<rect x="${(L + i * bw + bw * 0.15).toFixed(1)}" y="${y(am.get(d)).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(T + ih - y(am.get(d))).toFixed(1)}" rx="2" fill="var(--blue)"/>` : '').join('');
  const pts = days.map((d, i) => bm.has(d) ? `${(L + i * bw + bw / 2).toFixed(1)},${y(bm.get(d)).toFixed(1)}` : null).filter(Boolean);
  const line = pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--amber)" stroke-width="2.5" stroke-linejoin="round"/>` : (pts.length ? `<circle cx="${pts[0].split(',')[0]}" cy="${pts[0].split(',')[1]}" r="3.5" fill="var(--amber)"/>` : '');
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(top * f).toFixed(1)}" y2="${y(top * f).toFixed(1)}" stroke="var(--line)"/><text x="${L - 4}" y="${(y(top * f) + 3).toFixed(1)}" text-anchor="end">${num(top * f)}</text>`).join('');
  const xl = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, ar) => ar.indexOf(v) === i).map((i) => `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}">${fmtDay(days[i])}</text>`).join('');
  const hit = days.map((d, i) => `<rect x="${(L + i * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ih}" fill="transparent" data-act="barTap" data-d="${d}"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily HVAC energy in kWh">${grid}${bars}${line}${xl}${hit}</svg>
  <div class="legend"><span><i style="background:var(--blue)"></i>Actual</span>${pts.length ? '<span><i style="background:var(--amber)"></i>Baseline</span>' : ''}</div><div class="readout" id="readout"></div>`;
}
function hourChart(s) {
  const p = Tracker.hourProfile(s.actual); if (!p) return '';
  const W = 600, H = 110, L = 4, T = 6, B = 18, bw = (W - L) / 24, max = Math.max(...p, 1);
  return `<div class="sec">Typical day: average per hour</div><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average energy by hour of day">${p.map((v, h) => { const ht = (v / max) * (H - T - B); return `<rect x="${(L + h * bw + 2).toFixed(1)}" y="${(H - B - ht).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${ht.toFixed(1)}" rx="2" fill="var(--blue)" opacity=".85"/>`; }).join('')}${[0, 6, 12, 18, 23].map((h) => `<text x="${(L + h * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${String(h).padStart(2, '0')}h</text>`).join('')}</svg>`;
}
function savingsCard(s) {
  if (!s.baseline.length) return `<div class="sec">Savings vs baseline</div><div class="row"><button class="btn ghost" data-act="importCSV" data-series="baseline">Import baseline CSV</button><button class="btn ghost" data-act="addReading" data-series="baseline">Add baseline reading</button></div>`;
  const r = Tracker.savings(s.baseline, s.actual, s.tariff, s.grid);
  if (!r) return `<div class="sec">Savings vs baseline</div><div class="warn">No overlapping readings.</div>`;
  const aed = r.aed, f = (v, d = 1) => num(v, d);
  const cov = r.n < r.baseCount || r.n < r.actCount ? `Compared ${num(r.n)} matching intervals (baseline has ${num(r.baseCount)}, actual ${num(r.actCount)}).` : `Compared ${num(r.n)} intervals.`;
  const txt = [`Period: ${r.first.replace('T', ' ').slice(0, 16)} -> ${r.last.replace('T', ' ').slice(0, 16)} (${r.n} intervals, ${r.days.toFixed(2)} days)`, '',
    `1. Baseline HVAC energy        B = ${f(r.baseline)} kWh`, `2. Optimised HVAC energy       C = ${f(r.actual)} kWh`, `3. Energy saved            B - C = ${f(r.baseline)} - ${f(r.actual)} = ${f(r.saved)} kWh`,
    `4. Saving %          (B - C) / B = ${f(r.saved)} / ${f(r.baseline)} = ${r.pct.toFixed(1)}%`, `5. Cost saved        kWh x tariff = ${f(r.saved)} x ${s.tariff} AED/kWh = AED ${f(aed, 0)}`,
    `6. CO2 avoided  kWh x grid factor = ${f(r.saved)} x ${s.grid} kg/kWh / 1000 = ${r.tco2.toFixed(2)} tCO2e`].join('\n');
  const good = r.saved >= 0;
  return `<div class="sec">Savings vs baseline</div><div class="tiles"><div class="tile"><small>Energy saved</small><b class="${good ? 'down' : 'up'}">${good ? '' : '+'}${f(Math.abs(r.saved), 0)}</b><em>${r.pct.toFixed(1)}% vs baseline</em></div><div class="tile"><small>Cost ${good ? 'saved' : 'extra'}</small><b>AED ${f(Math.abs(aed), 0)}</b></div></div>
  <pre class="calc">${esc(txt)}</pre>
  <div class="row"><button class="btn ghost sm" data-act="copyCalc">Copy</button></div>`;
}
function renderTrack() {
  const s = site();
  if (S.view && S.view.settings && s) return renderSiteSettings(s);
  if (!s) {
    $('#app').innerHTML = S.sites.length ? `<h2>Sites</h2>${S.sites.map(siteCard).join('')}<div class="row"><button class="btn" data-act="addSite">Add site</button></div>` :
      `<div class="empty"><b>HVAC consumption</b><div class="row" style="justify-content:center"><button class="btn" data-act="addSite">Add a site</button><button class="btn ghost" data-act="loadSample">Load sample data</button></div></div>`;
    return;
  }
  const k = trackerKpis(s), sw = S.sites.length > 1 ? `<div class="sel"><select data-bind="siteSel" aria-label="Site">${S.sites.map((x) => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : '';
  $('#app').innerHTML = `<div class="top2" style="align-items:center"><h2 style="margin:0">${esc(s.name)}</h2><button class="btn ghost sm" data-act="siteSettings" aria-label="Settings" style="min-width:40px;padding:6px 10px"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button></div>${sw ? `<div style="margin-top:10px">${sw}</div>` : ''}
  ${k ? `<div class="tiles"><div class="tile"><small>Last ${k.days} days</small><b>${num(k.l7)}</b>${k.delta != null ? `<em class="${k.delta > 0 ? 'up' : 'down'}">${k.delta > 0 ? '▲' : '▼'} ${Math.abs(k.delta).toFixed(1)}% vs prior 7 days</em>` : '<em style="color:var(--mute)">no prior week yet</em>'}</div>
  <div class="tile"><small>Daily average</small><b>${num(k.avg)}</b><em style="color:var(--mute)">to ${fmtDay(k.latest)}</em></div>
  <div class="tile"><small>Cost, last ${k.days} days</small><b>AED ${num(k.cost)}</b></div><div class="tile"><small>Logged</small><b>${num(k.total)}</b><em style="color:var(--mute)">${k.nDays} days</em></div></div>
  <div style="margin:8px 0 10px"><select class="sm" data-bind="range" aria-label="Time frame">${[[7, '7 days'], [30, '30 days'], [0, 'All time']].map(([v, l]) => `<option value="${v}" ${S.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>${dailyChart(s)}${hourChart(s)}` : (s.baseline.length ? dailyChart(s) : '<p class="help" style="margin-top:12px">No readings yet. Add one, or import a CSV.</p>')}
  ${savingsCard(s)}
  <div class="sec">Data</div><div class="row" style="margin-top:10px"><button class="btn" data-act="addReading" data-series="actual">Add reading</button><button class="btn ghost" data-act="importCSV" data-series="actual">Import CSV</button><button class="btn ghost" data-act="exportCSV">Export CSV</button></div>
  ${recentList(s)}`;
}
function siteCard(s) {
  const k = trackerKpis(s), sv = s.baseline.length && Tracker.savings(s.baseline, s.actual, s.tariff, s.grid);
  return `<button class="card click" data-act="openSite" data-id="${s.id}"><div class="top2"><span class="nm">${esc(s.name)}</span></div><div class="sub">${k ? `${num(k.total)} over ${k.nDays} days` : 'No readings yet'}${sv ? ` · saving ${sv.pct.toFixed(1)}%` : ''}</div></button>`;
}
function recentList(s) {
  const e = [...s.actual.map((x) => ({ ...x, series: 'actual' })), ...s.baseline.map((x) => ({ ...x, series: 'baseline' }))].sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 8);
  if (!e.length) return '';
  return `<div class="sec">Latest entries</div>${e.map((x) => `<div class="ent"><span>${x.t.slice(0, 16).replace('T', ' ')} · <b>${x.kwh == null ? 'meter anchor' : num(x.kwh, 1)}</b> <span class="note">${x.series}</span></span><button data-act="delEntry" data-series="${x.series}" data-t="${x.t}" aria-label="Delete entry">Delete</button></div>`).join('')}`;
}
function renderSiteSettings(s) {
  $('#app').innerHTML = `<button class="btn ghost sm" data-act="settingsBack">‹ Back</button><h2 style="margin-top:12px">Site settings</h2>
  <div class="fields"><label class="f" style="grid-column:1/-1">Site name<input data-bind="s_name" value="${esc(s.name)}"></label>
  <label class="f">Tariff, AED per kWh<input type="number" inputmode="decimal" step="0.01" data-bind="s_tariff" value="${s.tariff}"></label>
  <label class="f">Grid factor, kg CO₂e/kWh<input type="number" inputmode="decimal" step="0.01" data-bind="s_grid" value="${s.grid}"></label></div>
  <div class="row"><button class="btn ghost" data-act="clearSeries" data-series="baseline">Clear baseline</button><button class="btn danger" data-act="delSite">Delete site</button></div>`;
}

/* sheets */
function openSheet(html) { const sh = $('#sheet'); sh.innerHTML = `<div role="dialog" aria-modal="true">${html}</div>`; sh.hidden = false; const f = sh.querySelector('input,select'); if (f) f.focus(); }
const closeSheet = () => { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; };
function nowLocal() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; }
function readingSheet(series) {
  const s = site();
  openSheet(`<h2>Add reading</h2><div class="seg" role="group" aria-label="Series"><button class="on" data-act="segSeries" data-v="actual">Actual</button><button data-act="segSeries" data-v="baseline">Baseline</button></div>
  <div class="seg" style="margin-top:10px" role="group" aria-label="Mode"><button class="on" data-act="segMode" data-v="use">Consumption</button><button data-act="segMode" data-v="meter">Meter reading</button></div>
  <div class="fields" style="margin-top:14px"><label class="f" style="grid-column:1/-1">Date and time<input type="datetime-local" id="r_t" value="${nowLocal()}"></label>
  <label class="f" style="grid-column:1/-1"><span id="r_lbl">kWh used in this interval</span><input type="number" inputmode="decimal" min="0" step="any" id="r_v" placeholder="0"></label></div>
  <input type="hidden" id="r_series" value="${series}"><input type="hidden" id="r_mode" value="use">
  <div class="row"><button class="btn ghost" data-act="closeSheet">Cancel</button><button class="btn" data-act="saveReading">Save reading</button></div>`);
  if (series === 'baseline') $('#sheet [data-act=segSeries][data-v=baseline]').click();
}
function csvSheet(series) {
  openSheet(`<h2>Import CSV</h2>
  <div class="seg" role="group" aria-label="Series"><button class="${series === 'actual' ? 'on' : ''}" data-act="segSeries" data-v="actual">Actual</button><button class="${series === 'baseline' ? 'on' : ''}" data-act="segSeries" data-v="baseline">Baseline</button></div><input type="hidden" id="r_series" value="${series}">
  <input type="file" id="csvFile" accept=".csv,text/csv,text/plain" style="margin-top:14px"><div class="row"><button class="btn ghost" data-act="closeSheet">Cancel</button></div>`);
  $('#csvFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return; const r = Tracker.parseCSV(await f.text()), sr = $('#r_series').value;
    if (!r.rows.length) { toast(r.errors[0] || 'No usable rows found.'); return; }
    const s = site(); s[sr] = Tracker.merge(s[sr], r.rows); save(); closeSheet(); render();
    toast(`Imported ${r.rows.length} rows into ${sr}${r.errors.length ? `, skipped ${r.errors.length}` : ''}`);
  });
}
function saveReading() {
  const s = site(), sr = $('#r_series').value, mode = $('#r_mode').value, tv = $('#r_t').value, v = parseFloat($('#r_v').value);
  const t = Tracker.normTime(tv); if (!t) return toast('Enter a date and time.');
  if (!Number.isFinite(v) || v < 0) return toast('Enter a kWh value of 0 or more.');
  let entry;
  if (mode === 'use') entry = { t, kwh: v };
  else {
    const prev = [...s[sr]].reverse().find((e) => e.meter != null && e.t < t);
    if (prev && v < prev.meter) return toast(`Meter reads lower than the previous ${num(prev.meter, 1)}. Check the value.`);
    entry = { t, kwh: prev ? v - prev.meter : null, meter: v };
  }
  s[sr] = Tracker.merge(s[sr], [entry]); save(); closeSheet(); render();
  toast(entry.kwh == null ? 'First meter reading saved as the starting point.' : `Saved ${num(entry.kwh, 1)} kWh`);
}
function exportCSV() {
  const s = site(), rows = ['series,timestamp,hvac_kwh', ...['baseline', 'actual'].flatMap((k) => s[k].filter((e) => e.kwh != null).map((e) => `${k},${e.t},${e.kwh}`))];
  const url = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' })), a = document.createElement('a');
  a.href = url; a.download = `${s.name.replace(/[^\w-]+/g, '_')}_hvac.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function loadSample() {
  try {
    const [b, a] = await Promise.all(['sample/baseline.csv', 'sample/genhvac.csv'].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.text(); })));
    const s = newSite('Sample building'); s.baseline = Tracker.parseCSV(b).rows; s.actual = Tracker.parseCSV(a).rows;
    S.sites.push(s); S.site = s.id; S.view = null; save(); render(); toast('Sample data loaded');
  } catch (e) { toast('Could not load sample data.'); }
}

/* ======================================================================
   shell: render, events
   ====================================================================== */
const TITLES = { quote: 'Quote', saved: 'Saved quotes', track: 'Consumption' };
function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  if (S.tab === 'quote') renderQuote(); else { $('#bar').hidden = true; document.documentElement.style.setProperty('--barh', '0px'); if (S.tab === 'saved') renderSaved(); else renderTrack(); }
  updateBadge(); save();
}
const goTop = () => window.scrollTo({ top: 0 });
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act],[data-tab]'); if (!el) return;
  if (el.dataset.tab) { S.tab = el.dataset.tab; S.view = null; render(); goTop(); return; }
  const a = el.dataset.act, d = el.dataset, st = S.st;
  switch (a) {
    case 'pick': pick(d.k, d.v); break;
    case 'next': S.cur++; render(); goTop(); break;
    case 'back': S.cur--; render(); goTop(); break;
    case 'reset': if (confirm('Clear all answers and pricing assumptions?')) { S.st = { ...DEF }; S.p = { ...P0 }; S.cur = 0; render(); goTop(); } break;
    case 'saveQuote': saveQuote(); break;
    case 'shareQuote': { const { m, r } = freeze(); share(quoteText(r, m), 'Bohio HVAC quote'); break; }
    case 'print': window.print(); break;
    case 'openSaved': S.view = { saved: d.id }; render(); goTop(); break;
    case 'savedBack': S.view = null; render(); break;
    case 'shareSaved': { const q = S.saved.find((x) => x.id === d.id); share(quoteText(q.r, q.m), q.no); break; }
    case 'delSaved': if (confirm('Delete this saved quote?')) { S.saved = S.saved.filter((x) => x.id !== d.id); S.view = null; render(); } break;
    case 'editSaved': { const q = S.saved.find((x) => x.id === d.id); S.st = { ...DEF, ...q.snap.st }; S.p = { ...P0, ...q.snap.p }; S.cur = steps().length - 1; S.tab = 'quote'; S.view = null; render(); goTop(); break; }
    /* tracker */
    case 'addSite': { const n = prompt('Site name', 'My building'); if (n && n.trim()) { const s = newSite(n.trim()); S.sites.push(s); S.site = s.id; render(); } break; }
    case 'loadSample': loadSample(); break;
    case 'openSite': S.site = d.id; render(); goTop(); break;
    case 'siteSettings': S.view = { settings: true }; render(); break;
    case 'settingsBack': S.view = null; render(); break;
    case 'delSite': if (confirm('Delete this site and all its readings?')) { S.sites = S.sites.filter((x) => x.id !== S.site); S.site = null; S.view = null; render(); } break;
    case 'clearSeries': if (confirm('Clear the baseline readings?')) { site()[d.series] = []; render(); } break;
    case 'range': S.range = +d.v; render(); break;
    case 'barTap': { const s = site(), am = new Map(Tracker.daily(s.actual)), bm = new Map(Tracker.daily(s.baseline)); $('#readout').textContent = `${fmtDay(d.d)}: ${am.has(d.d) ? num(am.get(d.d), 1) + ' actual' : 'no actual reading'}${bm.has(d.d) ? ` · baseline ${num(bm.get(d.d), 1)}` : ''}`; break; }
    case 'addReading': readingSheet(d.series); break;
    case 'importCSV': csvSheet(d.series); break;
    case 'exportCSV': exportCSV(); break;
    case 'closeSheet': closeSheet(); break;
    case 'saveReading': saveReading(); break;
    case 'segSeries': { el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); $('#r_series').value = d.v; break; }
    case 'segMode': { el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); $('#r_mode').value = d.v; $('#r_lbl').textContent = d.v === 'use' ? 'kWh used in this interval' : 'Meter reading, cumulative kWh'; break; }
    case 'delEntry': { const s = site(); s[d.series] = s[d.series].filter((x) => x.t !== d.t); render(); break; }
    case 'copyCalc': { const t = document.querySelector('pre.calc'); navigator.clipboard.writeText(t.textContent).then(() => toast('Calculation copied'), () => toast('Copy was blocked by the browser.')); break; }
  }
});
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
document.addEventListener('input', (e) => {
  const t = e.target, b = t.dataset.bind; if (!b) return; const st = S.st;
  if (['flats', 'perFlat', 'common', 'floors'].includes(b)) { const v = +t.value; if (t.value !== '' && Number.isFinite(v) && v >= 0) { st[b] = Math.round(v); st.sizeTouched = true; const n = $('#nUnits'); if (n) n.textContent = st.flats * st.perFlat + st.common; setBar(); save(); } }
  else if (b.startsWith('p_')) { const v = +t.value; if (t.value !== '' && Number.isFinite(v)) { S.p[b.slice(2)] = v; setBar(); save(); } }
  else if (b === 'bmsFixed') { st.bmsFixed = t.value; setBar(); save(); }
  else if (['occ', 'balc', 'warr'].includes(b)) { st[b] = t.checked; setBar(); save(); }
  else if (b === 'client' || b === 'building') { st[b] = t.value; save(); }
  else if (b === 'siteSel') { S.site = t.value; render(); }
  else if (b === 'range') { S.range = +t.value; render(); }
  else if (b.startsWith('s_')) { const s = site(), f = b.slice(2); if (f === 'name') { if (t.value.trim()) s.name = t.value; } else { const v = +t.value; if (t.value !== '' && Number.isFinite(v) && v >= 0) s[f] = v; } save(); }
});
document.addEventListener('change', (e) => { if (e.target.dataset.bind === 'siteSel') { S.site = e.target.value; render(); } });

if (S.tab === 'track' && !site() && S.sites.length === 1) S.site = S.sites[0].id;
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
