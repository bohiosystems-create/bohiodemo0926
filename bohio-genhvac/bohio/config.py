"""Site configuration (pydantic). Loaded from TOML; every threshold has the spec default (§4, §6)."""
from __future__ import annotations

import tomllib
from typing import Literal

from pydantic import BaseModel, Field

BuildingType = Literal["apartment", "office", "hotel", "retail", "villa"]
Mode = Literal["advisory", "shadow", "live"]

# §4 vacancy thresholds: minutes without an activity signal before a space counts as empty.
VACANCY_MINUTES = {"apartment": 180, "office": 20, "hotel": 30, "retail": 20, "villa": 720}


class Schedule(BaseModel):
    """The building's own schedule: what the BMS/thermostat does without us (also our fallback value)."""
    occupied_start_h: float = 7.0
    occupied_end_h: float = 18.0
    occupied_setpoint_c: float = 23.5
    unoccupied_setpoint_c: float = 26.0

    def setpoint_at(self, hour: float) -> float:
        return self.occupied_setpoint_c if self.occupied_start_h <= hour < self.occupied_end_h else self.unoccupied_setpoint_c


class ZoneConfig(BaseModel):
    name: str
    kind: Literal["flat", "suite", "room", "shop", "villa", "common"] = "suite"
    comfort_min_c: float = 22.0
    comfort_max_c: float = 26.0
    max_step_c: float = 0.5
    occupancy_sensing: Literal["none", "pir", "radar", "door_pir"] = "radar"
    schedule: Schedule = Field(default_factory=Schedule)
    # simulation parameters (ignored by real adapters)
    sim_capacity_kw: float = 8.0
    sim_ua_kw_per_k: float = 0.25
    sim_heat_capacity_kwh_per_k: float = 8.0
    sim_occupant_gain_kw: float = 1.2


class SiteConfig(BaseModel):
    name: str
    building_type: BuildingType = "office"
    cooling_source: Literal["district", "electric"] = "electric"
    timezone: str = "Asia/Dubai"
    mode: Mode = "advisory"            # every site starts read-only (P3)
    currency: Literal["USD"] = "USD"
    cycle_minutes: int = Field(15, ge=5, le=15)
    stale_after_s: float = 900.0
    plausible_temp_c: tuple[float, float] = (5.0, 50.0)
    setback_c: float = 1.5
    pre_cool_minutes: int = 90
    setpoint_floor_c: float = 22.0
    vacancy_minutes: float | None = None   # None -> default for building_type
    occupied_prob_guard: float = 0.3       # G9: never set back a zone above this probability
    override_hold_h: float = 4.0           # G13
    supervisory_priority: int = Field(12, ge=10)   # never below 10 (§8.4)
    history_hours: int = 24
    zones: list[ZoneConfig]

    @property
    def vacancy_min(self) -> float:
        return self.vacancy_minutes if self.vacancy_minutes is not None else VACANCY_MINUTES[self.building_type]

    def zone(self, name: str) -> ZoneConfig:
        return next(z for z in self.zones if z.name == name)


def load_site(path: str) -> SiteConfig:
    with open(path, "rb") as f:
        return SiteConfig.model_validate(tomllib.load(f))
