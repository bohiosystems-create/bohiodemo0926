"""Overnight / weekend baseload that is higher than the building has shown it can achieve.

Method: take mild-weather nights (little heating or cooling), compute each
night's mean load between 00:00 and 05:00, and compare the typical (median)
night with the site's own best nights (10th percentile). The gap is load the
building has already proven it can switch off, so the target is not a
benchmark guess.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..context import SiteData, finalize
from ..models import Finding


def nightly_profile(ctx: SiteData) -> pd.DataFrame:
    kw, temp = ctx.kw, ctx.temp
    idx = pd.DatetimeIndex(kw.index)
    night = (idx.hour < 5) & ~ctx.occupied
    frame = pd.DataFrame({"kw": kw[night].to_numpy(), "t": temp[night].to_numpy()}, index=idx[night].date)
    g = frame.groupby(level=0)
    nights = pd.DataFrame({"kw": g["kw"].mean(), "t": g["t"].mean(), "n": g["kw"].count()})
    return nights[nights["n"] >= 0.9 * nights["n"].median()]  # median, not max: DST nights are longer


def detect(ctx: SiteData) -> Finding | None:
    a = ctx.config.assumptions
    nights = nightly_profile(ctx)
    if len(nights) < 14:
        return None
    mild = nights[(nights["t"] - a.balance_point_c).abs() <= a.mild_weather_band_c]
    used_mild = len(mild) >= 10
    sample = mild if used_mild else nights
    typical = float(sample["kw"].median())
    target = float(np.percentile(sample["kw"], a.baseload_target_percentile))
    excess_kw = typical - target
    if typical <= 0 or excess_kw < max(0.05 * typical, 0.5):
        return None

    kw = ctx.kw
    unocc = ~ctx.occupied
    reduction_kw = np.minimum(excess_kw, (kw - target).clip(lower=0)) * unocc
    reduction_kwh = (reduction_kw * ctx.hours).fillna(0)
    annual_kwh = float(reduction_kwh.sum() * ctx.annualize)

    occ_kw = kw[ctx.occupied].dropna()
    peak_ref = float(np.percentile(occ_kw, 95)) if len(occ_kw) else float(kw.max())
    base_to_peak = typical / peak_ref if peak_ref > 0 else None
    unocc_hours_per_year = float(unocc.sum() * ctx.hours * ctx.annualize)

    confidence = "high" if used_mild and len(mild) >= 30 and excess_kw >= 0.15 * typical else "medium"
    if not used_mild:
        confidence = "low"
    return finalize(
        Finding(
            id="baseload",
            type="baseload",
            title="Overnight and weekend baseload is higher than it needs to be",
            summary=(
                f"On a typical mild night the building draws {typical:.1f} kW, but on its best nights it gets "
                f"down to {target:.1f} kW. Closing that {excess_kw:.1f} kW gap across ~{unocc_hours_per_year:,.0f} "
                f"unoccupied hours a year saves about {annual_kwh:,.0f} kWh."
            ),
            annual_kwh_savings=annual_kwh,
            annual_cost_savings=ctx.annual_cost_delta(reduction_kwh, "energy"),
            confidence=confidence,
            evidence={
                "typical_night_kw": round(typical, 2),
                "best_nights_kw": round(target, 2),
                "excess_kw": round(excess_kw, 2),
                "nights_analyzed": int(len(sample)),
                "mild_weather_only": used_mild,
                "base_to_peak_ratio": None if base_to_peak is None else round(base_to_peak, 2),
                "occupied_p95_kw": round(peak_ref, 1),
                "unoccupied_hours_per_year": round(unocc_hours_per_year),
            },
            assumptions=[
                f"Achievable baseload = {a.baseload_target_percentile:.0f}th percentile of the site's own mild nights",
                f"Mild night = mean temperature within {a.mild_weather_band_c} C of the {a.balance_point_c} C balance point",
                "Savings apply to all unoccupied hours (nights, weekends, holidays)",
            ],
        ),
        ctx,
    )
