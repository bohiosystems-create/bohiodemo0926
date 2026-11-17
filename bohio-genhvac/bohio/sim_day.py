"""Run one simulated day and print the decision log.

    python -m bohio.sim_day --config configs/demo_office.toml                       # shadow: logs only
    python -m bohio.sim_day --config configs/demo_office.toml --mode advisory
    python -m bohio.sim_day --config configs/demo_office.toml --mode live --i-understand-live --compare

--compare also runs a baseline day (building schedule only, nothing written) and prints both energy totals.
The building is a toy RC simulation: the numbers prove the loop works, not that savings exist.
"""
from __future__ import annotations

import argparse
from datetime import datetime

from bohio.adapters.sim import SimAdapter
from bohio.audit import decision_rows, format_log
from bohio.config import SiteConfig, load_site
from bohio.control.rules import RuleBasedController
from bohio.cycle import SiteLoop
from bohio.db import make_session, seed_site


def run_day(cfg: SiteConfig, live_ack: bool = False, controller=None, adapter=None, session=None):
    s = session or make_session()
    site = seed_site(s, cfg)
    sim = adapter or SimAdapter(cfg, datetime(2026, 7, 15, 0, 0))
    loop = SiteLoop(s, site.id, cfg, sim, controller or RuleBasedController(), live_ack=live_ack)
    while not sim.finished:
        loop.run_cycle()
        sim.advance()
    loop.release_all()
    return s, site, sim, loop


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="configs/demo_office.toml")
    ap.add_argument("--mode", choices=["advisory", "shadow", "live"], help="override the config's mode")
    ap.add_argument("--i-understand-live", action="store_true", dest="live_ack")
    ap.add_argument("--compare", action="store_true", help="also run a no-AI baseline day and compare energy")
    ap.add_argument("--rows", type=int, default=40, help="decision-log rows to print (0 = all)")
    a = ap.parse_args(argv)
    cfg = load_site(a.config)
    if a.mode:
        cfg.mode = a.mode
    s, site, sim, _ = run_day(cfg, a.live_ack)
    rows = decision_rows(s, site.id)
    print(f"Site: {cfg.name} | mode: {cfg.mode} | controller: rules | {len(cfg.zones)} zones | cycle {cfg.cycle_minutes} min")
    print(f"Decisions logged: {len(rows)} ({sum(r['outcome'] == 'fallback' for r in rows)} fallbacks, {sum(r['written'] for r in rows)} writes)\n")
    changed = [r for r in rows if r["why"].startswith("vacancy") or r["outcome"] in ("fallback", "rejected")]
    print(format_log(changed or rows, limit=a.rows or None))
    if len(changed) > a.rows > 0:
        print(f"... {len(changed) - a.rows} more (use --rows 0)")
    print(f"\nEnergy today with this run: {sim.total_energy_kwh():.1f} kWh | occupied comfort violations: "
          f"{sim.occupied_comfort_violations} of {sim.occupied_steps} zone-minutes")
    if a.compare:
        if cfg.mode != "live":
            print("\n--compare needs --mode live (a shadow/advisory run writes nothing, so it equals the baseline).")
            return 0
        base_cfg = cfg.model_copy(update={"mode": "shadow"})
        _, _, bsim, _ = run_day(base_cfg)
        b, c = bsim.total_energy_kwh(), sim.total_energy_kwh()
        print(f"\nBaseline (schedule only)  B = {b:.1f} kWh\nWith rules controller     C = {c:.1f} kWh\n"
              f"Difference            B - C = {b - c:.1f} kWh = {(b - c) / b * 100:.1f}%\n"
              f"Baseline comfort violations: {bsim.occupied_comfort_violations} zone-minutes")
        print("NOTE: one simulated day on a toy model. Not evidence of savings; real figures come from M&V (Milestone 5).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
