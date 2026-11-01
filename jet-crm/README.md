# SkyDesk: private jet charter broker CRM

A mobile CRM (installable PWA for iPhone and Android) that watches your Outlook inbox and handles first-round sourcing for you:

1. **Every 60 seconds** the server checks your Outlook / Microsoft 365 inbox through Microsoft Graph.
2. Each new email is classified as a **charter request**, an **operator/broker quote**, or **other**. With `ANTHROPIC_API_KEY` set, Claude does this and extracts the legs, dates, passengers, category, client details and notes. Without it, a rule-based parser is used.
3. A charter request becomes a **trip request** (`RFQ-1001`, `RFQ-1002`, …), and the client is added to Contacts.
4. If **Auto-send RFQs** is on, an individual RFQ email goes **from your own mailbox** to every active broker and operator in Contacts. Recipients are never CC'd together, and sending is throttled to stay under Exchange's 30 messages/minute limit.
5. A reply that keeps `RFQ-xxxx` in the subject is attached to that request as a **quote** (operator, aircraft, year, tail, price, currency). Quotes are ranked by price, and you can select one and apply your margin.
6. **Quote comparison**: every quote is shown with operator price, your brokerage fee and the resulting client price. Quotes are converted to your base currency (using the exchange rates you set) and ranked cheapest-for-client first, with "+x% vs best" and an age warning for aircraft over 15 years old. You can correct any price or aircraft the email reader missed.
7. **Brokerage fee**: a default percentage (with optional minimum) or fixed amount, set in Settings. You can override it per trip. Fixed fees and minimums are entered in your base currency and converted to the quote's currency.
8. **Invoicing**: tap **Invoice client** on the chosen quote. SkyDesk issues a numbered invoice (e.g. `INV-2026-0001`) under your business name, address, tax number and bank details, with the charter and your fee either combined or on separate lines, plus VAT if you set a rate. You can open it as a PDF, **email it to the client from your Outlook** with the PDF attached, mark it paid (the trip moves to Won) or void it. Only one active invoice per trip.
9. The phone app updates live (server-sent events, plus a 60-second refresh). Tap the status pill at the top to check the inbox right away.

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
- Exchange rates are entered by hand in Settings and are not live; update them when you compare quotes in different currencies.
- In Saudi Arabia, tax invoices must be issued through a ZATCA (Fatoora) compliant e-invoicing system with QR code and XML clearance. SkyDesk's PDF invoices are not ZATCA-integrated. If you are VAT-registered there, use SkyDesk for quoting and pricing, and either connect a compliant e-invoicing provider or issue the final tax invoice from it. The same applies to other countries with mandatory e-invoicing.

## Install on your phone

Open the deployed HTTPS URL on your phone, then use **Share → Add to Home Screen** (iOS) or **⋮ → Install app** (Android). It runs full-screen like a native app.

## Customising

- **RFQ template**: Settings → RFQ email template. Placeholders: `{{ref}} {{route}} {{date}} {{pax}} {{legs}} {{category}} {{notes}} {{contactName}} {{company}} {{senderName}}`. Keep `{{ref}}` in the subject so replies can be matched.
- **Per-supplier opt-out**: use the toggle next to each broker or operator in Contacts.
- **Business & invoicing**: Settings → Business & invoicing (name, address, VAT/tax and company numbers, bank details, default fee, VAT rate and whether it applies to the whole invoice or the fee only, base currency, exchange rates, invoice prefix and numbering, payment terms, footer). Issued invoices keep a copy of these details, so later edits don't change them.
- **Manual requests / extra RFQs**: use the `+` button on Requests, or **Send RFQ** on a request to reach suppliers added later.

## Files

```
server.js          HTTP server, REST API, OAuth routes, SSE
lib/engine.js      60s inbox poller, request/quote pipeline, throttled RFQ outbox, demo mailbox
lib/graph.js       Microsoft Graph OAuth + read inbox + sendMail
lib/invoice.js     Invoice numbering, snapshot of business details, PDF rendering
public/shared/pricing.js  Fee, currency conversion, quote ranking, invoice totals (shared by server and app)
lib/parser.js      Claude structured extraction with rule-based fallback
lib/store.js       JSON file storage
lib/seed.js        Demo suppliers
public/            Mobile PWA (vanilla JS, no build step)
```
