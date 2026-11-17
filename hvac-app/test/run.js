// node test/run.js : checks pricing.js against the reference-building snapshot and tracker maths.
const assert = require('assert');
const { price, P0 } = require('../pricing.js');
const T = require('../tracker.js');
const ref = require('./routes_usd.json');

const base = { btype: 'apartment', flats: 20, perFlat: 3, common: 7, floors: 5, cooling: 'dc', occ: false, balc: false, warr: false };
const states = {
  A1: { ...base, bmsType: 'open', bmsAccess: 'write' },
  A2: { ...base, bmsType: 'legacy', bmsAccess: 'write' },
  A3: { ...base, bmsType: 'open', bmsAccess: 'read' },
  B1: base, B2: base, B3: base,
  C1: { ...base, cooling: 'elec' }, C2: { ...base, cooling: 'elec' },
  D1: { ...base, perFlat: 1, common: 5, cooling: 'elec' },
  E1: { ...base, cooling: 'elec' },
};
let ok = 0;
for (const code of Object.keys(ref)) {
  const r = price(code, states[code], P0);
  assert.strictEqual(r.one, ref[code].one, `${code} one-time: got ${r.one}, snapshot ${ref[code].one}`);
  assert.strictEqual(r.monthly, ref[code].monthly, `${code} monthly`);
  ok++;
}
console.log(`pricing: ${ok} routes match routes_usd.json`);

// tracker maths
const rows = (v) => Array.from({ length: 96 }, (_, i) => ({ t: `2026-07-01T${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00`, kwh: v }));
const s = T.savings(rows(40), rows(34), 0.38, 0.40);
assert.strictEqual(Math.round(s.baseline), 3840); assert.strictEqual(Math.round(s.actual), 3264);
assert.strictEqual(Math.round(s.saved), 576); assert.ok(Math.abs(s.pct - 15) < 1e-9);
assert.ok(Math.abs(s.aed - 576 * 0.38) < 1e-6);
const p = T.parseCSV('timestamp,hvac_kwh\n2026-07-01T00:00:00,40\n2026-07-01,x\n2026-07-02,12.5\n');
assert.strictEqual(p.rows.length, 2); assert.strictEqual(p.errors.length, 1);
assert.deepStrictEqual(T.daily(p.rows), [['2026-07-01', 40], ['2026-07-02', 12.5]]);
console.log('tracker: ok');
