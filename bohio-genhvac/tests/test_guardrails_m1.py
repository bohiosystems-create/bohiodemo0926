"""One pass and one fail per guardrail (G1-G5, G8, G9, G13), plus chain behaviour."""
from datetime import timedelta

import pytest

from bohio.control.base import ProposalOut
from bohio.guardrails import checks as C
from bohio.state.types import ActiveEvent
from tests.conftest import T0, make_cfg, make_state

CFG = make_cfg()


def P(v, zone="a"):
    return ProposalOut(zone, v, "", "test")


def test_g1_fresh_passes_stale_fails_missing_fails():
    assert C.g1_freshness(P(24), make_state(temp_age_s=100), CFG).passed
    r = C.g1_freshness(P(24), make_state(temp_age_s=901), CFG)
    assert not r.passed and "901" in r.detail
    assert not C.g1_freshness(P(24), make_state(temp_c=None, temp_age_s=None, temp_quality="missing"), CFG).passed


def test_g2_plausible_passes_suspect_and_out_of_range_fail():
    assert C.g2_plausibility(P(24), make_state(), CFG).passed
    assert not C.g2_plausibility(P(24), make_state(temp_c=55.0), CFG).passed
    assert not C.g2_plausibility(P(24), make_state(temp_c=2.0), CFG).passed
    assert not C.g2_plausibility(P(24), make_state(temp_quality="suspect"), CFG).passed


@pytest.mark.parametrize("v", [24.0, 24, 22, 40.0])
def test_g3_accepts_numbers(v):
    assert C.g3_schema(P(v), make_state(), CFG).passed


@pytest.mark.parametrize("v", ["24", None, float("nan"), float("inf"), True, 75.0, 3.0, [24.0], {"v": 24}])
def test_g3_rejects_junk_nan_fahrenheit_and_non_numbers(v):
    assert not C.g3_schema(P(v), make_state(), CFG).passed


def test_g4_clamps_both_sides_and_passes_inside():
    assert C.g4_hard_limits(P(24), make_state(), CFG).passed
    hi, lo = C.g4_hard_limits(P(28), make_state(), CFG), C.g4_hard_limits(P(18), make_state(), CFG)
    assert (hi.passed, hi.replacement, hi.kind) == (False, 26.0, "soft")
    assert (lo.passed, lo.replacement) == (False, 22.0)


def test_g5_limits_step_against_last_applied_else_schedule():
    st = make_state(last_applied_c=24.0)
    assert C.g5_rate(P(24.5), st, CFG).passed
    r = C.g5_rate(P(26.0), st, CFG)
    assert (r.passed, r.replacement) == (False, 24.5)
    assert C.g5_rate(P(22.0), st, CFG).replacement == 23.5
    # no history: schedule (23.5) is the reference
    assert C.g5_rate(P(25.0), make_state(), CFG).replacement == 24.0


@pytest.mark.parametrize("kind", ["fire", "smoke", "sandstorm", "outside_air_closed", "maintenance", "alarm", "equipment_fault"])
def test_g8_any_active_event_blocks_that_zone(kind):
    st = make_state(); st.events = [ActiveEvent(kind, "a")]
    assert not C.g8_modes(P(24), st, CFG).passed
    st.events = [ActiveEvent(kind, "other")]
    assert C.g8_modes(P(24), st, CFG).passed
    st.events = [ActiveEvent(kind, None)]          # site-wide
    assert not C.g8_modes(P(24), st, CFG).passed


def test_g9_refuses_setback_of_possibly_occupied_zone_but_allows_more_cooling():
    occ = make_state(occupancy_prob=0.9)
    assert not C.g9_occupancy(P(25.0), occ, CFG).passed
    assert C.g9_occupancy(P(23.0), occ, CFG).passed        # cooler than schedule is not a setback
    assert C.g9_occupancy(P(25.0), make_state(occupancy_prob=0.1), CFG).passed
    assert not C.g9_occupancy(P(25.0), make_state(occupancy_prob=0.31), CFG).passed
    assert C.g9_occupancy(P(25.0), make_state(occupancy_prob=0.3), CFG).passed


def test_g13_operator_override_blocks_writes_and_keeps_operator_value():
    assert C.g13_operator(P(24), make_state(), CFG).passed
    r = C.g13_operator(P(24), make_state(override_hold_until=T0 + timedelta(hours=3), setpoint_c=21.0), CFG)
    assert not r.passed and r.no_write and r.replacement == 21.0


# ---- chain ----
def test_chain_good_proposal_passes_everything():
    g = C.run_guardrails(P(23.5), make_state(), CFG)
    assert (g.applied, g.fallback) == (23.5, False) and all(r.passed for r in g.results)


def test_chain_soft_corrections_stack_clamp_then_rate():
    g = C.run_guardrails(P(30.0), make_state(last_applied_c=25.0), CFG)       # 40 limit passes G3; clamp 26; rate 25.5
    assert g.applied == 25.5 and not g.fallback
    assert [r.name for r in g.results if not r.passed] == ["G4 hard limits", "G5 rate of change"]


def test_chain_hard_failure_uses_schedule_and_stops():
    g = C.run_guardrails(P("hello"), make_state(schedule_c=23.0), CFG)
    assert g.fallback and g.applied == 23.0 and len(g.results) == 3          # stopped at G3


def test_chain_stale_data_falls_back_even_for_a_good_value():
    g = C.run_guardrails(P(24.0), make_state(temp_age_s=5000, schedule_c=23.5), CFG)
    assert g.fallback and g.applied == 23.5 and g.results[0].name == "G1 freshness"


def test_chain_override_hold_is_no_write_with_operator_value():
    g = C.run_guardrails(P(24.0), make_state(override_hold_until=T0 + timedelta(hours=1), setpoint_c=20.5), CFG)
    assert g.fallback and g.no_write and g.applied == 20.5


def test_regression_gradual_return_to_schedule_is_not_mistaken_for_a_setback():
    """People return: controller proposes the cooler schedule value; G5 limits the step. The limited value is still
    warmer than schedule but is NOT a set-back, so G9 must not fire and force a 1.5 C jump."""
    st = make_state(occupancy_prob=0.9, last_applied_c=25.0, schedule_c=23.5)
    g = C.run_guardrails(P(23.5), st, CFG)
    assert (g.applied, g.fallback) == (24.5, False)
    # a genuine set-back of an occupied zone is still refused
    assert C.run_guardrails(P(25.0), st, CFG).fallback
