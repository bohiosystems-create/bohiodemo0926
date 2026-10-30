"""Claude API: reading bill PDFs and writing the plain-English report.

Division of labor: code computes every number; Claude reads documents and
explains. The report prompt hands Claude the computed findings, Claude
returns a ranking plus explanations, and code then copies the numbers back
in from the findings by id and flags any figure in Claude's prose that it
cannot trace to the data.
"""

from __future__ import annotations

import base64
import json
import os
import re

import anthropic
from pydantic import BaseModel, Field

from .bills import BillExtraction
from .models import Action, Finding

MODEL = os.environ.get("ENERGY_ANALYZER_MODEL", "claude-opus-5-5")
# Server-side fallback: if a request is declined, the API retries it on
# Anthropic's recommended fallback model inside the same call.
_FALLBACK = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}


def claude_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


class ClaudeError(RuntimeError):
    pass


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def _check(response) -> None:
    if response.stop_reason == "refusal":
        detail = getattr(response.stop_details, "explanation", None) if response.stop_details else None
        raise ClaudeError(f"Claude declined the request: {detail or 'no detail'}")
    if response.stop_reason == "max_tokens":
        raise ClaudeError("Claude's response was cut off (max_tokens)")


# --- bill PDF extraction -------------------------------------------------------

BILL_SYSTEM = """You extract data from electric utility bills for an energy analysis tool.

Extract every electricity billing period in the document (some PDFs hold several months or meters).
Copy numbers exactly as printed; do not compute values that are not on the bill, except:
- period dates: use the service period / read dates, in ISO format.
- kwh: the billed consumption for the period (sum on-peak/off-peak/shoulder if only split values appear).
Leave a field null if the bill doesn't show it. Exclude gas, water, past-due balances and payments.
Record anything illegible, ambiguous or assumed in notes."""


