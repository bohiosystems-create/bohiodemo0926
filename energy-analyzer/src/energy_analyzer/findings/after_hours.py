"""HVAC and equipment running outside occupied hours.

Three components, measured so they don't overlap with each other or with
the baseload finding (which owns the load between the best-night level and the
typical-night level):

1. Schedule creep: on occupied days, load stays at occupied levels after
   closing (beyond a wind-down allowance) or starts earlier than the warm-up
   allowance. Counted as load above the typical-night floor in those windows.
2. Unoccupied-day operation: weekend/holiday daytime load well above the
   overnight floor. Counted the same way.
3. Weather-driven night load: in the remaining unoccupied hours, load that
   rises with heating or cooling degrees (a regression on outdoor
   temperature) means HVAC is conditioning an empty building. A share of it
   (setback realization) is counted.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..context import SiteData, finalize
from ..models import Finding
from .baseload import nightly_profile


def _hour_of_day(idx: pd.DatetimeIndex) -> np.ndarray:
    return idx.hour + idx.minute / 60.0


def typical_occupied_day(ctx: SiteData) -> pd.Series:
    idx = pd.DatetimeIndex(ctx.kw.index)
    hod = _hour_of_day(idx)
    return ctx.kw[ctx.occupied_day].groupby(hod[ctx.occupied_day]).median()


def detect(ctx: SiteData) -> Finding | None:
    a, s = ctx.config.assumptions, ctx.config.schedule
    kw = ctx.kw
    idx = pd.DatetimeIndex(kw.index)
    hod = _hour_of_day(idx)
    nights = nightly_profile(ctx)
    if len(nights) < 14 or not ctx.occupied.any():
        return None
    floor = float(nights["kw"].median())
    occ_level = float(kw[ctx.occupied].median())
    if occ_level <= floor:
        return None
    threshold = floor + 0.5 * (occ_level - floor)
    open_h = s.open.hour + s.open.minute / 60
    close_h = s.close.hour + s.close.minute / 60

    # 1. schedule creep from the typical occupied-day profile
    profile = typical_occupied_day(ctx)
    on = profile[profile >= threshold]
    eff_start = float(on.index.min()) if len(on) else open_h
    eff_end = float(on.index.max()) + ctx.hours if len(on) else close_h
    early_window = (hod >= eff_start) & (hod < open_h - a.prestart_allowance_h)
    late_window = (hod >= close_h + a.shutdown_allowance_h) & (hod < eff_end)
    creep_mask = ctx.occupied_day & ~ctx.occupied & (early_window | late_window)
    creep_kwh = ((kw - floor).clip(lower=0) * ctx.hours).where(creep_mask, 0.0).fillna(0)

    # 2. unoccupied days running like occupied days during the day
    unocc_day = ~ctx.occupied_day
    daytime = (hod >= open_h) & (hod < close_h)
    weekend_kw = kw[unocc_day & daytime]
    weekend_mean = float(weekend_kw.mean()) if len(weekend_kw.dropna()) else floor
    weekend_flag = weekend_mean > floor + 0.25 * (occ_level - floor)
    weekend_mask = unocc_day & daytime if weekend_flag else np.zeros(len(kw), bool)
    weekend_kwh = ((kw - floor).clip(lower=0) * ctx.hours).where(weekend_mask, 0.0).fillna(0)

    # 3. weather-driven load in the remaining unoccupied hours
    rest = ~ctx.occupied & ~creep_mask & ~weekend_mask
    fit_mask = rest & ((hod < 5) | (hod >= 23))
    t = ctx.temp.to_numpy()
    hd = np.maximum(a.balance_point_c - t, 0)
    cd = np.maximum(t - a.balance_point_c, 0)
    weather_kwh = pd.Series(0.0, index=kw.index)
    slopes = {"heating_kw_per_c": 0.0, "cooling_kw_per_c": 0.0}
    ok = fit_mask & ~np.isnan(t) & kw.notna().to_numpy()
    if ok.sum() > 200:
        X = np.column_stack([np.ones(ok.sum()), hd[ok], cd[ok]])
        y = kw.to_numpy()[ok]
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        resid = y - X @ beta
        sigma2 = resid @ resid / (len(y) - 3)
        se = np.sqrt(np.diag(sigma2 * np.linalg.pinv(X.T @ X)))
        # Hourly residuals are autocorrelated, so demand a high t-stat.
        bh = beta[1] if beta[1] > 0 and beta[1] / se[1] > 5 else 0.0
        bc = beta[2] if beta[2] > 0 and beta[2] / se[2] > 5 else 0.0
        slopes = {"heating_kw_per_c": round(float(bh), 3), "cooling_kw_per_c": round(float(bc), 3)}
        weather_kw = np.where(rest, bh * hd + bc * cd, 0.0)
        weather_kwh = pd.Series(np.nan_to_num(weather_kw) * ctx.hours * a.hvac_setback_realization, index=kw.index)
        weather_kwh = weather_kwh.where(kw.notna(), 0.0)

    reduction = creep_kwh + weekend_kwh + weather_kwh
    parts = {
        "schedule_creep_kwh": float(creep_kwh.sum() * ctx.annualize),
        "unoccupied_day_operation_kwh": float(weekend_kwh.sum() * ctx.annualize),
        "weather_driven_night_hvac_kwh": float(weather_kwh.sum() * ctx.annualize),
    }
    annual_kwh = sum(parts.values())
    annual_total_kwh = float(ctx.kwh.sum() * ctx.annualize)
    if annual_kwh < 0.01 * annual_total_kwh:
        return None

    lines = []
    if parts["schedule_creep_kwh"] > 0:
        lines.append(
            f"on weekdays the building reaches occupied load at {_fmt_h(eff_start)} and stays there until "
            f"{_fmt_h(eff_end)}, versus a {_fmt_h(open_h)}–{_fmt_h(close_h)} schedule"
        )
    if parts["unoccupied_day_operation_kwh"] > 0:
        lines.append(f"weekend/holiday daytime load averages {weekend_mean:.1f} kW against a {floor:.1f} kW overnight floor")
    if parts["weather_driven_night_hvac_kwh"] > 0:
        lines.append("overnight load rises with outdoor temperature, so HVAC is conditioning the empty building")
    summary = "Load outside occupied hours: " + "; ".join(lines) + f". Total ≈ {annual_kwh:,.0f} kWh/yr."

    evidence = {
        "scheduled_hours": f"{_fmt_h(open_h)}-{_fmt_h(close_h)}",
        "effective_start": _fmt_h(eff_start),
        "effective_end": _fmt_h(eff_end),
        "overnight_floor_kw": round(floor, 2),
        "occupied_median_kw": round(occ_level, 2),
        "weekend_daytime_mean_kw": round(weekend_mean, 2),
        **slopes,
        **{k: round(v) for k, v in parts.items()},
    }
    confidence = "high" if parts["schedule_creep_kwh"] + parts["unoccupied_day_operation_kwh"] > 0.5 * annual_kwh else "medium"
    return finalize(
        Finding(
            id="after_hours_hvac",
            type="after_hours_hvac",
            title="HVAC and equipment running outside occupied hours",
            summary=summary,
            annual_kwh_savings=annual_kwh,
            annual_cost_savings=ctx.annual_cost_delta(reduction, "energy"),
            confidence=confidence,
            evidence=evidence,
            assumptions=[
                f"Warm-up allowance {a.prestart_allowance_h} h before opening; wind-down allowance {a.shutdown_allowance_h} h after closing",
                "After-hours excess measured above the typical-night floor (the baseload finding covers the rest)",
                f"A proper setback removes {a.hvac_setback_realization:.0%} of weather-driven night load",
            ],
        ),
        ctx,
    )


def _fmt_h(h: float) -> str:
    h = h % 24
    return f"{int(h):02d}:{int(round((h % 1) * 60)) % 60:02d}"
