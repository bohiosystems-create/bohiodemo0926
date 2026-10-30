# Energy Analyzer

A bill and meter analyzer for commercial buildings. It finds energy waste and puts a number on the savings,
using only data the customer already has: utility bills, 15-minute meter data, weather and tariffs. No
hardware is needed.

**What it reports**

| Finding | How it's measured |
|---|---|
| High overnight/weekend baseload | Typical mild night vs. the building's own best nights (10th percentile) |
| HVAC/equipment outside occupied hours | Schedule creep, weekend operation, and night load that rises with outdoor temperature |
| Demand-charge peaks | Billed peak vs. Nth-highest interval each month; flags start-up spikes |
| Upward drift | Weather-normalized residuals against a baseline fitted on the earliest year |
| Cheaper tariff | The same 12 months of interval data re-priced under every candidate rate |

Each finding has annual kWh, annual $ (priced with the site's real tariff, TOU and demand included),
implementation cost, simple payback, a confidence level, the evidence behind it and its assumptions.
Claude turns the findings into a ranked action plan in plain English.

## Quick start

```bash
cd energy-analyzer
pip install -e ".[dev]"
python -m pytest

# Synthetic building with known, injected waste; also writes its input CSVs
energy-analyzer demo --no-claude --write-inputs out/demo_inputs --out out/demo

# Your own site
export ANTHROPIC_API_KEY=...        # optional: bill PDFs and the written report
export OPENEI_API_KEY=...           # optional: tariffs from OpenEI's Utility Rate Database
energy-analyzer analyze --site examples/site.toml \
    --interval meter.csv --bills bills/*.pdf --out out/site

# HTTP API
energy-analyzer serve               # POST /analyze, POST /bills/extract, GET /health
```

Without `ANTHROPIC_API_KEY`, the analysis still runs and the report uses a deterministic template.

## Inputs

- **Interval data:** a CSV with a timestamp column and a kWh or kW column (detected from the header names),
  a Green Button CSV (with or without the account-info preamble), Green Button ESPI XML, or BDG2
  (`ingest.interval.load_bdg2`). Timestamps are interval start, in local time unless they carry an offset.
- **Bills:** PDFs (Claude extracts periods, kWh, peak kW, charges and line items, which are then checked
  arithmetically) or a CSV (`period_start, period_end, kwh, total_charges[, peak_kw, ...]`). Bills are
  reconciled against the meter data. With bills only, you get a billing-period baseline but no waste detection.
- **Weather:** fetched from Open-Meteo's historical archive (free, cached under `.cache/`), or passed as a CSV
  with `--weather`.
- **Tariffs:** inline in the site config, or OpenEI URDB labels (`tariff_label`, `candidate_tariff_labels`, or
  `search_openei_tariffs = true`). Supported: fixed charges, TOU and tiered energy, flat and TOU demand.
  Ratchets and coincident-peak charges are flagged as not modeled.

## Method: why the numbers hold up

**Baseline (ASHRAE Guideline 14).** Daily energy is regressed on mean outdoor temperature using change-point
models (1P, 2P, 3P cooling, 3P heating, 5P), with separate models for occupied and unoccupied days. The model
with the lowest CV(RMSE) wins, computed with n−p degrees of freedom. The report checks the fit against
G14's calibration limits: CV(RMSE) ≤ 15% and |NMBE| ≤ 0.5% at monthly resolution. `baseline.verify_savings`
projects the baseline onto a reporting period's actual weather. It returns avoided energy with G14's
fractional savings uncertainty, adjusted for autocorrelation. That figure is what a share-of-verified-savings
contract settles on.

**No double counting.** Each detector owns a defined slice of the load. Demand shaving counts as shifted
energy, not saved energy. Report totals are labeled indicative because measures interact.

**Claude explains, code calculates.** Claude ranks and explains findings, but every number in an action is
copied from the computed finding. Any figure in Claude's text that can't be traced back to the data is
flagged in the report's caveats.

**No false alarms on a clean building.** The test suite runs every detector on a synthetic building with no
waste and requires zero waste findings. It also checks that injected waste is found and sized correctly.

## Layout

See [CLAUDE.md](CLAUDE.md) for the module map and the rules that keep the analysis trustworthy.

## Roadmap

1. **MVP (this):** bills + meter data → ranked, priced actions.
2. **Verified savings:** after a measure is implemented, run `verify_savings` on the post period for M&V
   reports that support share-of-savings pricing.
3. **Building connection:** read-only BACnet (BAC0) / Modbus trends through an MCP server, then setpoint and
   schedule *recommendations* approved one at a time by a person. Fully automatic control comes last.
