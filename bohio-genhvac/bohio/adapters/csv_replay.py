"""CSVReplayAdapter: replays a BMS trend-log CSV (timestamp,zone,temp_c,schedule_setpoint_c,outdoor_c). Read-only."""
from __future__ import annotations

import csv
from datetime import datetime

from bohio.adapters.base import PointRef, RawReading, SourceAdapter


class CSVReplayAdapter(SourceAdapter):
    def __init__(self, path: str):
        with open(path, newline="") as f:
            rows = list(csv.DictReader(f))
        self.steps: dict[datetime, list[dict]] = {}
        for r in rows:
            self.steps.setdefault(datetime.fromisoformat(r["timestamp"]), []).append(r)
        self.times = sorted(self.steps)
        self.i = 0

    @property
    def now(self) -> datetime:
        return self.times[self.i]

    @property
    def finished(self) -> bool:
        return self.i >= len(self.times)

    def advance(self, minutes: int | None = None) -> None:
        self.i += 1

    def read(self, points: list[PointRef]) -> list[RawReading]:
        if self.finished:
            return []
        ts, rows = self.now, {r["zone"]: r for r in self.steps[self.now]}
        out = []
        for p in points:
            if p.quantity == "outdoor_temp":
                v = float(next(iter(rows.values()))["outdoor_c"])
            elif p.zone in rows and p.quantity == "zone_temp":
                v = float(rows[p.zone]["temp_c"])
            elif p.zone in rows and p.quantity == "setpoint":
                v = float(rows[p.zone]["schedule_setpoint_c"])
            else:
                continue       # no occupancy/energy in a trend log: reported as missing downstream
            out.append(RawReading(p, ts, v))
        return out

    def write(self, *a, **k):   # deliberately not a WritableAdapter
        raise RuntimeError("CSVReplayAdapter is read-only")
