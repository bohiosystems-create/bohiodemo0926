// Geographic RFQ routing: operators based near the departure airport + brokers who cover worldwide.
// When too few nearby operators are on file, Claude searches the web for more and adds them to Contacts.
const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');
const geo = require('./geo');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
let client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const DISCOVERY_TTL_DAYS = 30;

const isGlobal = (c) => (c.global ?? c.type === 'broker');
// Departure as a set of points: one airport, or every airport of a city the client named without choosing one.
const departurePlace = (req) => {
  const leg = req.legs?.[0];
  if (!leg) return null;
  return (leg.fromCode && geo.place(leg.fromCode)) || geo.place(leg.from);
};
const departure = (req) => departurePlace(req)?.primary || null;
const areaOf = (p) => (p && !p.airport && p.ambiguous ? { name: p.metro.name, country: p.metro.country, airports: p.metro.airports.map(geo.code) } : null);

// Ranks every supplier contact for a request. Pure: no side effects.
function candidates(req, { live }) {
  const db = store.load();
  const cfg = db.settings.routing;
  const depPlace = departurePlace(req);
  const dep = depPlace?.primary || null;
  const depPoints = depPlace ? (depPlace.airport ? [depPlace.airport] : depPlace.metro.airports) : [];
  const rows = db.contacts
    .filter((c) => c.type !== 'client' && c.email && c.email !== req.client?.email && !(c.demo && live))
    .map((c) => {
      const bases = geo.contactBases(c);
      const nearest = dep && bases.length ? bases.flatMap((b) => depPoints.map((p) => ({ b, d: geo.distanceKm(p, b) }))).sort((x, y) => x.d - y.d)[0] : null;
      let include = false, reason;
      if (c.rfqEnabled === false) reason = 'RFQs switched off';
      else if (cfg.mode === 'all') { include = true; reason = 'sending to all'; }
      else if (!dep) { include = true; reason = 'departure airport not recognised, sent to all'; }
      else if (isGlobal(c)) { include = true; reason = 'covers worldwide'; }
      else if (nearest && nearest.d <= cfg.radiusKm) { include = true; reason = `based ${nearest.b.iata || nearest.b.icao}, ${nearest.d} km away`; }
      else if (nearest) reason = `based ${nearest.b.iata || nearest.b.icao}, ${nearest.d} km away (outside ${cfg.radiusKm} km)`;
      else reason = 'no base airport on file';
      return { contact: c, include, reason, distanceKm: nearest?.d ?? null, global: isGlobal(c) };
    })
    .sort((a, b) => (b.include - a.include) || ((a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9)));
  const nearbyOperators = rows.filter((r) => r.include && !r.global && r.distanceKm != null).length;
  return { dep, area: areaOf(depPlace), rows, nearbyOperators, cfg };
}

// ---------- web discovery ----------
const SAVE_TOOL = {
  name: 'save_operators',
  description: 'Save the charter operators you found. Call this exactly once, at the end, with every verified operator.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['operators'],
    properties: {
      operators: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['company', 'email', 'phone', 'website', 'baseAirport', 'city', 'country', 'fleet', 'sourceUrl'],
          properties: {
            company: { type: 'string' },
            email: { type: 'string', description: 'Charter sales / quotes / operations email exactly as published on the source page' },
            phone: { type: ['string', 'null'] },
            website: { type: 'string', description: 'Company website URL' },
            baseAirport: { type: 'string', description: 'ICAO code of the home base, e.g. EGLF' },
            city: { type: ['string', 'null'] },
            country: { type: ['string', 'null'] },
            fleet: { type: ['string', 'null'], description: 'Aircraft types operated, short' },
            sourceUrl: { type: 'string', description: 'Page where the email address was found' },
          },
        },
      },
    },
  },
};

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const sameOrg = (emailDomain, h) => {
  if (!emailDomain || !h) return false;
  const core = (d) => d.split('.').filter((p) => !['com', 'co', 'net', 'org', 'aero', 'uk', 'ae', 'sa', 'ch', 'fr', 'de', 'it', 'es', 'at', 'us', 'io', 'aviation', 'jet', 'eu'].includes(p)).pop();
  return emailDomain === h || emailDomain.endsWith('.' + h) || h.endsWith('.' + emailDomain) || (core(emailDomain) && core(emailDomain) === core(h));
};

