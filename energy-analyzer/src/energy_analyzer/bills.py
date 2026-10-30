"""Utility bills: schema, CSV loading, sanity checks and reconciliation
against interval data. PDF extraction itself lives in llm.py."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
from pydantic import BaseModel, Field

from .models import BillReconciliation


class LineItem(BaseModel):
    description: str
    amount: float = Field(description="Charge in the bill's currency; credits are negative")
    quantity: float | None = None
    unit: str | None = Field(None, description="e.g. kWh, kW, days")


class Bill(BaseModel):
    utility_name: str | None = None
    account_number: str | None = None
    service_address: str | None = None
    rate_schedule: str | None = Field(None, description="Tariff / rate name printed on the bill")
    period_start: date
    period_end: date
    kwh: float = Field(description="Total electricity consumption billed for the period")
    peak_kw: float | None = Field(None, description="Billed maximum demand, if shown")
    energy_charges: float | None = None
    demand_charges: float | None = None
    fixed_charges: float | None = None
    taxes_and_fees: float | None = None
    total_charges: float = Field(description="Total electricity charges for this period, excluding past-due balances")
    line_items: list[LineItem] = Field(default_factory=list)


class BillExtraction(BaseModel):
    bills: list[Bill] = Field(description="One entry per billing period / meter found in the document")
    notes: list[str] = Field(default_factory=list, description="Anything ambiguous, illegible or assumed")


def check_bill(bill: Bill) -> list[str]:
    """Arithmetic checks on an extracted bill. Returns human-readable issues."""
    issues = []
    if bill.period_end <= bill.period_start:
        issues.append(f"{bill.period_start}: period end is not after start")
    days = (bill.period_end - bill.period_start).days
    if not 20 <= days <= 40:
        issues.append(f"{bill.period_start}: unusual billing period length ({days} days)")
    if bill.line_items:
        items = sum(li.amount for li in bill.line_items)
        if bill.total_charges and abs(items - bill.total_charges) > max(1.0, 0.02 * abs(bill.total_charges)):
            issues.append(
                f"{bill.period_start}: line items sum to {items:,.2f} but total is {bill.total_charges:,.2f}"
            )
    if bill.kwh <= 0:
        issues.append(f"{bill.period_start}: non-positive kWh")
    return issues


def load_bills_csv(path: str | Path) -> list[Bill]:
    """CSV with columns period_start, period_end, kwh, total_charges (+ optional peak_kw, ...)."""
    df = pd.read_csv(path)
    known = set(Bill.model_fields)
    return [Bill(**{k: v for k, v in row.items() if k in known and pd.notna(v)}) for row in df.to_dict("records")]


def bills_frame(bills: list[Bill]) -> pd.DataFrame:
    return pd.DataFrame([b.model_dump(exclude={"line_items"}) for b in bills]).sort_values("period_start")


def reconcile(bills: list[Bill], kwh: pd.Series | None) -> list[BillReconciliation]:
    """Compare billed kWh with metered interval kWh for the same dates.

    Bill periods are treated as inclusive of both start and end dates, the
    most common convention; a consistent ~3% gap usually means the utility
    uses an exclusive end date."""
    out = []
    # Compare by local calendar date: a naive local index repeats an hour at
    # the DST fall-back, so label slicing is unreliable.
    dates = pd.Series(kwh.index.tz_localize(None).date, index=kwh.index) if kwh is not None else None
    for b in sorted(bills, key=lambda x: x.period_start):
        meter = None
        if kwh is not None:
            window = kwh[((dates >= b.period_start) & (dates <= b.period_end)).to_numpy()]
            covers_period = len(window) and dates.iloc[0] <= b.period_start and dates.iloc[-1] >= b.period_end
            if covers_period and window.notna().mean() > 0.95:
                meter = float(window.sum() / window.notna().mean())
        diff = None if meter is None or b.kwh == 0 else round((meter - b.kwh) / b.kwh * 100, 2)
        out.append(
            BillReconciliation(
                period_start=b.period_start, period_end=b.period_end, bill_kwh=b.kwh,
                meter_kwh=None if meter is None else round(meter, 1), difference_pct=diff,
            )
        )
    return out
