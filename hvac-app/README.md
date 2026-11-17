# Bohio HVAC app

Mobile web app (installable PWA, works offline) with two tools:

- **Quote**: the Bohio HVAC retrofit quoting wizard, one question per screen, live total, itemised quote, save / share / print.
- **Track**: HVAC energy consumption tracker. Log daily kWh or meter readings, import/export CSV, view daily and hour-of-day charts, and compare against a baseline with the full savings derivation (same maths as `audit/savings_report.py`).

No build step, no dependencies. Data is stored on the device (localStorage).

## Run
    python3 -m http.server 8000 --directory .   # from the repo root, then open /hvac-app/
On a phone, open the deployed URL and use "Add to Home Screen". (The service worker needs HTTPS or localhost.)

## Pricing
`pricing.js` contains the `/*CALC*/` block copied verbatim from `bohio-genhvac/quoting/index.html`, the source of truth.
Launch rules from that project's CLAUDE.md are enforced in the UI: only A3, B1, B2, D1, E1 are quoted; A1 only with a fixed
BMS-contractor price; A2, B3, C1, C2 are blocked. Quotes are in USD.

    node test/run.js    # all 10 routes must match test/routes_usd.json; tracker maths

## Tracker notes
- CSV format: a time column and a kWh column, e.g. `timestamp,hvac_kwh`.
- Savings are computed only over timestamps present in both baseline and actual; no weather or occupancy adjustment.
- `sample/` holds the placeholder CSVs from the starter kit (illustrative, not measured results).
