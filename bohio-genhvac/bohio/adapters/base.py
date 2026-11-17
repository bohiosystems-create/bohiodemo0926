"""Adapter interfaces (§8). Readers implement SourceAdapter; only controllable sources implement WritableAdapter."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class PointRef:
    id: int
    zone: str | None          # zone name, None for site-level points
    quantity: str
    raw_name: str = ""
    writable: bool = False
    tags: tuple[str, ...] = ()


@dataclass
class RawReading:
    point: PointRef
    ts: datetime              # when the DEVICE measured it (age = cycle time - ts)
    value: float | None
    quality: str = "ok"       # ok|stale|suspect|missing


@dataclass
class WriteResult:
    ok: bool
    detail: str = ""


class SourceAdapter(ABC):
    @abstractmethod
    def read(self, points: list[PointRef]) -> list[RawReading]: ...


class WritableAdapter(SourceAdapter):
    @abstractmethod
    def write(self, point: PointRef, value: float, priority: int) -> WriteResult: ...

    @abstractmethod
    def release(self, point: PointRef, priority: int) -> WriteResult:
        """Relinquish our priority so the building's own schedule takes over."""
