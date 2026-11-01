// Business-aviation aircraft knowledge, shared by server and browser.
// Used to judge whether an operator's fleet can do a requested trip (category, seats, range).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Aircraft = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CATEGORIES = ['Turboprop', 'Light', 'Midsize', 'Super Midsize', 'Heavy', 'Ultra Long Range', 'Airliner'];
  const rank = (cat) => {
    const c = String(cat || '').toLowerCase().replace(/[-_]/g, ' ');
    if (!c) return null;
    if (/turbo ?prop|king air|pc ?12|tbm/.test(c)) return 0;
    if (/very light|entry|vlj|light/.test(c)) return 1;
    if (/super ?mid/.test(c)) return 3;
    if (/mid/.test(c)) return 2;
    if (/ultra|long range|ulr/.test(c)) return 5;
    if (/heavy|large/.test(c)) return 4;
    if (/airliner|vip|bbj|acj|bizliner|corporate liner/.test(c)) return 6;
    return null;
  };
  // Typical figures when only a class is known.
  const CLASS = [
    { seats: 8, rangeKm: 2400 }, { seats: 7, rangeKm: 3300 }, { seats: 8, rangeKm: 4800 }, { seats: 9, rangeKm: 6000 },
    { seats: 13, rangeKm: 8000 }, { seats: 15, rangeKm: 12500 }, { seats: 30, rangeKm: 9000 },
  ];
  // name, regex (lower-case text), category rank, seats, range km (NBAA IFR, typical)
  const TYPES = [
    ['King Air 350', /king ?air ?(350|360)|b350/, 0, 9, 3300], ['King Air 250', /king ?air ?(200|250|260|b200)/, 0, 7, 3100],
    ['Pilatus PC-12', /pc[- ]?12/, 0, 8, 3400], ['TBM 9x0', /tbm[- ]?9[0-9]{2}/, 0, 5, 3300], ['Piaggio Avanti', /avanti|p\.?180/, 0, 7, 2700],
    ['Citation Mustang', /mustang/, 1, 4, 2100], ['Phenom 100', /phenom ?100/, 1, 5, 2200], ['HondaJet', /honda ?jet/, 1, 5, 2600],
    ['Citation M2', /citation ?m2|\bm2\b/, 1, 6, 2800], ['Citation CJ2', /cj2|citation ?jet ?2/, 1, 6, 2900], ['Citation CJ3', /cj3/, 1, 7, 3700],
    ['Citation CJ4', /cj4/, 1, 8, 3900], ['Citation CJ1', /cj1|citation ?jet\b/, 1, 5, 2400], ['Phenom 300', /phenom ?300/, 1, 8, 3700],
    ['Learjet 75', /lear(jet)? ?(70|75|45|40)/, 1, 8, 3800], ['Nextant 400XTi', /nextant|hawker ?400|beechjet/, 1, 7, 3700], ['Premier 1A', /premier/, 1, 6, 2500],
    ['Citation XLS+', /xls|citation ?excel/, 2, 9, 3900], ['Citation Latitude', /latitude/, 2, 9, 5000], ['Citation Sovereign', /sovereign/, 2, 9, 5600],
    ['Hawker 800/900', /hawker ?(750|800|850|900|1000)/, 2, 8, 4600], ['Learjet 60', /lear(jet)? ?60/, 2, 7, 4400], ['Praetor 500 / Legacy 450', /praetor ?500|legacy ?450/, 2, 9, 6000],
    ['Gulfstream G150', /g150|g-150/, 2, 7, 5500], ['Pilatus PC-24', /pc[- ]?24/, 2, 8, 3700],
    ['Challenger 350', /challenger ?(300|350|3500)|cl ?3[05]0/, 3, 9, 5900], ['Citation X', /citation ?x\b|citation ?ten/, 3, 8, 6000], ['Citation Longitude', /longitude/, 3, 9, 6500],
    ['Praetor 600 / Legacy 500', /praetor ?600|legacy ?500/, 3, 9, 7400], ['Gulfstream G280', /g280|g200|g-280|g-200/, 3, 9, 6700], ['Falcon 2000', /falcon ?2000|f2000/, 3, 10, 7400], ['Falcon 50', /falcon ?50\b/, 3, 9, 5700],
    ['Challenger 650', /challenger ?(600|601|604|605|650)|cl ?6[05][0-9]/, 4, 11, 7400], ['Falcon 900', /falcon ?900|f900/, 4, 12, 8300], ['Falcon 7X', /falcon ?7x|f7x/, 4, 14, 11000],
    ['Gulfstream G450', /g450|giv|g-iv|g400|g-450/, 4, 14, 8000], ['Gulfstream G550', /g550|gv\b|g-v|g500|g-550/, 4, 16, 12500], ['Legacy 650', /legacy ?(600|650)/, 4, 13, 7200],
    ['Global 5000', /global ?(5000|5500|express)/, 4, 13, 9600], ['Global 6000', /global ?(6000|6500|xrs)/, 5, 14, 11100],
    ['Falcon 8X', /falcon ?8x|f8x/, 5, 14, 11900], ['Gulfstream G600', /g600|g-600/, 5, 15, 12000], ['Gulfstream G650', /g650|g-650/, 5, 16, 13000], ['Gulfstream G700', /g700|g800|g-700/, 5, 17, 13900],
    ['Global 7500', /global ?(7000|7500|8000)/, 5, 17, 14200],
    ['Lineage 1000', /lineage/, 6, 19, 8500], ['Boeing BBJ', /bbj|boeing ?business|737 ?(vip|bbj)/, 6, 25, 11000], ['Airbus ACJ', /acj|a3(18|19|20|21) ?(vip|corporate)/, 6, 25, 11000],
    ['Embraer ERJ VIP', /erj|embraer ?1(35|45)/, 6, 16, 3700], ['MD-80 VIP', /md[- ]?8[0-9]|dc[- ]?9/, 6, 30, 4000],
  ];

  // Parses a fleet description ("Citation XLS+, 2x Challenger 350, heavy jets") into known aircraft and class hints.
  function parseFleet(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return [];
    const out = [];
    for (const [name, re, cat, seats, rangeKm] of TYPES) if (re.test(t)) out.push({ name, cat, seats, rangeKm });
    for (const part of t.split(/[,;/+&\n]| and /)) {
      const r = rank(part);
      if (r != null && !/\d{2,}/.test(part) && !out.some((o) => o.cat === r)) out.push({ name: `${CATEGORIES[r]} class`, cat: r, ...CLASS[r], generic: true });
    }
    return out;
  }

  const fmtKm = (n) => `${Math.round(n / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // Does this fleet fit the trip? needs = { pax, category, longestLegKm }
  // Returns { status: 'capable' | 'unknown' | 'unsuitable', best, reason }
  function fit(fleetText, needs) {
    const fleet = parseFleet(fleetText);
    if (!fleet.length) return { status: 'unknown', reason: 'fleet not on file' };
    const wantCat = rank(needs.category);
    const pax = Number(needs.pax) || 0;
    const legKm = Number(needs.longestLegKm) || 0;
    const ok = [];
    const fails = new Set();
    for (const a of fleet) {
      const problems = [];
      if (wantCat != null && a.cat < wantCat) problems.push(`smaller than ${CATEGORIES[wantCat]}`);
      if (pax && a.seats < pax) problems.push(`${a.seats} seats`);
      if (legKm && a.rangeKm < legKm * 1.1) problems.push(`range ${fmtKm(a.rangeKm)} km`);
      if (!problems.length) ok.push(a); else problems.forEach((p) => fails.add(p));
    }
    if (ok.length) {
      // prefer the smallest aircraft that fits (cheapest), named types over class hints
      ok.sort((a, b) => (a.generic - b.generic) || (a.cat - b.cat) || (a.seats - b.seats));
      const b = ok[0];
      return { status: 'capable', best: b.name, reason: `${b.name} fits (${b.seats} seats, ${fmtKm(b.rangeKm)} km)` };
    }
    return { status: 'unsuitable', reason: `fleet can't do this trip (${[...fails].slice(0, 2).join(', ')})` };
  }

  return { CATEGORIES, rank, parseFleet, fit, TYPES };
});
