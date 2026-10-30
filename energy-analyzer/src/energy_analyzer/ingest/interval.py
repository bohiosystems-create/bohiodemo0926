"""Interval meter data: generic CSV, Green Button (ESPI XML and utility CSV)
and the Building Data Genome 2 (BDG2) wide format.

Everything is normalized to a pandas Series of kWh per interval, indexed by
interval-start timestamps in the site's local timezone, on a regular grid
(gaps are NaN, so completeness can be measured).
"""

from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import pandas as pd

ESPI_NS = {"espi": "http://naesb.org/espi", "atom": "http://www.w3.org/2005/Atom"}
_TS_CANDIDATES = ["timestamp", "datetime", "date_time", "interval_start", "start", "start_time", "time", "date"]


class IntervalDataError(ValueError):
    pass


def load_interval_file(path_or_bytes: str | Path | bytes, timezone: str, filename: str | None = None) -> pd.Series:
    """Load any supported interval file, detecting the format from content."""
    if isinstance(path_or_bytes, (str, Path)):
        filename = filename or str(path_or_bytes)
        raw = Path(path_or_bytes).read_bytes()
    else:
        raw = path_or_bytes
    head = raw[:2000].lstrip().lower()
    if head.startswith(b"<?xml") or head.startswith(b"<feed") or b"espi" in head:
        return load_green_button_xml(raw, timezone)
    return load_interval_csv(io.BytesIO(raw), timezone)


def load_interval_csv(
    source,
    timezone: str,
    timestamp_col: str | None = None,
    value_col: str | None = None,
    units: str | None = None,
) -> pd.Series:
    """Load a CSV with one timestamp column (or Green Button DATE + START TIME)
    and one consumption column. Units are inferred from the column name
    ('kwh', 'kw', 'wh') unless given. A kW column is converted to kWh."""
    df = _read_csv_skipping_preamble(source)
    cols = {c.lower().strip(): c for c in df.columns}

    if timestamp_col is None and "date" in cols and ("start time" in cols or "start" in cols):
        start = cols.get("start time", cols.get("start"))
        ts = pd.to_datetime(df[cols["date"]].astype(str) + " " + df[start].astype(str), errors="coerce")
    else:
        if timestamp_col is None:
            timestamp_col = next((cols[c] for c in _TS_CANDIDATES if c in cols), df.columns[0])
        ts = pd.to_datetime(df[timestamp_col], errors="coerce", utc=_looks_tz_aware(df[timestamp_col]))

    if value_col is None:
        value_col = _pick_value_column(df, exclude={timestamp_col} if timestamp_col else set())
    lowered = value_col.lower()
    if units is None:
        if "kwh" in lowered or "usage" in lowered or "consumption" in lowered or "value" in lowered:
            units = "kwh"
        elif re.search(r"\bwh\b|\(wh\)|_wh\b", lowered):
            units = "wh"
        elif "kw" in lowered:
            units = "kw"
        else:
            units = "kwh"
    values = pd.to_numeric(df[value_col].astype(str).str.replace(",", ""), errors="coerce")
    series = pd.Series(values.to_numpy(), index=pd.DatetimeIndex(ts), name="kwh")
    series = series[series.index.notna()]
    series = _localize(series, timezone)
    series = _regularize(series)
    if units == "wh":
        series = series / 1000.0
    elif units == "kw":
        from ..tariff import interval_hours

        series = series * interval_hours(series)
    return series.rename("kwh")


def load_green_button_xml(raw: bytes, timezone: str) -> pd.Series:
    """Parse a Green Button (NAESB ESPI) XML export."""
    root = ET.fromstring(raw)
    multiplier, uom = 0, 72  # 72 = Wh
    rt = root.find(".//espi:ReadingType", ESPI_NS)
    if rt is not None:
        m = rt.find("espi:powerOfTenMultiplier", ESPI_NS)
        u = rt.find("espi:uom", ESPI_NS)
        multiplier = int(m.text) if m is not None else 0
        uom = int(u.text) if u is not None else 72
    if uom != 72:
        raise IntervalDataError(f"Green Button uom {uom} is not energy (Wh=72); only electricity energy is supported")

    starts, values = [], []
    for reading in root.iterfind(".//espi:IntervalReading", ESPI_NS):
        start = reading.find("espi:timePeriod/espi:start", ESPI_NS)
        value = reading.find("espi:value", ESPI_NS)
        if start is None or value is None:
            continue
        starts.append(int(start.text))
        values.append(float(value.text))
    if not starts:
        raise IntervalDataError("No IntervalReading elements found in Green Button file")
    idx = pd.to_datetime(starts, unit="s", utc=True)
    kwh = np.asarray(values) * (10.0**multiplier) / 1000.0
    series = pd.Series(kwh, index=idx, name="kwh").sort_index()
    series.index = series.index.tz_convert(timezone)
    return _regularize(series)


