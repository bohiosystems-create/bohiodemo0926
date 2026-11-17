"""Data model (§3). SQLite today, Postgres-ready (no dialect-specific types)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

QUANTITIES = ("zone_temp", "setpoint", "occupancy", "door", "valve", "fan_speed", "energy", "btu",
              "supply_temp", "return_temp", "alarm", "mode", "outdoor_temp")
# Hard rule 3: never write these. Reading them is allowed and required.
PROTECTED_TAGS = frozenset({"life_safety", "fire", "smoke", "interlock"})


class Base(DeclarativeBase):
    pass


class Site(Base):
    __tablename__ = "site"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    building_type: Mapped[str] = mapped_column(String(20))
    cooling_source: Mapped[str] = mapped_column(String(20))
    timezone: Mapped[str] = mapped_column(String(40), default="Asia/Dubai")
    mode: Mapped[str] = mapped_column(String(20), default="advisory")
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    delta_t_min_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    zones: Mapped[list[Zone]] = relationship(back_populates="site", cascade="all, delete-orphan")


class Zone(Base):
    __tablename__ = "zone"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"))
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20))
    occupancy_sensing: Mapped[str] = mapped_column(String(20))
    comfort_min_c: Mapped[float] = mapped_column(Float, default=22.0)
    comfort_max_c: Mapped[float] = mapped_column(Float, default=26.0)
    max_step_c: Mapped[float] = mapped_column(Float, default=0.5)
    site: Mapped[Site] = relationship(back_populates="zones")


class Point(Base):
    __tablename__ = "point"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"))
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zone.id"), nullable=True)
    raw_name: Mapped[str] = mapped_column(String(160))
    source: Mapped[str] = mapped_column(String(40))
    address: Mapped[str] = mapped_column(String(160), default="")
    quantity: Mapped[str] = mapped_column(String(20))
    unit: Mapped[str] = mapped_column(String(20), default="")
    writable: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    mapping_confirmed_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    mapping_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Reading(Base):
    __tablename__ = "reading"
    id: Mapped[int] = mapped_column(primary_key=True)
    point_id: Mapped[int] = mapped_column(ForeignKey("point.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality: Mapped[str] = mapped_column(String(10), default="ok")   # ok|stale|suspect|missing


class Proposal(Base):
    __tablename__ = "proposal"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"), index=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zone.id"))
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)
    controller: Mapped[str] = mapped_column(String(40))
    proposed_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_value: Mapped[str | None] = mapped_column(String(80), nullable=True)   # what the controller really returned
    rationale_text: Mapped[str] = mapped_column(Text, default="")
    llm_used: Mapped[bool] = mapped_column(Boolean, default=False)
    consistency_spread: Mapped[float | None] = mapped_column(Float, nullable=True)
    decision: Mapped[Decision] = relationship(back_populates="proposal", uselist=False)


class Decision(Base):
    __tablename__ = "decision"
    id: Mapped[int] = mapped_column(primary_key=True)
    proposal_id: Mapped[int] = mapped_column(ForeignKey("proposal.id"), index=True)
    checks: Mapped[list] = mapped_column(JSON, default=list)       # [{name, passed, detail}]
    applied_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    outcome: Mapped[str] = mapped_column(String(12))               # applied|recommended|logged|fallback|rejected
    mode: Mapped[str] = mapped_column(String(10))
    written: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    proposal: Mapped[Proposal] = relationship(back_populates="decision")


class Override(Base):
    __tablename__ = "override"
    id: Mapped[int] = mapped_column(primary_key=True)
    point_id: Mapped[int] = mapped_column(ForeignKey("point.id"))
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zone.id"), nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime)
    previous: Mapped[float | None] = mapped_column(Float, nullable=True)
    new: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(12), default="unknown")   # operator|occupant|unknown


class ModeEvent(Base):
    __tablename__ = "mode_event"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"), index=True)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zone.id"), nullable=True)   # None = whole site
    ts: Mapped[datetime] = mapped_column(DateTime)
    kind: Mapped[str] = mapped_column(String(24))   # alarm|fire|smoke|sandstorm|maintenance|outside_air_closed|equipment_fault
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class BaselinePeriod(Base):   # also used for TestBlock (kind: baseline|ai|control)
    __tablename__ = "baseline_period"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"))
    start: Mapped[datetime] = mapped_column(DateTime)
    end: Mapped[datetime] = mapped_column(DateTime)
    kind: Mapped[str] = mapped_column(String(10), default="baseline")


class SavingsReport(Base):
    __tablename__ = "savings_report"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"))
    period: Mapped[str] = mapped_column(String(40))
    baseline: Mapped[float] = mapped_column(Float)
    actual: Mapped[float] = mapped_column(Float)
    normalised_saving: Mapped[float | None] = mapped_column(Float, nullable=True)
    method: Mapped[str] = mapped_column(String(80))
    calculation_text: Mapped[str] = mapped_column(Text)
