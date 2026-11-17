"""Integration tests: whole cycles against the simulator, including injected faults."""
from datetime import timedelta

import pytest

from bohio.actuation.modes import LiveNotAcknowledged, ProtectedPoint, write_setpoint
from bohio.adapters.base import PointRef
from bohio.audit import decision_rows
from bohio.control.base import ProposalOut
from bohio.control.rules import RuleBasedController
from bohio.cycle import SiteLoop
from bohio.models import ModeEvent, Override
from tests.conftest import make_cfg


def run(loop, sim, n):
    out = []
    for _ in range(n):
        out.append(loop.run_cycle()); sim.advance()
    return out


class Fixed:
    name = "fixed"
    def __init__(self, v): self.v = v
    def propose(self, state, cfg, hints=None): return {z.name: ProposalOut(z.name, self.v, "fixed", self.name) for z in cfg.zones}


class Boom:
    name = "boom"
    def propose(self, state, cfg, hints=None): raise RuntimeError("model server down")


# ---- modes ----
def test_shadow_logs_and_never_writes(loop_factory):
    loop, sim, s, cfg = loop_factory("shadow")
    res = run(loop, sim, 8)
    assert sim.writes == [] and sim.releases == []
    assert {z.outcome for r in res for z in r.zones} <= {"logged", "fallback"}


def test_advisory_recommends_and_never_writes(loop_factory):
    loop, sim, s, cfg = loop_factory("advisory")
    res = run(loop, sim, 8)
    assert sim.writes == []
    assert "recommended" in {z.outcome for r in res for z in r.zones}


def test_live_without_acknowledgement_refuses_to_start(loop_factory):
    with pytest.raises(LiveNotAcknowledged):
        loop_factory("live", live_ack=False)


def test_live_with_acknowledgement_writes_at_supervisory_priority(loop_factory):
    loop, sim, s, cfg = loop_factory("live", live_ack=True)
    run(loop, sim, 8)
    assert sim.writes and all(prio == cfg.supervisory_priority >= 10 for *_, prio in sim.writes)


def test_write_function_itself_refuses_outside_live_and_for_protected_points(loop_factory):
    loop, sim, s, cfg = loop_factory("shadow")
    pt = PointRef(1, "a", "setpoint", "x", writable=True)
    with pytest.raises(LiveNotAcknowledged):
        write_setpoint(sim, pt, 24.0, cfg, live_ack=True)            # mode is shadow
    live = make_cfg("live")
    with pytest.raises(LiveNotAcknowledged):
        write_setpoint(sim, pt, 24.0, live, live_ack=False)          # no flag
    for tag in ("life_safety", "fire", "smoke", "interlock"):
        with pytest.raises(ProtectedPoint):
            write_setpoint(sim, PointRef(2, "a", "setpoint", "fire_damper", writable=True, tags=(tag,)), 24.0, live, live_ack=True)


# ---- fallbacks ----
def test_garbage_controller_output_falls_back_to_schedule(loop_factory):
    for junk in ("hot", float("nan"), None, 99.0, [1, 2]):
        loop, sim, s, cfg = loop_factory("live", live_ack=True, controller=Fixed(junk))
        res = run(loop, sim, 2)
        assert all(z.outcome == "fallback" and z.applied == 26.0 for r in res for z in r.zones), junk   # 06:00 schedule = 26
        assert sim.writes == []


def test_controller_crash_falls_back_everywhere(loop_factory):
    loop, sim, s, cfg = loop_factory("live", live_ack=True, controller=Boom())
    res = run(loop, sim, 2)
    assert all(z.outcome == "fallback" for r in res for z in r.zones) and sim.writes == []


def test_stale_data_falls_back_and_releases_a_previous_write(loop_factory):
    loop, sim, s, cfg = loop_factory("live", live_ack=True)
    run(loop, sim, 4)
    assert "a" in loop.rt.last_written
    sim.freeze("a", "zone_temp")
    res = run(loop, sim, 4)                                    # frozen reading ages past 900 s
    late = [z for z in res[-1].zones if z.zone == "a"][0]
    assert late.outcome == "fallback" and "G1" in late.reason
    assert ("a" not in loop.rt.last_written) and any(z == "a" for _, z in sim.releases)
    assert sim.zones["a"].supervisory is None                  # the building's schedule is in charge again
    assert "b" in loop.rt.last_written                         # the other zone is unaffected


def test_missing_temperature_falls_back(loop_factory):
    loop, sim, s, cfg = loop_factory("shadow")
    sim.dropout.add(("a", "zone_temp"))
    z = [z for z in run(loop, sim, 1)[0].zones if z.zone == "a"][0]
    assert z.outcome == "fallback" and "G1" in z.reason


def test_implausible_sensor_value_falls_back(loop_factory):
    loop, sim, s, cfg = loop_factory("shadow")
    sim.raised[("a", "zone_temp")] = 85.0
    z = [z for z in run(loop, sim, 1)[0].zones if z.zone == "a"][0]
    assert z.outcome == "fallback" and "G2" in z.reason


