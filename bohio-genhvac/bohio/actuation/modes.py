"""Mode handling and device writes (§9). The only module that may call adapter.write().

Hard rules enforced here, in code:
  2. no write unless site mode is 'live' AND the process was started with --i-understand-live
  3. never write a point tagged life_safety / fire / smoke / interlock
  1. (LLM never writes) is structural: nothing in bohio/llm may import this module.
"""
from __future__ import annotations

from bohio.adapters.base import PointRef, WritableAdapter, WriteResult
from bohio.config import SiteConfig
from bohio.models import PROTECTED_TAGS


class LiveNotAcknowledged(RuntimeError):
    pass


class ProtectedPoint(RuntimeError):
    pass


def assert_live_allowed(mode: str, live_ack: bool) -> None:
    if mode == "live" and not live_ack:
        raise LiveNotAcknowledged("site mode is 'live' but --i-understand-live was not given; refusing to start")


def write_setpoint(adapter, point: PointRef, value: float, cfg: SiteConfig, live_ack: bool) -> WriteResult:
    if cfg.mode != "live" or not live_ack:
        raise LiveNotAcknowledged(f"write refused: mode={cfg.mode!r}, live_ack={live_ack}")
    if PROTECTED_TAGS & set(point.tags):
        raise ProtectedPoint(f"{point.raw_name} is tagged {sorted(PROTECTED_TAGS & set(point.tags))}; never written")
    if not point.writable or not isinstance(adapter, WritableAdapter):
        return WriteResult(False, "point or adapter not writable")
    return adapter.write(point, value, cfg.supervisory_priority)


def release_point(adapter, point: PointRef, cfg: SiteConfig, live_ack: bool) -> WriteResult:
    """Relinquish our priority; the BMS schedule takes over. Same gate as a write."""
    if cfg.mode != "live" or not live_ack:
        raise LiveNotAcknowledged("release refused outside live mode")
    if PROTECTED_TAGS & set(point.tags):
        raise ProtectedPoint(point.raw_name)
    return adapter.release(point, cfg.supervisory_priority) if isinstance(adapter, WritableAdapter) else WriteResult(False, "read-only")
