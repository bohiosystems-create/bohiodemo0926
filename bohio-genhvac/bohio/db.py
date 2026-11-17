from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from bohio.config import SiteConfig
from bohio.models import Base, Point, Site, Zone


def make_session(url: str = "sqlite://") -> Session:
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)()


def seed_site(s: Session, cfg: SiteConfig, source: str = "sim") -> Site:
    """Create Site, Zones and the standard points for each zone (mapping confirmed by 'seed')."""
    site = Site(name=cfg.name, building_type=cfg.building_type, cooling_source=cfg.cooling_source,
                timezone=cfg.timezone, mode=cfg.mode, currency=cfg.currency)
    s.add(site); s.flush()
    s.add(Point(site_id=site.id, raw_name="OUTDOOR_T", source=source, quantity="outdoor_temp", unit="degC"))
    for zc in cfg.zones:
        z = Zone(site_id=site.id, name=zc.name, kind=zc.kind, occupancy_sensing=zc.occupancy_sensing,
                 comfort_min_c=zc.comfort_min_c, comfort_max_c=zc.comfort_max_c, max_step_c=zc.max_step_c)
        s.add(z); s.flush()
        for q, unit, writable in (("zone_temp", "degC", False), ("setpoint", "degC", True),
                                  ("occupancy", "bool", False), ("energy", "kWh", False)):
            s.add(Point(site_id=site.id, zone_id=z.id, raw_name=f"{zc.name}.{q}", source=source, quantity=q,
                        unit=unit, writable=writable, tags=[], mapping_confirmed_by="seed"))
    s.commit()
    return site
