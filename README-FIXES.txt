BOHIO API FIXES — api/whatsapp.js, api/_monday.js

WHY THESE FILES EXIST

The live pipeline was not doing what the replies claimed. These are fixes to
the original api/ code, not to the standalone /schedule demo page.

WHAT WAS WRONG

1. WhatsApp never talked to Monday at all.
   api/whatsapp.js contained zero references to Monday. Only index.html ever
   called api/monday.js, from the browser. A message sent while nobody had
   Bohio open reached the board not at all. This is why the activity was not
   logged.

2. A status could not be changed, by anything.
   api/monday.js supported only create_item and create_update. There was no
   change_column_value mutation anywhere in the pack, so no status, date or
   any other column could ever move.

3. A photo could not be attached, by anything.
   There was no add_file_to_update, no multipart upload, no FormData in the
   pack. Evidence reaching Monday was not possible.

4. The reply asserted completion the sender had not claimed.
   The template read "Bohio logged <deliverable name> as work in progress".
   Deliverables are named things like "Telecom chambers complete", so a photo
   captioned "upload this as evidence" came back as "Bohio logged Telecom
   chambers complete", which reads as a completion claim. Reproduced exactly.

5. Two activities could never be matched.
   asph and light had an empty contractor in PROJECT_SCHEDULE while TASKS
   assigned them to robopave and gridbot.

6. Matching was scoped to the sender's own package.
   With DEFAULT_CONTRACTOR=voltaic only duct and tele could ever match. An
   asphalt or drainage claim was matched and then discarded in the handler,
   and the event was filed against the wrong task.

7. The AI branch threw on an unexpected response shape.
   payload.output?.flatMap(...) throws "flatMap is not a function" when
   output is an object or a string rather than an array.

WHAT CHANGED

api/_monday.js   new shared client: change_column_value for status and date,
                 add_file_to_update over multipart for the photo, and one
                 syncToMonday() the webhook calls server-side.
api/whatsapp.js  matches across the whole project and resolves the task and
                 deliverable project-wide; states only what the message
                 supports; guards the AI response shape; fixes the asph and
                 light contractors; pushes to Monday after storing the event
                 and reports back what actually happened on the board.

The rule that only a verified deliverable moves Primavera is unchanged: the
status is written only when targetMet is true.

NEW ENVIRONMENT VARIABLES

MONDAY_STATUS_COLUMN   status column id on the board, default "status"
MONDAY_DATE_COLUMN     date column id on the board, default "date"

Find the real ids: open the board, click the column menu, Customise, and the
id is shown; or query boards(ids:...){columns{id title type}}. If the default
ids are wrong the update still posts and the status write returns an error
that is reported back in the WhatsApp reply rather than failing the request.

NOT YET VERIFIED AGAINST A LIVE BOARD

Every fix here is verified against the real handler locally, including the
messages that failed on your phone. The Monday mutations themselves have not
been run against your board from this machine, because that needs your API
token. Deploy, send one message, and check the Vercel function log.

TWO-WAY SYNC — SETUP

A manual change on either platform now lands in one shared record that
WhatsApp reads from.

  api/_state.js        the shared record: status, dates, owner, per task,
                       each write stamped with its origin and a revision
  api/monday-webhook.js  Monday calls this when a column changes
  api/sync.js          GET pulls the board into the record; POST records a
                       manual Bohio edit and pushes it to Monday

1. Deploy, then in Monday open Integrations > Webhooks and add
   https://YOUR-PROJECT.vercel.app/api/monday-webhook
   for "When a column changes". Monday sends a challenge first; the endpoint
   echoes it automatically.
2. Optional: set MONDAY_WEBHOOK_SECRET and send it as the Authorization
   header from Monday.
3. Hit https://YOUR-PROJECT.vercel.app/api/sync once to seed the record from
   the board. Call it any time to reconcile if a webhook was missed.

A change stamped origin "monday" is never written back to Monday, which is
what stops the two sides echoing each other.

WHATSAPP RETRIEVAL

  "what is the live status"     every activity with its current status,
                                its finish date and which platform last
                                changed it
  "what changed recently"       the last dozen changes from both platforms
                                with who made them and where
  "send me the full project
   schedule"                    now carries a Live line per activity. This
                                previously answered from a hardcoded
                                constant and never reflected either platform.

The schedule reply shows the planned dates and the live date together, so a
drift between Bohio and Monday is visible rather than silent.
