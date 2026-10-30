"""Shared data models: site configuration, findings and the report.

Every number in a Finding is computed by deterministic code. The LLM layer
(llm.py) may rank and explain findings but never produces or edits numbers.
"""

from __future__ import annotations

from datetime import date, time
from typing import Literal

from pydantic import BaseModel, Field

from .tariff import Tariff


class OccupancySchedule(BaseModel):
    """When the building is supposed to be occupied (site local time)."""

    weekdays: list[int] = Field(default=[0, 1, 2, 3, 4], description="0=Monday ... 6=Sunday")
    open: time = time(7, 0)
    close: time = time(19, 0)
    holidays: list[date] = Field(default_factory=list)


class Assumptions(BaseModel):
    """Every judgment call in the savings math lives here, so it can be shown
    to the customer and tuned per site."""

    balance_point_c: float = Field(18.0, description="Outdoor temperature (C) with no heating or cooling load")
    mild_weather_band_c: float = Field(3.0, description="Nights within this many C of the balance point count as 'mild'")
    baseload_target_percentile: float = Field(10.0, description="Achievable overnight load = this percentile of the site's own mild nights")
    hvac_setback_realization: float = Field(0.7, description="Share of weather-driven after-hours load a proper setback removes")
    prestart_allowance_h: float = Field(1.5, description="HVAC start before opening that counts as normal warm-up/cool-down")
    shutdown_allowance_h: float = Field(0.5, description="Load after closing that counts as normal wind-down")
    demand_shave_intervals_per_month: int = Field(8, description="Peak shaving target: clip each month's peak down to its Nth-highest interval")
    drift_min_pct: float = Field(3.0, description="Ignore weather-normalized drift smaller than this % of baseline")
    tariff_min_savings_pct: float = Field(2.0, description="Only recommend a tariff switch saving more than this %")
    implementation_cost_usd: dict[str, float] = Field(
        default={
            "baseload": 3000.0,  # audit + plug-load / equipment scheduling
            "after_hours_hvac": 1500.0,  # BMS schedule and setback changes
            "demand_peaks": 2500.0,  # staggered start sequencing / controls
            "drift": 2000.0,  # investigation and retro-commissioning visit
            "tariff_switch": 0.0,
        },
        description="Rough cost to implement each measure type (USD); edit per site",
    )


class SiteConfig(BaseModel):
    name: str
    latitude: float
    longitude: float
    timezone: str = "UTC"
    floor_area_m2: float | None = None
    schedule: OccupancySchedule = Field(default_factory=OccupancySchedule)
    tariff: Tariff | None = None
    candidate_tariffs: list[Tariff] = Field(default_factory=list)
    assumptions: Assumptions = Field(default_factory=Assumptions)


FindingType = Literal["baseload", "after_hours_hvac", "demand_peaks", "drift", "tariff_switch"]


class Finding(BaseModel):
    id: str
    type: FindingType
    title: str
    summary: str
    annual_kwh_savings: float
    annual_cost_savings: float | None = Field(None, description="USD/yr; None when no tariff is configured")
    implementation_cost: float | None = None
    simple_payback_years: float | None = None
    confidence: Literal["high", "medium", "low"]
    evidence: dict = Field(default_factory=dict, description="Metrics behind the finding, for the report and audit trail")
    assumptions: list[str] = Field(default_factory=list)


class BaselineSummary(BaseModel):
    model_type: str
    coefficients: dict[str, float]
    n_points: int
    granularity: Literal["daily", "billing_period"]
    r2: float
    cv_rmse_pct: float
    nmbe_pct: float
    monthly_cv_rmse_pct: float | None
    meets_ashrae_g14: bool
    notes: list[str] = Field(default_factory=list)


class BillReconciliation(BaseModel):
    period_start: date
    period_end: date
    bill_kwh: float
    meter_kwh: float | None
    difference_pct: float | None


class Action(BaseModel):
    """One ranked recommendation. Numeric fields are copied from the
    matching Finding by code, not written by the model."""

    rank: int
    finding_id: str
    title: str
    explanation: str
    steps: list[str]
    annual_kwh_savings: float
    annual_cost_savings: float | None
    implementation_cost: float | None
    simple_payback_years: float | None
    confidence: str


class Report(BaseModel):
    site: str
    period_start: date
    period_end: date
    total_kwh: float
    total_cost: float | None
    baseline: BaselineSummary | None
    findings: list[Finding]
    actions: list[Action]
    executive_summary: str
    bill_reconciliation: list[BillReconciliation] = Field(default_factory=list)
    narrative_source: Literal["claude", "template"]
    assumptions: Assumptions
    warnings: list[str] = Field(default_factory=list)
