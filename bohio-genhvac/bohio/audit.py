"""Audit trail (P8): every proposal, check result and outcome is a database row; this renders it."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from bohio.models import Decision, Proposal, Zone


def decision_rows(s: Session, site_id: int, outcome: str | None = None, zone: str | None = None) -> list[dict]:
    q = (select(Proposal, Decision, Zone).join(Decision, Decision.proposal_id == Proposal.id)
         .join(Zone, Zone.id == Proposal.zone_id).where(Proposal.site_id == site_id).order_by(Proposal.ts, Zone.id))
    rows = []
    for p, d, z in s.execute(q):
        if (outcome and d.outcome != outcome) or (zone and z.name != zone):
            continue
        failed = [c for c in d.checks if not c["passed"]]
        rows.append({"ts": p.ts, "zone": z.name, "proposed": p.raw_value, "applied": d.applied_value, "outcome": d.outcome,
                     "written": d.written, "why": p.rationale_text, "failed": failed, "mode": d.mode})
    return rows


def format_log(rows: list[dict], limit: int | None = None) -> str:
    head = f"{'time':<6} {'zone':<14} {'proposed':>9} {'applied':>8}  {'outcome':<11} reason"
    lines = [head, "-" * len(head)]
    for r in rows[:limit] if limit else rows:
        extra = " | ".join(f"{c['name']}: {c['detail']}" for c in r["failed"])
        lines.append(f"{r['ts']:%H:%M}  {r['zone']:<14} {str(r['proposed']):>9} {r['applied']:>8.2f}  {r['outcome']:<11} {extra or r['why']}")
    return "\n".join(lines)
