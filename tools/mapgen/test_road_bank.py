"""El talús dels carrers asfaltats no ha de quedar amb l'ortofoto projectada."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_world import SHOULDER_FALLBACK_SRGB, bank_factor, shoulder_tone  # noqa: E402


class BankFactorTest(unittest.TestCase):
    def test_foot_of_a_paved_ramp_drops_the_photo(self) -> None:
        factor = bank_factor(np.array([0.0]), np.array([0.2]), reach_m=2.3)
        self.assertAlmostEqual(float(factor[0]), 1.0)

    def test_top_of_the_ramp_keeps_the_photo(self) -> None:
        factor = bank_factor(np.array([1.0]), np.array([1.6]), reach_m=2.3)
        self.assertAlmostEqual(float(factor[0]), 0.0)

    def test_mid_ramp_blends(self) -> None:
        factor = bank_factor(np.array([0.4]), np.array([1.0]), reach_m=2.3)
        self.assertAlmostEqual(float(factor[0]), 0.6)

    def test_dirt_ramp_keeps_the_photo(self) -> None:
        factor = bank_factor(np.array([0.0]), np.array([8.0]), reach_m=2.3)
        self.assertAlmostEqual(float(factor[0]), 0.0)


class ShoulderToneTest(unittest.TestCase):
    def test_pink_wall_does_not_tint_the_bank(self) -> None:
        rgb = np.full((5, 5, 3), (210, 150, 150), dtype=np.uint8)
        rgb[2, 2] = (180, 150, 110)
        tone = shoulder_tone(rgb, window=5)
        np.testing.assert_allclose(tone[2, 2], (180, 150, 110), atol=1)

    def test_wall_without_soil_uses_the_fallback(self) -> None:
        rgb = np.full((3, 3, 3), (210, 150, 150), dtype=np.uint8)
        tone = shoulder_tone(rgb, window=3)
        self.assertEqual(tuple(int(v) for v in tone[1, 1]), SHOULDER_FALLBACK_SRGB)

    def test_grass_stays_green(self) -> None:
        rgb = np.full((5, 5, 3), (90, 140, 70), dtype=np.uint8)
        tone = shoulder_tone(rgb, window=3)
        self.assertGreater(int(tone[2, 2, 1]), int(tone[2, 2, 0]))


if __name__ == "__main__":
    unittest.main()
