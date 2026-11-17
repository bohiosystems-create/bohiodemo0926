"""State builder (§5 steps 1-6): collect, clean, align, history, context, package."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from bohio.adapters.base import PointRef, RawReading, SourceAdapter
from bohio.config import SiteConfig
from bohio.models import ModeEvent, Point, Reading, Zone
from bohio.state.occupancy import estimate
from bohio.state.types import ActiveEvent, NumericState, ZoneState


@dataclass
class SiteRuntime:
    """In-memory memory of the control loop for one site. Survives between cycles, not restarts."""
    last_applied: dict[str, float] = field(default_factory=dict)
    last_written: dict[str, float] = field(default_factory=dict)
    override_hold: dict[str, datetime] = field(default_factory=dict)
    last_activity: dict[str, datetime] = field(default_factory=dict)
    first_seen: datetime | None = None
    history: dict[str, deque] = field(default_factory=dict)
    step: int = 0


def load_points(s: Session, site_id: int) -> tuple[list[PointRef], dict[int, int | None], dict[str, int]]:
    zones = {z.id: z.name for z in s.scalars(select(Zone).where(Zone.site_id == site_id))}
    refs, zone_of = [], {}
    for p in s.scalars(select(Point).where(Point.site_id == site_id)):
        refs.append(PointRef(p.id, zones.get(p.zone_id), p.quantity, p.raw_name, p.writable, tuple(p.tags or [])))
        zone_of[p.id] = p.zone_id
    return refs, zone_of, {v: k for k, v in zones.items()}


def collect(adapter: SourceAdapter, points: list[PointRef]) -> list[RawReading]:
    try:
        return adapter.read(points)
    except Exception:          # a failing source is missing data, never a crash (P6)
        return []


def clean(raw: list[RawReading], cfg: SiteConfig, now: datetime) -> list[RawReading]:
    lo, hi = cfg.plausible_temp_c
    for r in raw:
        if r.value is None:
            r.quality = "missing"
        elif r.point.quantity in ("zone_temp", "outdoor_temp", "setpoint") and not (lo <= r.value <= hi):
            r.quality = "suspect"
        elif (now - r.ts).total_seconds() > cfg.stale_after_s:
            r.quality = "stale"
    return raw


def align(raw: list[RawReading]) -> dict[tuple[str | None, str], RawReading]:
    return {(r.point.zone, r.point.quantity): r for r in raw}


def active_events(s: Session, site_id: int, now: datetime, zone_names: dict[int, str]) -> list[ActiveEvent]:
    latest: dict[tuple, ModeEvent] = {}
    for e in s.scalars(select(ModeEvent).where(ModeEvent.site_id == site_id, ModeEvent.ts <= now).order_by(ModeEvent.ts, ModeEvent.id)):
        latest[(e.kind, e.zone_id)] = e
    return [ActiveEvent(e.kind, zone_names.get(e.zone_id)) for e in latest.values() if e.active]


def build_state(s: Session, site_id: int, cfg: SiteConfig, rt: SiteRuntime, adapter: SourceAdapter,
                points: list[PointRef], now: datetime) -> tuple[NumericState, list[RawReading]]:
    raw = clean(collect(adapter, points), cfg, now)
    got = align(raw)
    hour = now.hour + now.minute / 60
    rt.first_seen = rt.first_seen or now
    zone_names = {z.id: z.name for z in s.scalars(select(Zone).where(Zone.site_id == site_id))}
    zones: dict[str, ZoneState] = {}
    for zc in cfg.zones:
        t, sp, oc = got.get((zc.name, "zone_temp")), got.get((zc.name, "setpoint")), got.get((zc.name, "occupancy"))
        signal = oc.value if oc and oc.quality == "ok" else None
        if signal and signal > 0:
            rt.last_activity[zc.name] = now
        prob, why = estimate(cfg, zc, hour, now, signal, rt.last_activity.get(zc.name), rt.first_seen)
        hold = rt.override_hold.get(zc.name)
        zones[zc.name] = ZoneState(
            name=zc.name, temp_c=t.value if t else None,
            temp_age_s=(now - t.ts).total_seconds() if t else None,
            temp_quality=t.quality if t else "missing",
            setpoint_c=sp.value if sp and sp.quality != "missing" else None,
            schedule_c=zc.schedule.setpoint_at(hour), occupancy_prob=prob, occupancy_evidence=why,
            in_scheduled_hours=zc.schedule.occupied_start_h <= hour < zc.schedule.occupied_end_h,
            override_hold_until=hold if hold and hold > now else None,
            last_applied_c=rt.last_applied.get(zc.name))
        dq = rt.history.setdefault(zc.name, deque(maxlen=int(cfg.history_hours * 60 / cfg.cycle_minutes)))
        dq.append({"ts": now.isoformat(), "temp_c": zones[zc.name].temp_c, "setpoint_c": zones[zc.name].setpoint_c, "occ": prob})
    out = got.get((None, "outdoor_temp"))
    state = NumericState(step=rt.step, ts=now, hour=hour, outdoor_c=out.value if out else None, zones=zones,
                         events=active_events(s, site_id, now, zone_names),
                         history={k: list(v) for k, v in rt.history.items()})
    return state, raw


def store_readings(s: Session, raw: list[RawReading]) -> None:
    s.add_all(Reading(point_id=r.point.id, ts=r.ts, value=r.value, quality=r.quality) for r in raw)
