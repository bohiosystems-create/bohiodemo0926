// Picks the quote to propose to the client and drafts the client email. Shared by server and browser.
// Ranking = client price (in the client's currency) adjusted for how well the aircraft matches the request.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pricing'), require('./aircraft'));
  else root.Proposal = factory(root.Pricing, root.Aircraft);
})(typeof self !== 'undefined' ? self : this, function (Pricing, Aircraft) {
  // needs = { pax, category, longestLegKm }; feePct overrides the fee used for client prices (approval step).
  function evaluate(request, business, needs = {}, feePct) {
    const req = feePct != null ? { ...request, fee: { type: 'percent', value: Number(feePct) || 0, min: Number(business.feeMin) || 0 } } : request;
    const cmp = Pricing.compareQuotes(req, business);
    const wantCat = Aircraft.rank(needs.category || request.category);
    const pax = Number(needs.pax ?? request.pax) || 0;
    const legKm = Number(needs.longestLegKm) || 0;
    const rows = cmp.rows.map((q) => {
      const penalties = [], notes = [];
      let disqualified = null;
      if (q.clientPriceTarget == null) disqualified = q.price == null ? 'no price in the reply' : `no exchange rate for ${q.currency}`;
      const a = Aircraft.parseFleet(q.aircraft).find((x) => !x.generic);
      if (!a) penalties.push(['aircraft not identified', 5]);
      else {
        if (pax && a.seats < pax) disqualified = disqualified || `${a.name} seats ${a.seats}, client needs ${pax}`;
        if (legKm && a.rangeKm < legKm * 1.05) penalties.push([`range ${Math.round(a.rangeKm / 100) * 100} km for a ${legKm.toLocaleString()} km leg: likely fuel stop`, 8]);
        if (wantCat != null && a.cat < wantCat) { penalties.push([`smaller than the ${Aircraft.CATEGORIES[wantCat]} requested`, 15]); var below = true; }
        if (wantCat != null && a.cat > wantCat) notes.push(`larger than requested (${Aircraft.CATEGORIES[a.cat]})`);
        if (wantCat != null && a.cat === wantCat) notes.push(`matches the ${Aircraft.CATEGORIES[wantCat]} requested`);
        if (pax && a.seats >= pax) notes.push(`${a.seats} seats for ${pax} passengers`);
      }
      if (q.ageYears != null && q.ageYears > 20) penalties.push([`${q.ageYears} years old`, 5]);
      else if (q.ageYears != null && q.ageYears > 15) penalties.push([`${q.ageYears} years old`, 2]);
      const pct = penalties.reduce((n, [, p]) => n + p, 0);
      const effective = q.clientPriceTarget != null ? Pricing.round2(q.clientPriceTarget * (1 + pct / 100)) : null;
      return { ...q, aircraftInfo: a || null, penalties: penalties.map(([t, p]) => ({ text: t, pct: p })), notes, disqualified, effective, belowRequest: !!(typeof below !== 'undefined' && below) };
    });
    // Quotes that meet the request come first; smaller-than-requested aircraft only if nothing else fits.
    const ok = rows.filter((r) => !r.disqualified).sort((x, y) => (x.belowRequest - y.belowRequest) || (x.effective - y.effective) || (x.penalties.length - y.penalties.length) || (x.clientPriceTarget - y.clientPriceTarget));
    const best = ok[0] || null;
    const cheapest = [...ok].sort((x, y) => x.clientPriceTarget - y.clientPriceTarget)[0] || null;
    return { rows: ok.concat(rows.filter((r) => r.disqualified)), best, cheapest, target: cmp.target, fee: cmp.rule };
  }

  // Why the agent picked this quote, in one sentence.
  function why(ev) {
    const b = ev.best;
    if (!b) return 'No quote fits the request yet.';
    const out = [];
    const isCheapest = ev.cheapest && ev.cheapest.id === b.id;
    out.push(`${isCheapest ? 'Lowest price' : 'Best value'}${b.notes.length ? ': ' + b.notes.join(', ') : ''}.`);
    if (!isCheapest && ev.cheapest) out.push(`The cheapest quote (${ev.cheapest.company}) ${ev.cheapest.penalties.length ? 'is ' + ev.cheapest.penalties.map((p) => p.text).join(', ') : 'fits the request less well'}.`);
    if (b.belowRequest) out.push('No quote met the requested size, so this is the closest.');
    if (b.penalties.length) out.push(`Watch: ${b.penalties.map((p) => p.text).join(', ')}.`);
    return out.join(' ');
  }

  function draftEmail(request, row, business, { senderName, routeText }) {
    const first = (request.client?.name || '').split(' ')[0] || 'Sir/Madam';
    const a = row.aircraftInfo;
    const lines = [
      `Dear ${first},`, '',
      `Thank you for your patience. For your trip ${routeText} on ${request.legs[0]?.date || 'the requested date'} (${request.pax ?? 'TBC'} passengers), we recommend:`, '',
      `Aircraft: ${row.aircraft || 'Private jet'}${row.year ? ` (${row.year})` : ''}${a ? `, ${a.seats} seats` : ''}`,
      `Total price: ${evaluateTarget(request, business)} ${fmt(row.clientPriceTarget)}, all-inclusive`,
      ...(row.penalties.some((p) => /fuel stop/.test(p.text)) ? ['Note: this aircraft may need one short fuel stop on the longest leg.'] : []),
      '', 'This offer is subject to availability at the time of confirmation. To book, simply reply to this email and we will send the contract and invoice.', '',
      'Kind regards,', senderName || business.name, `Ref ${request.ref}`,
    ];
    return { subject: `${request.ref} | Your private jet offer`, body: lines.join('\n') };
  }
  const evaluateTarget = (request, business) => (request.currency || business.baseCurrency || 'EUR').toUpperCase();
  const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

  return { evaluate, why, draftEmail };
});
