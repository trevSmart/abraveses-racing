"""Proves de túnels hidràulics: aigua sota un turó sense trinxera oberta."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import LineString

sys.path.insert(0, str(Path(__file__).resolve().parent))

from water import TUNNEL_COVER_M, Waterways, tunnel_mask, water_ref_profile  # noqa: E402


class TunnelDetectTest(unittest.TestCase):
    def test_marks_long_hill_cover_as_tunnel(self) -> None:
        # Vall – turó de 5 m / 20 m de llarg – vall (mostres cada 2 m, sentit aigües avall).
        step = 2.0
        smooth = np.concatenate(
            [
                np.full(10, 100.0),
                np.linspace(100.0, 105.0, 5),
                np.full(10, 105.0),
                np.linspace(105.0, 99.0, 5),
                np.full(10, 99.0),
            ]
        )
        tun = tunnel_mask(smooth, step_m=step)
        self.assertTrue(tun.any())
        self.assertGreaterEqual(float(tun.sum()) * step, 8.0)
        self.assertTrue(bool(tun[15:25].all()))
        self.assertFalse(bool(tun[:8].any()))
        self.assertFalse(bool(tun[-8:].any()))

    def test_short_bump_is_not_tunnel(self) -> None:
        step = 2.0
        smooth = np.concatenate([np.full(8, 100.0), np.full(2, 103.0), np.full(8, 99.5)])
        tun = tunnel_mask(smooth, step_m=step)
        self.assertFalse(bool(tun.any()))

    def test_ref_goes_under_hill_when_tunnel(self) -> None:
        step = 2.0
        smooth = np.concatenate(
            [
                np.full(8, 100.0),
                np.full(12, 100.0 + TUNNEL_COVER_M + 3.0),
                np.full(8, 99.0),
            ]
        )
        tun = tunnel_mask(smooth, step_m=step)
        ref = water_ref_profile(smooth, tun)
        crest = ref[8:20]
        self.assertTrue(bool(np.all(crest <= 100.0 + 0.05)))


class TunnelCarveTest(unittest.TestCase):
    def test_carve_skips_tunnel_segments(self) -> None:
        # Valls llargues perquè el suavitzat del perfil no contaminï el grau ideal.
        def dem(xs, ys):
            xs = np.asarray(xs, dtype=np.float64)
            return np.where((xs >= 40) & (xs <= 60), 106.0, 100.0)

        line = LineString([(0, 0), (100, 0)])
        gdf = gpd.GeoDataFrame({"kind": ["stream"], "geometry": [line]})
        cfg = {
            "waterways": {
                "stream": {"bed_m": 1.6, "bank_m": 2.6, "depth_m": 1.0, "water_frac": 0.35},
            }
        }
        water = Waterways(gdf, dem, origin=(0.0, 0.0), half=200.0, cfg=cfg)
        self.assertIsNotNone(water.tree)
        tunnels = [tun for _, _, _, _, _, tun in water.lines]
        self.assertTrue(any(bool(t.any()) for t in tunnels))

        xs = np.linspace(0, 100, 101)
        ys = np.zeros_like(xs)
        delta = water.carve(xs, ys, dem(xs, ys))
        crest = (xs >= 42) & (xs <= 58)
        self.assertTrue(np.allclose(delta[crest], 0.0, atol=1e-6), msg=f"crest delta={delta[crest]}")
        self.assertTrue(bool(np.any(delta[xs < 20] < -0.05)))


if __name__ == "__main__":
    unittest.main()
