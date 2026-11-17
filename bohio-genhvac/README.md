# bohio-genhvac

Starter kit for evaluating the open-source [Gen-HVAC Controller](https://huggingface.co/Gen-HVAC/Controller)
for Bohio Systems: reproduce its results, re-test in UAE climate, run simulation-based savings audits,
and (later) pilot it safely behind guardrails.

## Open in Claude Code
```bash
cd bohio-genhvac
git init && git add . && git commit -m "Starter kit"
claude            # Claude Code reads CLAUDE.md automatically
```
Then ask, e.g. *"Run Phase 0 of CHECKLIST.md"*.

## Bohio agent (Milestone 1)
```bash
pip install -e '.[dev]'
python3 -m pytest -q                                                              # 65 tests
python3 -m bohio.sim_day --config configs/demo_office.toml                        # shadow: logs only
python3 -m bohio.sim_day --mode live --i-understand-live --compare                # simulated day, rules vs schedule
```
Build spec: `docs/BUILD_SPEC.md` (add your copy). Change log: `docs/CHANGELOG.md`.

## Quick start
```bash
bash scripts/setup.sh                       # clone upstream + pull Docker image + Ollama model
python3 -m unittest discover tests          # sanity check our code
python3 audit/savings_report.py --baseline data/baseline.csv --candidate data/genhvac.csv --tariff 0.38
python3 -m gateway.shadow_gateway --config gateway/config.example.toml --source data/sample_readings.csv --dry-predict
```

## What's ours vs upstream
| Path | Owner | Purpose |
|---|---|---|
| `vendor/gen-hvac/` | upstream (MIT) | model, training, inference server |
| `gateway/` | Bohio | guardrails, shadow/live gateway, BMS adapter interface |
| `audit/` | Bohio | savings report with full calculation |

The sample CSVs in `data/` are **illustrative placeholders**, not results.
See `CHECKLIST.md` for the phased plan and `CLAUDE.md` for project rules.
