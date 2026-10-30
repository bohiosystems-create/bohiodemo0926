"""The prepared data every detector works from."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

import numpy as np
import pandas as pd

from .ingest.weather import align_temperature
from .models import Finding, OccupancySchedule, SiteConfig
from .tariff import Tariff, calculate_bills, interval_hours

ANALYSIS_DAYS = 365


def occupied_mask(index: pd.DatetimeIndex, schedule: OccupancySchedule) -> np.ndarray:
    minutes = index.hour * 60 + index.minute
    open_m = schedule.open.hour * 60 + schedule.open.minute
    close_m = schedule.close.hour * 60 + schedule.close.minute
    return occupied_day_mask(index, schedule) & (minutes >= open_m) & (minutes < close_m)


def occupied_day_mask(index: pd.DatetimeIndex, schedule: OccupancySchedule) -> np.ndarray:
    holidays = set(schedule.holidays)
    is_holiday = np.array([d in holidays for d in index.date]) if holidays else np.zeros(len(index), bool)
    return np.isin(index.dayofweek, schedule.weekdays) & ~is_holiday


@dataclass
class SiteData:
    config: SiteConfig
    kwh_all: pd.Series  # full history
    temp_all: pd.Series  # aligned to kwh_all
    kwh: pd.Series = field(init=False)  # analysis window (most recent year)
    temp: pd.Series = field(init=False)
    hours: float = field(init=False)
    occupied: np.ndarray = field(init=False)
    occupied_day: np.ndarray = field(init=False)
    annualize: float = field(init=False)

    def __post_init__(self) -> None:
        self.hours = interval_hours(self.kwh_all)
        end = self.kwh_all.index[-1]
        start = max(self.kwh_all.index[0], end - timedelta(days=ANALYSIS_DAYS) + timedelta(hours=self.hours))
        self.kwh = self.kwh_all.loc[start:]
        self.temp = self.temp_all.loc[start:]
        idx = pd.DatetimeIndex(self.kwh.index)
        self.occupied = occupied_mask(idx, self.config.schedule)
        self.occupied_day = occupied_day_mask(idx, self.config.schedule)
        present_days = self.kwh.notna().sum() * self.hours / 24
        self.annualize = 365.0 / present_days if present_days else 0.0

    @classmethod
    def build(cls, config: SiteConfig, kwh: pd.Series, hourly_temp: pd.Series) -> "SiteData":
        temp = align_temperature(hourly_temp, pd.DatetimeIndex(kwh.index))
        return cls(config=config, kwh_all=kwh, temp_all=temp)

    @property
    def kw(self) -> pd.Series:
        return self.kwh / self.hours

    @property
    def tariff(self) -> Tariff | None:
        return self.config.tariff

    @property
    def days(self) -> float:
        return float(self.kwh.notna().sum() * self.hours / 24)

    def annual_cost_delta(self, reduction_kwh: pd.Series, component: str = "total") -> float | None:
        """Annualized bill savings from removing `reduction_kwh` from the load,
        priced with the site's actual tariff (so TOU and demand are honored)."""
        if self.tariff is None:
            return None
        base = self.kwh.fillna(0)
        after = (base - reduction_kwh.reindex(base.index).fillna(0)).clip(lower=0)
        delta = calculate_bills(base, self.tariff)[component].sum() - calculate_bills(after, self.tariff)[component].sum()
        return float(delta * self.annualize)


def finalize(finding: Finding, ctx: SiteData) -> Finding:
    """Attach implementation cost and simple payback."""
    cost = ctx.config.assumptions.implementation_cost_usd.get(finding.type)
    finding.implementation_cost = cost
    if cost is not None and finding.annual_cost_savings and finding.annual_cost_savings > 0:
        finding.simple_payback_years = round(cost / finding.annual_cost_savings, 2)
    finding.annual_kwh_savings = round(finding.annual_kwh_savings, 0)
    if finding.annual_cost_savings is not None:
        finding.annual_cost_savings = round(finding.annual_cost_savings, 0)
    return finding
