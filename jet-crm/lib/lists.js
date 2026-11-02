// Contact lists dropped into DATA_DIR/lists/*.json are imported once into Contacts.
// They live in the private data folder, never in the (public) repository, because they hold people's contact details.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'lists');
const LABELS = { 'mena-prospects': 'Private Aviation Prospect List — MENA' };
const LISTS = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) : [])
  .map((file) => { const base = file.replace(/\.json$/, ''); return { id: base, file, label: LABELS[base] || base.replace(/[-_]+/g, ' ') }; });
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

function importList(list, { force = false } = {}) {
  const db = store.load();
  db.importedLists = db.importedLists || {};
  if (db.importedLists[list.id] && !force) return null;
  const items = JSON.parse(fs.readFileSync(path.join(DIR, list.file), 'utf8'));
  const res = importItems(items, list.label);
  db.importedLists[list.id] = { at: new Date().toISOString(), ...res };
  store.save();
  return res;
}

// Merges list items into Contacts. Email is optional; matching is by email, else by company name.
function importItems(items, label) {
  const db = store.load();
  const list = { label };
  let added = 0, updated = 0;
  for (const x of items) {
    if (!x || typeof x !== 'object' || !(x.company || x.name || x.email)) continue;
    const email = String(x.email || '').toLowerCase().trim();
    if (!['client', 'operator', 'broker'].includes(x.type)) x.type = 'client';
    const ex = (email && db.contacts.find((c) => c.email === email)) || db.contacts.find((c) => norm(c.company) && norm(c.company) === norm(x.company) && (c.type === 'client') === (x.type === 'client'));
    const data = {
      name: x.name || x.company, company: x.company, email, phone: x.phone || '', type: x.type, region: x.region || '', country: x.country || '',
      bases: x.bases || '', baseEstimated: !!x.baseEstimated, fleet: x.fleet || '', website: x.website || '', notes: x.notes || '', tags: x.tags || '',
      sourceUrl: x.sourceUrl || '', list: list.label, ...(x.type !== 'client' ? { global: false } : {}),
    };
    if (ex) { for (const [k, v] of Object.entries(data)) if (v !== '' && v != null && (ex[k] == null || ex[k] === '')) ex[k] = v; updated++; }
    else {
      db.contacts.push({ id: store.id('con'), createdAt: new Date().toISOString(), source: 'list', rfqEnabled: x.type !== 'client' && !!email, ...data });
      added++;
    }
  }
  store.log('contacts', `Imported "${list.label}": ${added} contacts added, ${updated} updated`);
  store.save();
  return { added, updated };
}

function ensure() {
  for (const l of LISTS()) {
    try { importList(l); } catch (e) { console.error(`[lists] ${l.file}: ${e.message}`); }
  }
}
module.exports = { ensure, importList, importItems, LISTS };
