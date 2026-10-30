import numpy as np
import pandas as pd
import pytest

from energy_analyzer.ingest.interval import completeness, load_interval_csv, load_interval_file
from energy_analyzer.ingest.weather import align_temperature, daily_degree_days, parse_open_meteo

TZ = "America/Chicago"


def test_generic_csv_kw_column_converted(tmp_path):
    idx = pd.date_range("2024-03-01", periods=96 * 3, freq="15min")
    pd.DataFrame({"Timestamp": idx, "Demand (kW)": 20.0}).to_csv(tmp_path / "m.csv", index=False)
    s = load_interval_file(tmp_path / "m.csv", TZ)
    assert str(s.index.tz) == TZ
    assert s.iloc[0] == pytest.approx(5.0)  # 20 kW for 15 min


def test_csv_gaps_become_nan(tmp_path):
    idx = pd.date_range("2024-03-01", periods=100, freq="h")
    df = pd.DataFrame({"datetime": idx, "kwh": 1.0}).drop(index=[10, 11, 12])
    df.to_csv(tmp_path / "m.csv", index=False)
    s = load_interval_csv(tmp_path / "m.csv", TZ)
    assert len(s) == 100 and s.isna().sum() == 3
    assert completeness(s) == pytest.approx(0.97)


def test_dst_spring_forward_naive_timestamps(tmp_path):
    # Naive local timestamps across spring-forward: 02:00-02:45 don't exist.
    idx = pd.date_range("2024-03-09", "2024-03-11", freq="15min", inclusive="left")
    pd.DataFrame({"timestamp": idx, "kwh": 1.0}).to_csv(tmp_path / "m.csv", index=False)
    s = load_interval_csv(tmp_path / "m.csv", "America/New_York")
    assert s.index.is_monotonic_increasing
    assert s.notna().sum() == len(idx) - 4


def test_green_button_csv_with_preamble(tmp_path):
    text = (
        "Name,ACME CORP\nAddress,1 Main St\nAccount Number,12345\n\n"
        "TYPE,DATE,START TIME,END TIME,USAGE (kWh),COST,NOTES\n"
        + "".join(
            f"Electric usage,2024-05-01,{h:02d}:{m:02d},{h:02d}:{m + 14:02d},2.5,$0.30,\n"
            for h in range(24)
            for m in (0, 15, 30, 45)
        )
    )
    (tmp_path / "gb.csv").write_text(text)
    s = load_interval_file(tmp_path / "gb.csv", TZ)
    assert len(s) == 96 and s.sum() == pytest.approx(240)


def test_green_button_xml():
    readings = "".join(
        f"<espi:IntervalReading><espi:timePeriod><espi:duration>900</espi:duration>"
        f"<espi:start>{1714521600 + i * 900}</espi:start></espi:timePeriod><espi:value>{2500}</espi:value></espi:IntervalReading>"
        for i in range(8)
    )
    xml = f"""<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:espi="http://naesb.org/espi">
 <entry><content><espi:ReadingType><espi:powerOfTenMultiplier>0</espi:powerOfTenMultiplier><espi:uom>72</espi:uom></espi:ReadingType></content></entry>
 <entry><content><espi:IntervalBlock>{readings}</espi:IntervalBlock></content></entry>
</feed>""".encode()
    s = load_interval_file(xml, TZ)
    assert len(s) == 8 and s.iloc[0] == pytest.approx(2.5)
    assert s.index[0] == pd.Timestamp("2024-05-01 00:00", tz="UTC")


def test_open_meteo_parse_and_degree_days():
    payload = {"hourly": {"time": [f"2024-07-01T{h:02d}:00" for h in range(24)], "temperature_2m": [28.0] * 24}}
    t = parse_open_meteo(payload, "UTC")
    dd = daily_degree_days(t, 18)
    assert dd["cdd"].iloc[0] == pytest.approx(10) and dd["hdd"].iloc[0] == 0


def test_align_temperature_across_fall_back():
    hourly = pd.Series(
        np.arange(72, dtype=float), index=pd.date_range("2024-11-02", periods=72, freq="h", tz="UTC").tz_convert("America/New_York")
    )
    idx = pd.date_range("2024-11-02 12:00", periods=200, freq="15min", tz="UTC").tz_convert("America/New_York")
    aligned = align_temperature(hourly, idx)
    assert aligned.notna().all()
