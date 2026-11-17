"""Gateway: read building data -> ask Gen-HVAC /predict -> guardrails -> log (shadow) or write (live).

Shadow mode (default) never writes to the building. Live mode needs BOTH
`mode = "live"` in the config AND the `--i-understand-live` flag.

Run on sample data without a model server:
    python3 -m gateway.shadow_gateway --config gateway/config.example.toml \
        --source data/sample_readings.csv --dry-predict
"""
from __future__ import annotations

import argparse
import csv
import json
import time
import tomllib
import urllib.request
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

from gateway.guardrails import Guardrails, ZoneLimits


# ---------- BMS adapters ----------------------------------------------------

class BMSAdapter(ABC):
    """Implement for BACnet (e.g. BAC0) or Niagara REST in Phase 5."""

    @abstractmethod
    def read(self) -> list[dict]:
        """Yield one dict per step: {timestamp, zone, temp_c, schedule_setpoint_c, outdoor_c}."""

    @abstractmethod
    def write_setpoint(self, zone: str, value_c: float) -> None: ...


class CSVReplayAdapter(BMSAdapter):
    """Replays trend-log CSV rows grouped by timestamp. Cannot write."""

    def __init__(self, path: str):
        self.path = path

    def read(self):
        with open(self.path, newline="") as f:
            rows = list(csv.DictReader(f))
        steps: dict[str, list[dict]] = {}
        for r in rows:
            steps.setdefault(r["timestamp"], []).append(r)
        for ts in sorted(steps):
            yield ts, steps[ts]

    def write_setpoint(self, zone, value_c):
        raise RuntimeError("CSVReplayAdapter is read-only")


# ---------- model client ----------------------------------------------------

def build_payload(step: int, rows: list[dict], zones: list[str]) -> dict:
    """TODO(Phase 0): match upstream obs order exactly. Placeholder layout:
    [outdoor_c, zone temps in config order..., previous setpoints...]."""
    by_zone = {r["zone"]: r for r in rows}
    outdoor = float(rows[0]["outdoor_c"])
    temps = [float(by_zone[z]["temp_c"]) for z in zones if z in by_zone]
    return {"step": step, "obs": [outdoor, *temps], "info": {"zones": zones}}


def predict(url: str, payload: dict, timeout_s: float = 5.0) -> list[float] | None:
    try:
        req = urllib.request.Request(
            url.rstrip("/") + "/predict",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            body = json.load(resp)
        action = body.get("action", body) if isinstance(body, dict) else body
        return [float(a) for a in action]
    except Exception as e:  # any model failure -> guardrails fall back
        print(f"[warn] predict failed: {e}")
        return None


def dry_predict(rows: list[dict], zones: list[str]) -> list[float]:
    """Stand-in model for testing the pipeline: nudge each zone +1C above schedule."""
    by_zone = {r["zone"]: r for r in rows}
    return [float(by_zone[z]["schedule_setpoint_c"]) + 1.0 for z in zones]


# ---------- main loop -------------------------------------------------------

def run(cfg: dict, adapter: BMSAdapter, live: bool, use_dry: bool, log_path: Path) -> None:
    zones = list(cfg["zones"].keys())
    guard = Guardrails(
        limits={z: ZoneLimits(**v) for z, v in cfg["zones"].items()},
        stale_after_s=cfg.get("stale_after_s", 900),
    )
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "zone", "temp_c", "schedule_c", "proposed_c", "applied_c", "reason", "written"])
        for step, (ts, rows) in enumerate(adapter.read()):
            actions = dry_predict(rows, zones) if use_dry else predict(cfg["model_url"], build_payload(step, rows, zones))
            by_zone = {r["zone"]: r for r in rows}
            age = _age_seconds(ts, cfg.get("replay", True))
            for i, z in enumerate(zones):
                r = by_zone.get(z)
                if r is None:
                    continue
                sched = float(r["schedule_setpoint_c"])
                proposed = actions[i] if actions and i < len(actions) else None
                d = guard.apply(z, proposed, sched, age)
                written = False
                if live:
                    adapter.write_setpoint(z, d.applied)
                    written = True
                w.writerow([ts, z, r["temp_c"], sched, proposed, d.applied, d.reason, written])
    print(f"Wrote decisions to {log_path}")


def _age_seconds(ts: str, replay: bool) -> float:
    if replay:
        return 0.0  # historical replay: treat each row as fresh
    t = datetime.fromisoformat(ts)
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - t).total_seconds()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--config", required=True)
    p.add_argument("--source", required=True, help="CSV trend log to replay")
    p.add_argument("--dry-predict", action="store_true", help="use stand-in model, no server needed")
    p.add_argument("--i-understand-live", action="store_true")
    p.add_argument("--log", default=f"logs/decisions_{int(time.time())}.csv")
    a = p.parse_args()

    with open(a.config, "rb") as f:
        cfg = tomllib.load(f)
    live = cfg.get("mode") == "live" and a.i_understand_live
    if cfg.get("mode") == "live" and not a.i_understand_live:
        print("[info] config says live but --i-understand-live not given: running in SHADOW mode")
    run(cfg, CSVReplayAdapter(a.source), live, a.dry_predict, Path(a.log))


if __name__ == "__main__":
    main()
