// Airport lookup + distances. Data: OpenFlights / OurAirports (lib/airports.json, ODbL).
// Understands cities with several airports: "London" is ambiguous (8 airports), "London City", "Biggin Hill",
// "Paris Le Bourget", "LBG", "EGLF" are specific.
const path = require('path');

// Metro areas served by several airports. Business-aviation airports first (used as the default / for distances).
const METROS = [
  { code: 'LON', name: 'London', country: 'United Kingdom', names: ['london', 'greater london'], airports: ['EGLF', 'EGGW', 'EGKB', 'EGLC', 'EGWU', 'EGSS', 'EGKK', 'EGLL'] },
  { code: 'PAR', name: 'Paris', country: 'France', names: ['paris'], airports: ['LFPB', 'LFPG', 'LFPO'] },
  { code: 'NYC', name: 'New York', country: 'United States', names: ['new york', 'new york city', 'nyc', 'manhattan'], airports: ['KTEB', 'KHPN', 'KMMU', 'KJFK', 'KEWR', 'KLGA'] },
  { code: 'MOW', name: 'Moscow', country: 'Russia', names: ['moscow'], airports: ['UUWW', 'UUEE', 'UUDD'] },
  { code: 'MIL', name: 'Milan', country: 'Italy', names: ['milan', 'milano'], airports: ['LIML', 'LIMC', 'LIME'] },
  { code: 'ROM', name: 'Rome', country: 'Italy', names: ['rome', 'roma'], airports: ['LIRA', 'LIRF'] },
  { code: 'WAS', name: 'Washington', country: 'United States', names: ['washington', 'washington dc', 'washington d c'], airports: ['KIAD', 'KDCA', 'KBWI'] },
  { code: 'CHI', name: 'Chicago', country: 'United States', names: ['chicago'], airports: ['KMDW', 'KPWK', 'KORD'] },
  { code: 'TYO', name: 'Tokyo', country: 'Japan', names: ['tokyo'], airports: ['RJTT', 'RJAA'] },
  { code: 'SAO', name: 'São Paulo', country: 'Brazil', names: ['sao paulo'], airports: ['SBSP', 'SBGR', 'SBMT'] },
  { code: 'STO', name: 'Stockholm', country: 'Sweden', names: ['stockholm'], airports: ['ESSB', 'ESSA'] },
  { code: 'DXB', name: 'Dubai', country: 'United Arab Emirates', names: ['dubai'], airports: ['OMDW', 'OMDB'], cityCodeIsAirport: true },
  { code: 'AUH', name: 'Abu Dhabi', country: 'United Arab Emirates', names: ['abu dhabi'], airports: ['OMAD', 'OMAA'], cityCodeIsAirport: true },
  { code: 'DOH', name: 'Doha', country: 'Qatar', names: ['doha'], airports: ['OTBD', 'OTHH'], cityCodeIsAirport: true },
  { code: 'IST', name: 'Istanbul', country: 'Turkey', names: ['istanbul'], airports: ['LTFJ', 'LTFM', 'LTBA'], cityCodeIsAirport: true },
  { code: 'LAX', name: 'Los Angeles', country: 'United States', names: ['los angeles', 'la'], airports: ['KVNY', 'KSMO', 'KBUR', 'KLAX', 'KLGB'], cityCodeIsAirport: true },
  { code: 'MIA', name: 'Miami', country: 'United States', names: ['miami'], airports: ['KOPF', 'KFLL', 'KMIA'], cityCodeIsAirport: true },
  { code: 'SFO', name: 'San Francisco', country: 'United States', names: ['san francisco', 'bay area'], airports: ['KSJC', 'KOAK', 'KSFO'], cityCodeIsAirport: true },
  { code: 'LAS', name: 'Las Vegas', country: 'United States', names: ['las vegas', 'vegas'], airports: ['KHND', 'KLAS'], cityCodeIsAirport: true },
  { code: 'BOS', name: 'Boston', country: 'United States', names: ['boston'], airports: ['KBED', 'KBOS'], cityCodeIsAirport: true },
  { code: 'HOU', name: 'Houston', country: 'United States', names: ['houston'], airports: ['KHOU', 'KIAH'] },
  { code: 'DFW', name: 'Dallas', country: 'United States', names: ['dallas', 'dallas fort worth'], airports: ['KDAL', 'KDFW'] },
  { code: 'YTO', name: 'Toronto', country: 'Canada', names: ['toronto'], airports: ['CYTZ', 'CYYZ'] },
  { code: 'BKK', name: 'Bangkok', country: 'Thailand', names: ['bangkok'], airports: ['VTBD', 'VTBS'], cityCodeIsAirport: true },
  { code: 'SHA', name: 'Shanghai', country: 'China', names: ['shanghai'], airports: ['ZSSS', 'ZSPD'], cityCodeIsAirport: true },
  { code: 'BJS', name: 'Beijing', country: 'China', names: ['beijing'], airports: ['ZBAA', 'ZBAD'] },
  { code: 'SEL', name: 'Seoul', country: 'South Korea', names: ['seoul'], airports: ['RKSS', 'RKSI'] },
  { code: 'SIN', name: 'Singapore', country: 'Singapore', names: ['singapore'], airports: ['WSSL', 'WSSS'], cityCodeIsAirport: true },
  { code: 'SYD', name: 'Sydney', country: 'Australia', names: ['sydney'], airports: ['YSBK', 'YSSY'], cityCodeIsAirport: true },
  { code: 'JNB', name: 'Johannesburg', country: 'South Africa', names: ['johannesburg', 'joburg'], airports: ['FALA', 'FAOR'], cityCodeIsAirport: true },
  { code: 'VCE', name: 'Venice', country: 'Italy', names: ['venice', 'venezia'], airports: ['LIPZ', 'LIPH'], cityCodeIsAirport: true },
  { code: null, name: 'Riyadh', country: 'Saudi Arabia', names: ['riyadh'], airports: ['OERK'] },
  { code: null, name: 'Côte d\'Azur', country: 'France', names: ['cote d azur', 'french riviera', 'riviera'], airports: ['LFMN', 'LFMD', 'LFTZ'] },
];

