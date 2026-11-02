// Shared by server and browser: brokerage fee, currency conversion, quote comparison, invoice totals.
// Exchange rates: business.fxRates = { USD: 3.75, EUR: 4.05 } = units of base currency per 1 unit of X.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pricing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const round2 = (n) => Math.round(n * 100) / 100;
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'SAR', 'AED', 'QAR', 'KWD', 'BHD', 'OMR', 'TRY', 'RUB', 'INR', 'CNY', 'HKD', 'SGD', 'JPY', 'AUD', 'CAD', 'BRL', 'MXN', 'ZAR', 'EGP', 'MAD', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'ILS'];

  const baseOf = (business) => (business.baseCurrency || 'EUR').toUpperCase();

  // Units of base per 1 unit of `cur` (1 for the base itself, null if unknown).
  function rateToBase(cur, business) {
    const base = baseOf(business);
    if (!cur || cur === base) return 1;
    const r = Number(business.fxRates && business.fxRates[cur]);
    return r > 0 ? r : null;
  }

  // Cross rate: how many `to` for 1 `from`. null when a rate is missing.
  function crossRate(from, to, business) {
    if (!from || !to || from === to) return 1;
    const a = rateToBase(from, business), b = rateToBase(to, business);
    return a && b ? a / b : null;
  }

  // Converts with the optional FX buffer (business.fxBufferPct) applied whenever a conversion happens.
  function convert(amount, from, to, business, { buffer = true } = {}) {
    if (amount == null) return null;
    const r = crossRate(from, to, business);
    if (r == null) return null;
    const pct = buffer && from !== to ? Number(business.fxBufferPct) || 0 : 0;
    return round2(amount * r * (1 + pct / 100));
  }

  // Fee for one quote, in the quote's currency. Fixed fees and minimums are entered in the base currency.
  function feeFor(operatorPrice, feeRule, currency, business) {
    const rule = feeRule || { type: 'percent', value: 0 };
    const fromBase = (v) => convert(Number(v) || 0, baseOf(business), currency || baseOf(business), business, { buffer: false }) ?? (Number(v) || 0);
    let fee = rule.type === 'fixed' ? fromBase(rule.value) : operatorPrice * (Number(rule.value) || 0) / 100;
    if (rule.type === 'percent' && rule.min && fromBase(rule.min) > fee) fee = fromBase(rule.min);
    return round2(fee);
  }
  const minApplied = (price, rule, currency, business) =>
    rule.type === 'percent' && rule.min > 0 && feeFor(price, rule, currency, business) > round2(price * rule.value / 100);

  function effectiveFee(request, business) {
    return request.fee || { type: business.feeType || 'percent', value: business.feeValue ?? 10, min: business.feeMin || 0 };
  }

  // The currency the client is quoted and invoiced in.
  const clientCurrency = (request, business) => (request.currency || baseOf(business)).toUpperCase();

  // Quotes with fee + client price in the quote's currency and in the client's currency, ranked cheapest first.
  function compareQuotes(request, business) {
    const rule = effectiveFee(request, business);
    const target = clientCurrency(request, business);
    const rows = request.quotes.map((q) => {
      const cur = (q.currency || baseOf(business)).toUpperCase();
      const fee = q.price != null ? feeFor(q.price, rule, cur, business) : null;
      const clientPrice = q.price != null ? round2(q.price + fee) : null;
      const ageYears = q.year ? new Date().getFullYear() - Number(q.year) : null;
      return { ...q, currency: cur, fee, clientPrice, ageYears, clientPriceTarget: convert(clientPrice, cur, target, business), converted: cur !== target };
    });
    const priced = rows.filter((r) => r.clientPrice != null);
    const comparable = priced.every((r) => r.clientPriceTarget != null);
    const missingRates = [...new Set(priced.filter((r) => r.clientPriceTarget == null).map((r) => r.currency))];
    const key = (r) => (r.clientPriceTarget ?? Infinity);
    priced.sort((a, b) => key(a) - key(b));
    const best = priced.find((r) => r.clientPriceTarget != null);
    priced.forEach((r) => {
      r.deltaPct = best && r.clientPriceTarget != null ? round2(((r.clientPriceTarget - best.clientPriceTarget) / best.clientPriceTarget) * 100) : null;
      r.isBest = r === best;
    });
    return { rows: priced.concat(rows.filter((r) => r.clientPrice == null)), rule, base: baseOf(business), target, comparable, missingRates, best,
      mixedCurrencies: new Set(priced.map((r) => r.currency)).size > 1 };
  }

  // Invoice lines/totals for the selected quote, in the invoice currency (default: the client's currency).
  function invoiceTotals(quote, feeRule, business, invoiceCurrency) {
    const qc = (quote.currency || baseOf(business)).toUpperCase();
    const ic = (invoiceCurrency || qc).toUpperCase();
    const feeQ = feeFor(quote.price, feeRule, qc, business);
    const conv = (v) => convert(v, qc, ic, business);
    const operatorPrice = conv(quote.price), fee = conv(feeQ);
    if (operatorPrice == null || fee == null) return { error: `No exchange rate for ${qc} → ${ic}. Add one in Settings → Tax & currency.` };
    const vatRate = Number(business.vatRate) || 0;
    const separate = business.feeDisplay === 'separate';
    const subtotal = round2(operatorPrice + fee);
    const lines = separate ? [{ kind: 'charter', amount: operatorPrice }, { kind: 'fee', amount: fee }] : [{ kind: 'charter', amount: subtotal }];
    const vat = round2((business.vatOn === 'fee' ? fee : subtotal) * vatRate / 100);
    const fx = qc === ic ? null : { from: qc, to: ic, rate: Number(crossRate(qc, ic, business).toPrecision(6)), bufferPct: Number(business.fxBufferPct) || 0,
      source: business.fxSource || 'manual', at: business.fxUpdatedAt || null, operatorPriceOriginal: round2(quote.price), feeOriginal: feeQ,
      bufferAmount: round2(subtotal - convert(quote.price + feeQ, qc, ic, business, { buffer: false })) };
    return { lines, fee, operatorPrice, subtotal, vatRate, vat, total: round2(subtotal + vat), currency: ic, fx, minApplied: minApplied(quote.price, feeRule, qc, business) };
  }

  function parseFx(text) {
    const out = {};
    String(text || '').split(/[,\n;]/).forEach((p) => {
      const m = p.match(/([A-Za-z]{3})\s*[=:]\s*([\d.]+)/);
      if (m && Number(m[2]) > 0) out[m[1].toUpperCase()] = Number(m[2]);
    });
    return out;
  }

  // Sum amounts in mixed currencies into one currency; returns { total, missing: [currencies without a rate] }.
  function sumIn(items, to, business) {
    let total = 0; const missing = new Set();
    items.forEach(({ amount, currency }) => { const v = convert(amount, currency, to, business, { buffer: false }); if (v == null) missing.add(currency); else total += v; });
    return { total: round2(total), missing: [...missing] };
  }

  // Totals for a manually written invoice. lines: [{ kind: 'charter'|'fee'|'other', amount }]
  function manualTotals(lines, business) {
    const amt = (l) => round2(Number(l.amount) || 0);
    const subtotal = round2(lines.reduce((n, l) => n + amt(l), 0));
    const fee = round2(lines.filter((l) => l.kind === 'fee').reduce((n, l) => n + amt(l), 0));
    const vatRate = Number(business.vatRate) || 0;
    const vat = round2((business.vatOn === 'fee' ? fee : subtotal) * vatRate / 100);
    return { subtotal, fee, vatRate, vat, total: round2(subtotal + vat) };
  }

  // Invoice number INV-yymmddnn: today's date in Dubai time + a 2-digit counter that restarts each day.
  function invoiceNumber(existingNumbers, prefix = 'INV', now = new Date()) {
    const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', year: '2-digit', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const v = (t) => d.find((x) => x.type === t).value;
    const stem = `${prefix}-${v('year')}${v('month')}${v('day')}`;
    let n = 0;
    for (const x of existingNumbers || []) { const m = String(x).match(new RegExp(`^${stem}(\\d{2,})$`)); if (m) n = Math.max(n, +m[1]); }
    return `${stem}${String(n + 1).padStart(2, '0')}`;
  }

  return { invoiceNumber, manualTotals, CURRENCIES, rateToBase, crossRate, convert, feeFor, minApplied, effectiveFee, clientCurrency, compareQuotes, invoiceTotals, parseFx, sumIn, round2 };
});
