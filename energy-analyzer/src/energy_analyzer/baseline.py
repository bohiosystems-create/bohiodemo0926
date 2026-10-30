"""Weather-normalized baseline, following ASHRAE Guideline 14 inverse modeling.

Energy per day (or per day within a billing period) is regressed on mean
outdoor temperature with change-point models:

    1P   E = b0                                   (no weather sensitivity)
    2P   E = b0 + b1*T
    3PC  E = b0 + bc*max(T - Tc, 0)               (cooling)
    3PH  E = b0 + bh*max(Th - T, 0)               (heating)
    5P   E = b0 + bh*max(Th - T, 0) + bc*max(T - Tc, 0)

Change points are grid-searched. Heating/cooling slopes must be positive.
Among valid models, the one with the lowest CV(RMSE) wins; CV(RMSE) uses
n - p degrees of freedom, as G14 defines it, so extra parameters are only
kept when they earn their place. Occupied and unoccupied day types get
separate models when there is enough data for both.

G14 calibration limits used here: CV(RMSE) <= 15% and |NMBE| <= 0.5% at
monthly resolution (daily fits are rolled up to months to check this).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .models import BaselineSummary

G14_MONTHLY_CV_MAX = 15.0
G14_NMBE_MAX = 0.5
_MIN_POINTS_PER_DAYTYPE = 20


@dataclass
class ChangePointModel:
    kind: str
    b0: float
    bh: float = 0.0
    bc: float = 0.0
    b1: float = 0.0
    th: float | None = None
    tc: float | None = None
    n_params: int = 1

    def predict(self, t: np.ndarray) -> np.ndarray:
        t = np.asarray(t, dtype=float)
        y = np.full_like(t, self.b0)
        if self.kind == "2P":
            y = y + self.b1 * t
        if self.th is not None:
            y = y + self.bh * np.maximum(self.th - t, 0)
        if self.tc is not None:
            y = y + self.bc * np.maximum(t - self.tc, 0)
        return y

    def coefficients(self) -> dict[str, float]:
        out = {"b0": self.b0}
        if self.kind == "2P":
            out["b1"] = self.b1
        if self.th is not None:
            out.update(heating_slope=self.bh, heating_change_point_c=self.th)
        if self.tc is not None:
            out.update(cooling_slope=self.bc, cooling_change_point_c=self.tc)
        return {k: round(float(v), 4) for k, v in out.items()}


def _wls(X: np.ndarray, y: np.ndarray, w: np.ndarray) -> tuple[np.ndarray, float]:
    sw = np.sqrt(w)
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    sse = float(np.sum(w * (y - X @ beta) ** 2))
    return beta, sse


def _cv(sse: float, y: np.ndarray, w: np.ndarray, p: int) -> float:
    n = len(y)
    if n <= p:
        return np.inf
    ybar = np.average(y, weights=w)
    return float(np.sqrt(sse / np.mean(w) / (n - p)) / ybar * 100) if ybar > 0 else np.inf


def fit_changepoint(t: np.ndarray, y: np.ndarray, w: np.ndarray | None = None) -> ChangePointModel:
    """Fit all change-point forms and return the best valid one."""
    t, y = np.asarray(t, float), np.asarray(y, float)
    w = np.ones_like(y) if w is None else np.asarray(w, float)
    ones = np.ones_like(t)
    grid = np.unique(np.round(np.percentile(t, np.linspace(10, 90, 33)), 2))
    candidates: list[tuple[float, ChangePointModel]] = []

    beta, sse = _wls(ones[:, None], y, w)
    candidates.append((_cv(sse, y, w, 1), ChangePointModel("1P", beta[0], n_params=1)))

    beta, sse = _wls(np.column_stack([ones, t]), y, w)
    candidates.append((_cv(sse, y, w, 2), ChangePointModel("2P", beta[0], b1=beta[1], n_params=2)))

    for cp in grid:
        hc = np.maximum(t - cp, 0)
        if hc.any():
            beta, sse = _wls(np.column_stack([ones, hc]), y, w)
            if beta[1] > 0:
                candidates.append((_cv(sse, y, w, 3), ChangePointModel("3PC", beta[0], bc=beta[1], tc=cp, n_params=3)))
        hh = np.maximum(cp - t, 0)
        if hh.any():
            beta, sse = _wls(np.column_stack([ones, hh]), y, w)
            if beta[1] > 0:
                candidates.append((_cv(sse, y, w, 3), ChangePointModel("3PH", beta[0], bh=beta[1], th=cp, n_params=3)))

    for i, th in enumerate(grid):
        for tc in grid[i + 2 :]:
            X = np.column_stack([ones, np.maximum(th - t, 0), np.maximum(t - tc, 0)])
            if not X[:, 1].any() or not X[:, 2].any():
                continue
            beta, sse = _wls(X, y, w)
            if beta[1] > 0 and beta[2] > 0:
                candidates.append(
                    (_cv(sse, y, w, 5), ChangePointModel("5P", beta[0], bh=beta[1], bc=beta[2], th=th, tc=tc, n_params=5))
                )

    return min(candidates, key=lambda c: c[0])[1]


@dataclass
class Baseline:
    """A fitted baseline, possibly split by day type (occupied / unoccupied)."""

    models: dict[str, ChangePointModel]
    granularity: str
    data: pd.DataFrame  # columns: temp_c, energy (per day), weight, daytype, predicted
    notes: list[str] = field(default_factory=list)

    def predict(self, temp_c: np.ndarray, daytype: np.ndarray) -> np.ndarray:
        temp_c, daytype = np.asarray(temp_c, float), np.asarray(daytype)
        out = np.empty_like(temp_c)
        for dt, model in self.models.items():
            mask = (daytype == dt) if dt != "all" else np.ones_like(temp_c, dtype=bool)
            out[mask] = model.predict(temp_c[mask])
        return out

    @property
    def n_params(self) -> int:
        return sum(m.n_params for m in self.models.values())

    def residuals(self) -> pd.Series:
        return self.data["energy"] - self.data["predicted"]

    def metrics(self) -> dict[str, float]:
        d = self.data
        y, yhat, w = d["energy"].to_numpy(), d["predicted"].to_numpy(), d["weight"].to_numpy()
        n, p = len(y), self.n_params
        ybar = np.average(y, weights=w)
        sse = np.sum(w * (y - yhat) ** 2) / np.mean(w)
        sst = np.sum(w * (y - ybar) ** 2) / np.mean(w)
        out = {
            "n": n,
            "r2": float(1 - sse / sst) if sst > 0 else 0.0,
            "cv_rmse_pct": float(np.sqrt(sse / max(n - p, 1)) / ybar * 100),
            "nmbe_pct": float(np.sum(w * (y - yhat)) / np.mean(w) / max(n - p, 1) / ybar * 100),
            "monthly_cv_rmse_pct": None,
            "rho": float(pd.Series(y - yhat).autocorr(lag=1)) if n > 3 else 0.0,
        }
        if self.granularity == "daily":
            monthly = d[["energy", "predicted"]].groupby(d.index.to_period("M")).sum()
            if len(monthly) >= 6:
                ym, ymh = monthly["energy"].to_numpy(), monthly["predicted"].to_numpy()
                out["monthly_cv_rmse_pct"] = float(
                    np.sqrt(np.sum((ym - ymh) ** 2) / (len(ym) - 1)) / ym.mean() * 100
                )
        else:
            out["monthly_cv_rmse_pct"] = out["cv_rmse_pct"]
        return out

    def summary(self) -> BaselineSummary:
        m = self.metrics()
        cv_check = m["monthly_cv_rmse_pct"]
        notes = list(self.notes)
        if cv_check is None:
            notes.append("Fewer than 6 months of data: G14 monthly check not possible; daily CV(RMSE) <= 25% used instead.")
            meets = m["cv_rmse_pct"] <= 25 and abs(m["nmbe_pct"]) <= G14_NMBE_MAX
        else:
            meets = cv_check <= G14_MONTHLY_CV_MAX and abs(m["nmbe_pct"]) <= G14_NMBE_MAX
        coeffs: dict[str, float] = {}
        for dt, model in self.models.items():
            for k, v in model.coefficients().items():
                coeffs[f"{dt}.{k}" if len(self.models) > 1 else k] = v
        return BaselineSummary(
            model_type=", ".join(f"{dt}: {mdl.kind}" for dt, mdl in self.models.items()),
            coefficients=coeffs,
            n_points=m["n"],
            granularity=self.granularity,  # type: ignore[arg-type]
            r2=round(m["r2"], 4),
            cv_rmse_pct=round(m["cv_rmse_pct"], 2),
            nmbe_pct=round(m["nmbe_pct"], 3),
            monthly_cv_rmse_pct=None if cv_check is None else round(cv_check, 2),
            meets_ashrae_g14=bool(meets),
            notes=notes,
        )


def daily_energy(kwh: pd.Series, min_completeness: float = 0.95) -> pd.Series:
    """Daily kWh totals (local days), keeping only days with enough data."""
    local = kwh.copy()
    local.index = local.index.tz_localize(None) if local.index.tz is not None else local.index
    days = local.index.normalize()
    expected = local.groupby(days).size()
    present = local.notna().groupby(days).sum()
    total = local.groupby(days).sum(min_count=1)
    # Per-day expected counts (DST days are 23/25 h); partial first/last days are dropped.
    full_day = expected >= 0.95 * expected.median()
    complete = full_day & (present / expected >= min_completeness)
    # Scale up slightly incomplete days so a missing interval doesn't read as savings.
    return (total[complete] * expected[complete] / present[complete]).rename("kwh")


def fit_daily_baseline(daily_kwh: pd.Series, daily_temp: pd.Series, occupied_day: pd.Series) -> Baseline:
    """Fit a daily baseline. `occupied_day` is a boolean Series by date."""
    df = pd.DataFrame({"energy": daily_kwh, "temp_c": daily_temp, "occ": occupied_day}).dropna()
    if len(df) < 14:
        raise ValueError(f"Need at least 14 complete days with weather to fit a baseline (have {len(df)})")
    df["weight"] = 1.0
    df["daytype"] = np.where(df["occ"].astype(bool), "occupied", "unoccupied")
    notes = []
    counts = df["daytype"].value_counts()
    if counts.get("occupied", 0) >= _MIN_POINTS_PER_DAYTYPE and counts.get("unoccupied", 0) >= _MIN_POINTS_PER_DAYTYPE:
        models = {
            dt: fit_changepoint(g["temp_c"].to_numpy(), g["energy"].to_numpy()) for dt, g in df.groupby("daytype")
        }
    else:
        notes.append("Not enough occupied/unoccupied days for separate models; one model fitted to all days.")
        df["daytype"] = "all"
        models = {"all": fit_changepoint(df["temp_c"].to_numpy(), df["energy"].to_numpy())}
    base = Baseline(models=models, granularity="daily", data=df, notes=notes)
    df["predicted"] = base.predict(df["temp_c"].to_numpy(), df["daytype"].to_numpy())
    return base


def fit_billing_baseline(bills: pd.DataFrame, daily_temp: pd.Series) -> Baseline:
    """Baseline from monthly bills alone (no interval data).

    `bills` needs period_start, period_end (inclusive dates) and kwh columns.
    Each period becomes one point: kWh/day vs mean temperature, weighted by days.
    """
    rows = []
    temp = daily_temp.copy()
    temp.index = pd.DatetimeIndex(temp.index)
    for _, b in bills.iterrows():
        start, end = pd.Timestamp(b["period_start"]), pd.Timestamp(b["period_end"])
        days = (end - start).days + 1
        t = temp.loc[start:end]
        if days <= 0 or len(t) < 0.8 * days:
            continue
        rows.append({"date": end, "energy": b["kwh"] / days, "temp_c": t.mean(), "weight": float(days), "daytype": "all"})
    df = pd.DataFrame(rows).set_index("date").sort_index()
    if len(df) < 9:
        raise ValueError(f"Need at least 9 billing periods with weather for a bill baseline (have {len(df)})")
    model = fit_changepoint(df["temp_c"].to_numpy(), df["energy"].to_numpy(), df["weight"].to_numpy())
    base = Baseline(models={"all": model}, granularity="billing_period", data=df)
    df["predicted"] = base.predict(df["temp_c"].to_numpy(), df["daytype"].to_numpy())
    return base


# --- savings verification (the M&V step behind "share of verified savings") ---

_Z = {0.68: 0.994, 0.80: 1.2816, 0.90: 1.645, 0.95: 1.96}


def _t_value(confidence: float, df: int) -> float:
    z = _Z[confidence]
    return z + (z**3 + z) / (4 * max(df, 1))  # Cornish-Fisher approximation of Student's t


def savings_uncertainty(
    cv_rmse_pct: float, n: int, m: int, savings_fraction: float, rho: float = 0.0, n_params: int = 2, confidence: float = 0.90
) -> float:
    """ASHRAE Guideline 14 fractional savings uncertainty (Annex B):

        dE/E = t * 1.26 * CV * sqrt( (n/n') * (1 + 2/n) * (1/m) ) / F

    n = baseline points, n' = n(1-rho)/(1+rho) for autocorrelated residuals,
    m = reporting-period points, F = savings as a fraction of baseline use.
    """
    if savings_fraction <= 0:
        return float("inf")
    rho = max(min(rho, 0.95), 0.0)
    n_eff = n * (1 - rho) / (1 + rho)
    cv = cv_rmse_pct / 100
    t = _t_value(confidence, n - n_params)
    return float(t * 1.26 * cv * np.sqrt((n / n_eff) * (1 + 2 / n) / m) / savings_fraction)


def verify_savings(baseline: Baseline, post_daily: pd.DataFrame, confidence: float = 0.90) -> dict:
    """Avoided energy in a reporting period: baseline projected onto the
    reporting period's actual weather, minus metered use.

    `post_daily` needs columns energy, temp_c and daytype (as in the baseline).
    """
    predicted = baseline.predict(post_daily["temp_c"].to_numpy(), post_daily["daytype"].to_numpy())
    actual = post_daily["energy"].to_numpy()
    avoided = float(predicted.sum() - actual.sum())
    fraction = avoided / float(predicted.sum()) if predicted.sum() > 0 else 0.0
    m = baseline.metrics()
    unc = savings_uncertainty(m["cv_rmse_pct"], m["n"], len(actual), fraction, m["rho"], baseline.n_params, confidence)
    return {
        "baseline_kwh": float(predicted.sum()),
        "actual_kwh": float(actual.sum()),
        "avoided_kwh": avoided,
        "savings_fraction": fraction,
        "fractional_uncertainty": unc,
        "confidence": confidence,
        "significant": bool(unc < 0.5),  # G14: uncertainty under 50% of savings
    }
