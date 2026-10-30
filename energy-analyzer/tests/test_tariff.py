import pandas as pd
import pytest

from energy_analyzer.ingest.openei import urdb_to_tariff
from energy_analyzer.tariff import Tariff, Tier, calculate_bills


def _flat_load(kw=10.0, days=31, start="2024-01-01"):
    idx = pd.date_range(start, periods=days * 96, freq="15min", tz="America/New_York")
    return pd.Series(kw * 0.25, index=idx)


def test_simple_tariff_by_hand():
    load = _flat_load(kw=10)
    load.iloc[500] = 40 * 0.25  # one 40 kW interval sets the demand charge
    bills = calculate_bills(load, Tariff.simple("x", energy_rate=0.10, demand_rate=15, fixed_monthly=20))
    jan = bills.iloc[0]
    assert jan["kwh"] == pytest.approx(10 * 744 + 7.5)
    assert jan["energy"] == pytest.approx(jan["kwh"] * 0.10)
    assert jan["demand"] == pytest.approx(40 * 15)
    assert jan["total"] == pytest.approx(jan["energy"] + 600 + 20)


def test_tou_and_tiers():
    sched = [[1 if 12 <= h < 18 else 0 for h in range(24)] for _ in range(12)]
    t = Tariff(
        name="tou",
        energy_rates=[[Tier(rate=0.10, max=1000), Tier(rate=0.05)], [Tier(rate=0.30)]],
        energy_weekday_schedule=sched,
        energy_weekend_schedule=[[0] * 24 for _ in range(12)],
    )
    load = _flat_load(kw=10, days=7, start="2024-01-01")  # Mon..Sun
    bills = calculate_bills(load, t)
    peak_kwh = 10 * 6 * 5  # 5 weekdays x 6 peak hours
    off_kwh = 10 * 24 * 7 - peak_kwh  # 1380: crosses the 1000 kWh tier
    expected = peak_kwh * 0.30 + 1000 * 0.10 + (off_kwh - 1000) * 0.05
    assert bills["energy"].sum() == pytest.approx(expected)


def test_urdb_conversion():
    item = {
        "label": "abc123",
        "name": "Large General Service TOU",
        "utility": "Example Utility",
        "fixedchargefirstmeter": 3.0,
        "fixedchargeunits": "$/day",
        "energyratestructure": [[{"rate": 0.08, "unit": "kWh"}], [{"rate": 0.2, "adj": 0.01, "unit": "kWh"}]],
        "energyweekdayschedule": [[0] * 24] * 12,
        "energyweekendschedule": [[0] * 24] * 12,
        "flatdemandstructure": [[{"rate": 12.5}]],
        "flatdemandmonths": [0] * 12,
        "demandratchetpercentage": [0.8] * 12,
    }
    t = urdb_to_tariff(item)
    assert t.label == "abc123" and t.fixed_monthly == pytest.approx(91.2)
    assert t.energy_rates[1][0].total == pytest.approx(0.21)
    assert t.flat_demand_rates[0][0].rate == 12.5
    assert "demand ratchet" in t.unsupported
