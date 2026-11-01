// Live exchange rates (refreshed every few hours) with manual overrides.
// Stored as "units of base currency per 1 unit of X", the convention used by public/shared/pricing.js.
const store = require('./store');

const REFRESH_HOURS = Number(process.env.FX_REFRESH_HOURS || 6);
const SOURCES = [
  // Free, no key, ~160 currencies incl. SAR/AED/QAR. Response: { result, rates: { USD: 1.08, ... } } = units per 1 base.
  { name: 'open.er-api.com', url: (base) => `https://open.er-api.com/v6/latest/${base}`, parse: (j) => (j.result === 'success' ? j.rates : null) },
  // European Central Bank reference rates via Frankfurter (fewer currencies, no Gulf currencies).
  { name: 'ECB (frankfurter.app)', url: (base) => `https://api.frankfurter.app/latest?from=${base}`, parse: (j) => (j.rates ? { ...j.rates, [j.base]: 1 } : null) },
];

// Effective table = live rates, then manual overrides on top.
function effective(biz) {
  return { ...(biz.fxLive || {}), ...(biz.fxOverrides || {}) };
}

function apply(biz) {
  biz.fxRates = effective(biz);
  return biz.fxRates;
}

async function refresh({ fetchImpl = fetch } = {}) {
  const db = store.load();
  const biz = db.business;
  if (biz.fxAuto === false) { apply(biz); store.save(); return { skipped: 'live rates switched off' }; }
  const base = (biz.baseCurrency || 'EUR').toUpperCase();
  let lastErr = null;
  for (const src of SOURCES) {
    try {
      const res = await fetchImpl(src.url(base), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const perBase = src.parse(await res.json());
      if (!perBase || !Object.keys(perBase).length) throw new Error('empty response');
      const live = {};
      for (const [cur, v] of Object.entries(perBase)) if (Number(v) > 0 && cur !== base) live[cur] = Number((1 / Number(v)).toPrecision(8));
      // Merge so a fallback source with fewer currencies doesn't drop rates the main source had.
      biz.fxLive = biz.fxLiveBase === base ? { ...(biz.fxLive || {}), ...live } : live;
      biz.fxLiveBase = base;
      biz.fxUpdatedAt = new Date().toISOString();
      biz.fxSource = src.name;
      biz.fxError = null;
      apply(biz);
      store.save();
      return { source: src.name, currencies: Object.keys(live).length };
    } catch (e) {
      lastErr = `${src.name}: ${e.message}`;
    }
  }
  biz.fxError = lastErr;
  apply(biz);
  store.save();
  return { error: lastErr };
}

function start() {
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), REFRESH_HOURS * 3600000);
}

module.exports = { refresh, start, apply, effective };
