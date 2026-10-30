"""Synthetic office building with known, injected waste.

Used by the tests and the demo. Every kind of waste the analyzer looks for
can be switched on or off, so tests can check both that waste is found and
roughly sized, and that a clean building produces no findings.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .models import OccupancySchedule, SiteConfig
from .tariff import Tariff, Tier

TZ = "America/New_York"


@dataclass
class Waste:
    baseload_excess_kw: float = 8.0  # extra overnight load on most nights
    baseload_excess_share: float = 0.85  # share of nights it is left on
    night_hvac: bool = True  # HVAC follows the weather when unoccupied
    close_creep_h: float = 2.0  # occupied load continues this long after close
    startup_spike_kw: float = 70.0  # morning start-up spike ...
    spikes_per_month: int = 3  # ... on this many weekdays a month
    drift_pct: float = 12.0  # gradual increase over the second year

    @classmethod
    def none(cls) -> "Waste":
        return cls(0.0, 0.0, False, 0.0, 0.0, 0, 0.0)


def sample_temperature(start: str, days: int, seed: int = 1) -> pd.Series:
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=days * 24, freq="h", tz="UTC").tz_convert(TZ)
    doy = idx.dayofyear.to_numpy()
    daily_noise = np.repeat(np.convolve(rng.normal(0, 2.5, days + 6), np.ones(4) / 2, "same")[:days], 24)
    t = 12 - 12 * np.cos(2 * np.pi * (doy - 20) / 365) + 4.5 * np.sin(2 * np.pi * (idx.hour.to_numpy() - 9) / 24)
    return pd.Series(t + daily_noise, index=idx, name="temp_c")


def sample_building(
    start: str = "2024-01-01", days: int = 730, waste: Waste | None = None, seed: int = 7
) -> tuple[pd.Series, pd.Series]:
    """Returns (15-minute kWh series, hourly temperature series)."""
    waste = Waste() if waste is None else waste
    rng = np.random.default_rng(seed)
    temp_h = sample_temperature(start, days + 1, seed)
    idx = pd.date_range(start, periods=days * 96, freq="15min", tz="UTC").tz_convert(TZ)
    t = temp_h.reindex(idx.tz_convert("UTC").floor("h").tz_convert(TZ)).to_numpy()
    hod = idx.hour.to_numpy() + idx.minute.to_numpy() / 60
    weekday = idx.dayofweek.to_numpy() < 5
    day_num = (idx.tz_localize(None).normalize() - idx.tz_localize(None).normalize()[0]).days.to_numpy()

    occupied_hvac = (hod >= 5.5) & (hod < 19 + waste.close_creep_h) & weekday
    occupied_lights = (hod >= 7) & (hod < 19 + waste.close_creep_h) & weekday
    kw = np.full(len(idx), 20.0)  # true achievable baseload
    nights_on = rng.random(days + 1) < waste.baseload_excess_share
    kw += np.where(~occupied_lights & nights_on[day_num], waste.baseload_excess_kw, 0.0)
    kw += np.where(occupied_lights, 40.0, 0.0)
    cool, heat = np.maximum(t - 18, 0), np.maximum(14 - t, 0)
    kw += np.where(occupied_hvac, 3.0 * cool + 2.0 * heat, 0.0)
    if waste.night_hvac:
        kw += np.where(~occupied_hvac, 1.2 * cool + 1.0 * np.maximum(18 - t, 0), 0.0)

    if waste.spikes_per_month:
        month_key = idx.year.to_numpy() * 12 + idx.month.to_numpy()
        spike_slot = (hod >= 7) & (hod < 7.25) & weekday
        for mk in np.unique(month_key):
            days_in = np.unique(day_num[(month_key == mk) & spike_slot])
            chosen = rng.choice(days_in, size=min(waste.spikes_per_month, len(days_in)), replace=False)
            kw += np.where(spike_slot & np.isin(day_num, chosen) & (month_key == mk), waste.startup_spike_kw, 0.0)

    if waste.drift_pct:
        ramp = np.clip((day_num - 365) / 180, 0, 1)
        kw *= 1 + waste.drift_pct / 100 * ramp

    kw *= rng.normal(1.0, 0.03, len(idx))
    kwh = pd.Series(kw * 0.25, index=idx, name="kwh")
    return kwh, temp_h


def sample_tariffs() -> tuple[Tariff, list[Tariff]]:
    """A TOU + demand tariff (current) and two alternatives."""
    summer_peak = [[0] * 24 for _ in range(12)]
    for m in range(5, 9):  # Jun-Sep
        for h in range(12, 18):
            summer_peak[m][h] = 1
    current = Tariff(
        name="GS-TOU (current)",
        utility="Example Electric",
        fixed_monthly=95.0,
        energy_rates=[[Tier(rate=0.11)], [Tier(rate=0.19)]],
        energy_weekday_schedule=summer_peak,
        energy_weekend_schedule=[[0] * 24 for _ in range(12)],
        flat_demand_rates=[[Tier(rate=16.0)]],
    )
    flat = Tariff.simple("GS-Flat", energy_rate=0.165, fixed_monthly=60.0)
    high_demand = Tariff.simple("GS-LoadFactor", energy_rate=0.085, demand_rate=24.0, fixed_monthly=150.0)
    return current, [flat, high_demand]


def sample_config(with_tariffs: bool = True) -> SiteConfig:
    current, candidates = sample_tariffs()
    return SiteConfig(
        name="Example Office (synthetic)",
        latitude=40.71,
        longitude=-74.01,
        timezone=TZ,
        floor_area_m2=4500,
        schedule=OccupancySchedule(),
        tariff=current if with_tariffs else None,
        candidate_tariffs=candidates if with_tariffs else [],
    )
