# Energy Analyzer: guidance for Claude Code

Bill and meter analyzer for commercial buildings. It finds energy waste and quantifies savings from data the
customer already has (no hardware). Live building control (BACnet/Modbus) is Phase 2 and is **not** in this
codebase yet; see "Phase 2 rules" before adding any of it.

## Stack

Python 3.11+, pandas/numpy, pydantic v2, FastAPI, Anthropic Python SDK. No scipy/statsmodels: the regression
code is plain numpy on purpose (small, auditable). Network access goes through `urllib`, not extra HTTP libraries.

```
pip install -e ".[dev]"
python -m pytest            # whole suite runs in ~6 s, no network or API key needed
energy-analyzer demo --no-claude
```

## Data flow

```
ingest/interval.py  CSV | Green Button XML/CSV | BDG2  ->  kWh Series, local tz, regular grid (gaps = NaN)
ingest/weather.py   Open-Meteo archive                 ->  hourly temp (C); degree days
ingest/openei.py    OpenEI URDB                        ->  tariff.Tariff
bills.py + llm.py   bill PDF (Claude) | bills CSV      ->  bills.Bill, checks, reconciliation vs meter
context.py          SiteData: analysis window = most recent 365 days, occupancy masks, tariff pricing
baseline.py         ASHRAE G14 change-point models (1P/2P/3PC/3PH/5P), per day type; savings uncertainty
findings/*.py       one detector per waste type -> models.Finding | None
pipeline.py         runs it all -> models.Report;  report.py renders Markdown
llm.py              Claude ranks/explains findings; code re-attaches numbers and checks the prose
cli.py, api.py      entry points
```

## Rules that keep the numbers trustworthy

These are the product. Don't trade them away for convenience.

1. **Code computes every number; Claude never does.** Claude reads bill PDFs and writes explanations. Numeric
   fields on `Action` are copied from `Finding` by `llm.assemble_actions`. `llm.untraceable_numbers` flags
   any figure in Claude's prose that can't be traced to the data. Keep both mechanisms when changing the
   report.
2. **Every judgment call is an `Assumptions` field** (models.py) and every finding lists its assumptions in
   plain English. No magic constants inside detectors unless they are statistical guards (and commented).
3. **Detectors must not double count.** Baseload owns load between the best-night level and the
   typical-night level; after-hours owns load above the typical-night floor outside occupied hours; demand
   savings are demand charges only (energy is shifted, kWh savings = 0). New detectors must state what slice
   of load they own.
4. **Price savings with the real tariff** via `SiteData.annual_cost_delta(reduction_kwh, component)`, not a
   blended $/kWh, so TOU periods and demand charges are honored.
5. **A clean building must produce no waste findings.** `tests/test_findings.py::test_clean_building_has_no_waste_findings`
   guards false positives. Any new detector needs a "found and sized" test on `sample_data.Waste` and must pass
   the clean-building test.
6. **Timezones/DST:** interval data is tz-aware local time. Never floor or slice a *naive* local index
   (fall-back repeats an hour): floor in UTC, select by date masks, count expected intervals per day.
   There are tests for this; keep them.

## Claude API usage (llm.py)

- Model `claude-opus-5-5` (override with `ENERGY_ANALYZER_MODEL`), `client.beta.messages.parse` with Pydantic
  `output_format` for structured output, `output_config.effort = "medium"`.
- Server-side refusal fallback is on (`betas=["server-side-fallback-2026-07-01"]`, `fallbacks="default"`);
  `stop_reason == "refusal"` / `"max_tokens"` raise `ClaudeError`.
- Bill PDFs go in as base64 `document` blocks. Extracted bills always pass through `bills.check_bill`.
- Everything works without an API key (template narrative); the pipeline falls back to the template on any
  `ClaudeError` and records a warning. Tests use a fake client and never call the API.

## Conventions

- Detectors: `detect(ctx: SiteData) -> Finding | None`, registered in `pipeline.DETECTORS`, wrapped with
  `context.finalize` (adds implementation cost and payback). Put the method in the module docstring.
- Findings carry `evidence` (metrics a skeptical engineer would ask for) and `confidence`.
- Test data comes from `sample_data.py` (synthetic building with switchable, known waste). For real-data
  checks use BDG2 via `ingest.interval.load_bdg2` / `load_bdg2_weather`.

## Phase 2 rules (building connection)

When adding BMS integration (BAC0 for BACnet, pymodbus for Modbus), wrapped as an MCP server:
- Start **read-only**: points, trends, schedules. Reads should feed the same detectors.
- Writes (setpoints, schedules) only as *proposals* that a named human approves one by one, with the
  previous value recorded for rollback, bounds checks on every value, and an audit log.
- No autonomous control until the approval flow has a track record. Comfort, equipment and safety
  interlocks (freeze stats, smoke control, life safety) are never written to.
