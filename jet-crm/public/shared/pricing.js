// Shared by server and browser: brokerage fee, currency conversion, quote comparison, invoice totals.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pricing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const round2 = (n) => Math.round(n * 100) / 100;

  // Fee for one quote, in the quote's currency. Fixed fees and minimums are entered in the base currency
  // and converted with fxRates (units of base per 1 unit of currency).
  function feeFor(operatorPrice, feeRule, currency, base, fxRates) {
    const rule = feeRule || { type: 'percent', value: 0 };
    const rate = !currency || currency === base ? 1 : Number(fxRates && fxRates[currency]) || 1;
    const fromBase = (v) => (Number(v) || 0) / rate;
    let fee = rule.type === 'fixed' ? fromBase(rule.value) : operatorPrice * (Number(rule.value) || 0) / 100;
    const minApplied = rule.type === 'percent' && rule.min && fromBase(rule.min) > fee;
    if (minApplied) fee = fromBase(rule.min);
    return round2(fee);
  }
  const minApplied = (price, rule, currency, base, fx) =>
    rule.type === 'percent' && rule.min > 0 && feeFor(price, rule, currency, base, fx) > round2(price * rule.value / 100);

  // fxRates: { USD: 3.75, EUR: 4.05 } = how many units of base currency 1 unit is worth. Base itself = 1.
  function toBase(amount, currency, base, fxRates) {
    if (amount == null) return null;
    if (!currency || currency === base) return amount;
    const r = fxRates && Number(fxRates[currency]);
    return r ? amount * r : null;
  }

  function effectiveFee(request, business) {
    return request.fee || { type: business.feeType || 'percent', value: business.feeValue ?? 10, min: business.feeMin || 0 };
  }

  // Returns quotes with clientPrice/fee/base figures, ranked cheapest-for-client first.
  function compareQuotes(request, business) {
    const rule = effectiveFee(request, business);
    const base = business.baseCurrency || 'EUR';
    const rows = request.quotes.map((q) => {
      const fee = q.price != null ? feeFor(q.price, rule, q.currency || base, base, business.fxRates) : null;
      const clientPrice = q.price != null ? round2(q.price + fee) : null;
      const ageYears = q.year ? new Date().getFullYear() - Number(q.year) : null;
      return { ...q, fee, clientPrice, ageYears, clientPriceBase: toBase(clientPrice, q.currency, base, business.fxRates) };
    });
    const priced = rows.filter((r) => r.clientPrice != null);
    const currencies = [...new Set(priced.map((r) => r.currency || base))];
    const comparable = priced.every((r) => r.clientPriceBase != null);
    const key = (r) => (comparable ? r.clientPriceBase : r.clientPrice);
    priced.sort((a, b) => key(a) - key(b));
    const best = priced[0];
    priced.forEach((r) => {
      r.deltaPct = best && (comparable || r.currency === best.currency) ? round2(((key(r) - key(best)) / key(best)) * 100) : null;
      r.isBest = r === best;
    });
    return { rows: priced.concat(rows.filter((r) => r.clientPrice == null)), rule, base, comparable, mixedCurrencies: currencies.length > 1, best };
  }

  // Builds invoice lines/totals for the selected quote.
  function invoiceTotals(quote, feeRule, business) {
    const base = business.baseCurrency || 'EUR';
    const fee = feeFor(quote.price, feeRule, quote.currency || base, base, business.fxRates);
    const vatRate = Number(business.vatRate) || 0;
    const separate = business.feeDisplay === 'separate';
    const lines = separate
      ? [{ kind: 'charter', amount: round2(quote.price) }, { kind: 'fee', amount: fee }]
      : [{ kind: 'charter', amount: round2(quote.price + fee) }];
    const subtotal = round2(quote.price + fee);
    const vatBase = business.vatOn === 'fee' ? fee : subtotal;
    const vat = round2(vatBase * vatRate / 100);
    return { lines, fee, operatorPrice: round2(quote.price), subtotal, vatRate, vat, total: round2(subtotal + vat), currency: quote.currency || base,
      minApplied: minApplied(quote.price, feeRule, quote.currency || base, base, business.fxRates) };
  }

  function parseFx(text) {
    const out = {};
    String(text || '').split(/[,\n;]/).forEach((p) => {
      const m = p.match(/([A-Za-z]{3})\s*[=:]\s*([\d.]+)/);
      if (m) out[m[1].toUpperCase()] = Number(m[2]);
    });
    return out;
  }

  return { feeFor, minApplied, toBase, compareQuotes, invoiceTotals, effectiveFee, parseFx, round2 };
});