def extract_bills_from_pdf(pdf_bytes: bytes, client: anthropic.Anthropic | None = None) -> BillExtraction:
    client = client or _client()
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=16000,
            system=BILL_SYSTEM,
            output_config={"effort": "medium"},
            output_format=BillExtraction,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": base64.standard_b64encode(pdf_bytes).decode(),
                            },
                        },
                        {"type": "text", "text": "Extract the billing data from this utility bill."},
                    ],
                }
            ],
            **_FALLBACK,
        )
    except anthropic.APIStatusError as e:
        raise ClaudeError(f"Claude API error {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise ClaudeError("Could not reach the Claude API") from e
    _check(response)
    if response.parsed_output is None:
        raise ClaudeError("Claude returned no structured bill data")
    return response.parsed_output


# --- report narrative ----------------------------------------------------------

STANDARD_STEPS: dict[str, list[str]] = {
    "baseload": [
        "Walk the building at night and list everything still running (lighting, AHUs, exhaust fans, process loads, plug loads).",
        "Put lighting and non-critical equipment on schedules or occupancy sensors.",
        "Use smart plugs / plug-load controllers for vending, printers and kitchen equipment.",
        "Re-check the overnight load after changes and lock the new level in as the target.",
    ],
    "after_hours_hvac": [
        "Compare BMS occupancy schedules with real building hours; remove overrides left on.",
        "Set unoccupied heating/cooling setbacks (e.g. 15 C heating / 29 C cooling).",
        "Use optimal start so equipment starts only as early as needed to reach setpoint at opening.",
        "Turn off AHUs and exhaust fans on weekends and holidays unless a zone needs them.",
    ],
    "demand_peaks": [
        "Stagger the morning start of chillers, AHUs and large motors by 10-15 minutes each.",
        "Set a demand limit in the BMS that sheds non-critical loads near the target kW.",
        "Move flexible loads (EV charging, pumping, batch processes) away from the peak window.",
    ],
    "drift": [
        "Check what changed around the onset date: new tenants or equipment, BMS changes, failed sensors.",
        "Look for overridden setpoints, stuck dampers or valves, simultaneous heating and cooling.",
        "Schedule a retro-commissioning visit for the systems that matter most.",
    ],
    "tariff_switch": [
        "Confirm eligibility for the recommended rate with the utility account representative.",
        "Check contract terms, minimum stays and any switching fees before requesting the change.",
        "Re-run this comparison after the first bill on the new rate.",
    ],
}

REPORT_SYSTEM = """You are an energy engineer writing for property owners and facility managers.

You receive waste findings computed by an analysis engine from a building's meter data, bills and weather.
Turn them into a ranked action list and a short executive summary.

Rules:
- The numbers in the findings are the only numbers you may use. Don't calculate new totals, percentages or
  costs, and don't round in a way that changes meaning. If a figure isn't in the data, say it qualitatively.
- Rank by what the owner should do first: weigh annual cost savings, payback, confidence and how easy the
  change is (schedule and setpoint changes before capital work).
- Explanations: 2-4 sentences, plain English, say what the data shows and why it is waste.
- Steps: 2-5 concrete actions for a facility manager. You may adapt the standard steps provided.
- Mention a finding's caveats when its confidence is low or it depends on assumptions the reader should check.
- Executive summary: 3-5 sentences, lead with the total opportunity and the top action."""


class NarrativeAction(BaseModel):
    finding_id: str
    title: str = Field(description="Short imperative action title")
    explanation: str
    steps: list[str]


class Narrative(BaseModel):
    executive_summary: str
    actions: list[NarrativeAction] = Field(description="In recommended order, most important first")


def write_narrative(
    site_context: dict, findings: list[Finding], client: anthropic.Anthropic | None = None
) -> tuple[Narrative, list[str]]:
    """Ask Claude for a ranked, explained action list. Returns the narrative
    and a list of warnings from the number check."""
    client = client or _client()
    payload = {
        "site": site_context,
        "findings": [f.model_dump(mode="json") for f in findings],
        "standard_steps": {f.type: STANDARD_STEPS[f.type] for f in findings},
    }
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=16000,
            system=REPORT_SYSTEM,
            output_config={"effort": "medium"},
            output_format=Narrative,
            messages=[{"role": "user", "content": json.dumps(payload, indent=1, default=str)}],
            **_FALLBACK,
        )
    except anthropic.APIStatusError as e:
        raise ClaudeError(f"Claude API error {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise ClaudeError("Could not reach the Claude API") from e
    _check(response)
    if response.parsed_output is None:
        raise ClaudeError("Claude returned no structured report")
    narrative = response.parsed_output
    return narrative, untraceable_numbers(narrative, payload)


# --- deterministic assembly -------------------------------------------------------


def template_narrative(findings: list[Finding]) -> Narrative:
    """Used when Claude is unavailable: rank by savings, explain with the
    finding's own summary."""
    ranked = rank_findings(findings)
    total_cost = sum(f.annual_cost_savings or 0 for f in ranked)
    total_kwh = sum(f.annual_kwh_savings for f in ranked)
    if ranked:
        head = (
            f"The analysis found {len(ranked)} savings opportunities worth about "
            + (f"${total_cost:,.0f}/yr" if total_cost else f"{total_kwh:,.0f} kWh/yr")
            + f". Start with: {ranked[0].title.lower()}."
        )
    else:
        head = "No significant waste was found in the analysis period."
    return Narrative(
        executive_summary=head,
        actions=[
            NarrativeAction(finding_id=f.id, title=f.title, explanation=f.summary, steps=STANDARD_STEPS[f.type])
            for f in ranked
        ],
    )


def rank_findings(findings: list[Finding]) -> list[Finding]:
    conf = {"high": 0, "medium": 1, "low": 2}
    return sorted(findings, key=lambda f: (-(f.annual_cost_savings or 0), -f.annual_kwh_savings, conf[f.confidence]))


def assemble_actions(narrative: Narrative, findings: list[Finding]) -> list[Action]:
    """Merge Claude's ranking/explanations with the computed numbers. Unknown
    ids are dropped; findings Claude left out are appended in default order."""
    by_id = {f.id: f for f in findings}
    seen: list[str] = []
    texts = {}
    for a in narrative.actions:
        if a.finding_id in by_id and a.finding_id not in seen:
            seen.append(a.finding_id)
            texts[a.finding_id] = a
    for f in rank_findings(findings):
        if f.id not in seen:
            seen.append(f.id)
            texts[f.id] = NarrativeAction(finding_id=f.id, title=f.title, explanation=f.summary, steps=STANDARD_STEPS[f.type])
    return [
        Action(
            rank=i + 1,
            finding_id=fid,
            title=texts[fid].title,
            explanation=texts[fid].explanation,
            steps=texts[fid].steps,
            annual_kwh_savings=by_id[fid].annual_kwh_savings,
            annual_cost_savings=by_id[fid].annual_cost_savings,
            implementation_cost=by_id[fid].implementation_cost,
            simple_payback_years=by_id[fid].simple_payback_years,
            confidence=by_id[fid].confidence,
        )
        for i, fid in enumerate(seen)
    ]


_NUM = re.compile(r"(?<![\w.])\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?")


def _numbers_in(obj) -> list[float]:
    out: list[float] = []
    if isinstance(obj, dict):
        for v in obj.values():
            out += _numbers_in(v)
    elif isinstance(obj, list):
        for v in obj:
            out += _numbers_in(v)
    elif isinstance(obj, bool):
        pass
    elif isinstance(obj, (int, float)):
        out.append(float(obj))
    elif isinstance(obj, str):
        out += [float(m.group(1).replace(",", "") + ("." + m.group(2) if m.group(2) else "")) for m in _NUM.finditer(obj)]
    return out


def untraceable_numbers(narrative: Narrative, payload: dict, min_value: float = 50) -> list[str]:
    """Figures >= min_value in Claude's prose that don't match (within 5%)
    any number in the data it was given, or a sum of findings."""
    known = _numbers_in(payload)
    findings = payload.get("findings", [])
    for key in ("annual_cost_savings", "annual_kwh_savings"):
        known.append(sum(f.get(key) or 0 for f in findings))
    text = narrative.model_dump()
    warnings = []
    for value in sorted(set(_numbers_in(text))):
        if value < min_value or 1900 <= value <= 2100:  # skip small counts and years
            continue
        if not any(abs(value - k) <= 0.05 * max(abs(k), 1) for k in known):
            warnings.append(f"Narrative figure {value:,.0f} could not be traced to the computed findings; check it.")
    return warnings
