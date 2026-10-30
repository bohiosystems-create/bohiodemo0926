"""Tariff model and bill calculator.

The Tariff schema mirrors OpenEI's Utility Rate Database (URDB) fields, so a
URDB record maps onto it directly (see ingest/openei.py). Supported:
fixed monthly charge, time-of-use and tiered energy rates, flat monthly demand
charges and time-of-use demand charges. Not supported (flagged in
`unsupported`): demand ratchets, coincident-peak charges, kWh/kW-dependent tiers.
Billing months are calendar months in the site's local time.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field


class Tier(BaseModel):
    rate: float  # $/kWh for energy, $/kW for demand
    adj: float = 0.0
    max: float | None = None  # upper bound of this tier (kWh or kW per month); None = unbounded

    @property
    def total(self) -> float:
        return self.rate + self.adj


def _flat_schedule(period: int = 0) -> list[list[int]]:
    return [[period] * 24 for _ in range(12)]


class Tariff(BaseModel):
    name: str
    utility: str | None = None
    label: str | None = Field(None, description="URDB label, if from OpenEI")
    fixed_monthly: float = 0.0
    energy_rates: list[list[Tier]] = Field(default_factory=lambda: [[Tier(rate=0.0)]])
    energy_weekday_schedule: list[list[int]] = Field(default_factory=_flat_schedule)  # 12 months x 24 hours -> period
    energy_weekend_schedule: list[list[int]] = Field(default_factory=_flat_schedule)
    flat_demand_rates: list[list[Tier]] = Field(default_factory=list)
    flat_demand_months: list[int] = Field(default_factory=lambda: [0] * 12)  # month -> flat demand period
    tou_demand_rates: list[list[Tier]] = Field(default_factory=list)
    tou_demand_weekday_schedule: list[list[int]] = Field(default_factory=_flat_schedule)
    tou_demand_weekend_schedule: list[list[int]] = Field(default_factory=_flat_schedule)
    unsupported: list[str] = Field(default_factory=list)

    @classmethod
    def simple(cls, name: str, energy_rate: float, demand_rate: float = 0.0, fixed_monthly: float = 0.0) -> "Tariff":
        return cls(
            name=name,
            fixed_monthly=fixed_monthly,
            energy_rates=[[Tier(rate=energy_rate)]],
            flat_demand_rates=[[Tier(rate=demand_rate)]] if demand_rate else [],
        )


def _tiered_cost(quantity: float, tiers: list[Tier]) -> float:
    cost, lower = 0.0, 0.0
    for tier in tiers:
        upper = tier.max if tier.max is not None else np.inf
        in_tier = min(max(quantity - lower, 0.0), upper - lower)
        cost += in_tier * tier.total
        lower = upper
        if quantity <= lower:
            break
    return cost


def _periods(index: pd.DatetimeIndex, weekday: list[list[int]], weekend: list[list[int]]) -> np.ndarray:
    m = index.month.to_numpy() - 1
    h = index.hour.to_numpy()
    wd = np.asarray(weekday)[m, h]
    we = np.asarray(weekend)[m, h]
    return np.where(index.dayofweek.to_numpy() >= 5, we, wd)


def calculate_bills(kwh: pd.Series, tariff: Tariff) -> pd.DataFrame:
    """Monthly bills for an interval kWh series (tz-aware local index).

    Returns one row per calendar month with fixed, energy, demand and total
    charges plus kWh and peak kW.
    """
    if kwh.empty:
        return pd.DataFrame(columns=["kwh", "peak_kw", "fixed", "energy", "demand", "total"])
    idx = pd.DatetimeIndex(kwh.index)
    hours = interval_hours(kwh)
    kw = kwh / hours
    month = idx.to_period("M") if idx.tz is None else idx.tz_localize(None).to_period("M")
    e_period = _periods(idx, tariff.energy_weekday_schedule, tariff.energy_weekend_schedule)
    d_period = _periods(idx, tariff.tou_demand_weekday_schedule, tariff.tou_demand_weekend_schedule)
    frame = pd.DataFrame({"kwh": kwh.to_numpy(), "kw": kw.to_numpy(), "month": month, "ep": e_period, "dp": d_period})

    rows = []
    for mo, g in frame.groupby("month", sort=True):
        energy = sum(
            _tiered_cost(gp["kwh"].sum(), tariff.energy_rates[min(p, len(tariff.energy_rates) - 1)])
            for p, gp in g.groupby("ep")
        )
        demand = 0.0
        if tariff.flat_demand_rates:
            p = tariff.flat_demand_months[mo.month - 1]
            demand += _tiered_cost(g["kw"].max(), tariff.flat_demand_rates[min(p, len(tariff.flat_demand_rates) - 1)])
        if tariff.tou_demand_rates:
            for p, gp in g.groupby("dp"):
                if p < len(tariff.tou_demand_rates):
                    demand += _tiered_cost(gp["kw"].max(), tariff.tou_demand_rates[p])
        rows.append(
            {
                "month": mo,
                "kwh": g["kwh"].sum(),
                "peak_kw": g["kw"].max(),
                "fixed": tariff.fixed_monthly,
                "energy": energy,
                "demand": demand,
            }
        )
    bills = pd.DataFrame(rows).set_index("month")
    bills["total"] = bills[["fixed", "energy", "demand"]].sum(axis=1)
    return bills


def interval_hours(series: pd.Series) -> float:
    """Interval length in hours, from the most common timestamp spacing."""
    deltas = pd.Series(series.index).diff().dropna()
    if deltas.empty:
        return 1.0
    return deltas.mode().iloc[0].total_seconds() / 3600.0
