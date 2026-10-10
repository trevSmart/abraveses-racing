"""Proves de la fitxa breu que ensenya el tooltip del mode dev."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from house_cards import (  # noqa: E402
    address_from_payload,
    compose_card,
    door_number,
    model_label,
    photo_for,
    street_title,
    year_of,
)


class HouseCardTest(unittest.TestCase):
    def test_model_label_follows_review(self) -> None:
        self.assertEqual(model_label({"review": {"level": "full"}}, False), "Propi refinat")
        self.assertEqual(model_label({"wall": [1, 2, 3]}, False), "Propi bàsic")
        self.assertEqual(model_label(None, True), "Model propi")
        self.assertEqual(model_label(None, False), "Genèrica")

    def test_year_ignores_placeholders(self) -> None:
        self.assertEqual(year_of("1978-01-01T00:00:00"), 1978)
        self.assertIsNone(year_of("0001-01-01"))
        self.assertIsNone(year_of(None))

    def test_compose_drops_empty_fields(self) -> None:
        card = compose_card(
            spec={"review": {"level": "full"}},
            landmark=False,
            use="Habitatge",
            year=1978,
            area=120,
            dwellings=1,
            floors=2,
            parts=3,
            condition="En ús",
            street="Calle Calzada",
            photo="/facades/0232109TM6503S.jpg",
        )
        self.assertEqual(card["model"], "Propi refinat")
        self.assertEqual(card["street"], "Calle Calzada")
        self.assertEqual(card["floors"], 2)
        self.assertNotIn("floors", compose_card(
            spec=None, landmark=False, use=None, year=None, area=None, dwellings=None,
            floors=0, parts=0, condition=None, street=None, photo=None,
        ))

    def test_photo_prefers_local_facade(self) -> None:
        cases = Path(__file__).resolve().parents[2] / "data" / "cases"
        ref = "0232109TM6503S"
        if not (cases / ref / "cadastre_facana.jpg").is_file():
            self.skipTest("sense foto local")
        self.assertEqual(photo_for(ref, "http://example.test/foto", cases), f"/facades/{ref}.jpg")

    def test_street_title_adds_the_cadastre_number(self) -> None:
        self.assertEqual(street_title("Calle Calzada", "7", "CALZADA ABRAVES", "CL"), "Calle Calzada 7")
        self.assertEqual(
            street_title("Calle Santibáñez", "4", "SANTIBAÑEZ ABRA", "CL"),
            "Calle Santibáñez 4",
        )
        self.assertEqual(street_title("Calle El Cristo", "20", "EL CRISTO ABR", "CL"), "Calle El Cristo 20")
        # El carrer més proper de l'OSM no és el de l'adreça: es fa servir el nom oficial.
        self.assertEqual(street_title("Calle Santiago", "12", "CALZADA ABRAVES", "CL"), "Calle Calzada 12")
        self.assertEqual(street_title(None, "24", "DISEMINADOS ABR", "DS"), "Diseminados 24")
        self.assertEqual(street_title("Calle Calzada", None, "", ""), "Calle Calzada")

    def test_door_number_drops_empty_qualifier(self) -> None:
        self.assertEqual(door_number("007", "0"), "7")
        self.assertEqual(door_number("12", "A"), "12A")
        self.assertIsNone(door_number("0", "0"))
        self.assertIsNone(door_number("", ""))

    def test_address_from_payload_reads_the_door(self) -> None:
        direct = {"tv": "CL", "nv": "CALZADA ABRAVES", "pnp": "7", "snp": "0"}
        payload = {"consulta_dnprcResult": {"bico": {"bi": {"dt": {"locs": {"lous": {"lourb": {"dir": direct}}}}}}}}
        self.assertEqual(
            address_from_payload(payload),
            {"number": "7", "name": "CALZADA ABRAVES", "type": "CL"},
        )
        self.assertEqual(address_from_payload({}), {"number": None, "name": "", "type": ""})

    def test_photo_falls_back_to_cadastre_link(self) -> None:
        link = "http://ovc.catastro.meh.es/foto"
        self.assertEqual(photo_for("NO_EXISTEIX", link, Path("/tmp/cases-buides")), link)


if __name__ == "__main__":
    unittest.main()
