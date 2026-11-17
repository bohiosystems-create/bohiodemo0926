"""SimAdapter: a small deterministic RC building so the whole cycle runs with no hardware (§8.1).

This is a TOY model for developing and testing the loop. It is not evidence of savings; the
Sinergym/EnergyPlus wrapper arrives in Milestone 2. Fault hooks (dropout, freeze, operator_set,
raise_value) exist so tests can inject the failures the guardrails must survive.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta

from bohio.adapters.base import PointRef, RawReading, WritableAdapter, WriteResult
from bohio.config import SiteConfig

COP = 3.0
KP_KW_PER_K = 6.0


class _Zone:
    def __init__(self, cfg, t0: float):
        self.cfg, self.T = cfg, t0
        self.supervisory: float | None = None      # our written value (None = released)
        self.energy_kwh = 0.0
        self.last_activity: bool = False


class SimAdapter(WritableAdapter):
    def __init__(self, cfg: SiteConfig, start: datetime, seed: int = 7, vacancy: dict[str, list[tuple[float, float]]] | None = None):
        self.cfg, self.now, self.start = cfg, start, start
        self.rng = random.Random(seed)
        self.zones = {z.name: _Zone(z, 25.0) for z in cfg.zones}
        self.vacancy = vacancy if vacancy is not None else self._default_vacancy()
        self.dropout: set[tuple[str, str]] = set()        # (zone, quantity) omitted from reads
        self.frozen: dict[tuple[str, str], tuple[datetime, float]] = {}   # stale: old ts, old value
        self.raised: dict[tuple[str, str], float] = {}    # force a reading value (e.g. absurd temp)
        self.writes: list[tuple[datetime, str, float, int]] = []
        self.releases: list[tuple[datetime, str]] = []
        self.occupied_comfort_violations = 0
        self.occupied_steps = 0

    # ----- scenario -----
    def _default_vacancy(self):
        """Seeded empty blocks (hours) inside working hours: lunch for all, plus a longer one per zone."""
        out = {}
        for z in self.cfg.zones:
            a = self.rng.choice([9.0, 10.0, 14.0, 15.0])
            out[z.name] = [(12.0, 13.0), (a, a + 2.0)]
        return out

    def occupied(self, zone: str, ts: datetime | None = None) -> bool:
        ts = ts or self.now
        h = ts.hour + ts.minute / 60
        sc = self.zones[zone].cfg.schedule
        if not (sc.occupied_start_h + 0.5 <= h < sc.occupied_end_h - 0.5):
            return False
        return not any(a <= h < b for a, b in self.vacancy.get(zone, []))

    def outdoor(self, ts: datetime | None = None) -> float:
        ts = ts or self.now
        h = ts.hour + ts.minute / 60
        return 38.0 + 6.0 * math.sin((h - 9.0) / 24 * 2 * math.pi)       # 32 to 44 C, peak ~15:00

    def effective_setpoint(self, zone: str) -> float:
        z = self.zones[zone]
        if z.supervisory is not None:
            return z.supervisory
        return z.cfg.schedule.setpoint_at(self.now.hour + self.now.minute / 60)

    # ----- physics -----
    def advance(self, minutes: int | None = None) -> None:
        minutes = minutes or self.cfg.cycle_minutes
        for _ in range(minutes):
            h = self.now.hour + self.now.minute / 60
            to, solar = self.outdoor(), 1.0 * max(0.0, math.sin((h - 6) / 12 * math.pi))
            for name, z in self.zones.items():
                c = z.cfg
                occ = self.occupied(name)
                q_int = 0.4 + (c.sim_occupant_gain_kw if occ else 0.0) + solar
                q_cool = min(max(KP_KW_PER_K * (z.T - self.effective_setpoint(name)), 0.0), c.sim_capacity_kw)
                dT = (c.sim_ua_kw_per_k * (to - z.T) + q_int - q_cool) / c.sim_heat_capacity_kwh_per_k / 60
                z.T += dT
                z.energy_kwh += q_cool / COP / 60
                z.last_activity = occ
                if occ:
                    self.occupied_steps += 1
                    if z.T > c.comfort_max_c + 0.5:
                        self.occupied_comfort_violations += 1
            self.now += timedelta(minutes=1)

    @property
    def finished(self) -> bool:
        return self.now >= self.start + timedelta(days=1)

    def total_energy_kwh(self) -> float:
        return sum(z.energy_kwh for z in self.zones.values())

    # ----- SourceAdapter -----
    def read(self, points: list[PointRef]) -> list[RawReading]:
        out = []
        for p in points:
            key = (p.zone or "", p.quantity)
            if key in self.dropout:
                continue
            if key in self.frozen:
                ts, v = self.frozen[key]
                out.append(RawReading(p, ts, v)); continue
            if key in self.raised:
                out.append(RawReading(p, self.now, self.raised[key])); continue
            if p.quantity == "outdoor_temp":
                v = self.outdoor()
            elif p.zone in self.zones:
                z = self.zones[p.zone]
                v = {"zone_temp": z.T, "setpoint": self.effective_setpoint(p.zone),
                     "occupancy": 1.0 if self.occupied(p.zone) else 0.0, "energy": z.energy_kwh}.get(p.quantity)
            else:
                v = None
            if v is not None:
                out.append(RawReading(p, self.now, round(v, 3)))
        return out

    # ----- WritableAdapter -----
    def write(self, point: PointRef, value: float, priority: int) -> WriteResult:
        if not point.writable or point.zone not in self.zones:
            return WriteResult(False, "not writable")
        self.zones[point.zone].supervisory = float(value)
        self.writes.append((self.now, point.zone, float(value), priority))
        return WriteResult(True)

    def release(self, point: PointRef, priority: int) -> WriteResult:
        if point.zone in self.zones:
            self.zones[point.zone].supervisory = None
            self.releases.append((self.now, point.zone))
        return WriteResult(True)

    # ----- fault hooks -----
    def operator_set(self, zone: str, value: float) -> None:
        """An operator changes the setpoint at the device; indistinguishable from our own write except by value."""
        self.zones[zone].supervisory = value

    def freeze(self, zone: str, quantity: str) -> None:
        r = self.read([PointRef(0, zone, quantity)])
        if r:
            self.frozen[(zone, quantity)] = (r[0].ts, r[0].value)
