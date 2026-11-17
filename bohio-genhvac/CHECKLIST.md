# Gen-HVAC evaluation checklist (Bohio Systems)

## Phase 0 — Setup
- [ ] Install Docker, Git + git-lfs, Python 3.11+, Ollama on a dev machine (GPU optional)
- [ ] `bash scripts/setup.sh` — upstream cloned into `vendor/gen-hvac`, Sinergym 2.4.0 image pulled
- [ ] Ollama model pulled (default `qwen2.5:7b`; upstream tested DeepSeek-R1)
- [ ] `python3 -m unittest discover tests` passes
- [ ] Read upstream README end to end; note exact `/predict` payload + action format in CLAUDE.md

## Phase 1 — Reproduce the claim (go / no-go)
- [ ] Run upstream trajectory generator in the Sinergym container (OfficeSmall 5-zone)
- [ ] Train or load checkpoint; start inference server
- [ ] Run one simulated year: rule-based baseline vs Gen-HVAC, same weather file
- [ ] Export both runs' HVAC energy to CSV; run `audit/savings_report.py`
- [ ] Repeat for OfficeMedium 15-zone
- [ ] **Decision:** savings within reach of the claimed 36.8% and comfort acceptable? If not, stop or benchmark HVAC-DPT instead

## Phase 2 — UAE climate fit
- [ ] Add Dubai / Abu Dhabi EPW weather files
- [ ] Build or adapt a cooling-only, chilled-water model (residential tower / mall / office)
- [ ] Generate local trajectories; fine-tune or re-train
- [ ] Re-run baseline vs Gen-HVAC; record savings, comfort violations, peak demand
- [ ] **Decision:** savings still material in hot-humid cooling-dominated buildings?

## Phase 3 — Savings-audit product
- [ ] Define client inputs: floor plans, 12 months utility bills, BMS trend logs, current schedules, tariff
- [ ] Template EnergyPlus model + calibration step (match model to 12 months of bills)
- [ ] Report template: method, baseline vs AI, kWh / AED / tCO2e, assumptions, caveats
- [ ] Price the audit; pick 1–2 friendly pilot clients
- [ ] Deliver first audit; collect feedback

## Phase 4 — Comfort-preference demo
- [ ] Wire upstream LLM layer to a simple chat UI ("meeting room too cold in the afternoon")
- [ ] Show RTG target change → setpoint change in simulation
- [ ] Record a 2-minute demo video for sales

## Phase 5 — Live pilot (only after Phases 1–3 pass)
- [ ] Choose site + get written client sign-off and BMS contractor involvement
- [ ] Implement `BMSAdapter` (BACnet or Niagara) — read sensors, write setpoints only
- [ ] Configure guardrails per zone: min/max setpoint, max change per step, stale-data timeout
- [ ] Run **shadow mode** ≥ 2 weeks; compare recommendations with actual BMS behaviour
- [ ] Manual override + automatic fallback tested
- [ ] A/B weeks (live vs baseline), weather-normalised; produce measurement & verification report
- [ ] Liability / insurance and contract terms reviewed before any live control
