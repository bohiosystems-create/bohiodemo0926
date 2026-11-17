from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from bohio.config import SiteConfig
from bohio.state.types import NumericState


@dataclass
class ProposalOut:
    zone: str
    value: Any                 # deliberately untyped: a misbehaving controller may return junk; G3 catches it
    rationale: str = ""
    controller: str = ""
    llm_used: bool = False
    intent: Any = None         # set by the guardrail runner: the controller's original value, before soft corrections


class Controller(Protocol):
    name: str

    def propose(self, state: NumericState, cfg: SiteConfig, hints: dict | None = None) -> dict[str, ProposalOut]: ...
