"""The control cycle (§5): collect, clean, align, history, context, package, decide, check, act, log."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from bohio.actuation.modes import assert_live_allowed, release_point, write_setpoint
from bohio.config import SiteConfig
from bohio.control.base import Controller, ProposalOut
from bohio.guardrails.checks import run_guardrails
from bohio.models import Decision, Override, Proposal
from bohio.state.builder import SiteRuntime, build_state, load_points, store_readings

CYCLE_TIMEOUT_S = 60.0
OVERRIDE_TOL_C = 0.05


@dataclass
class ZoneOutcome:
    zone: str
    proposed: object
    applied: float
    outcome: str            # applied|recommended|logged|fallback|rejected
    written: bool
    reason: str
    checks: list = field(default_factory=list)


@dataclass
class CycleResult:
    ts: datetime
    zones: list[ZoneOutcome]
    notes: list[str] = field(default_factory=list)


class SiteLoop:
    """Everything one site needs to run cycles. Refuses to exist in live mode without the live acknowledgement."""

    def __init__(self, session: Session, site_id: int, cfg: SiteConfig, adapter, controller: Controller, live_ack: bool = False):
        assert_live_allowed(cfg.mode, live_ack)
        self.s, self.site_id, self.cfg, self.adapter, self.controller, self.live_ack = session, site_id, cfg, adapter, controller, live_ack
        self.rt = SiteRuntime()
        self.points, _, self.zone_ids = load_points(session, site_id)
        self.setpoint_pt = {p.zone: p for p in self.points if p.quantity == "setpoint"}
        self.override_value: dict[str, float] = {}

    # ---- override detection (G13 input) ----
    def _detect_overrides(self, state, now: datetime) -> None:
        for name, z in state.zones.items():
            obs = z.setpoint_c
            if obs is None:
                continue
            if name in self.override_value and abs(obs - z.schedule_c) <= OVERRIDE_TOL_C:
                self.override_value.pop(name)                      # operator reverted to the schedule
            expected = self.override_value.get(name, self.rt.last_written.get(name, z.schedule_c))
            if abs(obs - expected) > OVERRIDE_TOL_C:
                self.s.add(Override(point_id=self.setpoint_pt[name].id, zone_id=self.zone_ids[name], ts=now,
                                    previous=expected, new=obs, source="unknown"))
                self.override_value[name] = obs
                self.rt.override_hold[name] = now + timedelta(hours=self.cfg.override_hold_h)
                self.rt.last_written.pop(name, None)
                z.override_hold_until = self.rt.override_hold[name]

    def _propose(self, state) -> dict[str, ProposalOut]:
        ex = ThreadPoolExecutor(max_workers=1)
        try:
            return ex.submit(self.controller.propose, state, self.cfg, None).result(timeout=CYCLE_TIMEOUT_S)
        except (FuturesTimeout, Exception) as e:      # controller failure -> every zone falls back (P6)
            msg = f"controller {type(e).__name__}: {e}"[:200]
            return {zc.name: ProposalOut(zc.name, None, msg, getattr(self.controller, "name", "?")) for zc in self.cfg.zones}
        finally:
            ex.shutdown(wait=False)

    def run_cycle(self) -> CycleResult:
        now: datetime = self.adapter.now
        state, raw = build_state(self.s, self.site_id, self.cfg, self.rt, self.adapter, self.points, now)
        store_readings(self.s, raw)
        self._detect_overrides(state, now)
        for name, z in state.zones.items():
            z.last_applied_c = self.rt.last_applied.get(name)
        proposals = self._propose(state)
        out, mode = [], self.cfg.mode
        for zc in self.cfg.zones:
            p = proposals.get(zc.name) or ProposalOut(zc.name, None, "controller returned nothing for this zone", self.controller.name)
            g = run_guardrails(p, state, self.cfg)
            written, detail = False, ""
            if g.no_write:
                outcome = "rejected"
            elif g.fallback:
                outcome = "fallback"
                if mode == "live" and zc.name in self.rt.last_written:      # hand control back to the BMS schedule
                    release_point(self.adapter, self.setpoint_pt[zc.name], self.cfg, self.live_ack)
                    self.rt.last_written.pop(zc.name, None); detail = " (released to schedule)"
            elif mode == "advisory":
                outcome = "recommended"
            elif mode == "shadow":
                outcome = "logged"
            else:
                res = write_setpoint(self.adapter, self.setpoint_pt[zc.name], g.applied, self.cfg, self.live_ack)
                written, outcome = res.ok, "applied" if res.ok else "fallback"
                if res.ok:
                    self.rt.last_written[zc.name] = g.applied
                    self.override_value.pop(zc.name, None)
            self.rt.last_applied[zc.name] = g.applied
            prop = Proposal(site_id=self.site_id, zone_id=self.zone_ids[zc.name], ts=now, controller=p.controller,
                            proposed_value=float(p.value) if isinstance(p.value, (int, float)) and not isinstance(p.value, bool) and p.value == p.value and abs(p.value) != float("inf") else None,
                            raw_value=repr(p.value)[:80], rationale_text=p.rationale, llm_used=p.llm_used)
            prop.decision = Decision(checks=[r.as_dict() for r in g.results], applied_value=g.applied, outcome=outcome,
                                     mode=mode, written=written)
            self.s.add(prop)
            out.append(ZoneOutcome(zc.name, p.value, g.applied, outcome, written, g.reason + detail, [r.as_dict() for r in g.results]))
        self.rt.step += 1
        self.s.commit()
        return CycleResult(now, out)

    def release_all(self) -> int:
        """Hand every written point back to the building's own schedule. Used at shutdown and by the dashboard button."""
        n = 0
        if self.cfg.mode == "live":
            for name in list(self.rt.last_written):
                release_point(self.adapter, self.setpoint_pt[name], self.cfg, self.live_ack); n += 1
            self.rt.last_written.clear()
        return n
