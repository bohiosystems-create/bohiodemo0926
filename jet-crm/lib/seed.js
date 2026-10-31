// Demo suppliers so the app is usable before real contacts are imported.
// Seeded contacts are flagged demo:true and never receive real email once Outlook is connected.
const store = require('./store');

const SUPPLIERS = [
  ['Sophie Laurent', 'Riviera Jet Partners', 'broker', 'Nice / Monaco'],
  ['James Whitmore', 'Albion Executive Aviation', 'operator', 'London Luton'],
  ['Khalid Al-Mansoori', 'Gulf Sky Charter', 'operator', 'Dubai DWC'],
  ['Marco Bellini', 'Alpine Wings', 'operator', 'Milan Linate'],
  ['Elena Petrova', 'Nordic Executive Jets', 'broker', 'Geneva'],
  ['David Cohen', 'Atlantic Jet Brokers', 'broker', 'New York Teterboro'],
  ['Fatima Al-Saud', 'Red Sea Aviation', 'operator', 'Jeddah'],
  ['Lukas Huber', 'Danube Air Charter', 'operator', 'Vienna'],
];

function ensure() {
  const db = store.load();
  if (db.contacts.length || process.env.SEED_DEMO === 'false') return;
  for (const [name, company, type, region] of SUPPLIERS) {
    const slug = company.toLowerCase().replace(/[^a-z]+/g, '');
    db.contacts.push({
      id: store.id('con'), name, company, type, region, rfqEnabled: true, demo: true,
      email: `${name.split(' ')[0].toLowerCase()}@${slug}.example.com`, phone: '', createdAt: new Date().toISOString(),
    });
  }
  store.log('system', 'Loaded 8 demo brokers/operators');
  store.save();
}

module.exports = { ensure };
