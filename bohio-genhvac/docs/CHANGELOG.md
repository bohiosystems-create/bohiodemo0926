# Changelog

## M1: skeleton and simulation loop, rules only
- `bohio/` package: config (pydantic, TOML), data model (SQLAlchemy, all §3 tables), state builder (§5 steps 1-6), occupancy
  probability by building type (§4), `RuleBasedController`, guardrails **G1 G2 G3 G4 G5 G8 G9 G13**, mode handling
  (advisory / shadow / live), audit log, `SimAdapter` (toy RC building with fault hooks), `CSVReplayAdapter`.
- `python -m bohio.sim_day` runs one simulated day and prints the decision log.
- Hard rules 2 and 3 are enforced in `bohio/actuation/modes.py`: no write without live mode AND `--i-understand-live`;
  never write points tagged life_safety / fire / smoke / interlock. Hard rule 1 is structural: `bohio/llm/` is empty and must never import `actuation`.
- Decisions that go beyond the spec text:
  - G4 (clamp) and G5 (rate limit) are *soft* checks: they correct the value and the chain continues. All other implemented checks are *hard*: first failure replaces the value with the building's schedule setpoint.
  - G13 (operator override) is hard but keeps the operator's value and writes nothing; outcome `rejected`.
  - G8 treats every ModeEvent kind (incl. alarm, equipment_fault) as blocking for the affected zone.
  - A failed zone in live mode is released (relinquished) rather than overwritten with the schedule value.
  - Unknown occupancy (sensor missing or none configured) counts as probability 0.5, so nothing is set back by mistake.
- Bug found by the day-long test and fixed: G9 judged the rate-limited intermediate value, not the controller's intent, so a
  zone coming back from setback was forced to jump straight to schedule. G9 now uses the original proposal (`ProposalOut.intent`). Regression test added.
- Not in M1 (later milestones): G6 G7 G10 G11 G12, watchdog, Gen-HVAC client, LLM layer, real adapters, dashboard, M&V, quoting move.
- The simulator is a toy. Its energy numbers show the loop works; they are not evidence of savings.
