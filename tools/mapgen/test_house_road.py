"""Una façana que entra a la calçada es tira enrere; un voral no es mou.

El Cadastre de vegades deixa el mur dins del carrer de l'OSM. La casa queda ficada a la
carretera. Només es mou l'aresta que hi és de debò, paral·lela a ella mateixa.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

from shapely.geometry import LineString, Polygon

sys.path.insert(0, str(Path(__file__).resolve().parent))

from village import _retract_from_road  # noqa: E402


def _road() -> Polygon:
    """Calçada de 6 m (de y = -1 a y = 5) al llarg de l'eix y = 2."""
    return LineString([(0, 2), (40, 2)]).buffer(3.0)


class HouseRoadTest(unittest.TestCase):
    def test_facade_inside_the_road_steps_back(self) -> None:
        # Mur nord a y = 0.5: a 1,5 m dins la vora sud de la calçada (y = -1).
        house = Polygon([(2, -6), (14, -6), (14, 0.5), (2, 0.5)])
        out = _retract_from_road(house, _road())
        north = max(y for _, y in out.exterior.coords)
        self.assertLess(north, -1.05)
        self.assertGreater(north, -1.6)
        self.assertFalse(out.intersects(_road()))
        # El mur del fons no es mou.
        self.assertAlmostEqual(min(y for _, y in out.exterior.coords), -6.0, places=2)

    def test_shallow_overlap_stays(self) -> None:
        house = Polygon([(2, -6), (14, -6), (14, -0.6), (2, -0.6)])
        out = _retract_from_road(house, _road())
        self.assertTrue(house.equals(out))

    def test_no_road_stays(self) -> None:
        house = Polygon([(0, 0), (4, 0), (4, 3), (0, 3)])
        self.assertTrue(house.equals(_retract_from_road(house, None)))


if __name__ == "__main__":
    unittest.main()
