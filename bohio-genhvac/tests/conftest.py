import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bohio.adapters.sim import SimAdapter  # noqa: E402
from bohio.config import SiteConfig, ZoneConfig  # noqa: E402
from bohio.control.rules import RuleBasedController  # noqa: E402
from bohio.cycle import SiteLoop  # noqa: E402
from bohio.db import make_session, seed_site  # noqa: E402
from bohio.state.types import NumericState, ZoneState  # noqa: E402

T0 = datetime(2026, 7, 15, 10, 0)


def make_cfg(mode="shadow", btype="office", zones=("a", "b")) -> SiteConfig:
    return SiteConfig(name="t", building_type=btype, mode=mode, zones=[ZoneConfig(name=z) for z in zones])


def make_state(zone="a", **kw) -> NumericState:
    z = dict(name=zone, temp_c=24.0, temp_age_s=0.0, temp_quality="ok", setpoint_c=23.5, schedule_c=23.5,
             occupancy_prob=0.1, occupancy_evidence="test", in_scheduled_hours=True, override_hold_until=None, last_applied_c=None)
    z.update(kw)
    return NumericState(step=0, ts=T0, hour=10.0, outdoor_c=40.0, zones={zone: ZoneState(**z)})


@pytest.fixture
def loop_factory():
    def make(mode="shadow", live_ack=False, controller=None, start=T0.replace(hour=6), **cfg_kw):
        cfg = make_cfg(mode=mode, **cfg_kw)
        s = make_session()
        site = seed_site(s, cfg)
        sim = SimAdapter(cfg, start)
        loop = SiteLoop(s, site.id, cfg, sim, controller or RuleBasedController(), live_ack=live_ack)
        return loop, sim, s, cfg
    return make
