import pytest

from energy_analyzer.context import SiteData
from energy_analyzer.findings import after_hours, baseload, demand, drift, tariff_switch
from energy_analyzer.pipeline import analyze, run_detectors
from energy_analyzer.sample_data import sample_building, sample_config

# Ground truth injected by sample_data.Waste() defaults, in the analysis year
# (second year), where drift scales everything by up to 12%.


def test_baseload_found_and_sized(wasteful_ctx):
    f = baseload.detect(wasteful_ctx)
    assert f is not None and f.confidence == "high"
    assert f.evidence["excess_kw"] == pytest.approx(8.0 * 1.06, rel=0.2)
    assert 30_000 < f.annual_kwh_savings < 55_000
    assert f.annual_cost_savings > 0


def test_after_hours_components(wasteful_ctx):
    f = after_hours.detect(wasteful_ctx)
    assert f is not None
    e = f.evidence
    assert e["effective_end"] == "21:00"  # 2 h creep past the 19:00 close
    assert e["cooling_kw_per_c"] == pytest.approx(1.2, rel=0.25)
    assert e["heating_kw_per_c"] == pytest.approx(1.0, rel=0.25)
    assert e["schedule_creep_kwh"] > 5_000
    assert e["unoccupied_day_operation_kwh"] == 0


def test_demand_peaks_attributed_to_startup(wasteful_ctx):
    f = demand.detect(wasteful_ctx)
    assert f is not None
    assert f.evidence["startup_window_share"] > 0.5
    assert f.evidence["avg_shave_kw"] > 40
    assert f.annual_kwh_savings == 0 and f.annual_cost_savings > 5_000


def test_drift_found(wasteful_ctx):
    f = drift.detect(wasteful_ctx)
    assert f is not None
    assert f.evidence["recent_excess_pct"] == pytest.approx(12, abs=2.5)


def test_tariff_switch_matches_bill_math(wasteful_ctx):
    f = tariff_switch.detect(wasteful_ctx)
    assert f is not None
    costs = {r["name"]: r["annual_cost"] for r in f.evidence["tariffs"]}
    assert f.annual_cost_savings == pytest.approx(costs["GS-TOU (current)"] - min(costs.values()))
    assert f.simple_payback_years is None or f.simple_payback_years == 0


def test_clean_building_has_no_waste_findings(clean_ctx):
    findings, warnings = run_detectors(clean_ctx)
    assert not warnings
    assert {f.type for f in findings} <= {"tariff_switch"}


def test_no_tariff_means_no_dollars(wasteful):
    kwh, temp = wasteful
    ctx = SiteData.build(sample_config(with_tariffs=False), kwh, temp)
    f = baseload.detect(ctx)
    assert f.annual_cost_savings is None and f.simple_payback_years is None
    assert demand.detect(ctx) is not None  # still reports kW when no tariff is known


def test_full_pipeline_template_report(wasteful):
    from energy_analyzer.report import to_markdown

    kwh, temp = wasteful
    r = analyze(sample_config(), temp, kwh, use_claude=False)
    assert r.narrative_source == "template"
    assert [a.rank for a in r.actions] == list(range(1, len(r.actions) + 1))
    assert {a.finding_id for a in r.actions} == {f.id for f in r.findings} == {
        "baseload", "after_hours_hvac", "demand_peaks", "drift", "tariff_switch"
    }
    md = to_markdown(r)
    assert "Ranked actions" in md and "ASHRAE Guideline 14" in md


def test_short_history_warns():
    kwh, temp = sample_building(days=120)
    r = analyze(sample_config(), temp, kwh, use_claude=False)
    assert any("extrapolated" in w for w in r.warnings)
    assert all(f.type != "drift" for f in r.findings)
