"""Les cares que es veuen per sota (plafó del ràfec, sostre de lògia) han d'exportar normals
cap avall. `Trimesh.invert` gira el sentit però es deixa la caché de normals al revés, i el
glTF il·lumina el pla com si mirés al cel."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parent))

from village import RoofFrame, _eave_trim, _hip_roof_meshes, _quad, _slope_trim, roof_wings  # noqa: E402


class RoofNormalTest(unittest.TestCase):
    def test_hip_soffit_normals_point_down(self) -> None:
        poly = Polygon([(0, 0), (10, 0), (10, 6), (0, 6)])
        roof = RoofFrame.for_polygon(poly, eave=6.0, pitch_deg=22, hip=True)
        soffit = _eave_trim(roof, 0.45, (220, 214, 200))[-1]
        self.assertLess(float(soffit.vertex_normals[:, 1].mean()), -0.5)

    def test_wide_wing_ridge_stays_with_the_main(self) -> None:
        # L'ala més ampla no pot aixecar un pic per damunt del carener del cos.
        poly = Polygon([(0, 0), (14, 0), (14, 6), (8, 6), (8, 16), (0, 16)])
        wings = roof_wings(poly, 6.0, 22, True, 0.4, None, (180, 80, 60))
        self.assertIsNotNone(wings)
        main = wings.frames[0]
        main_ridge = 6.0 + main.slope * main.half_w
        top = max(float(m.vertices[:, 1].max()) for m in wings.meshes())
        self.assertLess(top, main_ridge + 0.08)

    def test_wing_soffit_normals_point_down(self) -> None:
        poly = Polygon([(0, 0), (12, 0), (12, 5), (5, 5), (5, 10), (0, 10)])
        wings = roof_wings(poly, 6.0, 22, True, 0.4, None, (180, 80, 60))
        soffit = wings.eave_trim(poly, 0.4, (220, 214, 200))[-1]
        self.assertLess(float(soffit.vertex_normals[:, 1].mean()), -0.5)

    def test_hip_roof_normals_point_up(self) -> None:
        poly = Polygon([(0, 0), (10, 0), (10, 6), (0, 6)])
        roof = RoofFrame.for_polygon(poly, eave=6.0, pitch_deg=22, hip=True)
        for mesh in _hip_roof_meshes(roof, 0.4, (180, 80, 60)):
            self.assertGreater(float(mesh.vertex_normals[:, 1].mean()), 0.5)

    def test_gable_soffit_normals_point_down(self) -> None:
        poly = Polygon([(0, 0), (12, 0), (12, 6), (0, 6)])
        roof = RoofFrame.for_polygon(poly, eave=6.0, pitch_deg=22, hip=False)
        outer = poly.buffer(0.35, join_style=2)
        trim = _slope_trim(outer, roof.z, 0.35, (220, 214, 200))
        soffits = [m for m in trim if float(m.vertex_normals[:, 1].mean()) < -0.5]
        self.assertTrue(soffits)
        # Només les vores del ràfec: el frontó no puja fins al carener.
        top = max(float(m.vertices[:, 1].max()) for m in trim)
        self.assertLess(top, 6.4)

    def test_flipped_quad_follows_outward(self) -> None:
        # El quadrat mira amunt; es demana que miri avall, així que s'ha de girar.
        down = np.array([0.0, -1.0, 0.0])
        mesh = _quad([0, 0, 0], [1, 0, 0], [1, 0, -1], [0, 0, -1], (200, 200, 200), down)
        self.assertGreater(float(np.dot(mesh.vertex_normals.mean(axis=0), down)), 0.5)


if __name__ == "__main__":
    unittest.main()
