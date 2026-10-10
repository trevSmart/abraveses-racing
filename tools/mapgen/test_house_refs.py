"""Proves del registre house_id → referència cadastral (mode DEV)."""

from __future__ import annotations

import itertools
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from shapely.geometry import Polygon  # noqa: E402

from village import assign_house, drop_modeled_extras  # noqa: E402


class AssignHouseTest(unittest.TestCase):
    def test_assign_house_tags_mesh_and_records_cadastral_ref(self) -> None:
        mesh = SimpleNamespace(vertices=[(0, 0, 0), (1, 0, 0)], vertex_attributes={})
        house_ids = itertools.count(1)
        house_refs: dict[str, str] = {}

        hid = assign_house([mesh], house_ids, house_refs, "002000300TM55D")

        self.assertEqual(hid, 1)
        self.assertEqual(house_refs, {"1": "002000300TM55D"})
        self.assertTrue(all(v == 1.0 for v in mesh.vertex_attributes["_HOUSE"]))

    def test_assign_house_skips_empty_ref(self) -> None:
        mesh = SimpleNamespace(vertices=[(0, 0, 0)], vertex_attributes={})
        house_ids = itertools.count(7)
        house_refs: dict[str, str] = {}

        hid = assign_house([mesh], house_ids, house_refs, None)

        self.assertEqual(hid, 7)
        self.assertEqual(house_refs, {})
        self.assertEqual(list(mesh.vertex_attributes["_HOUSE"]), [7.0])


class DropModeledExtrasTest(unittest.TestCase):
    def test_drops_blob_covered_by_extra_part_outline(self) -> None:
        blob = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)])
        other = Polygon([(20, 20), (24, 20), (24, 24), (20, 24)])
        specs = {"X": {"extra_parts": [{"outline": [(10, 30), (14, 30), (14, 34), (10, 34)]}]}}

        kept = drop_modeled_extras([blob, other], specs, 10, 30)

        self.assertEqual(kept, [other])


if __name__ == "__main__":
    unittest.main()