// Names people use that don't match the official airport name.
const ALIASES = {
  'dubai world central': 'OMDW', 'al maktoum': 'OMDW', 'dubai south': 'OMDW', 'jebel ali': 'OMDW',
  'al bateen': 'OMAD', 'doha old airport': 'OTBD', 'hamad': 'OTHH',
  'istanbul new airport': 'LTFM', 'istanbul airport': 'LTFM', 'sabiha': 'LTFJ', 'ataturk': 'LTBA',
  'luton': 'EGGW', 'stansted': 'EGSS', 'gatwick': 'EGKK', 'heathrow': 'EGLL', 'northolt': 'EGWU', 'biggin hill': 'EGKB', 'farnborough': 'EGLF', 'london city': 'EGLC', 'oxford': 'EGTK',
  'le bourget': 'LFPB', 'charles de gaulle': 'LFPG', 'cdg': 'LFPG', 'orly': 'LFPO',
  'teterboro': 'KTEB', 'white plains': 'KHPN', 'westchester': 'KHPN', 'morristown': 'KMMU', 'jfk': 'KJFK', 'newark': 'KEWR', 'la guardia': 'KLGA', 'laguardia': 'KLGA',
  'vnukovo': 'UUWW', 'sheremetyevo': 'UUEE', 'domodedovo': 'UUDD', 'linate': 'LIML', 'malpensa': 'LIMC', 'bergamo': 'LIME', 'ciampino': 'LIRA', 'fiumicino': 'LIRF',
  'van nuys': 'KVNY', 'opa locka': 'KOPF', 'henderson': 'KHND', 'hanscom': 'KBED', 'love field': 'KDAL',
  'billy bishop': 'CYTZ', 'don mueang': 'VTBD', 'seletar': 'WSSL', 'lanseria': 'FALA', 'bankstown': 'YSBK', 'gimpo': 'RKSS', 'campo de marte': 'SBMT',
  'cannes': 'LFMD', 'cannes mandelieu': 'LFMD', 'la mole': 'LFTZ', 'saint tropez': 'LFTZ', 'st tropez': 'LFTZ', 'treviso': 'LIPH',
  'king khalid': 'OERK', 'king khaled': 'OERK', 'king abdulaziz': 'OEJN',
};

