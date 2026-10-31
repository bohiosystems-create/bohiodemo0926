# SkyDesk: private jet charter broker CRM

A mobile CRM (installable PWA for iPhone and Android) that watches your Outlook inbox and handles first-round sourcing for you:

1. **Every 60 seconds** the server checks your Outlook / Microsoft 365 inbox through Microsoft Graph.
2. Each new email is classified as a **charter request**, an **operator/broker quote**, or **other**. With `ANTHROPIC_API_KEY` set, Claude does this and extracts the legs, dates, passengers, category, client details and notes. Without it, a rule-based parser is used.
3. A charter request becomes a **trip request** (`RFQ-1001`, `RFQ-1002`, …), and the client is added to Contacts.
4. If **Auto-send RFQs** is on, an individual RFQ email goes **from your own mailbox** to every active broker and operator in Contacts. Recipients are never CC'd together, and sending is throttled to stay under Exchange's 30 messages/minute limit.
5. A reply that keeps `RFQ-xxxx` in the subject is attached to that request as a **quote** (operator, aircraft, year, tail, price, currency). Quotes are ranked by price, and you can select one and apply your margin.
6. The phone app updates live (server-sent events, plus a 60-second refresh). Tap the status pill at the top to check the inbox right away.

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

## Install on your phone

Open the deployed HTTPS URL on your phone, then use **Share → Add to Home Screen** (iOS) or **⋮ → Install app** (Android). It runs full-screen like a native app.

## Customising

- **RFQ template**: Settings → RFQ email template. Placeholders: `{{ref}} {{route}} {{date}} {{pax}} {{legs}} {{category}} {{notes}} {{contactName}} {{company}} {{senderName}}`. Keep `{{ref}}` in the subject so replies can be matched.
- **Per-supplier opt-out**: use the toggle next to each broker or operator in Contacts.
- **Manual requests / extra RFQs**: use the `+` button on Requests, or **Send RFQ** on a request to reach suppliers added later.

## Files

```
server.js          HTTP server, REST API, OAuth routes, SSE
lib/engine.js      60s inbox poller, request/quote pipeline, throttled RFQ outbox, demo mailbox
lib/graph.js       Microsoft Graph OAuth + read inbox + sendMail
lib/parser.js      Claude structured extraction with rule-based fallback
lib/store.js       JSON file storage
lib/seed.js        Demo suppliers
public/            Mobile PWA (vanilla JS, no build step)
```
