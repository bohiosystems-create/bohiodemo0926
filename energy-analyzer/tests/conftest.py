import pytest

from energy_analyzer.context import SiteData
from energy_analyzer.sample_data import Waste, sample_building, sample_config


@pytest.fixture(scope="session")
def wasteful():
    kwh, temp = sample_building()
    return kwh, temp


@pytest.fixture(scope="session")
def clean():
    kwh, temp = sample_building(waste=Waste.none())
    return kwh, temp


@pytest.fixture(scope="session")
def wasteful_ctx(wasteful):
    kwh, temp = wasteful
    return SiteData.build(sample_config(), kwh, temp)


@pytest.fixture(scope="session")
def clean_ctx(clean):
    kwh, temp = clean
    return SiteData.build(sample_config(), kwh, temp)
