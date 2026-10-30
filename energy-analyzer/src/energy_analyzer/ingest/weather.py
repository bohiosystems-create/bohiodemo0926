"""Outdoor temperature from Open-Meteo's historical archive (free, no key),
plus degree-day helpers."""

from __future__ import annotations

import hashlib
import json
import os
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import pandas as pd

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
CACHE_DIR = Path(os.environ.get("ENERGY_ANALYZER_CACHE", ".cache")) / "weather"


def fetch_hourly_temperature(
    latitude: float, longitude: float, start: date, end: date, timezone: str, use_cache: bool = True
) -> pd.Series:
    """Hourly 2 m air temperature (C), indexed in the site's local timezone."""
    params = {
        "latitude": f"{latitude:.4f}",
        "longitude": f"{longitude:.4f}",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "hourly": "temperature_2m",
        "timezone": "GMT",
    }
    url = f"{ARCHIVE_URL}?{urllib.parse.urlencode(params)}"
    cache_file = CACHE_DIR / f"{hashlib.sha256(url.encode()).hexdigest()[:20]}.json"
    if use_cache and cache_file.exists():
        payload = json.loads(cache_file.read_text())
    else:
        with urllib.request.urlopen(url, timeout=60) as resp:
            payload = json.load(resp)
        if use_cache:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(payload))
    return parse_open_meteo(payload, timezone)


def parse_open_meteo(payload: dict, timezone: str) -> pd.Series:
    hourly = payload["hourly"]
    idx = pd.to_datetime(hourly["time"]).tz_localize("UTC").tz_convert(timezone)
    return pd.Series(hourly["temperature_2m"], index=idx, name="temp_c", dtype=float).interpolate(limit=6)


def align_temperature(temp: pd.Series, index: pd.DatetimeIndex) -> pd.Series:
    """Hourly temperature resampled onto an interval index (step-held within the hour)."""
    hourly = temp.sort_index()
    hourly = hourly[~hourly.index.duplicated()]
    # Floor in UTC: flooring local time fails on the ambiguous DST fall-back hour.
    floored = index.tz_convert("UTC").floor("h").tz_convert(index.tz) if index.tz is not None else index.floor("h")
    return pd.Series(hourly.reindex(floored).to_numpy(), index=index, name="temp_c").interpolate(limit=8)


def daily_degree_days(temp: pd.Series, base_c: float) -> pd.DataFrame:
    """Daily mean temperature, HDD and CDD (from hourly values, base in C)."""
    local_days = temp.index.tz_localize(None).normalize() if temp.index.tz is not None else temp.index.normalize()
    frame = pd.DataFrame({"t": temp.to_numpy()}, index=local_days)
    frame["hdh"] = (base_c - frame["t"]).clip(lower=0)
    frame["cdh"] = (frame["t"] - base_c).clip(lower=0)
    g = frame.groupby(level=0)
    out = pd.DataFrame({"temp_c": g["t"].mean(), "hdd": g["hdh"].mean(), "cdd": g["cdh"].mean()})
    out.index.name = "date"
    return out
