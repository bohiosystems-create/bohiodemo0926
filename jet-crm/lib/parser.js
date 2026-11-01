// Turns a raw email into structured data: a charter request, an operator quote, or neither.
// Uses Claude when ANTHROPIC_API_KEY is set, otherwise a rule-based fallback.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const str = { type: ['string', 'null'] };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'client', 'legs', 'pax', 'category', 'notes', 'currency', 'quote'],
  properties: {
    kind: { type: 'string', enum: ['charter_request', 'quote', 'other'] },
    client: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'email', 'phone', 'company'],
      properties: { name: str, email: str, phone: str, company: str },
    },
    legs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'fromCode', 'toCode', 'date', 'time'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          fromCode: { ...str, description: 'ICAO code, only if one specific airport is named (e.g. EGLF); null for a city with several airports' },
          toCode: { ...str, description: 'ICAO code, only if one specific airport is named; null for a city with several airports' },
          date: { ...str, description: 'YYYY-MM-DD if known' },
          time: { ...str, description: 'HH:MM local if known' },
        },
      },
    },
    pax: { type: ['integer', 'null'] },
    category: { ...str, description: 'Turboprop, Light, Midsize, Super Midsize, Heavy, Ultra Long Range, Airliner' },
    notes: { ...str, description: 'Pets, catering, luggage, flexibility, budget, etc.' },
    currency: { ...str, description: 'ISO 4217 code of the currency the client wants to be quoted/billed in, if stated or clearly implied by a budget (e.g. "budget $50k" = USD). null if not stated.' },
    quote: {
      type: 'object',
      additionalProperties: false,
      required: ['operator', 'aircraft', 'year', 'tail', 'price', 'currency', 'notes'],
      properties: {
        operator: str, aircraft: str, year: str, tail: str,
        price: { type: ['number', 'null'] }, currency: str, notes: str,
      },
    },
  },
};

const SYSTEM = `You are the intake assistant for a private jet charter brokerage. Classify each email and extract data.
- "charter_request": a client (or client-side contact) asking for a private flight / price / availability.
- "quote": an operator or broker replying with a price and aircraft offer for a flight.
- "other": newsletters, empty-leg blasts, invoices, spam, internal chatter, anything else.
Airports: keep what the email says in from/to. Set fromCode/toCode to the ICAO code ONLY when the client names or clearly implies one specific airport (e.g. "Luton", "Le Bourget", "Teterboro", "LBG"). When the client only names a city that has several airports (London, Paris, New York, Moscow, Dubai, Milan...), leave the code null and put just the city name in from/to; the broker will confirm the airport. Resolve relative dates against the email's received date. Use null for anything unknown; never invent prices or passengers.`;

