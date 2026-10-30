"""Claude integration, tested with a fake client (no network)."""

from datetime import date
from types import SimpleNamespace

import pytest

from energy_analyzer import llm
from energy_analyzer.bills import Bill, BillExtraction
from energy_analyzer.models import Finding


class FakeClient:
    def __init__(self, parsed, stop_reason="end_turn"):
        self.calls = []
        response = SimpleNamespace(parsed_output=parsed, stop_reason=stop_reason, stop_details=None)
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=lambda **kw: self.calls.append(kw) or response))


def _finding(id_, type_, kwh, cost, evidence):
    return Finding(
        id=id_, type=type_, title=id_, summary=f"{id_} summary", annual_kwh_savings=kwh,
        annual_cost_savings=cost, implementation_cost=1000.0, confidence="high",
        evidence=evidence,
    )


FINDINGS = [
    _finding("baseload", "baseload", 41588, 4575, {"excess_kw": 7.9}),
    _finding("demand_peaks", "demand_peaks", 0, 12061, {"avg_shave_kw": 58.0}),
]


def test_bill_extraction_request_shape():
    extraction = BillExtraction(
        bills=[Bill(period_start=date(2024, 1, 3), period_end=date(2024, 2, 1), kwh=41000, total_charges=6100)]
    )
    client = FakeClient(extraction)
    out = llm.extract_bills_from_pdf(b"%PDF-1.4 fake", client=client)
    assert out.bills[0].kwh == 41000
    call = client.calls[0]
    assert call["model"] == llm.MODEL
    assert call["output_format"] is BillExtraction
    assert call["fallbacks"] == "default"
    doc = call["messages"][0]["content"][0]
    assert doc["type"] == "document" and doc["source"]["media_type"] == "application/pdf"


def test_refusal_raises():
    with pytest.raises(llm.ClaudeError):
        llm.extract_bills_from_pdf(b"%PDF", client=FakeClient(None, stop_reason="refusal"))


def test_claude_ranking_is_used_but_numbers_come_from_findings():
    narrative = llm.Narrative(
        executive_summary="About $16,636/yr is available. Start by staggering the morning start-up.",
        actions=[
            llm.NarrativeAction(finding_id="demand_peaks", title="Stagger start-up", explanation="Peaks of 58 kW...", steps=["a"]),
            llm.NarrativeAction(finding_id="made_up", title="Invented", explanation="x", steps=[]),
            llm.NarrativeAction(finding_id="baseload", title="Cut night load", explanation="Saves 41,588 kWh", steps=["b"]),
        ],
    )
    client = FakeClient(narrative)
    out, warnings = llm.write_narrative({"name": "x"}, FINDINGS, client=client)
    actions = llm.assemble_actions(out, FINDINGS)
    assert [a.finding_id for a in actions] == ["demand_peaks", "baseload"]  # Claude's order, invented id dropped
    assert actions[0].annual_cost_savings == 12061  # numbers from the finding
    # 58 kW comes from the evidence and $16,636 is the sum of the findings: both traceable.
    assert warnings == []


def test_untraceable_number_is_flagged():
    narrative = llm.Narrative(
        executive_summary="This saves $99,999 a year.",
        actions=[llm.NarrativeAction(finding_id="baseload", title="t", explanation="41,588 kWh", steps=[])],
    )
    payload = {"findings": [f.model_dump(mode="json") for f in FINDINGS]}
    warnings = llm.untraceable_numbers(narrative, payload)
    assert len(warnings) == 1 and "99,999" in warnings[0]


def test_missing_findings_are_appended():
    narrative = llm.Narrative(
        executive_summary="s",
        actions=[llm.NarrativeAction(finding_id="baseload", title="t", explanation="e", steps=[])],
    )
    actions = llm.assemble_actions(narrative, FINDINGS)
    assert [a.finding_id for a in actions] == ["baseload", "demand_peaks"]


def test_pipeline_falls_back_to_template_on_claude_error(monkeypatch, wasteful):
    from energy_analyzer.pipeline import analyze
    from energy_analyzer.sample_data import sample_config

    def boom(*a, **k):
        raise llm.ClaudeError("Claude API error 529: overloaded")

    monkeypatch.setattr(llm, "write_narrative", boom)
    kwh, temp = wasteful
    r = analyze(sample_config(), temp, kwh, use_claude=True)
    assert r.narrative_source == "template"
    assert any("overloaded" in w for w in r.warnings)
