import unittest

from gateway.guardrails import Guardrails, ZoneLimits


class GuardrailTests(unittest.TestCase):
    def setUp(self):
        self.g = Guardrails(limits={"z": ZoneLimits(min_c=22, max_c=26, max_step_change_c=0.5)})

    def test_ok_within_limits(self):
        d = self.g.apply("z", 24.3, schedule_setpoint=24.0, reading_age_s=0)
        self.assertEqual((d.applied, d.reason), (24.3, "ok"))

    def test_clamped_then_rate_limited(self):
        d = self.g.apply("z", 30.0, schedule_setpoint=24.0, reading_age_s=0)
        self.assertEqual(d.applied, 24.5)
        self.assertEqual(d.reason, "rate_limited")

    def test_clamped_only(self):
        self.g.last_applied["z"] = 25.8
        d = self.g.apply("z", 27.0, schedule_setpoint=24.0, reading_age_s=0)
        self.assertEqual((d.applied, d.reason), (26.0, "clamped"))

    def test_stale_data_falls_back(self):
        d = self.g.apply("z", 24.5, schedule_setpoint=24.0, reading_age_s=5000)
        self.assertEqual((d.applied, d.reason), (24.0, "fallback:stale_data"))

    def test_nan_and_none_fall_back(self):
        for bad in (None, float("nan")):
            d = self.g.apply("z", bad, schedule_setpoint=23.5, reading_age_s=0)
            self.assertEqual(d.applied, 23.5)
            self.assertTrue(d.reason.startswith("fallback"))

    def test_unknown_zone_falls_back(self):
        d = self.g.apply("other", 24.0, schedule_setpoint=23.0, reading_age_s=0)
        self.assertEqual(d.reason, "fallback:unknown_zone")


if __name__ == "__main__":
    unittest.main()
