"""Un mur amb fitxa que talla la calçada s'enretira cap a la parcel·la.

La vora del Cadastre de vegades entra al carrer de l'OSM. Només es mou si la major part
del tram hi és més d'un metre: un solapament de vorera es deixa on és.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))

from walls import _clear_of_road, resolve_wall_specs  # noqa: E402


def _road() -> Polygon:
    """Calçada de 6 m (de y = -1 a y = 5) al llarg de l'eix y = 2."""
    return LineString([(0, 2), (30, 2)]).buffer(3.0)


class WallRoadTest(unittest.TestCase):
    def test_deep_wall_moves_just_outside_the_road(self) -> None:
        # y = 0.5 és a 1,5 m dins la vora sud (y = -1).
        edge = LineString([(2, 0.5), (16, 0.5)])
        cleared = _clear_of_road(edge, np.array([0.0, -1.0]), _road())
        for _, y in cleared.coords:
            self.assertLess(y, -1.05)
            self.assertGreater(y, -1.5)
        self.assertFalse(cleared.intersects(_road()))

    def test_shallow_overlap_stays(self) -> None:
        edge = LineString([(2, -0.6), (16, -0.6)])
        cleared = _clear_of_road(edge, np.array([0.0, -1.0]), _road())
        self.assertTrue(cleared.equals(edge))

    def test_side_road_does_not_drag_the_wall_into_the_field(self) -> None:
        # El cap de ponent cau en un camí que baixa cap al camp. El mur s'aparta de la
        # calçada, però no es deforma seguint aquest camí.
        street = LineString([(0, 2), (30, 2)]).buffer(3.0)
        side = LineString([(2, 2), (2, -20)]).buffer(3.0)
        edge = LineString([(2, 0.5), (16, 0.5)])
        roads = unary_union([street, side])
        cleared = _clear_of_road(edge, np.array([0.0, -1.0]), roads)
        self.assertIsNotNone(cleared)
        self.assertGreater(cleared.length, edge.length * 0.7)
        ys = [y for _, y in cleared.coords]
        self.assertTrue(all(y < -1.05 for y in ys))
        self.assertLess(max(ys) - min(ys), 0.05)
        self.assertFalse(cleared.intersects(roads))

    def test_wall_running_along_a_road_is_removed(self) -> None:
        side = LineString([(2, 0), (2, -30)]).buffer(3.0)
        edge = LineString([(2, -6), (2, -16)])
        cleared = _clear_of_road(edge, np.array([0.0, -1.0]), side)
        self.assertIsNone(cleared)

    def test_wall_outside_stays(self) -> None:
        edge = LineString([(2, -3.0), (16, -3.0)])
        cleared = _clear_of_road(edge, np.array([0.0, -1.0]), _road())
        self.assertTrue(cleared.equals(edge))

    def test_gate_follows_the_moved_wall(self) -> None:
        # Parcel·la al sud de la calçada; la vora nord (y = 0.5) hi entra 1,5 m.
        parcel = Polygon([(0, -20), (20, -20), (20, 0.5), (0, 0.5)])
        parcels = gpd.GeoDataFrame({"nationalCadastralReference": ["X"]}, geometry=[parcel])
        specs = {
            "X-carrer": {
                "parcel": "X",
                "near": [10.0, 0.5],
                "thick_m": 0.28,
                "gates": [{"near": [8.0, 0.5], "w": 1.8, "h": 1.2}],
            }
        }
        jobs = resolve_wall_specs(specs, parcels, _road(), 0.0, 0.0)
        self.assertEqual(len(jobs), 1)
        line, spec = jobs[0]
        self.assertFalse(line.intersects(_road()))
        at = Point(spec["gates"][0]["at"])
        self.assertLess(line.distance(at), 0.3)
        self.assertLess(at.y, -1.0)