let rows = null;
const byCode = new Map();
const metroByCode = new Map(METROS.filter((m) => m.code).map((m) => [m.code, m]));
function load() {
  if (rows) return;
  rows = require(path.join(__dirname, 'airports.json')).map(([icao, iata, name, city, country, lat, lon]) => ({ icao, iata, name, city, country, lat, lon }));
  for (const a of rows) {
    if (a.icao) byCode.set(a.icao, a);
    if (a.iata && !byCode.has(a.iata)) byCode.set(a.iata, a);
  }
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-–_.']/g, ' ').replace(/\s+/g, ' ').trim();
const group = (name, country, airports) => ({ airport: null, metro: { name, country, airports }, ambiguous: airports.length > 1, primary: airports[0] });
const metroResult = (m) => {
  const r = group(m.name, m.country, m.airports.map((c) => byCode.get(c)).filter(Boolean));
  r.metro.code = m.code;
  return r;
};
const one = (a) => (a ? { airport: a, metro: null, ambiguous: false, primary: a } : null);

// Airports whose city is `name`; if the name exists in several countries (London UK vs London, Ontario) keep the biggest group.
function cityAirports(name) {
  const hits = rows.filter((a) => norm(a.city) === name && a.iata);
  if (!hits.length) return [];
  const count = {};
  hits.forEach((a) => (count[a.country] = (count[a.country] || 0) + 1));
  const country = Object.keys(count).sort((x, y) => count[y] - count[x])[0];
  return hits.filter((a) => a.country === country).sort((a, b) => /international/i.test(b.name) - /international/i.test(a.name));
}
const cityResult = (hits) => (hits.length > 1 ? group(hits[0].city, hits[0].country, hits) : one(hits[0]));

// Full answer: { airport, metro, ambiguous, primary } or null.
//  - airport: the exact airport when the text names one
//  - metro + ambiguous: the text only names a city that has several airports
//  - primary: best single airport for distances (business-aviation airport first)
function place(text) {
  if (!text) return null;
  load();
  const t = String(text);
  // 1. Explicit codes, e.g. "Farnborough (FAB)", "EGLF", "LON".
  const codes = (t.match(/\b[A-Z0-9]{3,4}\b/g) || []).reverse();
  for (const c of codes) {
    const m = metroByCode.get(c);
    if (m && !m.cityCodeIsAirport) return metroResult(m);
    if (byCode.has(c)) return one(byCode.get(c));
  }
  const stripped = t.replace(/\([^)]*\)/g, '');
  const full = norm(stripped);
  const q = norm(stripped.split(/[,/]/)[0]);
  if (q.length < 2) return null;
  // 2. Well-known airport names / nicknames ("Biggin Hill", "Le Bourget", "Dubai World Central").
  for (const [alias, code] of Object.entries(ALIASES).sort((a, b) => b[0].length - a[0].length)) {
    if ((' ' + full + ' ').includes(' ' + alias + ' ')) return one(byCode.get(code));
  }
  // 3. Just a city with several airports ("London", "Paris", "New York").
  const metro = METROS.find((m) => m.names.includes(q) || m.names.includes(full));
  if (metro) return metroResult(metro);
  if (q.length < 3) return null;
  // 4. Airport by its official name ("London City Airport", "Westchester County").
  const exact = rows.find((a) => norm(a.name) === q || norm(a.name) === `${q} airport`);
  if (exact) return one(exact);
  // 5. City name from the airport table (several airports in one city = ambiguous).
  const hits = cityAirports(q);
  if (hits.length) return cityResult(hits);
  const nameHit = rows.find((a) => a.iata && norm(a.name).includes(q));
  if (nameHit) return one(nameHit);
  // 6. Multi-word text: all words, then the longest word as a city.
  const words = q.split(' ').filter((w) => w.length >= 3);
  if (words.length > 1) {
    const all = rows.find((a) => a.iata && words.every((w) => norm(`${a.city} ${a.name}`).includes(w)));
    if (all) return one(all);
    for (const w of [...words].sort((x, y) => y.length - x.length).filter((x) => x.length >= 5)) {
      const m = METROS.find((x) => x.names.includes(w));
      if (m) return metroResult(m);
      const h = cityAirports(w);
      if (h.length) return cityResult(h);
    }
  }
  return null;
}

// One airport (exact, or the city's primary airport) — used for distances.
function resolve(text) {
  const p = place(text);
  return p ? p.primary : null;
}

function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// A contact's bases: "EGLF, LTN" (codes or names). Falls back to the free-text region.
function contactBases(c) {
  const list = String(c.bases || '').split(/[,;/]+/).map((s) => s.trim()).filter(Boolean).map(resolve).filter(Boolean);
  if (list.length) return list;
  const r = resolve(c.region);
  return r ? [r] : [];
}

const code = (a) => a && (a.iata || a.icao);
const label = (a) => a && `${a.name}${a.iata ? ` (${a.iata})` : a.icao ? ` (${a.icao})` : ''}, ${a.country}`;
const brief = (a) => a && { icao: a.icao, iata: a.iata, name: a.name, city: a.city, country: a.country, lat: a.lat, lon: a.lon };

// What a leg endpoint resolves to, for the UI and RFQ emails. Prefers the explicit code chosen by the user/parser.
function endpoint(text, explicitCode) {
  const p = (explicitCode && place(explicitCode)) || place(text);
  if (!p) return { status: 'unknown', text };
  if (p.airport || !p.ambiguous) return { status: 'airport', text, airport: brief(p.airport || p.primary) };
  return { status: 'city', text, city: { code: p.metro.code || null, name: p.metro.name, country: p.metro.country }, options: p.metro.airports.map(brief) };
}

// RFQ wording for a leg endpoint.
function describe(text, explicitCode) {
  const e = endpoint(text, explicitCode);
  if (e.status === 'airport') return `${e.airport.name} (${[e.airport.iata, e.airport.icao].filter(Boolean).join('/')})`;
  if (e.status === 'city') return `${e.city.name} area, airport flexible (${e.options.map(code).join(', ')})`;
  return text;
}

module.exports = { place, resolve, endpoint, describe, distanceKm, contactBases, label, brief, code, METROS };
