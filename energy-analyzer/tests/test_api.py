import io
import json

from fastapi.testclient import TestClient

from energy_analyzer.api import app
from energy_analyzer.sample_data import sample_config

client = TestClient(app)


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_analyze_with_uploaded_files(wasteful):
    kwh, temp = wasteful
    kwh = kwh.loc["2025-01-01":]
    interval_csv = kwh.tz_convert("UTC").rename_axis("timestamp").reset_index().to_csv(index=False)
    weather_csv = temp.tz_convert("UTC").rename_axis("timestamp").reset_index().to_csv(index=False)
    site = sample_config().model_dump(mode="json")
    r = client.post(
        "/analyze",
        data={"site": json.dumps(site), "use_claude": "false"},
        files={
            "interval": ("meter.csv", io.BytesIO(interval_csv.encode()), "text/csv"),
            "weather": ("weather.csv", io.BytesIO(weather_csv.encode()), "text/csv"),
        },
    )
    assert r.status_code == 200, r.text
    report = r.json()
    assert {f["type"] for f in report["findings"]} >= {"baseload", "after_hours_hvac", "demand_peaks"}
    md = client.post("/analyze/markdown", json=report)
    assert md.status_code == 200 and md.text.startswith("# Energy savings report")


def test_bad_config_is_422():
    r = client.post("/analyze", data={"site": "{not json"})
    assert r.status_code == 422


def test_example_site_config_loads():
    from pathlib import Path

    from energy_analyzer.service import load_site_config

    config = load_site_config(Path(__file__).parent.parent / "examples" / "site.toml")
    assert config.tariff.name == "GS-TOU (current)" and len(config.candidate_tariffs) == 2
    assert config.schedule.close.hour == 19
