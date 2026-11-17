"""Savings report: baseline vs Gen-HVAC HVAC energy, with the full derivation printed.

Each CSV needs columns: timestamp, hvac_kwh  (one row per interval, same period in both files).

    python3 audit/savings_report.py --baseline data/baseline.csv --candidate data/genhvac.csv \
        --tariff 0.38 --grid-factor 0.40 --annualise
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime


def load(path: str) -> tuple[float, datetime, datetime, int]:
    total, times = 0.0, []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            total += float(r["hvac_kwh"])
            times.append(datetime.fromisoformat(r["timestamp"]))
    return total, min(times), max(times), len(times)


def report(baseline: str, candidate: str, tariff: float, grid_factor: float, annualise: bool) -> dict:
    b_kwh, b_start, b_end, b_n = load(baseline)
    c_kwh, c_start, c_end, c_n = load(candidate)
    if (b_start, b_end, b_n) != (c_start, c_end, c_n):
        raise SystemExit("Baseline and candidate cover different periods/intervals - not comparable.")

    saved_kwh = b_kwh - c_kwh
    pct = saved_kwh / b_kwh * 100 if b_kwh else 0.0
    saved_aed = saved_kwh * tariff
    saved_t = saved_kwh * grid_factor / 1000

    days = (b_end - b_start).total_seconds() / 86400 or 1
    factor = 365 / days if annualise else 1.0

    lines = [
        f"Period: {b_start:%Y-%m-%d %H:%M} -> {b_end:%Y-%m-%d %H:%M} ({b_n} intervals, {days:.2f} days)",
        "",
        f"1. Baseline HVAC energy        B = {b_kwh:,.1f} kWh",
        f"2. Gen-HVAC HVAC energy        C = {c_kwh:,.1f} kWh",
        f"3. Energy saved            B - C = {b_kwh:,.1f} - {c_kwh:,.1f} = {saved_kwh:,.1f} kWh",
        f"4. Saving %          (B - C) / B = {saved_kwh:,.1f} / {b_kwh:,.1f} = {pct:.1f}%",
        f"5. Cost saved        kWh x tariff = {saved_kwh:,.1f} x {tariff} AED/kWh = AED {saved_aed:,.0f}",
        f"6. CO2 avoided  kWh x grid factor = {saved_kwh:,.1f} x {grid_factor} kg/kWh / 1000 = {saved_t:,.2f} tCO2e",
    ]
    if annualise:
        lines += [
            f"7. Annualised (x 365 / {days:.2f} = x{factor:.2f}):",
            f"   {saved_kwh * factor:,.0f} kWh/yr, AED {saved_aed * factor:,.0f}/yr, {saved_t * factor:,.1f} tCO2e/yr",
            "   (Simple scaling - ignores seasonality. Use a full simulated year for client figures.)",
        ]
    print("\n".join(lines))
    return {"baseline_kwh": b_kwh, "candidate_kwh": c_kwh, "saved_kwh": saved_kwh,
            "saving_pct": pct, "saved_aed": saved_aed, "saved_tco2e": saved_t}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--baseline", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--tariff", type=float, required=True, help="AED per kWh (check client's DEWA/ADDC/SEWA bill)")
    p.add_argument("--grid-factor", type=float, default=0.40, help="kg CO2e per kWh - placeholder, confirm locally")
    p.add_argument("--annualise", action="store_true")
    a = p.parse_args()
    report(a.baseline, a.candidate, a.tariff, a.grid_factor, a.annualise)
