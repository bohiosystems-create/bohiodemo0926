"""Guardrails (§6). Each check is a pure function (proposal, state, cfg) -> CheckResult.

kind 'soft'  : corrects the value (clamp, rate limit) and the chain continues with the corrected value.
kind 'hard'  : the proposal is discarded and replaced by the building's own schedule setpoint
               (or, for G13, the operator's value, and nothing is written).
Implemented in Milestone 1: G1 G2 G3 G4 G5 G8 G9 G13. Later: G6 G7 (M6), G10 (M3), G11 (M6), G12 (M5/M6).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import Callable

from bohio.config import SiteConfig
from bohio.control.base import ProposalOut
from bohio.state.types import NumericState

LOWEST_PLAUSIBLE_SETPOINT_C = 10.0
HIGHEST_PLAUSIBLE_SETPOINT_C = 40.0     # above this a cooling setpoint looks like degrees Fahrenheit


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str
    kind: str = "hard"                  # hard|soft
    replacement: float | None = None
    no_write: bool = False

    def as_dict(self) -> dict:
        return {"name": self.name, "passed": self.passed, "detail": self.detail}


def _ok(name: str, detail: str = "ok", kind: str = "hard") -> CheckResult:
    return CheckResult(name, True, detail, kind)


def g1_freshness(p: ProposalOut, st: NumericState, cfg: SiteConfig) -> CheckResult:
    z = st.zones[p.zone]
    if z.temp_age_s is None or z.temp_c is None:
        return CheckResult("G1 freshness", False, "no zone temperature reading")
    if z.temp_age_s > cfg.stale_after_s or z.temp_quality == "stale":
        return CheckResult("G1 freshness", False, f"reading is {z.temp_age_s:.0f}s old (limit {cfg.stale_after_s:.0f}s)")
    return _ok("G1 freshness")


def g2_plausibility(p: ProposalOut, st: NumericState, cfg: SiteConfig) -> CheckResult:
    z, (lo, hi) = st.zones[p.zone], cfg.plausible_temp_c
    if z.temp_quality == "suspect" or (z.temp_c is not None and not lo <= z.temp_c <= hi):
        return CheckResult("G2 plausibility", False, f"zone temperature {z.temp_c} C outside {lo}-{hi} C or flagged suspect")
    return _ok("G2 plausibility")


def g3_schema(p: ProposalOut, st: NumericState, cfg: SiteConfig) -> CheckResult:
    v = p.value
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return CheckResult("G3 schema", False, f"not a number: {type(v).__name__} {str(v)[:30]!r}")
    if not math.isfinite(v):
        return CheckResult("G3 schema", False, "value is NaN or infinite")
    if v > HIGHEST_PLAUSIBLE_SETPOINT_C:
        return CheckResult("G3 schema", False, f"{v} looks like degrees Fahrenheit, expected C (max {HIGHEST_PLAUSIBLE_SETPOINT_C})")
    if v < LOWEST_PLAUSIBLE_SETPOINT_C:
        return CheckResult("G3 schema", False, f"{v} C is below the plausible minimum {LOWEST_PLAUSIBLE_SETPOINT_C}")
    return _ok("G3 schema")


def g4_hard_limits(p: ProposalOut, st: NumericState, cfg: SiteConfig) -> CheckResult:
    zc = cfg.zone(p.zone)
    v = min(max(float(p.value), zc.comfort_min_c), zc.comfort_max_c)
    if v != p.value:
        return CheckResult("G4 hard limits", False, f"{p.value} clamped to {v} (limits {zc.comfort_min_c}-{zc.comfort_max_c} C)", "soft", v)
    return _ok("G4 hard limits", kind="soft")


def g5_rate(p: ProposalOut, st: NumericState, cfg: SiteConfig) -> CheckResult:
    z, zc = st.zones[p.zone], cfg.zone(p.zone)
    prev = z.last_applied_c if z.last_applied_c is not None else z.schedule_c
    d = float(p.value) - prev
    if abs(d) > zc.max_step_c + 1e-9:
        v = round(prev + math.copysign(zc.max_step_c, d), 2)
        return CheckResult("G5 rate of change", False, f"{p.value} is {abs(d):.2f} C from {prev}; limited to {v} (max {zc.max_step_c} C/cycle)", "soft", v)
    return _ok("G5 rate of change", kind="soft")


def g8_modes(p: ProposalOut, st: NumericState, cfg: SiteConfig) -> CheckResult:
    ev = st.events_for(p.zone)
    if ev:
        return CheckResult("G8 mode and alarms", False, "active: " + ", ".join(e.kind for e in ev) + "; released to schedule")
    return _ok("G8 mode and alarms")


def g9_occupancy(p: ProposalOut, st: NumericState, cfg: SiteConfig) -> CheckResult:
    z = st.zones[p.zone]
    wanted = p.intent if p.intent is not None else p.value      # judge the controller's intent, not a rate-limited step on the way back
    if z.occupancy_prob > cfg.occupied_prob_guard and float(wanted) > z.schedule_c + 1e-9:
        return CheckResult("G9 occupancy", False, f"set-back refused: occupancy probability {z.occupancy_prob:.2f} > {cfg.occupied_prob_guard}")
    return _ok("G9 occupancy")


def g13_operator(p: ProposalOut, st: NumericState, cfg: SiteConfig) -> CheckResult:
    z = st.zones[p.zone]
    if z.override_hold_until is not None:
        return CheckResult("G13 operator precedence", False, f"operator override: hands off until {z.override_hold_until:%H:%M}",
                           replacement=z.setpoint_c, no_write=True)
    return _ok("G13 operator precedence")


CHECKS: list[Callable[[ProposalOut, NumericState, SiteConfig], CheckResult]] = [
    g1_freshness, g2_plausibility, g3_schema, g4_hard_limits, g5_rate, g8_modes, g9_occupancy, g13_operator]


@dataclass
class GuardResult:
    applied: float
    results: list[CheckResult]
    fallback: bool = False          # a hard check failed: schedule value used
    no_write: bool = False          # operator precedence: do not touch the device

    @property
    def reason(self) -> str:
        bad = [r for r in self.results if not r.passed]
        return "; ".join(f"{r.name}: {r.detail}" for r in bad) or "ok"


def run_guardrails(p: ProposalOut, st: NumericState, cfg: SiteConfig) -> GuardResult:
    """Run every check in order. First hard failure ends the chain with the fallback value."""
    z = st.zones[p.zone]
    cur, results = replace(p, intent=p.value), []
    for check in CHECKS:
        r = check(cur, st, cfg)
        results.append(r)
        if r.passed:
            continue
        if r.kind == "soft":
            cur = replace(cur, value=r.replacement)
            continue
        value = r.replacement if r.replacement is not None else z.schedule_c
        return GuardResult(round(value, 2), results, fallback=True, no_write=r.no_write)
    return GuardResult(round(float(cur.value), 2), results)