def load_bdg2(meter_csv: str | Path, building_id: str, timezone: str) -> pd.Series:
    """Load one building from a BDG2 meter file (wide: timestamp + one column
    per building, hourly kWh, local time)."""
    df = pd.read_csv(meter_csv, usecols=["timestamp", building_id])
    series = pd.Series(df[building_id].to_numpy(), index=pd.to_datetime(df["timestamp"]), name="kwh")
    return _regularize(_localize(series, timezone))


def load_bdg2_weather(weather_csv: str | Path, site_id: str, timezone: str) -> pd.Series:
    """Hourly outdoor air temperature (C) for one BDG2 site."""
    df = pd.read_csv(weather_csv, usecols=["timestamp", "site_id", "airTemperature"])
    df = df[df["site_id"] == site_id]
    series = pd.Series(df["airTemperature"].to_numpy(), index=pd.to_datetime(df["timestamp"]), name="temp_c")
    return _localize(series, timezone).sort_index().interpolate(limit=3)


def completeness(series: pd.Series) -> float:
    return float(series.notna().mean()) if len(series) else 0.0


# --- helpers -----------------------------------------------------------------


def _read_csv_skipping_preamble(source) -> pd.DataFrame:
    """Utility exports often have a few lines of account info before the header."""
    if isinstance(source, (str, Path)):
        text = Path(source).read_text(encoding="utf-8-sig", errors="replace")
    else:
        data = source.read()
        text = data.decode("utf-8-sig", errors="replace") if isinstance(data, bytes) else data
    lines = text.splitlines()
    header_row = 0
    for i, line in enumerate(lines[:50]):
        low = line.lower()
        if line.count(",") >= 1 and any(k in low for k in ("date", "time", "start")):
            header_row = i
            break
    return pd.read_csv(io.StringIO("\n".join(lines[header_row:])))


def _looks_tz_aware(col: pd.Series) -> bool:
    sample = col.dropna().astype(str).head(20)
    return bool(sample.str.contains(r"(?:Z|[+-]\d{2}:?\d{2})$", regex=True).any())


def _pick_value_column(df: pd.DataFrame, exclude: set[str]) -> str:
    preferred = ["kwh", "usage", "consumption", "value", "kw", "wh", "energy"]
    for key in preferred:
        for c in df.columns:
            if c not in exclude and key in c.lower() and pd.to_numeric(df[c], errors="coerce").notna().mean() > 0.5:
                return c
    numeric = [c for c in df.columns if c not in exclude and pd.to_numeric(df[c], errors="coerce").notna().mean() > 0.5]
    if not numeric:
        raise IntervalDataError("Could not find a numeric consumption column")
    return numeric[-1]


def _localize(series: pd.Series, timezone: str) -> pd.Series:
    idx = pd.DatetimeIndex(series.index)
    if idx.tz is None:
        # Ambiguous fall-back hour and spring-forward gap are dropped rather than guessed.
        idx = idx.tz_localize(timezone, ambiguous="NaT", nonexistent="NaT")
    else:
        idx = idx.tz_convert(timezone)
    out = pd.Series(series.to_numpy(), index=idx, name=series.name)
    return out[out.index.notna()]


def _regularize(series: pd.Series) -> pd.Series:
    series = series[~series.index.duplicated(keep="first")].sort_index()
    if len(series) < 3:
        raise IntervalDataError("Need at least 3 intervals")
    step = pd.Series(series.index).diff().dropna().mode().iloc[0]
    # Build the grid in UTC so DST transitions don't create or drop intervals.
    utc = series.tz_convert("UTC") if series.index.tz is not None else series
    grid = pd.date_range(utc.index[0], utc.index[-1], freq=step)
    out = utc.reindex(grid)
    if series.index.tz is not None:
        out.index = out.index.tz_convert(series.index.tz)
    return out
