"""Demand-charge peaks that a few intervals a month are responsible for.

For each billing month, the billed peak is compared with the month's
Nth-highest interval. If the peak is a short spike (a "needle"), clipping it
to the Nth-highest level only needs a small amount of energy shifted, yet
saves demand charges on the whole month. Savings are priced by re-running
the actual tariff with the clipped load (demand component only, since the
energy is shifted rather than removed).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..context import SiteData, finalize
from ..models import Finding

# On real (and synthetic) meters, noise alone puts the peak ~5% above the
# Nth-highest interval, so only flag clearly needle-shaped peaks.
MIN_SHAVE_SHARE = 0.10


def detect(ctx: SiteData) -> Finding | None:
    a, s = ctx.config.assumptions, ctx.config.schedule
    if ctx.tariff is not None and not (ctx.tariff.flat_demand_rates or ctx.tariff.tou_demand_rates):
        return None  # no demand charges to reduce
    kw = ctx.kw
    idx = pd.DatetimeIndex(kw.index)
    months = idx.tz_localize(None).to_period("M")
    n = a.demand_shave_intervals_per_month

    clipped = kw.copy()
    rows = []
    for mo, g in kw.groupby(months):
        g = g.dropna()
        if len(g) <= n:
            continue
        ranked = g.sort_values(ascending=False)
        peak, target = float(ranked.iloc[0]), float(ranked.iloc[n])
        clipped.loc[g.index] = np.minimum(g, target)
        top = ranked.iloc[:n]
        rows.append(
            {
                "month": str(mo),
                "peak_kw": round(peak, 1),
                "target_kw": round(target, 1),
                "shave_kw": round(peak - target, 1),
                "peak_time": ranked.index[0].strftime("%Y-%m-%d %H:%M"),
                "top_hours": [t.hour for t in top.index],
                "shift_kwh": round(float((g - target).clip(lower=0).sum() * ctx.hours), 1),
            }
        )
    if not rows:
        return None
    table = pd.DataFrame(rows)
    avg_shave = float(table["shave_kw"].mean())
    avg_peak = float(table["peak_kw"].mean())
    if avg_shave < MIN_SHAVE_SHARE * avg_peak:
        return None  # ordinary peak-to-peak noise, not a needle worth managing

    reduction_kwh = ((kw - clipped) * ctx.hours).fillna(0)
    cost = ctx.annual_cost_delta(reduction_kwh, "demand")

    top_hours = np.concatenate(table["top_hours"].to_numpy())
    open_h = s.open.hour
    startup_share = float(np.mean((top_hours >= open_h - 2) & (top_hours <= open_h + 1)))
    pattern = (
        f"{startup_share:.0%} of the top intervals fall in the morning start-up window, which points to "
        "equipment all starting at once (stagger the start)."
        if startup_share >= 0.4
        else f"Peaks most often occur around {int(pd.Series(top_hours).mode().iloc[0]):02d}:00."
    )
    cost_txt = f" worth about ${cost:,.0f}/yr in demand charges" if cost else ""
    return finalize(
        Finding(
            id="demand_peaks",
            type="demand_peaks",
            title="Short demand peaks are setting the monthly demand charge",
            summary=(
                f"Each month's billed peak averages {avg_peak:.0f} kW, but only {n} intervals a month go above "
                f"{avg_peak - avg_shave:.0f} kW. Holding the load to that level cuts the billed peak by "
                f"~{avg_shave:.0f} kW{cost_txt}. {pattern}"
            ),
            annual_kwh_savings=0.0,
            annual_cost_savings=cost,
            confidence="high" if avg_shave >= 0.2 * avg_peak else "medium",
            evidence={
                "avg_billed_peak_kw": round(avg_peak, 1),
                "avg_shave_kw": round(avg_shave, 1),
                "startup_window_share": round(startup_share, 2),
                "monthly": table.drop(columns=["top_hours"]).to_dict(orient="records"),
            },
            assumptions=[
                f"Target = each month's {n + 1}th-highest interval (only {n} intervals/month need managing)",
                "Shaved energy is shifted, not saved: kWh savings are zero, savings are demand charges only",
                "Ratchets and coincident-peak charges are not modeled",
            ],
        ),
        ctx,
    )
