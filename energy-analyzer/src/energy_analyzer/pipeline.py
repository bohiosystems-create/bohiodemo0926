"""End-to-end analysis: data in, Report out."""

from __future__ import annotations

import logging

import pandas as pd

from . import llm
from .baseline import Baseline, fit_billing_baseline, fit_daily_baseline
from .bills import Bill, bills_frame, check_bill, reconcile
from .context import SiteData
from .findings import after_hours, baseload, demand, drift, tariff_switch
from .findings.drift import daily_frame
from .ingest.interval import completeness
from .ingest.weather import daily_degree_days
from .models import Finding, Report, SiteConfig
from .tariff import calculate_bills

log = logging.getLogger(__name__)
DETECTORS = [baseload.detect, after_hours.detect, demand.detect, drift.detect, tariff_switch.detect]


def run_detectors(ctx: SiteData) -> tuple[list[Finding], list[str]]:
    findings, warnings = [], []
    for detect in DETECTORS:
        try:
            f = detect(ctx)
        except Exception as e:  # one bad detector shouldn't sink the report
            log.exception("detector %s failed", detect.__module__)
            warnings.append(f"{detect.__module__.rsplit('.', 1)[-1]} analysis failed: {e}")
            continue
        if f is not None:
            findings.append(f)
    return findings, warnings


def analyze(
    config: SiteConfig,
    hourly_temp: pd.Series,
    kwh: pd.Series | None = None,
    bills: list[Bill] | None = None,
    use_claude: bool | None = None,
) -> Report:
    """Run the full analysis. With use_claude=None, Claude writes the
    narrative when an API key is configured, otherwise a template does."""
    bills = bills or []
    warnings: list[str] = [w for b in bills for w in check_bill(b)]
    if config.tariff:
        warnings += [f"Tariff '{config.tariff.name}': not modeled: {u}" for u in config.tariff.unsupported]

    findings: list[Finding] = []
    baseline: Baseline | None = None
    total_cost = None
    if kwh is not None:
        ctx = SiteData.build(config, kwh, hourly_temp)
        comp = completeness(ctx.kwh)
        if comp < 0.9:
            warnings.append(f"Interval data is only {comp:.0%} complete in the analysis year; results are less certain.")
        if ctx.days < 300:
            warnings.append(f"Only {ctx.days:.0f} days of interval data; annual figures are extrapolated and seasonal effects may be missed.")
        daily = daily_frame(ctx, ctx.kwh, ctx.temp)
        try:
            baseline = fit_daily_baseline(daily["energy"], daily["temp_c"], daily["occ"])
        except ValueError as e:
            warnings.append(f"Baseline not fitted: {e}")
        f, w = run_detectors(ctx)
        findings, warnings = f, warnings + w
        if config.tariff:
            total_cost = float(calculate_bills(ctx.kwh.fillna(0), config.tariff)["total"].sum())
        period_start, period_end = ctx.kwh.index[0].date(), ctx.kwh.index[-1].date()
        total_kwh = float(ctx.kwh.sum())
    elif bills:
        frame = bills_frame(bills)
        weather = daily_degree_days(hourly_temp.dropna(), config.assumptions.balance_point_c)
        try:
            baseline = fit_billing_baseline(frame, weather["temp_c"])
        except ValueError as e:
            warnings.append(f"Baseline not fitted: {e}")
        warnings.append("No interval data: waste detection needs 15-minute or hourly meter data. Bill-level baseline only.")
        period_start, period_end = frame["period_start"].min(), frame["period_end"].max()
        total_kwh = float(frame["kwh"].sum())
        total_cost = float(frame["total_charges"].sum())
    else:
        raise ValueError("Provide interval data, bills, or both")

    baseline_summary = baseline.summary() if baseline else None
    if baseline_summary and not baseline_summary.meets_ashrae_g14:
        warnings.append(
            "The weather-normalized baseline does not meet ASHRAE Guideline 14 calibration limits; "
            "treat savings verification against it with caution."
        )

    site_context = {
        "name": config.name,
        "floor_area_m2": config.floor_area_m2,
        "schedule": config.schedule.model_dump(mode="json"),
        "period": f"{period_start} to {period_end}",
        "total_kwh": round(total_kwh),
        "total_cost": None if total_cost is None else round(total_cost),
        "tariff": config.tariff.name if config.tariff else None,
        "baseline": baseline_summary.model_dump() if baseline_summary else None,
    }
    if use_claude is None:
        use_claude = llm.claude_available()
    source = "template"
    narrative = llm.template_narrative(findings)
    if use_claude and findings:
        try:
            narrative, number_warnings = llm.write_narrative(site_context, findings)
            warnings += number_warnings
            source = "claude"
        except llm.ClaudeError as e:
            warnings.append(f"Claude narrative unavailable ({e}); using the template report.")

    return Report(
        site=config.name,
        period_start=period_start,
        period_end=period_end,
        total_kwh=round(total_kwh, 0),
        total_cost=None if total_cost is None else round(total_cost, 0),
        baseline=baseline_summary,
        findings=findings,
        actions=llm.assemble_actions(narrative, findings),
        executive_summary=narrative.executive_summary,
        bill_reconciliation=reconcile(bills, kwh) if bills else [],
        narrative_source=source,  # type: ignore[arg-type]
        assumptions=config.assumptions,
        warnings=warnings,
    )
