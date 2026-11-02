# SkyDesk: private jet charter broker CRM

A mobile CRM (installable PWA for iPhone and Android) that watches your Outlook inbox and handles first-round sourcing for you:

1. **Every 60 seconds** the server checks your Outlook / Microsoft 365 inbox through Microsoft Graph.
2. Each new email is classified as a **charter request**, an **operator/broker quote**, or **other**. With `ANTHROPIC_API_KEY` set, Claude does this and extracts the legs, dates, passengers, category, client details and notes. Without it, a rule-based parser is used.
3. **Instant reply**: the moment a charter request is recognised, SkyDesk replies in the client's own email thread confirming you're on it, with their route, date, passengers and reference (editable in Settings → Client replies & operator follow-ups). If the client later replies in that thread, it's kept on the trip as a client message, not mistaken for a quote.
   A charter request becomes a **trip request** (`RFQ-1001`, `RFQ-1002`, …), and the client is added to Contacts.
4. If **Auto-send RFQs** is on, the request is **routed by geography**:
   - The departure airport is identified (Claude returns ICAO codes; the built-in table of ~7,700 airports resolves codes, airport names and nicknames such as "Biggin Hill", "Le Bourget" or "Dubai World Central").
   - **Cities with several airports**: if the client only names a city such as London, Paris, New York, Moscow, Dubai, Milan or Istanbul (about 30 cities, plus city codes like LON, PAR, NYC, MOW), the trip shows "airport not specified" with a **Choose airport** list (business-aviation airports first). Until you choose, RFQs say "London area, airport flexible (FAB, LTN, BQH, LCY, NHT, STN, LGW, LHR)" and routing measures distance from the nearest of those airports.
   - **Operators** whose base airport is within the radius (default 800 km) get the RFQ, in priority order: first those whose **fleet is known to fit the trip** (enough seats, the requested category or larger, range for the longest leg), then those with no fleet on file. **Brokers** marked *covers worldwide* get every RFQ, after the operators. Operators whose known fleet can't do the trip (e.g. light jets for a 10-seat transatlantic request) are skipped, with the reason shown on the trip; you can still add them by hand.
   - Fleet knowledge comes from each contact's **Fleet** field (aircraft types such as "Citation XLS+, Challenger 350", or classes such as "heavy jets"), matched against a built-in table of ~50 business-aviation types with seats and range (`public/shared/aircraft.js`). Operators found online get their fleet from their website.
   - If fewer nearby operators are on file than the minimum (default 3), **Claude searches the web** for charter operators based near that airport, opens their websites, and adds the ones whose quote/sales email is published on their own domain to Contacts (marked *found online*, with the source page). They are emailed straight away, or added switched off for review if you turn that option off. Each airport is searched at most once every 30 days.
   - If the departure airport can't be recognised, the RFQ goes to every active supplier and the trip says so.
   - Each RFQ goes **from your own mailbox** as an individual email, throttled under Exchange's 30 messages/minute limit. The trip shows who got it and why ("based LTN, 72 km away", "covers worldwide").
