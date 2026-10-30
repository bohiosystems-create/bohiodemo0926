"""A cheaper tariff for the same load.

Re-prices the most recent year of interval data under every candidate
tariff (e.g. from OpenEI for the site's utility) and compares with the
current one.
"""

from __future__ import annotations

from ..context import SiteData, finalize
from ..models import Finding
from ..tariff import calculate_bills


def compare(ctx: SiteData) -> list[dict]:
    kwh = ctx.kwh.fillna(0)
    out = []
    for t in [ctx.tariff, *ctx.config.candidate_tariffs]:
        if t is None:
            continue
        bills = calculate_bills(kwh, t)
        out.append(
            {
                "name": t.name,
                "label": t.label,
                "annual_cost": round(float(bills["total"].sum() * ctx.annualize), 0),
                "energy": round(float(bills["energy"].sum() * ctx.annualize), 0),
                "demand": round(float(bills["demand"].sum() * ctx.annualize), 0),
                "fixed": round(float(bills["fixed"].sum() * ctx.annualize), 0),
                "unsupported_features": t.unsupported,
                "current": t is ctx.tariff,
            }
        )
    return out


def detect(ctx: SiteData) -> Finding | None:
    if ctx.tariff is None or not ctx.config.candidate_tariffs:
        return None
    table = compare(ctx)
    current = next(r for r in table if r["current"])
    best = min((r for r in table if not r["current"]), key=lambda r: r["annual_cost"])
    savings = current["annual_cost"] - best["annual_cost"]
    if savings <= current["annual_cost"] * ctx.config.assumptions.tariff_min_savings_pct / 100:
        return None
    caveat = bool(best["unsupported_features"] or current["unsupported_features"])
    return finalize(
        Finding(
            id="tariff_switch",
            type="tariff_switch",
            title=f"Switch to the '{best['name']}' rate",
            summary=(
                f"Priced on the same 12 months of interval data, '{best['name']}' would cost "
                f"${best['annual_cost']:,.0f}/yr versus ${current['annual_cost']:,.0f}/yr on the current "
                f"'{current['name']}' rate: ${savings:,.0f}/yr ({savings / current['annual_cost']:.1%}) with no "
                "change in operations."
            ),
            annual_kwh_savings=0.0,
            annual_cost_savings=float(savings),
            confidence="medium" if caveat else "high",
            evidence={"tariffs": sorted(table, key=lambda r: r["annual_cost"])},
            assumptions=[
                "Same load profile under every tariff (no behavior change)",
                "Eligibility rules (customer class, size limits, contract terms) must be confirmed with the utility",
                *([f"Some tariff features not modeled: {best['unsupported_features'] or current['unsupported_features']}"] if caveat else []),
            ],
        ),
        ctx,
    )
