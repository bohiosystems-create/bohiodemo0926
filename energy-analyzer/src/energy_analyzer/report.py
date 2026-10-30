"""Render a Report as Markdown."""

from __future__ import annotations

from .models import Report


def _money(v: float | None) -> str:
    return "—" if v is None else f"${v:,.0f}"


def _payback(v: float | None, cost: float | None) -> str:
    if cost == 0:
        return "immediate"
    return "—" if v is None else (f"{v * 12:.0f} months" if v < 1 else f"{v:.1f} years")


def to_markdown(r: Report) -> str:
    lines = [
        f"# Energy savings report: {r.site}",
        "",
        f"Analysis period: {r.period_start} to {r.period_end} · {r.total_kwh:,.0f} kWh"
        + (f" · {_money(r.total_cost)} (modeled on current tariff)" if r.total_cost is not None else ""),
        "",
        "## Summary",
        "",
        r.executive_summary,
        "",
    ]
    if r.actions:
        total_kwh = sum(a.annual_kwh_savings for a in r.actions)
        total_cost = sum(a.annual_cost_savings or 0 for a in r.actions)
        lines += [
            "## Ranked actions",
            "",
            "| # | Action | kWh/yr | $/yr | Cost to implement | Payback | Confidence |",
            "|---|---|---:|---:|---:|---:|---|",
        ]
        for a in r.actions:
            lines.append(
                f"| {a.rank} | {a.title} | {a.annual_kwh_savings:,.0f} | {_money(a.annual_cost_savings)} | "
                f"{_money(a.implementation_cost)} | {_payback(a.simple_payback_years, a.implementation_cost)} | {a.confidence} |"
            )
        lines += [
            f"| | **Total** | **{total_kwh:,.0f}** | **{_money(total_cost) if total_cost else '—'}** | | | |",
            "",
            "_Totals are indicative: measures interact, so combined savings can be lower than the sum._",
            "",
        ]
        for a in r.actions:
            finding = next(f for f in r.findings if f.id == a.finding_id)
            lines += [f"### {a.rank}. {a.title}", "", a.explanation, "", "**What to do**", ""]
            lines += [f"{i}. {s}" for i, s in enumerate(a.steps, 1)]
            lines += ["", "<details><summary>Evidence and assumptions</summary>", ""]
            lines += [f"- {k}: {v}" for k, v in finding.evidence.items() if not isinstance(v, (list, dict))]
            lines += [f"- _Assumption:_ {x}" for x in finding.assumptions]
            lines += ["", "</details>", ""]

    if r.baseline:
        b = r.baseline
        lines += [
            "## Weather-normalized baseline",
            "",
            f"Model: {b.model_type} ({b.granularity}, {b.n_points} points) · R² {b.r2:.3f} · "
            f"CV(RMSE) {b.cv_rmse_pct:.1f}% · NMBE {b.nmbe_pct:+.2f}%"
            + (f" · monthly CV(RMSE) {b.monthly_cv_rmse_pct:.1f}%" if b.monthly_cv_rmse_pct is not None else ""),
            "",
            ("Meets" if b.meets_ashrae_g14 else "**Does not meet**")
            + " ASHRAE Guideline 14 calibration limits (CV(RMSE) ≤ 15% and |NMBE| ≤ 0.5% at monthly resolution).",
            "",
        ]
        lines += [f"- {n}" for n in b.notes]
        if b.notes:
            lines.append("")

    if r.bill_reconciliation:
        lines += ["## Bills vs. meter", "", "| Period | Billed kWh | Metered kWh | Difference |", "|---|---:|---:|---:|"]
        for rec in r.bill_reconciliation:
            meter = "—" if rec.meter_kwh is None else f"{rec.meter_kwh:,.0f}"
            diff = "—" if rec.difference_pct is None else f"{rec.difference_pct:+.1f}%"
            lines.append(f"| {rec.period_start} – {rec.period_end} | {rec.bill_kwh:,.0f} | {meter} | {diff} |")
        lines.append("")

    if r.warnings:
        lines += ["## Data quality and caveats", ""] + [f"- {w}" for w in r.warnings] + [""]
    lines.append(
        f"_Numbers computed by the analysis engine; narrative written by "
        f"{'Claude' if r.narrative_source == 'claude' else 'template'}._"
    )
    return "\n".join(lines) + "\n"
