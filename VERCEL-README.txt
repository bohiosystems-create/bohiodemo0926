BOHIO CONTRACTOR PLATFORM - VERCEL PACK

Deploy with the Vercel dashboard
1. Unzip bohio-vercel.zip.
2. Add the unzipped folder to a GitHub repository.
3. In Vercel, choose Add New > Project and import that repository.
4. Leave Framework Preset as Other and Build Command empty.
5. Deploy and keep the Production domain shown by Vercel. GitHub pushes to the production branch will deploy automatically.

Deploy with the Vercel CLI
1. Unzip bohio-vercel.zip.
2. Open a terminal in the unzipped folder.
3. Run: vercel
4. For a production deployment, run: vercel --prod

The pack includes both interfaces, the interactive 3D worksite, Dallas Light font,
the contractor report PDFs, and the /portal shortcut.

The demo stores changes in each browser's localStorage. API keys entered in the
chat settings remain in that browser and are not bundled in this pack.

Current demo navigation: Project Overview, Schedule, Orchestration Agent, Contractor Portal.
API configuration is shared by both interfaces on the same browser/origin.
Outlook opens a prepared draft; live automatic email sending is not configured.
Primavera updates and prior-client history are illustrative demo data.
Cross-device chat needs a shared backend. Scanner intake accepts files/camera
output; it does not directly control a desktop scanner. Uploaded PDFs can be
viewed, but their text is not yet extracted for AI analysis.
REAL WHATSAPP PHONE DEMO

1. Deploy this folder to Vercel.
2. In Vercel Marketplace, add Upstash Redis and connect it to this project. Confirm UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN appear under Project Settings > Environment Variables.
3. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, OPENAI_API_KEY and DEFAULT_CONTRACTOR under Project Settings > Environment Variables. Select Production. Never put these secrets in GitHub or the ZIP.
4. Add PUBLIC_BASE_URL with the exact permanent Production origin, for example https://bohio-demo.vercel.app, without a trailing slash.
5. Redeploy after adding or changing environment variables. Existing deployments do not receive newly added values.
6. Use an upgraded Twilio account and complete Trust Hub > Profiles. The Primary compliance profile must show Twilio Approved; otherwise Twilio blocks custom replies with error 20003 even when inbound Sandbox messages work.
7. Open Communications > Messaging > Try it out > Try WhatsApp Sandbox, activate the full Sandbox, then open Sandbox settings. Do not use the restricted +1 737 Twilio Trial chat.
8. Set "When a message comes in" to:
   https://YOUR-PROJECT.vercel.app/api/whatsapp
   Method: HTTP POST
9. On your phone, scan the full Sandbox QR code or send its displayed "join ..." message to +1 415 523 8886.
10. The planner or project manager sends a text, site photo, or WhatsApp voice note. Open the Production Bohio URL and use Schedule, then open the affected activity and deliverable to see the evidence.

ALWAYS-ON CHECKLIST

- Use the Vercel Production domain or a connected custom domain in both PUBLIC_BASE_URL and Twilio. Do not use localhost, a trycloudflare address or a Preview deployment URL.
- Keep the Upstash integration connected so messages and media metadata survive serverless restarts.
- Keep the Twilio and OpenAI accounts funded and their credentials current.
- After rotating any token, update it in Vercel and redeploy Production.
- Check Vercel Functions logs and Twilio Messaging Logs after the first real phone test.
- The WhatsApp function has a 60-second ceiling for voice, image and multi-message replies.

Voice notes are transcribed through the OpenAI API. Site images are interpreted through the OpenAI vision input and the original image or audio is retained in the Bohio evidence vault for seven days by default. The evidence, transcript and image findings are linked to the Primavera audit entry after the matched deliverable is verified.

WHATSAPP AGENT REQUESTS

Send “Send me the full project schedule” to receive the 10 activities and all 50 measurable deliverables in five readable WhatsApp messages.
Send “Send me a checklist for site inspection” to receive the two-part safety, quality, measurement and evidence checklist.
Both requests can be combined in one message or spoken as a voice note. Bohio sends each reply through Twilio's authenticated Messaging API in order and falls back to TwiML if that API is unavailable. The combined response stays below Twilio's 10-message limit.

For one-phone demos, DEFAULT_CONTRACTOR=voltaic maps all messages to Voltaic Power Systems. For multiple phones, set CONTRACTOR_PHONE_MAP as shown in .env.example.

Progress updates sync automatically in the demo. Proposed start/finish dates remain pending until planner approval.

MONDAY.COM PROJECT BOARD

1. Create or open a Monday.com board for the project.
2. In Monday.com, open your avatar > Developers > My access tokens and copy the personal API token. Use this only for the internal demo; an OAuth app is the production path.
3. Copy the board ID from the board URL.
4. In Vercel Project Settings > Environment Variables, add MONDAY_API_TOKEN and MONDAY_BOARD_ID for Production.
5. Redeploy Production, open Bohio > Settings, and select Test connection under Monday.com project board.

Bohio creates one Monday item per schedule activity, using the activity ID in square brackets. It posts an update only when a deliverable is verified or a schedule change is approved by the planner. Partial claims and unapproved changes are never sent to Monday.
