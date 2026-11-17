from datetime import datetime, timedelta

import pytest

from bohio.config import ZoneConfig
from bohio.control.rules import RuleBasedController
from bohio.state.occupancy import estimate
from tests.conftest import make_cfg, make_state

T = datetime(2026, 7, 15, 10, 0)


def occ(btype, signal, last_activity, first_seen, hour=10.0, sensing="radar", ts=T):
    cfg = make_cfg(btype=btype)
    return estimate(cfg, ZoneConfig(name="a", occupancy_sensing=sensing), hour, ts, signal, last_activity, first_seen)


@pytest.mark.parametrize("btype,minutes,empty", [("office", 19, False), ("office", 20, True), ("apartment", 179, False),
                                                  ("apartment", 180, True), ("hotel", 30, True), ("villa", 719, False), ("villa", 720, True)])
def test_vacancy_thresholds_by_building_type(btype, minutes, empty):
    p, _ = occ(btype, 0.0, T - timedelta(minutes=minutes), T - timedelta(days=1))
    assert (p < 0.3) == empty


def test_activity_now_is_occupied_and_unknown_is_treated_as_possibly_occupied():
    assert occ("office", 1.0, None, T)[0] > 0.3
    assert occ("office", None, None, T)[0] > 0.3                      # sensor missing
    assert occ("office", 0.0, None, T, sensing="none")[0] > 0.3       # no sensing configured


def test_no_history_yet_cannot_claim_empty():
    assert occ("office", 0.0, None, T - timedelta(minutes=5))[0] > 0.3   # observed for 5 min only
    assert occ("office", 0.0, None, T - timedelta(minutes=30))[0] < 0.3


def test_retail_after_close_is_zero():
    assert occ("retail", 1.0, T, T, hour=22.0)[0] == 0.0


def test_rules_follow_schedule_setback_precool_and_floor():
    cfg, c = make_cfg(zones=("a",)), RuleBasedController()
    st = make_state(occupancy_prob=0.9)
    assert c.propose(st, cfg)["a"].value == 23.5
    st = make_state(occupancy_prob=0.1)
    assert c.propose(st, cfg)["a"].value == 25.0 and "vacancy" in c.propose(st, cfg)["a"].rationale
    st = make_state(occupancy_prob=0.1, in_scheduled_hours=False, schedule_c=26.0); st.hour = 6.0
    assert c.propose(st, cfg)["a"].value == 23.5                      # pre-cool 60 min before 07:00
    st = make_state(occupancy_prob=0.1, in_scheduled_hours=False, schedule_c=26.0); st.hour = 2.0
    assert c.propose(st, cfg)["a"].value == 26.0                      # night: schedule
    cfg2 = make_cfg(zones=("a",)); cfg2.zones[0].schedule.occupied_setpoint_c = 20.0
    st = make_state(schedule_c=20.0, occupancy_prob=0.9)
    assert c.propose(st, cfg2)["a"].value == 22.0                     # floor
