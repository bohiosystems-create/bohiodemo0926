"""OpenEI Utility Rate Database (URDB) client and converter to our Tariff."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

from ..tariff import Tariff, Tier

URDB_URL = "https://api.openei.org/utility_rates"


def _get(params: dict, api_key: str | None) -> list[dict]:
    key = api_key or os.environ.get("OPENEI_API_KEY")
    if not key:
        raise RuntimeError("OPENEI_API_KEY is not set (free key: https://openei.org/services/api/signup/)")
    query = {"version": "latest", "format": "json", "detail": "full", "api_key": key, **params}
    with urllib.request.urlopen(f"{URDB_URL}?{urllib.parse.urlencode(query)}", timeout=60) as resp:
        payload = json.load(resp)
    if "error" in payload:
        raise RuntimeError(f"OpenEI error: {payload['error']}")
    return payload.get("items", [])


def search_tariffs(
    latitude: float, longitude: float, sector: str = "Commercial", api_key: str | None = None, limit: int = 50
) -> list[Tariff]:
    """Currently effective approved tariffs for a location."""
    items = _get(
        {"lat": latitude, "lon": longitude, "sector": sector, "approved": "true", "limit": limit}, api_key
    )
    return [urdb_to_tariff(i) for i in items if not i.get("enddate")]


def get_tariff(label: str, api_key: str | None = None) -> Tariff:
    items = _get({"getpage": label}, api_key)
    if not items:
        raise LookupError(f"No URDB tariff with label {label}")
    return urdb_to_tariff(items[0])


def _tiers(structure: list[list[dict]] | None) -> list[list[Tier]]:
    out = []
    for period in structure or []:
        out.append([Tier(rate=t.get("rate", 0.0) or 0.0, adj=t.get("adj", 0.0) or 0.0, max=t.get("max")) for t in period])
    return out


def urdb_to_tariff(item: dict) -> Tariff:
    unsupported = []
    if item.get("demandratchetpercentage") and any(item["demandratchetpercentage"]):
        unsupported.append("demand ratchet")
    if item.get("coincidentratestructure"):
        unsupported.append("coincident peak demand")
    for period in item.get("energyratestructure") or []:
        if any(t.get("unit") not in (None, "kWh") for t in period):
            unsupported.append("energy tiers not in plain kWh (e.g. kWh/kW)")
            break

    fixed = float(item.get("fixedchargefirstmeter") or 0.0)
    units = (item.get("fixedchargeunits") or "$/month").lower()
    if "day" in units:
        fixed *= 30.4
    elif "year" in units:
        fixed /= 12

    kwargs: dict = {
        "name": item.get("name", item.get("label", "URDB tariff")),
        "utility": item.get("utility"),
        "label": item.get("label"),
        "fixed_monthly": fixed,
        "unsupported": unsupported,
    }
    if item.get("energyratestructure"):
        kwargs["energy_rates"] = _tiers(item["energyratestructure"])
        kwargs["energy_weekday_schedule"] = item["energyweekdayschedule"]
        kwargs["energy_weekend_schedule"] = item["energyweekendschedule"]
    if item.get("flatdemandstructure"):
        kwargs["flat_demand_rates"] = _tiers(item["flatdemandstructure"])
        kwargs["flat_demand_months"] = item.get("flatdemandmonths") or [0] * 12
    if item.get("demandratestructure"):
        kwargs["tou_demand_rates"] = _tiers(item["demandratestructure"])
        kwargs["tou_demand_weekday_schedule"] = item["demandweekdayschedule"]
        kwargs["tou_demand_weekend_schedule"] = item["demandweekendschedule"]
    return Tariff(**kwargs)