async function parseWithClaude(email, today) {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Received: ${email.receivedAt || today}\nFrom: ${email.fromName} <${email.fromEmail}>\nSubject: ${email.subject}\n\n${email.body.slice(0, 20000)}`,
    }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to parse this email');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

// ---------- rule-based fallback ----------
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
function parseDate(s, base) {
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})[a-z]*\\.?(?:\\s+(\\d{4}))?`, 'i'))
    || s.match(new RegExp(`(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'i'));
  if (m) {
    const dayFirst = /^\d/.test(m[1]);
    const day = +(dayFirst ? m[1] : m[2]);
    const order = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mon = order.indexOf((dayFirst ? m[2] : m[1]).slice(0, 3).toLowerCase());
    const year = m[3] ? +m[3] : base.getUTCFullYear();
    const d = new Date(Date.UTC(year, mon, day));
    if (!m[3] && d < new Date(base.getTime() - 86400000)) d.setUTCFullYear(year + 1);
    return d.toISOString().slice(0, 10);
  }
  m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(y, +m[2] - 1, +m[1])).toISOString().slice(0, 10);
  }
  return null;
}

function parseHeuristic(email) {
  const text = `${email.subject}\n${email.body}`;
  const base = new Date(email.receivedAt || Date.now());
  const legs = [];
  const place = "((?:[A-Z][A-Za-z.'\\-]+)(?:\\s+[A-Z][A-Za-z.'\\-]+){0,3}(?:\\s*\\([A-Z]{3,4}\\))?)";
  const re = new RegExp(`${place}\\s*(?:\\bto\\b|->|→|–|>)\\s*${place}`, 'g');
  const scan = (src) => {
    const ms = [...src.matchAll(re)];
    ms.forEach((m, i) => {
      const from = m[1].replace(/^((?:From|Fly|Flight|Flights|Jet|Re|Fw|Fwd|Need|Needed|Please|Quote|Charter|Private|Request|Hi|Hello|Urgent|Tomorrow|Today)\s+)+/i, '').trim();
      const to = m[2].trim();
      if (from.length < 3 || to.length < 3 || legs.length >= 4) return;
      const end = m.index + m[0].length;
      const ctx = src.slice(end, Math.min(ms[i + 1]?.index ?? src.length, end + 80));
      legs.push({ from, to, date: parseDate(ctx, base), time: (ctx.match(/\b(\d{1,2}:\d{2})\b/) || [])[1] || null });
    });
  };
  scan(email.body);
  if (!legs.length) scan(email.subject);
  const paxM = text.match(/(\d{1,3})\s*(?:pax|passengers|people|persons|guests)/i);
  const priceM = text.match(/(EUR|USD|GBP|CHF|AED|SAR|€|\$|£)\s?([\d,.']+(?:\s?k)?)/i);
  const isReplyToRfq = /RFQ-\d+/i.test(email.subject);
  const wantsFlight = /(charter|quote|price|availability|flight|jet|fly|pax|passengers)/i.test(text);
  const kind = isReplyToRfq && priceM ? 'quote' : legs.length && wantsFlight ? 'charter_request' : 'other';
  let price = null;
  if (priceM) {
    price = parseFloat(priceM[2].replace(/[,']/g, ''));
    if (/k$/i.test(priceM[2])) price *= 1000;
  }
  const cur = priceM ? ({ '€': 'EUR', '$': 'USD', '£': 'GBP' }[priceM[1]] || priceM[1].toUpperCase()) : null;
  const cat = (text.match(/\b(turboprop|light|midsize|mid-size|super[\s-]?midsize|heavy|ultra[\s-]?long[\s-]?range|airliner)\b/i) || [])[1] || null;
  const ac = (text.match(/\b((?:Citation|Phenom|Learjet|Challenger|Global|Falcon|Gulfstream|G\d{3,4}|Legacy|Praetor|King Air|PC-12|Hawker|Embraer Lineage|Pilatus PC-24)[\w\s-]{0,12})/i) || [])[1] || null;
  return {
    kind,
    client: { name: email.fromName || null, email: email.fromEmail || null, phone: (text.match(/\+\d[\d\s-]{7,}\d/) || [])[0] || null, company: null },
    legs,
    pax: paxM ? +paxM[1] : null,
    category: cat,
    notes: null,
    currency: kind === 'charter_request' ? cur : null,
    quote: { operator: email.fromName || null, aircraft: ac && ac.replace(/\s+(YOM|year|yr|reg|tail|price|total)\b.*$/i, '').replace(/[,.\s]+$/, '').trim(), year: (text.match(/\b(?:yom|year)[:\s]*(\d{4})/i) || [])[1] || null, tail: (text.match(/\b([A-Z0-9]{1,2}-[A-Z]{3,5}|N\d{1,5}[A-Z]{0,2})\b/) || [])[1] || null, price, currency: cur, notes: null },
  };
}

async function parseEmail(email) {
  if (client) {
    try {
      return { ...(await parseWithClaude(email, new Date().toISOString())), engine: 'claude' };
    } catch (e) {
      console.error('[parser] Claude failed, using heuristic:', e.message);
    }
  }
  return { ...parseHeuristic(email), engine: 'rules' };
}

module.exports = { parseEmail, parseHeuristic, aiEnabled: () => Boolean(client) };