5. A reply that keeps `RFQ-xxxx` in the subject is attached to that request as a **quote** (operator, aircraft, year, tail, price, currency). Quotes are ranked by price, and you can select one and apply your margin.
6. **Operator follow-ups**: operators who haven't replied are chased every 15 minutes with a short follow-up (default up to 3 times each). Chasing stops as soon as they reply, when the trip moves to Proposal/Won/Lost, or once the trip date has passed. Tap any operator on the trip to see the RFQ, each follow-up and their reply.
7. **Offer to the client (with your approval)**: the first quote on a trip opens a **30-minute window** to collect more (Settings → Client replies & operator follow-ups). When it closes, the agent recommends one quote, ranked on the client's price and on fit to the request: quotes with too few seats or no usable price are excluded, aircraft smaller than the requested category are only proposed if nothing else fits, and likely fuel stops or aircraft over 15 years old count against a quote. The trip shows the pick and why; **Review & approve** lets you choose another quote, confirm or change the brokerage fee (standard **5%**) and edit the email. Nothing goes to the client until you tap **Approve fee & send offer**. The operator's name and tail number are not shown to the client. If more quotes arrive while it's waiting for you, the recommendation updates. **Recommend now** skips the rest of the window.
8. **Quotation → award → invoice**: approving an offer issues a numbered **quotation** (`QUO-2026-0001`, valid 48 hours by default) with a PDF attached; the client email asks them to reply "Confirmed" to book. When the client's reply comes in (in the quotation thread or their original enquiry thread), the agent reads it. A clear confirmation within the validity period marks the quotation **accepted** and shows **Confirm & send invoice** on the trip (and a prompt on the Requests screen). Nothing is invoiced until you tap it: then the flight is **awarded** and the invoice is issued from the quotation's exact amounts and emailed with the PDF. A decline marks the trip Lost. Anything unclear (a question, a change, a confirmation after the quotation expired) waits for you. **Awarded: send invoice** does the same by hand (e.g. the client confirmed by phone). The **Invoice client** button on each quote still lets you invoice directly without a quotation. Operator names and tail numbers never appear on client documents.
9. **Quote comparison**: every quote is shown with operator price, your brokerage fee and the resulting client price. Quotes are converted to the client's currency and ranked cheapest-for-client first, with "+x% vs best" and an age warning for aircraft over 15 years old. You can correct any price or aircraft the email reader missed.
10. **Multi-currency**: every trip has a **client currency**, taken from the email (e.g. "budget $120k" = USD), the client's saved preference, or your base currency, and changeable on the trip. Operator quotes in any currency are converted into it, ranked, and invoiced in it. Exchange rates are refreshed live every 6 hours (open.er-api.com, falling back to ECB rates via frankfurter.app); you can override any rate by hand and add an **FX buffer %** to cover currency risk. Each invoice stores the rate it used, and the app shows what the operator must be paid in their own currency. Invoice totals are summed in your base currency at today's rates.
11. **Brokerage fee**: a default percentage (standard 5%) (with optional minimum) or fixed amount, set in Settings. You can override it per trip. Fixed fees and minimums are entered in your base currency and converted to the quote's currency.
12. **Invoicing**: tap **Invoice client** on the chosen quote. SkyDesk issues a numbered invoice (e.g. `INV-2026-0001`) under your business name, address, tax number and bank details, with the charter and your fee either combined or on separate lines, plus VAT if you set a rate. Invoices are issued by **Bohio Systems FZCO, Dubai, UAE** (change in Settings → Business & invoicing). The **+** button on the Invoices tab writes an invoice by hand: pick a client or type one, add charter / brokerage-fee / other lines, choose the currency, optionally link it to a trip. You can open it as a PDF, **email it to the client from your Outlook** with the PDF attached, mark it paid (the trip moves to Won) or void it. Only one active invoice per trip.
13. The phone app updates live (server-sent events, plus a 60-second refresh). Tap the status pill at the top to check the inbox right away.

Contacts that sent an email can never trigger a new request: an email from an existing broker or operator is only treated as a quote, or ignored.

## Run locally (demo mode, no credentials)

```bash
cd jet-crm
npm install
npm start            # http://localhost:3000
```

Without Microsoft credentials, the app runs on a **demo inbox** with 8 demo suppliers. Go to **Settings → Simulate incoming email** and drop in an enquiry. RFQs are "simulated", and demo brokers reply with quotes within about a minute.

## Connect your real Outlook

1. In the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration**
   - Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*, or just your org.
   - Redirect URI (Web): `https://YOUR-DOMAIN/auth/callback` (and `http://localhost:3000/auth/callback` for local use).