def test_active_mode_event_stops_optimisation_in_that_zone_only(loop_factory):
    loop, sim, s, cfg = loop_factory("live", live_ack=True)
    run(loop, sim, 3)
    s.add(ModeEvent(site_id=loop.site_id, zone_id=loop.zone_ids["a"], ts=sim.now, kind="sandstorm", active=True)); s.commit()
    res = run(loop, sim, 1)[0]
    by = {z.zone: z for z in res.zones}
    assert by["a"].outcome == "fallback" and "G8" in by["a"].reason and "a" not in loop.rt.last_written
    assert by["b"].outcome == "applied"
    s.add(ModeEvent(site_id=loop.site_id, zone_id=loop.zone_ids["a"], ts=sim.now, kind="sandstorm", active=False)); s.commit()
    assert {z.zone: z for z in run(loop, sim, 1)[0].zones}["a"].outcome == "applied"      # clears when event ends


# ---- operator precedence ----
def test_operator_override_is_detected_and_respected_for_four_hours(loop_factory):
    loop, sim, s, cfg = loop_factory("live", live_ack=True)
    run(loop, sim, 4)
    sim.operator_set("a", 21.0)
    first = run(loop, sim, 1)[0]
    a = {z.zone: z for z in first.zones}["a"]
    assert a.outcome == "rejected" and "G13" in a.reason and a.applied == 21.0 and not a.written
    assert s.query(Override).count() == 1
    n_writes = len(sim.writes)
    res = run(loop, sim, 15)                                   # 3h45m later: still hands off, no repeat override rows
    assert all({z.zone: z for z in r.zones}["a"].outcome == "rejected" for r in res)
    assert all(zone != "a" for _, zone, *_ in sim.writes[n_writes:])
    assert sim.zones["a"].supervisory == 21.0 and s.query(Override).count() == 1
    run(loop, sim, 2)                                          # hold over (4 h): the agent may write again
    assert {z.zone: z for z in run(loop, sim, 1)[0].zones}["a"].outcome == "applied"
    assert s.query(Override).count() == 1                      # taking over again is not misread as a new override


def test_operator_reverting_to_schedule_clears_the_override(loop_factory):
    loop, sim, s, cfg = loop_factory("shadow")
    run(loop, sim, 2)
    sim.operator_set("a", 22.0); run(loop, sim, 1)
    assert s.query(Override).count() == 1
    sim.zones["a"].supervisory = None; run(loop, sim, 2)
    assert s.query(Override).count() == 1


# ---- audit ----
def test_every_zone_every_cycle_is_audited_with_check_detail(loop_factory):
    loop, sim, s, cfg = loop_factory("shadow")
    run(loop, sim, 5)
    rows = decision_rows(s, loop.site_id)
    assert len(rows) == 5 * 2
    assert all(r["mode"] == "shadow" and r["proposed"] is not None for r in rows)
    sim.raised[("a", "zone_temp")] = 85.0; run(loop, sim, 1)
    bad = decision_rows(s, loop.site_id, outcome="fallback", zone="a")
    assert bad and bad[-1]["failed"][0]["name"] == "G2 plausibility"


# ---- a whole simulated day ----
def test_simulated_day_live_is_safe_comfortable_and_fully_audited():
    from datetime import datetime
    from bohio.config import load_site
    from bohio.sim_day import run_day
    cfg = load_site("configs/demo_office.toml"); cfg.mode = "live"
    s, site, sim, loop = run_day(cfg, live_ack=True)
    rows = decision_rows(s, site.id)
    assert len(rows) == 96 * len(cfg.zones)
    assert sim.occupied_comfort_violations == 0
    assert all(22.0 <= w[2] <= 26.0 for w in sim.writes)                         # every write inside hard limits
    for z in cfg.zones:                                                          # rate limit holds between consecutive writes
        v = [w[2] for w in sim.writes if w[1] == z.name]
        assert all(abs(b - a) <= z.max_step_c + 1e-9 for a, b in zip(v, v[1:]))
    assert all(zn.supervisory is None for zn in sim.zones.values())               # released at the end of the day
    assert any(r["why"].startswith("vacancy") for r in rows)


def test_replay_of_csv_trend_log_is_read_only_and_works():
    from bohio.adapters.csv_replay import CSVReplayAdapter
    from bohio.db import make_session, seed_site
    from bohio.config import SiteConfig, ZoneConfig
    cfg = SiteConfig(name="csv", mode="shadow", zones=[ZoneConfig(name=n) for n in ("lobby", "office_north", "meeting_room")])
    s = make_session(); site = seed_site(s, cfg)
    ad = CSVReplayAdapter("data/sample_readings.csv")
    loop = SiteLoop(s, site.id, cfg, ad, RuleBasedController())
    n = 0
    while not ad.finished:
        res = loop.run_cycle(); ad.advance(); n += 1
    assert n >= 2 and len(decision_rows(s, site.id)) == n * 3
    with pytest.raises(RuntimeError):
        ad.write()
