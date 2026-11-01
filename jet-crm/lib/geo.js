// Airport lookup + distances. Data: OpenFlights / OurAirports (lib/airports.json, ODbL).
const path = require('path');

let rows = null;
const byCode = new Map();
function load() {
  if (rows) return;
  rows = require(path.join(__dirname, 'airports.json')).map(([icao, iata, name, city, country, lat, lon]) => ({ icao, iata, name, city, country, lat, lon }));
  for (const a of rows) {
    if (a.icao) byCode.set(a.icao, a);
    if (a.iata && !byCode.has(a.iata)) byCode.set(a.iata, a);
  }
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Accepts "Farnborough (FAB)", "EGLF", "LTN", "London Luton", "Nice", "Geneva, Switzerland"...
function resolve(text) {
  if (!text) return null;
  load();
  const t = String(text);
  const codes = t.match(/\b[A-Z0-9]{3,4}\b/g) || [];
  for (const c of codes.reverse()) if (byCode.has(c)) return byCode.get(c);
  const q = norm(t.replace(/\([^)]*\)/g, '').split(/[,/]/)[0]);
  if (q.length < 3) return null;
  const exactName = rows.find((a) => norm(a.name) === q);
  if (exactName) return exactName;
  const byCity = (name) => {
    const hits = rows.filter((a) => norm(a.city) === name && a.iata);
    if (!hits.length) return null;
    // Same city name in several countries (London UK vs London, Ontario): take the country with the most airports.
    const count = {};
    hits.forEach((a) => (count[a.country] = (count[a.country] || 0) + 1));
    const country = Object.keys(count).sort((x, y) => count[y] - count[x])[0];
    const local = hits.filter((a) => a.country === country);
    return local.find((a) => /international/i.test(a.name)) || local[0];
  };
  const city = byCity(q);
  if (city) return city;
  const nameHits = rows.filter((a) => a.iata && norm(a.name).includes(q));
  if (nameHits.length) return nameHits[0];
  const words = q.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length > 1) {
    const all = rows.find((a) => a.iata && words.every((w) => norm(`${a.city} ${a.name}`).includes(w)));
    if (all) return all;
    for (const w of [...words].sort((x, y) => y.length - x.length).filter((x) => x.length >= 5)) {
      const hit = byCity(w) || rows.find((a) => a.iata && norm(a.name).includes(w));
      if (hit) return hit;
    }
  }
  return null;
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

const label = (a) => a && `${a.name}${a.iata ? ` (${a.iata})` : a.icao ? ` (${a.icao})` : ''}, ${a.country}`;
const brief = (a) => a && { icao: a.icao, iata: a.iata, name: a.name, city: a.city, country: a.country, lat: a.lat, lon: a.lon };

module.exports = { resolve, distanceKm, contactBases, label, brief };
