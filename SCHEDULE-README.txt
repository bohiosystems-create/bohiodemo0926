XYZ HOSPITAL CONSTRUCTION - PROGRAMME PAGE

WHAT IS NEW IN THIS PACK

schedule.html is a redesigned programme page in the XYZ Hospital Construction
design language (Source Sans 3, the navy and teal palette, the 1680px shell
with a 336px aside, and the procurement table on its five-column grid).

It is served at /schedule and /programme through vercel.json rewrites.
Nothing else in the pack was changed: the existing pages, the 3D worksite,
the Dallas Light font and every api/ function are exactly as they were.

WHAT THE PAGE DOES

Timeline      Critical-path Gantt over 5 phases, 33 activities and 4
              milestones. Forward and backward pass, total float, and a
              live-versus-baseline comparison driving the delay chips and
              the slippage figure. Bars sit on a working-day calendar and
              the data date is drawn on the grid.
Week view     The working week around the data date.
Procurement   Every procurement item against its activity, with a status
              that combines the procurement state with the time left
              before the activity needs the material.

THE VERIFICATION GATE

This is the answer to a status that will not move. api/monday.js only
accepts deliverable_verified and schedule_change, so a partial claim is
correctly never written to Monday. The failure was that it happened
silently.

A claim arriving without a measurement is now HELD and shown in a queue on
the activity, with Verify & sync and Reject. Verifying moves the status and
the percentage together and records the write. A claim that carries a
measurement ("30 of 64 complete, measurement sheet attached") applies
immediately. Nothing unverified reaches Monday.

THE ASSISTANT

70 intents over the live programme, procurement, the verification queue and
the board, plus 26 regulatory answers for questions asked on site - escape
widths, travel distance, corridor and door widths, compartmentation,
excavation support, scaffold, work at height, lifting, noise, asbestos,
confined space, CDM, welfare, infection control, medical gas, ventilation
and electrical standards, plus the project registers - drawings, RFIs,
submittals, permits, levels, test results, live services, contacts and site
logistics.

Voice notes are transcribed (English and Arabic, the Arabic shown with the
original alongside the translation) and the transcript then runs through the
same pipeline as typed text. Photographs and documents attach to the
activity as evidence.

TYPO AND SPEECH TOLERANCE

Matching is fuzzy by design. Messages are typed one-handed in gloves and
voice notes come back from speech recognition with words mangled, so the
matcher survives:

  typos and transpositions   "strat" for "start", "stauts" for "status"
  dropped spaces             "fireexit", "increas ethe"
  plurals and word endings   "workin" / "working" / "works"
  words in between           "why hasnt THE STAUS updated"
  abbreviations              dwg, spec, ptw, regs, pct, ffl

Tested at 26/26 on misspelt site questions and 20/20 on misspelt regulatory
questions. This project's own registers outrank generic regulations, so
"whats the ceilling height" answers with the ward height from the drawings
rather than the Building Regulations minimum.

BOHIO AND MONDAY ARE MIRRORED

Both sides are modelled as two stores that must agree. Every change goes
through one write path that stamps a revision and mirrors it to the other
side, whichever side it started on. Status is derived from progress,
updates and any manual override, so a change to one field re-mirrors the
whole item rather than the single field that moved.

Sync status in the toolbar walks both stores field by field and reports
what it finds, with a Repair control if anything is out of step. State is
saved to the browser, so a refresh keeps the board; Reset demo clears it.

Verified: 33 of 33 activities mirrored, drift 0 at boot, after a Bohio
edit, after a Monday edit, after a WhatsApp command, after a photo upload
and across a page reload. Injected drift is detected and repaired.

EVIDENCE AND COMMENTS MIRROR BOTH WAYS

Evidence travels in both directions. A photo sent over WhatsApp is filed on
the Monday item as an asset with an id, content type and size. A photo
attached on the Monday item is pulled into Bohio and shows in the activity's
evidence list. Each entry is badged with where it came from, and both sides
carry the same set.

Comments behave the same way. A note written on the Monday item appears in
the Bohio feed marked "from Monday"; anything logged in Bohio appears on the
board. Every entry in the feed states its mirror position, so nothing is
ambiguous.

The one deliberate exception is a held claim. api/monday.js accepts only a
verified deliverable, so an unverified claim is kept out of the board and
labelled "held - not on Monday until it is verified". Verify it and it
mirrors immediately.

Drift detection compares the sets themselves rather than counts, so two
different files or comments on the two sides is still drift. Repair merges
both ways and never deletes - an earlier version overwrote one side with the
other, which would have destroyed whichever upload the other side held.

Use Upload on Monday and Comment on Monday in the toolbar to see the
Monday-to-Bohio direction, and the paperclip in the assistant for the
WhatsApp direction. Evidence alone never moves progress - a measurement does.

IMPORTANT - THIS PAGE IS STILL A FRONT-END DEMO

The page holds its programme in the browser (localStorage) and does not
yet call api/monday.js
or api/whatsapp.js. Its Monday reads and writes, the voice transcription and
the evidence upload are simulated in the browser so the flow can be reviewed
end to end. To make it live:

1. Replace the tasks array in schedule.html with a fetch of your board.
2. Route mWrite() through api/monday.js, sending deliverable_verified only
   after verifyClaim() has released the claim.
3. Point the assistant input at api/whatsapp.js so transcription and media
   use the OpenAI and Twilio paths already built in this pack.

The regulatory answers are indicative UK figures (Approved Documents, HTM
and HBN, CDM 2015). Each answer says so. They are safety-critical numbers
and must be confirmed against the current edition and this project's own
fire strategy and method statements before anyone relies on them.

DEPLOY

Follow VERCEL-README.txt. No new environment variables are needed for
/schedule; it renders without any API keys configured.
