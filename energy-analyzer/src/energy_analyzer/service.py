"""Glue shared by the CLI and the API: load a site config and gather inputs."""

from __future__ import annotations

import json
import tomllib
from datetime import timedelta
from pathlib import Path

import pandas as pd

from .bills import Bill, load_bills_csv
from .ingest import openei
from .ingest.weather import fetch_hourly_temperature
from .models import SiteConfig


def load_site_config(path: str | Path) -> SiteConfig:
    """Site config from TOML or JSON. Tariffs can be given inline or as
    OpenEI URDB labels (`tariff_label`, `candidate_tariff_labels`)."""
    path = Path(path)
    data = tomllib.loads(path.read_text()) if path.suffix == ".toml" else json.loads(path.read_text())
    return config_from_dict(data)


def config_from_dict(data: dict) -> SiteConfig:
    data = dict(data)
    label = data.pop("tariff_label", None)
    labels = data.pop("candidate_tariff_labels", [])
    search = data.pop("search_openei_tariffs", False)
    config = SiteConfig(**data)
    if label:
        config.tariff = openei.get_tariff(label)
    config.candidate_tariffs += [openei.get_tariff(lbl) for lbl in labels]
    if search:
        found = openei.search_tariffs(config.latitude, config.longitude)
        current = config.tariff.label if config.tariff else None
        config.candidate_tariffs += [t for t in found if t.label != current]
    return config


def load_weather_csv(source, timezone: str) -> pd.Series:
    """Hourly temperature CSV: first column timestamp (UTC or with offset), second column temp in C."""
    df = pd.read_csv(source)
    idx = pd.to_datetime(df.iloc[:, 0], utc=True).dt.tz_convert(timezone)
    return pd.Series(df.iloc[:, 1].to_numpy(dtype=float), index=pd.DatetimeIndex(idx), name="temp_c")


def weather_for(config: SiteConfig, kwh: pd.Series | None, bills: list[Bill]) -> pd.Series:
    if kwh is not None:
        start, end = kwh.index[0].date(), kwh.index[-1].date()
    else:
        start = min(b.period_start for b in bills)
        end = max(b.period_end for b in bills)
    return fetch_hourly_temperature(
        config.latitude, config.longitude, start - timedelta(days=1), end + timedelta(days=1), config.timezone
    )


def load_bill_files(paths: list[str | Path]) -> tuple[list[Bill], list[str]]:
    """Bills from CSV (structured) or PDF (read by Claude)."""
    from . import llm

    bills: list[Bill] = []
    notes: list[str] = []
    for p in map(Path, paths):
        if p.suffix.lower() == ".csv":
            bills += load_bills_csv(p)
        elif p.suffix.lower() == ".pdf":
            extraction = llm.extract_bills_from_pdf(p.read_bytes())
            bills += extraction.bills
            notes += [f"{p.name}: {n}" for n in extraction.notes]
        else:
            raise ValueError(f"Unsupported bill file: {p}")
    return bills, notes
