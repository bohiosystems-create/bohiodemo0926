"""Safety layer between the Gen-HVAC model and any building.

Every proposed setpoint passes through `Guardrails.apply`. Anything unexpected
(missing value, NaN, stale data, model error) falls back to the building's
existing schedule setpoint, never to a model value.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class ZoneLimits:
    min_c: float = 22.0          # coolest allowed setpoint (UAE cooling: don't overcool)
    max_c: float = 26.0          # warmest allowed setpoint
    max_step_change_c: float = 0.5  # max change vs previous applied setpoint per step


@dataclass
class Decision:
    zone: str
    proposed: float | None
    applied: float
    reason: str               # "ok", "clamped", "rate_limited", "fallback:<why>"


@dataclass
class Guardrails:
    limits: dict[str, ZoneLimits]
    stale_after_s: float = 900.0     # 15 min, matches upstream control step
    last_applied: dict[str, float] = field(default_factory=dict)

    def apply(
        self,
        zone: str,
        proposed: float | None,
        schedule_setpoint: float,
        reading_age_s: float,
    ) -> Decision:
        lim = self.limits.get(zone)
        if lim is None:
            return self._fallback(zone, proposed, schedule_setpoint, "unknown_zone")
        if reading_age_s > self.stale_after_s:
            return self._fallback(zone, proposed, schedule_setpoint, "stale_data")
        if proposed is None or not isinstance(proposed, (int, float)) or math.isnan(proposed):
            return self._fallback(zone, proposed, schedule_setpoint, "no_valid_proposal")

        value, reason = float(proposed), "ok"

        clamped = min(max(value, lim.min_c), lim.max_c)
        if clamped != value:
            value, reason = clamped, "clamped"

        prev = self.last_applied.get(zone, schedule_setpoint)
        delta = value - prev
        if abs(delta) > lim.max_step_change_c:
            value = prev + math.copysign(lim.max_step_change_c, delta)
            reason = "rate_limited"

        value = round(value, 2)
        self.last_applied[zone] = value
        return Decision(zone, proposed, value, reason)

    def _fallback(self, zone, proposed, schedule_setpoint, why) -> Decision:
        self.last_applied[zone] = schedule_setpoint
        return Decision(zone, proposed, schedule_setpoint, f"fallback:{why}")
