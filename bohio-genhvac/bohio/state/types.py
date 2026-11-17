from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class ZoneState:
    name: str
    temp_c: float | None
    temp_age_s: float | None          # None = no reading at all
    temp_quality: str                 # ok|stale|suspect|missing
    setpoint_c: float | None          # what the device currently uses
    schedule_c: float                 # the building's own schedule setpoint now (our fallback value)
    occupancy_prob: float             # 0..1, §4
    occupancy_evidence: str
    in_scheduled_hours: bool
    override_hold_until: datetime | None = None
    last_applied_c: float | None = None


@dataclass
class ActiveEvent:
    kind: str
    zone: str | None                  # None = whole site


@dataclass
class NumericState:
    """What controllers and guardrails see. The Gen-HVAC {step, obs, info} mapping is added in Milestone 2."""
    step: int
    ts: datetime
    hour: float
    outdoor_c: float | None
    zones: dict[str, ZoneState]
    events: list[ActiveEvent] = field(default_factory=list)
    history: dict[str, list[dict]] = field(default_factory=dict)   # rolling per-zone window (§5.4)

    def events_for(self, zone: str) -> list[ActiveEvent]:
        return [e for e in self.events if e.zone in (None, zone)]
