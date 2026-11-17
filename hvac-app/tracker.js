/* Consumption tracker maths: pure functions, no DOM. The savings derivation mirrors
   bohio-genhvac/audit/savings_report.py (B, C, B-C, %, cost, CO2, annualised). */
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  function normTime(s) {
    s = String(s).trim().replace(' ', 'T');
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const [, y, mo, d, h = '00', mi = '00', se = '00'] = m;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59) return null;
    return `${y}-${mo}-${d}T${h}:${mi}:${se}`;
  }
  function parseCSV(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const out = { rows: [], errors: [] };
    if (lines.length < 2) { out.errors.push('File has no data rows.'); return out; }
    const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
    const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
    const ti = head.findIndex((h) => /time|date/.test(h));
    const ki = head.findIndex((h) => /kwh|energy|consum/.test(h));
    if (ti < 0 || ki < 0) { out.errors.push('Need a time/date column and a kWh column (e.g. timestamp,hvac_kwh).'); return out; }
    lines.slice(1).forEach((l, i) => {
      const c = l.split(sep), t = normTime(c[ti] || ''), k = parseFloat(c[ki]);
      if (!t || !Number.isFinite(k) || k < 0) out.errors.push(`Row ${i + 2} skipped: "${l.slice(0, 40)}"`);
      else out.rows.push({ t, kwh: k });
    });
    return out;
  }
  const sorted = (a) => a.slice().sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
  function merge(existing, incoming) {           // same timestamp: incoming wins
    const m = new Map(existing.map((e) => [e.t, e]));
    incoming.forEach((e) => m.set(e.t, e));
    return sorted([...m.values()]);
  }
  function daily(entries) {                      // [[YYYY-MM-DD, kWh]] ascending
    const m = new Map();
    entries.forEach((e) => { if (e.kwh != null) m.set(e.t.slice(0, 10), (m.get(e.t.slice(0, 10)) || 0) + e.kwh); });
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  function hourProfile(entries) {                // average kWh per hour of day; null if data is not sub-daily
    const perDay = new Map();
    entries.forEach((e) => { if (e.kwh != null) perDay.set(e.t.slice(0, 10), (perDay.get(e.t.slice(0, 10)) || 0) + 1); });
    if (![...perDay.values()].some((n) => n > 1)) return null;
    const byDH = new Map();
    entries.forEach((e) => { if (e.kwh == null) return; const k = e.t.slice(0, 13); byDH.set(k, (byDH.get(k) || 0) + e.kwh); });
    const sum = Array(24).fill(0), n = Array(24).fill(0);
    byDH.forEach((v, k) => { const h = +k.slice(11, 13); sum[h] += v; n[h]++; });
    return sum.map((s, h) => (n[h] ? s / n[h] : 0));
  }
  function savings(base, act, tariff, grid) {    // only intervals present in both series
    const am = new Map(act.filter((e) => e.kwh != null).map((e) => [e.t, e.kwh]));
    let b = 0, c = 0, n = 0, first = null, last = null;
    base.forEach((e) => {
      if (e.kwh == null || !am.has(e.t)) return;
      b += e.kwh; c += am.get(e.t); n++;
      if (!first || e.t < first) first = e.t; if (!last || e.t > last) last = e.t;
    });
    if (!n) return null;
    const saved = b - c, ms = (s) => Date.parse(s + 'Z');
    const days = (ms(last) - ms(first)) / 864e5 || 1;   // same convention as savings_report.py
    return { baseline: b, actual: c, saved, pct: b ? (saved / b) * 100 : 0, aed: saved * tariff, tco2: (saved * grid) / 1000,
      n, first, last, days, annual: 365 / days, baseCount: base.length, actCount: act.length };
  }
  const api = { normTime, parseCSV, merge, daily, hourProfile, savings, sorted };
  if (typeof module !== 'undefined') module.exports = api; else root.Tracker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
