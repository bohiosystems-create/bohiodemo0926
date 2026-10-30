import numpy as np
import pandas as pd
import pytest

from energy_analyzer.baseline import (
    daily_energy,
    fit_billing_baseline,
    fit_changepoint,
    fit_daily_baseline,
    savings_uncertainty,
    verify_savings,
)


def _synthetic(kind, n=300, seed=0):
    rng = np.random.default_rng(seed)
    t = rng.uniform(-5, 32, n)
    if kind == "5P":
        y = 500 + 20 * np.maximum(10 - t, 0) + 35 * np.maximum(t - 20, 0)
    elif kind == "3PC":
        y = 400 + 30 * np.maximum(t - 16, 0)
    elif kind == "1P":
        y = np.full(n, 450.0)
    return t, y + rng.normal(0, 8, n)


def test_recovers_5p_change_points():
    t, y = _synthetic("5P")
    m = fit_changepoint(t, y)
    assert m.kind == "5P"
    assert m.th == pytest.approx(10, abs=1.5) and m.tc == pytest.approx(20, abs=1.5)
    assert m.bh == pytest.approx(20, rel=0.15) and m.bc == pytest.approx(35, rel=0.1)


def test_recovers_3pc():
    t, y = _synthetic("3PC")
    m = fit_changepoint(t, y)
    assert m.kind in ("3PC", "5P")
    assert m.predict(np.array([30.0]))[0] == pytest.approx(400 + 30 * 14, rel=0.03)


def test_flat_load_prefers_simple_model():
    t, y = _synthetic("1P")
    assert fit_changepoint(t, y).kind in ("1P", "2P")


def test_daily_baseline_meets_g14_on_sample(wasteful_ctx):
    from energy_analyzer.findings.drift import daily_frame

    d = daily_frame(wasteful_ctx, wasteful_ctx.kwh, wasteful_ctx.temp)
    base = fit_daily_baseline(d["energy"], d["temp_c"], d["occ"])
    s = base.summary()
    assert set(base.models) == {"occupied", "unoccupied"}
    assert s.meets_ashrae_g14
    assert s.r2 > 0.9
    assert abs(s.nmbe_pct) < 0.5


def test_daily_energy_handles_dst_and_partial_days(wasteful):
    kwh, _ = wasteful
    daily = daily_energy(kwh.iloc[10:-10])  # partial first and last day
    first, last = kwh.index[0].tz_localize(None).normalize(), kwh.index[-1].tz_localize(None).normalize()
    assert first not in daily.index and last not in daily.index
    # fall-back day has 25 h of intervals; its total must not be rescaled to 24 h
    fall_back = pd.Timestamp("2024-11-03")
    raw = kwh[kwh.index.tz_localize(None).normalize() == fall_back].sum()
    assert daily[fall_back] == pytest.approx(raw)


def test_billing_baseline():
    days = pd.date_range("2023-01-01", "2024-12-31", freq="D")
    temp = pd.Series(12 - 12 * np.cos(2 * np.pi * (days.dayofyear - 20) / 365), index=days)
    starts = pd.date_range("2023-01-05", periods=23, freq="MS") + pd.Timedelta(days=4)
    rows = []
    for s in starts:
        e = s + pd.Timedelta(days=29)
        t = temp.loc[s:e]
        rows.append({"period_start": s, "period_end": e, "kwh": float((800 + 40 * np.maximum(t - 18, 0)).sum())})
    base = fit_billing_baseline(pd.DataFrame(rows), temp)
    assert base.summary().granularity == "billing_period"
    assert base.summary().cv_rmse_pct < 5


def test_savings_uncertainty_behaves():
    u = savings_uncertainty(cv_rmse_pct=10, n=365, m=365, savings_fraction=0.10)
    assert 0 < u < 0.5
    assert savings_uncertainty(10, 365, 365, 0.05) > u  # smaller savings -> relatively less certain
    assert savings_uncertainty(10, 365, 365, 0.10, rho=0.6) > u  # autocorrelation widens it


def test_verify_savings_detects_reduction(wasteful_ctx):
    from energy_analyzer.findings.drift import daily_frame

    d = daily_frame(wasteful_ctx, wasteful_ctx.kwh_all, wasteful_ctx.temp_all).iloc[:300]
    base = fit_daily_baseline(d["energy"].iloc[:200], d["temp_c"].iloc[:200], d["occ"].iloc[:200])
    post = d.iloc[200:].copy()
    post["daytype"] = np.where(post["occ"], "occupied", "unoccupied")
    post["energy"] *= 0.85
    result = verify_savings(base, post)
    assert result["savings_fraction"] == pytest.approx(0.15, abs=0.04)
    assert result["significant"]
