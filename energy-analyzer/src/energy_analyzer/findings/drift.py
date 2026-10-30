"""Weather-normalized consumption drifting upward over time.

A baseline is fitted on the earliest part of the history (up to a year).
Every later day's actual use is compared with what that baseline predicts
for the day's actual weather and day type. A sustained positive residual
means the building now uses more energy than it did under the same weather,
which is typical of failing controls, overridden schedules, fouled coils or
added load.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..baseline import daily_energy, fit_daily_baseline
from ..context import SiteData, finalize, occupied_day_mask
from ..ingest.weather import daily_degree_days
from ..models import Finding

RECENT_DAYS = 90


def daily_frame(ctx: SiteData, kwh: pd.Series, temp: pd.Series) -> pd.DataFrame:
    energy = daily_energy(kwh)
    weather = daily_degree_days(temp.dropna(), ctx.config.assumptions.balance_point_c)
    days = pd.DatetimeIndex(energy.index)
    occ = pd.Series(occupied_day_mask(days, ctx.config.schedule), index=energy.index)
    return pd.DataFrame({"energy": energy, "temp_c": weather["temp_c"], "occ": occ}).dropna()


def detect(ctx: SiteData) -> Finding | None:
    a = ctx.config.assumptions
    daily = daily_frame(ctx, ctx.kwh_all, ctx.temp_all)
    if len(daily) < 180:
        return None
    train_days = min(365, len(daily) // 2)
    train, post = daily.iloc[:train_days], daily.iloc[train_days:]
    try:
        base = fit_daily_baseline(train["energy"], train["temp_c"], train["occ"])
    except ValueError:
        return None
    if not base.summary().meets_ashrae_g14:
        return None  # the reference model isn't good enough to call drift

    daytype = np.where(post["occ"], "occupied", "unoccupied") if "all" not in base.models else np.full(len(post), "all")
    predicted = base.predict(post["temp_c"].to_numpy(), daytype)
    resid = post["energy"] - predicted
    recent = resid.iloc[-RECENT_DAYS:]
    recent_pred = predicted[-RECENT_DAYS:]
    excess_pct = float(recent.sum() / recent_pred.sum() * 100)
    rho = max(float(recent.autocorr(lag=1)) if len(recent) > 3 else 0.0, 0.0)
    n_eff = len(recent) * (1 - rho) / (1 + rho) if rho < 0.95 else 1
    t_stat = float(recent.mean() / (recent.std(ddof=1) / np.sqrt(max(n_eff, 1)))) if recent.std() > 0 else 0.0
    if excess_pct < a.drift_min_pct or t_stat < 2.5:
        return None

    # Onset: first day the 30-day centered mean residual exceeds the drift threshold.
    rolling_pct = (resid.rolling(30, center=True).sum()
                   / pd.Series(predicted, index=post.index).rolling(30, center=True).sum() * 100)
    above = rolling_pct[rolling_pct >= a.drift_min_pct]
    onset = above.index[0] if len(above) else recent.index[0]
    excess_kwh_per_day = float(recent.mean())
    annual_kwh = excess_kwh_per_day * 365

    by_daytype = (
        pd.DataFrame({"r": recent, "occ": post["occ"].iloc[-RECENT_DAYS:]})
        .groupby("occ")["r"]
        .mean()
        .rename(index={True: "occupied_days", False: "unoccupied_days"})
        .round(1)
        .to_dict()
    )
    monthly = (resid.groupby(pd.DatetimeIndex(resid.index).to_period("M")).sum()
               / pd.Series(predicted, index=post.index).groupby(pd.DatetimeIndex(post.index).to_period("M")).sum() * 100)

    # Price the excess as a proportional cut across the analysis window.
    window_share = excess_kwh_per_day * ctx.days / max(float(ctx.kwh.sum()), 1e-9)
    reduction = ctx.kwh.fillna(0) * min(window_share, 1.0)
    return finalize(
        Finding(
            id="drift",
            type="drift",
            title="Energy use is drifting upward after weather normalization",
            summary=(
                f"Over the last {len(recent)} days the building used {excess_pct:.1f}% more than its own "
                f"baseline predicts for the same weather (≈{excess_kwh_per_day:,.0f} kWh/day). The shift "
                f"became noticeable around {pd.Timestamp(onset).date()}. Bringing it back to baseline saves "
                f"≈{annual_kwh:,.0f} kWh/yr."
            ),
            annual_kwh_savings=annual_kwh,
            annual_cost_savings=ctx.annual_cost_delta(reduction, "energy"),
            confidence="high" if t_stat > 5 and excess_pct > 2 * a.drift_min_pct else "medium",
            evidence={
                "reference_period": f"{train.index[0].date()} to {train.index[-1].date()}",
                "reference_model": base.summary().model_type,
                "reference_cv_rmse_pct": base.summary().cv_rmse_pct,
                "recent_excess_pct": round(excess_pct, 2),
                "recent_excess_kwh_per_day": round(excess_kwh_per_day, 1),
                "t_stat": round(t_stat, 1),
                "estimated_onset": str(pd.Timestamp(onset).date()),
                "excess_kwh_per_day_by_daytype": by_daytype,
                "monthly_excess_pct": {str(k): round(float(v), 1) for k, v in monthly.tail(12).items()},
            },
            assumptions=[
                "Reference baseline fitted on the earliest year (or half) of the history and meets ASHRAE G14",
                f"Drift measured over the most recent {RECENT_DAYS} days; t-stat adjusted for autocorrelation",
                "Savings assume the cause is found and fixed (retro-commissioning)",
            ],
        ),
        ctx,
    )
