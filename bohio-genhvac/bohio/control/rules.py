"""RuleBasedController: the baseline and the safety net (§5.4). Plain rules a facility manager can read.

Rules, in order: start from the building's own schedule; pre-cool before the schedule's occupied start;
set back (warmer) a zone that is probably empty during scheduled hours; never go below the setpoint floor.
"""
from __future__ import annotations

from bohio.config import SiteConfig
from bohio.control.base import ProposalOut
from bohio.state.types import NumericState


class RuleBasedController:
    name = "rules"

    def propose(self, state: NumericState, cfg: SiteConfig, hints: dict | None = None) -> dict[str, ProposalOut]:
        out: dict[str, ProposalOut] = {}
        for zc in cfg.zones:
            z = state.zones[zc.name]
            sc = zc.schedule
            target, why = z.schedule_c, "follow schedule"
            mins_to_start = (sc.occupied_start_h - state.hour) * 60
            if 0 < mins_to_start <= cfg.pre_cool_minutes:
                target, why = sc.occupied_setpoint_c, f"pre-cool: occupied hours start in {mins_to_start:.0f} min"
            elif z.in_scheduled_hours and z.occupancy_prob <= cfg.occupied_prob_guard:
                target, why = z.schedule_c + cfg.setback_c, f"vacancy setback +{cfg.setback_c} C: {z.occupancy_evidence}"
            if target < cfg.setpoint_floor_c:
                target, why = cfg.setpoint_floor_c, why + f"; raised to floor {cfg.setpoint_floor_c} C"
            out[zc.name] = ProposalOut(zc.name, round(target, 2), why, self.name)
        return out
