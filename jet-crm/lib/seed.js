// Demo suppliers so the app is usable before real contacts are imported.
// Seeded contacts are flagged demo:true and never receive real email once Outlook is connected.
const store = require('./store');

const SUPPLIERS = [
  // name, company, type, region, base airports, covers worldwide
  ['Sophie Laurent', 'Riviera Jet Partners', 'broker', 'Nice / Monaco', 'LFMN', true],
  ['James Whitmore', 'Albion Executive Aviation', 'operator', 'London Luton', 'EGGW', false],
  ['Oliver Grant', 'Thames Business Jets', 'operator', 'Farnborough', 'EGLF, EGKB', false],
  ['Khalid Al-Mansoori', 'Gulf Sky Charter', 'operator', 'Dubai', 'OMDW', false],
  ['Marco Bellini', 'Alpine Wings', 'operator', 'Milan Linate', 'LIML', false],
  ['Claire Dubois', 'Azur Executive Flights', 'operator', 'Nice / Cannes', 'LFMN, LFMD', false],
  ['Elena Petrova', 'Nordic Executive Jets', 'broker', 'Geneva', 'LSGG', true],
  ['David Cohen', 'Atlantic Jet Brokers', 'broker', 'New York', 'KTEB', true],
  ['Fatima Al-Saud', 'Red Sea Aviation', 'operator', 'Jeddah', 'OEJN', false],
  ['Faisal Al-Harbi', 'Najd Jet Services', 'operator', 'Riyadh', 'OERK', false],
  ['Lukas Huber', 'Danube Air Charter', 'operator', 'Vienna', 'LOWW', false],
];

function ensure() {
  const db = store.load();
  if (db.contacts.length || process.env.SEED_DEMO === 'false') return;
  for (const [name, company, type, region, bases, global] of SUPPLIERS) {
    const slug = company.toLowerCase().replace(/[^a-z]+/g, '');
    db.contacts.push({
      id: store.id('con'), name, company, type, region, bases, global, rfqEnabled: true, demo: true,
      email: `${name.split(' ')[0].toLowerCase()}@${slug}.example.com`, phone: '', createdAt: new Date().toISOString(),
    });
  }
  store.log('system', `Loaded ${SUPPLIERS.length} demo brokers/operators`);
  store.save();
}

module.exports = { ensure };
