# Bohio × Gen-HVAC — project context for Claude Code

## What this is
Bohio Systems is evaluating the open-source **Gen-HVAC Controller** (MIT,
https://huggingface.co/Gen-HVAC/Controller) as the engine for:
1. a **simulation-based HVAC savings audit** for UAE property managers (first product), and
2. later, a **supervised live pilot** writing setpoints to a real BMS.

Gen-HVAC = Decision Transformer HVAC controller + small local LLM (via Ollama) that turns
plain-language comfort preferences into return-to-go targets. Trained on EnergyPlus/Sinergym
simulations. Inference is an HTTP service: `POST /predict {step, obs, info}` → action vector,
`POST /reset` between episodes. Upstream README is the source of truth for payload shapes.

## Layout
- `vendor/gen-hvac/` — upstream code, cloned by `scripts/setup.sh` (not committed)
- `scripts/` — setup and simulation helpers
- `gateway/` — our code: guardrails + shadow/live gateway between a BMS and `/predict`
- `audit/` — savings report: baseline vs Gen-HVAC energy, shows the full calculation
- `tests/` — unit tests (stdlib `unittest`, no installs needed)
- `bohio/` — the supervisory agent (see docs/BUILD_SPEC.md); `configs/` site configs; milestone status in docs/CHANGELOG.md
- `quoting/` — quoting wizard (`index.html`), PDF quote and map builders; prices in USD (see quoting/README.md)
- `CHECKLIST.md` — phased plan; tick items as they're done

## Ground rules (do not relax)
- **Never write to a live BMS unless `mode = "live"` AND `--i-understand-live` are both set.**
  Default is shadow mode: log recommendations, write nothing.
- Every setpoint goes through `gateway/guardrails.py` (hard min/max, max change per step,
  fallback to existing BMS schedule on any error, stale data or missing reading).
- Savings claims must come from `audit/savings_report.py` output, which prints the
  derivation (baseline kWh, Gen-HVAC kWh, delta, %, AED). No hand-typed numbers.
- The upstream 36.8% savings figure is unverified; Phase 1 exists to reproduce or refute it.
- Keep our code stdlib-only where possible so it runs on locked-down client machines.

## Useful commands
- `bash scripts/setup.sh` — clone upstream, pull Sinergym image, pull Ollama model
- `bash scripts/run_sim_container.sh` — open a shell in the Sinergym container with this repo mounted
- `python3 -m unittest discover tests` — run tests
- `python3 -m gateway.shadow_gateway --config gateway/config.example.toml --source data/sample_readings.csv`
- `python3 audit/savings_report.py --baseline data/baseline.csv --candidate data/genhvac.csv --tariff 0.38`

## Open TODOs for Claude Code
- Map our `obs` vector to the exact order upstream expects (see `vendor/gen-hvac` README /
  inference server) — `gateway/shadow_gateway.py::build_payload` is a placeholder.
- Add UAE weather files (Dubai/Abu Dhabi EPW) and a cooling-only chilled-water building model.
- Implement a real BMS reader/writer (BACnet via BAC0, or Niagara REST) behind the
  `BMSAdapter` interface.

## Quoting rules
- Always quote in USD.
- Launch phase: offer routes A3, B1, B2, D1, E1; A1 only with a fixed BMS-contractor price; do not offer A2, B3, C1, C2.
- Pricing source of truth is the `price()` function in `quoting/index.html`; keep the PDFs and `routes_usd.json` in sync with it.
