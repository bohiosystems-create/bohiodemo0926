from datetime import date

import pandas as pd
import pytest

from energy_analyzer.bills import Bill, LineItem, check_bill, load_bills_csv, reconcile


def test_check_bill_flags_bad_arithmetic():
    b = Bill(
        period_start=date(2024, 1, 3), period_end=date(2024, 2, 1), kwh=1000, total_charges=200,
        line_items=[LineItem(description="Energy", amount=150), LineItem(description="Fixed", amount=20)],
    )
    issues = check_bill(b)
    assert len(issues) == 1 and "line items" in issues[0]


def test_reconcile_against_interval(wasteful):
    kwh, _ = wasteful
    dates = kwh.index.tz_localize(None).normalize()
    true = float(kwh[(dates >= "2024-03-05") & (dates <= "2024-04-03")].sum())
    bills = [Bill(period_start=date(2024, 3, 5), period_end=date(2024, 4, 3), kwh=round(true * 1.02), total_charges=1)]
    rec = reconcile(bills, kwh)[0]
    assert rec.difference_pct == pytest.approx(-1.96, abs=0.05)


def test_bills_csv(tmp_path):
    pd.DataFrame(
        {"period_start": ["2024-01-03"], "period_end": ["2024-02-01"], "kwh": [41000], "total_charges": [6100.5], "peak_kw": [150]}
    ).to_csv(tmp_path / "b.csv", index=False)
    (b,) = load_bills_csv(tmp_path / "b.csv")
    assert b.peak_kw == 150 and b.period_end == date(2024, 2, 1)
