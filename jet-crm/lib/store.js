// Tiny JSON-file database. Single process, atomic writes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_TEMPLATE = {
  subject: '{{ref}} | {{route}} | {{date}} | {{pax}} pax',
  body: `Dear {{contactName}},

We have a confirmed client enquiry and would appreciate your best quote:

Reference: {{ref}}
Itinerary:
{{legs}}
Passengers: {{pax}}
Preferred category: {{category}}
Notes: {{notes}}

Please reply to this email keeping {{ref}} in the subject, including aircraft type, year, tail number, total price and currency, and availability.

Kind regards,
{{senderName}}`,
};

const empty = () => ({
  settings: {
    autoSendRfq: true,
    pollSeconds: 60,
    senderName: process.env.SENDER_NAME || 'Bohio Charter Desk',
    template: DEFAULT_TEMPLATE,
    lastPollAt: null,
    lastPollStatus: 'never',
    lastPollError: null,
    routing: { mode: 'nearby', radiusKm: 800, minOperators: 3, webDiscovery: true, emailWebContacts: true },
    autoAck: true,
    ackTemplate: `Dear {{clientFirstName}},

Thank you for your request. We are on it.

{{route}}
{{date}} · {{pax}} passengers

We have already contacted our operators and will come back to you with the best available options shortly. Your reference is {{ref}}.

Kind regards,
{{senderName}}`,
    followUp: { enabled: true, everyMinutes: 15, maxPerOperator: 3 },
  },
  discoveries: {},
  business: {
    name: process.env.BUSINESS_NAME || 'Bohio Systems FZCO',
    address: 'Dubai, United Arab Emirates', taxId: '', regNo: '', email: '', phone: '', website: '',
    bankName: '', accountName: '', iban: '', swift: '',
    baseCurrency: 'EUR', fxRates: {}, fxAuto: true, fxLive: {}, fxOverrides: {}, fxBufferPct: 0, fxSource: null, fxUpdatedAt: null, fxError: null,
    feeType: 'percent', feeValue: 10, feeMin: 0, feeDisplay: 'bundled',
    vatRate: 0, vatOn: 'total',
    invoicePrefix: 'INV', nextInvoiceNo: 1, paymentTermsDays: 3,
    invoiceNotes: 'Payment is due in full before departure. Flights are subject to the operator\'s terms and conditions.',
  },
  invoices: [],
  auth: null,            // Microsoft OAuth tokens
  processedMessageIds: [],
  contacts: [],          // brokers / operators / clients
  requests: [],          // trip requests (leads)
  outbox: [],            // log of sent RFQs
  activity: [],
});

let db = null;

function load() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    db = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    db.settings = { ...empty().settings, ...db.settings };
    db.business = { ...empty().business, ...db.business };
    db.settings.routing = { ...empty().settings.routing, ...db.settings.routing };
    db.settings.followUp = { ...empty().settings.followUp, ...db.settings.followUp };
    if (db.settings.autoAck === undefined) db.settings.autoAck = true;
    if (!db.settings.ackTemplate) db.settings.ackTemplate = empty().settings.ackTemplate;
    if (['Your Brokerage Ltd', 'Bohio'].includes(db.business.name)) db.business.name = 'Bohio Systems FZCO';
    if (!db.business.address) db.business.address = 'Dubai, United Arab Emirates';
    if (!Object.keys(db.business.fxOverrides || {}).length && !Object.keys(db.business.fxLive || {}).length && Object.keys(db.business.fxRates || {}).length) {
      db.business.fxOverrides = { ...db.business.fxRates }; // rates typed before live rates existed become manual overrides
    }
  } else {
    db = empty();
    save();
  }
  return db;
}

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

function log(type, text, meta = {}) {
  load().activity.unshift({ id: id('act'), at: new Date().toISOString(), type, text, ...meta });
  db.activity = db.activity.slice(0, 500);
}

function nextRef() {
  const d = load();
  const n = d.requests.length + 1001;
  return `RFQ-${n}`;
}

module.exports = { load, save, id, log, nextRef, DEFAULT_TEMPLATE };