2. **API permissions → Microsoft Graph → Delegated**: `offline_access`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`. Grant admin consent if your tenant requires it.
3. **Certificates & secrets → New client secret**. Copy the *Value*.
4. Set the environment variables (see `.env.example`): `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`, `PUBLIC_BASE_URL`, plus `APP_PASSWORD` and `ANTHROPIC_API_KEY`.
5. Restart, open the app → **Settings → Connect Outlook**, then sign in. The first check imports the last hour of inbox mail.

Once Outlook is connected, demo suppliers are never emailed. Import your real brokers and operators under **Contacts → Import CSV** (columns: `name,email,company,phone,type,region,fleet`; `type` = `broker`, `operator` or `client`). Review the list **before** leaving Auto-send on, because every active supplier receives every RFQ.

## Deploy (always-on)

The 60-second poll needs a long-running process, so use an always-on host rather than serverless functions:

- **Render**: `render.yaml` is included (web service + 1 GB persistent disk at `/data`).
- **Docker / any VPS / Fly.io / Railway**: `docker build -t skydesk . && docker run -p 3000:3000 -v skydesk:/data --env-file .env skydesk`

Data is stored in `DATA_DIR/db.json`, including the Outlook refresh token. Keep that disk private and back it up.

## Invoicing notes

- Invoices are not sent automatically. You choose the quote and tap send, so a client never gets an invoice you haven't checked.
- Live rates are mid-market reference rates, not your bank's rate. Use the FX buffer % or manual overrides to match what you actually pay when settling operators.
- In Saudi Arabia, tax invoices must be issued through a ZATCA (Fatoora) compliant e-invoicing system with QR code and XML clearance. SkyDesk's PDF invoices are not ZATCA-integrated. If you are VAT-registered there, use SkyDesk for quoting and pricing, and either connect a compliant e-invoicing provider or issue the final tax invoice from it. The same applies to other countries with mandatory e-invoicing.

## Install on your phone

Open the deployed HTTPS URL on your phone, then use **Share → Add to Home Screen** (iOS) or **⋮ → Install app** (Android). It runs full-screen like a native app.

## Customising

- **RFQ template**: Settings → RFQ email template. Placeholders: `{{ref}} {{route}} {{date}} {{pax}} {{legs}} {{category}} {{notes}} {{contactName}} {{company}} {{senderName}}`. Keep `{{ref}}` in the subject so replies can be matched.
- **Per-supplier opt-out**: use the toggle next to each broker or operator in Contacts.
- **Routing**: Settings → RFQ routing (nearby vs everyone, radius, minimum nearby operators, web search on/off, email web-found operators automatically or not). Give each operator its base airports (e.g. `EGLF, EGKB`) in Contacts or with a `base` column in CSV imports; operators with no base don't receive routed RFQs. **Send RFQ** on a trip shows recommended and out-of-area suppliers with distances so you can add more by hand, and **Find operators online** runs the web search on demand.
- **Launch screen**: the Bohio Air Charter poster (`public/splash.jpg`) shows when the app opens and fades out after about 1.6 seconds (tap to skip).
- **iPhone contacts**: Contacts → **Import contacts** → *Choose from iPhone contacts* opens the iPhone contact list so you can tick who to add (Safari needs **Settings → Apps → Safari → Advanced → Feature Flags → Contact Picker API** switched on), or *Import a contacts file (.vcf)* for a vCard exported from iPhone (Share Contact → Save to Files) or icloud.com (Export vCard), which works on every iPhone. You choose whether they're clients, operators or brokers; only contacts with an email address are added, and nothing on the phone is changed. A web app can't keep a live two-way sync with the iPhone address book.
- **Contact lists**: Contacts → Import contacts → *Import a contact list (.json)* loads a prepared list (e.g. the MENA prospect list) in one go; contacts without email are kept, existing ones are matched by email or company and only missing details are filled in. Alternatively put the file in `DATA_DIR/lists/` on the server and it is imported once at start-up. Lists contain people's contact details, so keep them out of this (public) repository. Operators and brokers with an email are switched on for RFQs and routed by their base airport and fleet; clients are tagged by category (Family office, Umrah & Hajj agency, Concierge / agency partner, Luxury travel agent) with filters in Contacts.
- **Business & invoicing**: Settings → Business & invoicing (name, address, VAT/tax and company numbers, bank details, default fee, VAT rate and whether it applies to the whole invoice or the fee only, base currency, exchange rates, invoice prefix and numbering, payment terms, footer). Issued invoices keep a copy of these details, so later edits don't change them.
- **Manual requests / extra RFQs**: use the `+` button on Requests, or **Send RFQ** on a request to reach suppliers added later.

## Files

```
server.js          HTTP server, REST API, OAuth routes, SSE
lib/engine.js      60s inbox poller, request/quote pipeline, throttled RFQ outbox, demo mailbox
lib/graph.js       Microsoft Graph OAuth + read inbox + sendMail
lib/invoice.js     Invoice numbering, snapshot of business details, PDF rendering
public/shared/pricing.js  Fee, currency conversion, quote ranking, invoice totals (shared by server and app)
public/shared/aircraft.js Aircraft types, seats and range; judges whether a fleet can do a trip
public/shared/proposal.js Ranks quotes on price + fit to the request and drafts the client offer email
lib/routing.js     Geographic RFQ routing + Claude web search for operators near the departure airport
lib/geo.js         Airport lookup (codes, names, nicknames, multi-airport cities) and distances
lib/fx.js          Live exchange rates with manual overrides
lib/airports.json  Airport codes and coordinates (OpenFlights / OurAirports data, ODbL)
lib/parser.js      Claude structured extraction with rule-based fallback
lib/store.js       JSON file storage
lib/seed.js        Demo suppliers
public/            Mobile PWA (vanilla JS, no build step); bg.jpg is the page background photo
```
