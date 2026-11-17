"""Occupancy as a probability plus evidence (§4). Unknown always leans towards 'occupied' so nothing is set back by mistake."""
from __future__ import annotations

from datetime import datetime

from bohio.config import SiteConfig, ZoneConfig


def estimate(site: SiteConfig, zc: ZoneConfig, hour: float, ts: datetime, signal: float | None,
             last_activity: datetime | None, first_seen: datetime) -> tuple[float, str]:
    inside = zc.schedule.occupied_start_h <= hour < zc.schedule.occupied_end_h
    if site.building_type == "retail" and not inside:
        return 0.0, "closed (outside opening hours)"
    if zc.occupancy_sensing == "none" or signal is None:
        return 0.5, "no occupancy signal: unknown, treated as possibly occupied"
    if signal > 0:
        return 0.9, "activity detected now"
    since = last_activity or first_seen
    empty_min = (ts - since).total_seconds() / 60
    need = site.vacancy_min
    if empty_min >= need:
        return 0.1, f"no activity for {empty_min:.0f} min (threshold {need:.0f} min for {site.building_type})"
    return 0.6, f"no activity for {empty_min:.0f} min, below the {need:.0f} min threshold"