async function discover(dep, want, existingEmails) {
  const prompt = `Find up to ${want} private jet charter OPERATORS (Air Operator Certificate holders that operate their own business jets, not brokers or marketplaces) based at or near ${geo.label(dep)} (ICAO ${dep.icao}), within about ${store.load().settings.routing.radiusKm} km.
For each operator, open its official website and find the email address it publishes for charter quotes, sales or operations. Only include an operator if you saw that email address on a page you fetched, and give that page as sourceUrl. Prefer generic desk addresses (charter@, sales@, ops@) over named individuals.
Skip these addresses, already on file: ${[...existingEmails].slice(0, 200).join(', ') || 'none'}.
When done, call save_operators once with the verified operators (an empty list is fine if none can be verified).`;
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 12 },
    SAVE_TOOL,
  ];
  const messages = [{ role: 'user', content: prompt }];
  for (let turn = 0; turn < 6; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL, max_tokens: 16000, tools, messages,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium' },
    });
    if (res.stop_reason === 'refusal') throw new Error('Web search was declined');
    const call = res.content.find((b) => b.type === 'tool_use' && b.name === 'save_operators');
    if (call) return call.input.operators || [];
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    if (res.stop_reason === 'end_turn') {
      messages.push({ role: 'assistant', content: res.content });
      messages.push({ role: 'user', content: 'Please call save_operators now with what you verified.' });
      continue;
    }
    break;
  }
  return [];
}

// Adds operators found online for this departure airport. Cached per airport.
async function discoverNearby(dep, need) {
  const db = store.load();
  db.discoveries = db.discoveries || {};
  const prev = db.discoveries[dep.icao];
  if (prev && Date.now() - Date.parse(prev.at) < DISCOVERY_TTL_DAYS * 86400000) return { skipped: 'searched recently', added: [] };
  if (!client) return { skipped: 'web search needs ANTHROPIC_API_KEY', added: [] };
  const emails = new Set(db.contacts.map((c) => c.email));
  const found = await discover(dep, Math.max(need, 5), emails);
  const added = [];
  for (const o of found) {
    const email = String(o.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) || emails.has(email)) continue;
    const domain = email.split('@')[1];
    if (!sameOrg(domain, host(o.website)) && !sameOrg(domain, host(o.sourceUrl))) continue; // email must belong to the operator's own site
    const base = geo.resolve(o.baseAirport) || geo.resolve(o.city);
    if (base && geo.distanceKm(dep, base) > db.settings.routing.radiusKm * 1.5) continue;
    const c = {
      id: store.id('con'), type: 'operator', name: o.company, company: o.company, email, phone: o.phone || '',
      bases: base ? base.icao : o.baseAirport, region: [o.city, o.country].filter(Boolean).join(', '), fleet: o.fleet || '',
      website: o.website, source: 'web', sourceUrl: o.sourceUrl, foundFor: dep.icao, createdAt: new Date().toISOString(),
      rfqEnabled: db.settings.routing.emailWebContacts !== false, global: false,
    };
    db.contacts.push(c);
    emails.add(email);
    added.push(c);
  }
  db.discoveries[dep.icao] = { at: new Date().toISOString(), found: found.length, added: added.map((c) => c.id) };
  store.log('discovery', `Found ${added.length} operator${added.length === 1 ? '' : 's'} online near ${dep.iata || dep.icao}${found.length > added.length ? ` (${found.length - added.length} skipped: unverified or duplicate email)` : ''}`);
  store.save();
  return { added };
}

// Decides who gets the RFQ. May search the web first. Returns contact ids + a routing summary for the request.
async function route(req, { live }) {
  let plan = candidates(req, { live });
  let discovery = null;
  const cfg = plan.cfg;
  if (cfg.mode !== 'all' && plan.dep && plan.nearbyOperators < cfg.minOperators && cfg.webDiscovery) {
    try { discovery = await discoverNearby(plan.dep, cfg.minOperators - plan.nearbyOperators); }
    catch (e) { discovery = { error: e.message, added: [] }; store.log('discovery', `Web search for operators near ${plan.dep.iata || plan.dep.icao} failed: ${e.message}`); }
    plan = candidates(req, { live });
  }
  const chosen = plan.rows.filter((r) => r.include);
  const summary = {
    airport: geo.brief(plan.dep), area: plan.area, radiusKm: cfg.radiusKm, mode: cfg.mode,
    nearby: plan.nearbyOperators, worldwide: chosen.filter((r) => r.global).length,
    discovered: discovery?.added?.length || 0, discoveryNote: discovery?.skipped || discovery?.error || null,
    reasons: Object.fromEntries(chosen.map((r) => [r.contact.id, r.reason])),
    at: new Date().toISOString(),
  };
  return { contactIds: chosen.map((r) => r.contact.id), summary };
}

module.exports = { _setClientForTests: (c) => (client = c), candidates, route, discoverNearby, departure, isGlobal, aiEnabled: () => Boolean(client) };
