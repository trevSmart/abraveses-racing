"""Fitxes breus per al tooltip del mode dev (Maj+D).

    python tools/mapgen/house_cards.py

Llegeix les referències de `web/public/village.json`, el Cadastre, el carrer de l'OSM més
proper, el número de policia (Consulta_DNPRC) i `cases.yaml`, i escriu
`web/public/house_cards.json`. La foto és la de l'expedient
(`/facades/<ref>.jpg`, servida des de `data/cases`) o, si no n'hi ha, l'enllaç del Cadastre.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.config import ROOT, load_config  # noqa: E402
from village import _floors, load_house_specs, read_cadastre  # noqa: E402

CASES_DIR = ROOT / "data" / "cases"
FOTO_URL = (
    "http://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/"
    "RecuperarFotoFachadaGet?ReferenciaCatastral={ref}"
)
STREET_MAX_M = 40.0
USES = {
    "1_residential": "Habitatge",
    "2_agriculture": "Agrari",
    "3_industrial": "Industrial",
    "4_1_office": "Oficines",
    "4_2_retail": "Comerç",
    "4_3_publicServices": "Servei públic",
}
CONDITIONS = {
    "functional": "En ús",
    "declined": "Declinada",
    "ruin": "Ruïna",
}


def model_label(spec: dict | None, landmark: bool) -> str:
    """Com està modelada la casa al joc."""
    review = (spec or {}).get("review") or {}
    if spec is not None and review.get("level") == "full":
        return "Propi refinat"
    if spec is not None:
        return "Propi bàsic"
    if landmark:
        return "Model propi"
    return "Genèrica"


def year_of(beginning) -> int | None:
    text = str(beginning)[:4]
    if not text.isdigit():
        return None
    year = int(text)
    return year if 1800 <= year <= 2100 else None


def area_m2(value) -> int | None:
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


# Sufixos que el Cadastre enganxa al nom del carrer per dir el poble.
_VILLAGE_SUFFIXES = {"ABRAVES", "ABRAVESES", "ABRA", "ABR"}
_SMALL_WORDS = {"de", "la", "del", "el", "los", "las", "y"}
_STREET_TYPES = {
    "CL": "Calle",
    "AV": "Avenida",
    "CR": "Carretera",
    "PZ": "Plaza",
    "PL": "Plazuela",
    "CM": "Camino",
    "PS": "Paseo",
    "TR": "Travesía",
    "DS": "Diseminado",
    "GL": "Glorieta",
    "CJ": "Callejón",
}
ADDRESS_URL = (
    "https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/"
    "Consulta_DNPRC?RefCat={ref}"
)


def _fold(text: str) -> str:
    import unicodedata

    text = unicodedata.normalize("NFD", text.upper())
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


def _street_tokens(text: str) -> set[str]:
    """Paraules del nom, sense el tipus de via ni el sufix del poble."""
    skip = _VILLAGE_SUFFIXES | {w.upper() for w in _SMALL_WORDS} | set(_STREET_TYPES.values())
    skip |= set(_STREET_TYPES)
    return {w for w in _fold(text).replace(",", " ").split() if w not in skip and len(w) > 1}


def door_number(pnp, snp) -> str | None:
    """Número de policia del Cadastre. `snp` 0 vol dir que no hi ha lletra."""
    number = str(pnp or "").strip()
    if not number or set(number) <= {"0"}:
        return None
    if number.isdigit():
        number = str(int(number))
    letter = str(snp or "").strip()
    if letter.strip("0"):
        return f"{number}{letter}" if len(letter) == 1 else f"{number} {letter}"
    return number


def _pretty_cadastre_street(kind: str, name: str) -> str:
    words = [w for w in _fold(name).split() if w not in _VILLAGE_SUFFIXES]
    titled = []
    for i, word in enumerate(words):
        low = word.lower()
        titled.append(low if i and low in _SMALL_WORDS else low.capitalize())
    label = " ".join(titled)
    prefix = _STREET_TYPES.get(kind.upper(), "")
    if prefix and prefix.upper() not in _fold(label):
        return f"{prefix} {label}".strip()
    return label


def street_title(osm_name: str | None, number: str | None, cad_name: str | None, cad_type: str | None) -> str | None:
    """Nom del carrer i, si el Cadastre en dona, el número.

    El número només s'enganxa al carrer de l'OSM quan és el mateix vial. Si no ho és
    (un disseminat, o el carrer més proper no és el de l'adreça), es fa servir el
    nom oficial del Cadastre.
    """
    osm = (osm_name or "").strip() or None
    official = _pretty_cadastre_street(cad_type or "", cad_name or "") if cad_name else ""
    if number and osm and _street_tokens(osm) & _street_tokens(cad_name or ""):
        return f"{osm} {number}"
    if number and official:
        return f"{official} {number}"
    return osm


def address_from_payload(data: dict) -> dict:
    """`{number, name, type}` a partir de la resposta de Consulta_DNPRC. Buit si no hi ha via."""
    empty = {"number": None, "name": "", "type": ""}
    try:
        locs = data["consulta_dnprcResult"]["bico"]["bi"]["dt"]["locs"]["lous"]
    except (KeyError, TypeError):
        return empty
    if isinstance(locs, list):
        locs = locs[0] if locs else {}
    lourb = locs.get("lourb") if isinstance(locs, dict) else None
    if isinstance(lourb, list):
        lourb = lourb[0] if lourb else None
    direct = lourb.get("dir") if isinstance(lourb, dict) else None
    if isinstance(direct, list):
        direct = direct[0] if direct else None
    if not isinstance(direct, dict):
        return empty
    return {
        "number": door_number(direct.get("pnp"), direct.get("snp")),
        "name": str(direct.get("nv") or ""),
        "type": str(direct.get("tv") or ""),
    }


def photo_for(ref: str, document_link, cases_dir: Path = CASES_DIR) -> str | None:
    """Foto local de l'expedient, o l'enllaç públic del Cadastre."""
    if (cases_dir / ref / "cadastre_facana.jpg").is_file():
        return f"/facades/{ref}.jpg"
    link = str(document_link or "").strip()
    if link.startswith("http"):
        return link
    return FOTO_URL.format(ref=ref)


def compose_card(
    *,
    spec: dict | None,
    landmark: bool,
    use: str | None,
    year: int | None,
    area: int | None,
    dwellings: int | None,
    floors: int | None,
    parts: int,
    condition: str | None,
    street: str | None,
    photo: str | None,
) -> dict:
    """Camps que el joc sap pintar; els buits no hi entren."""
    card: dict = {"model": model_label(spec, landmark)}
    if street:
        card["street"] = street
    if use:
        card["use"] = use
    if year is not None:
        card["year"] = year
    if floors is not None and floors > 0:
        card["floors"] = floors
    if area is not None:
        card["areaM2"] = area
    if dwellings is not None:
        card["dwellings"] = dwellings
    if parts > 0:
        card["parts"] = parts
    if condition:
        card["condition"] = condition
    if photo:
        card["photo"] = photo
    return card


def _int_or_none(value) -> int | None:
    try:
        if value is None or str(value) in ("nan", "None", ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _street_index(cfg: dict):
    """Nom de carrer OSM → geometria UTM. None si no hi ha xarxa."""
    import geopandas as gpd
    from shapely.ops import unary_union

    path = Path(cfg["paths"]["osm_geojson"])
    if not path.is_file():
        return None
    osm = gpd.read_file(path).to_crs(epsg=int(cfg["utm_epsg"]))
    named = osm[osm["highway"].notna() & osm["name"].notna()]
    return {name: unary_union(list(g.geometry)) for name, g in named.groupby("name")}


def _nearest_street(streets, geom) -> str | None:
    if not streets or geom is None or geom.is_empty:
        return None
    name, dist = min(((n, s.distance(geom)) for n, s in streets.items()), key=lambda x: x[1])
    return str(name) if dist <= STREET_MAX_M else None


def _fetch_address(ref: str) -> dict | None:
    import requests

    try:
        res = requests.get(ADDRESS_URL.format(ref=ref), timeout=25, headers={"User-Agent": "abraveses-racing/0.1"})
        res.raise_for_status()
        return address_from_payload(res.json())
    except (requests.RequestException, ValueError):
        return None


def load_addresses(refs: set[str]) -> dict[str, dict]:
    """Número i carrer oficial del Cadastre, amb memòria cau a data/raw (fora del git)."""
    from concurrent.futures import ThreadPoolExecutor

    cache_path = ROOT / "data" / "raw" / "catastro" / "addresses.json"
    cache: dict[str, dict] = {}
    if cache_path.is_file():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
    missing = sorted(ref for ref in refs if ref not in cache)
    if not missing:
        return cache
    with ThreadPoolExecutor(max_workers=6) as pool:
        fetched = dict(zip(missing, pool.map(_fetch_address, missing)))
    ok = {ref: addr for ref, addr in fetched.items() if addr is not None}
    cache.update(ok)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Adreces del Cadastre: {len(ok)} de {len(missing)}")
    return cache


def build_cards(cfg: dict, refs: set[str]) -> dict[str, dict]:
    """Una fitxa per referència cadastral present al joc."""
    cad = Path(cfg["paths"]["cadastre_dir"])
    parts = read_cadastre(cad, "BuildingPart")
    parts["building"] = parts["localId"].astype(str).str.split("_part").str[0]
    parts = parts[parts["building"].isin(refs)]
    buildings = read_cadastre(cad, "Building").set_index("localId")
    specs = load_house_specs(Path(__file__).with_name("cases.yaml"))
    vd = cfg.get("village_detail", {})
    landmarks = {str(vd.get("church_ref", "")), str(vd.get("hermitage_ref", ""))} - {""}
    streets = _street_index(cfg)
    addresses = load_addresses(refs)

    from shapely.ops import unary_union

    cards: dict[str, dict] = {}
    for ref in sorted(refs):
        sub = parts[parts["building"] == ref]
        geom = unary_union(list(sub.geometry)) if len(sub) else None
        floors = sub["numberOfFloorsAboveGround"].apply(_floors) if len(sub) else None
        top = int(floors.max()) if floors is not None and len(floors) else 0
        row = buildings.loc[ref] if ref in buildings.index else None
        use = condition = None
        year = area = dwellings = None
        link = None
        if row is not None:
            raw_use = str(row.get("currentUse") or "")
            use = USES.get(raw_use)
            year = year_of(row.get("beginning"))
            area = area_m2(row.get("value"))
            dwellings = _int_or_none(row.get("numberOfDwellings"))
            raw_cond = str(row.get("conditionOfConstruction") or "")
            condition = CONDITIONS.get(raw_cond)
            link = row.get("documentLink")
        addr = addresses.get(ref) or {}
        cards[ref] = compose_card(
            spec=specs.get(ref),
            landmark=ref in landmarks,
            use=use,
            year=year,
            area=area,
            dwellings=dwellings,
            floors=top,
            parts=int(len(sub)),
            condition=condition,
            street=street_title(
                _nearest_street(streets, geom),
                addr.get("number"),
                addr.get("name"),
                addr.get("type"),
            ),
            photo=photo_for(ref, link),
        )
    return cards


def write_house_cards(cfg: dict, refs: set[str], path: Path | None = None) -> Path:
    out = path or (ROOT / "web" / "public" / "house_cards.json")
    cards = build_cards(cfg, {str(r) for r in refs if r})
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=2)
        f.write("\n")
    photos = sum(1 for c in cards.values() if str(c.get("photo", "")).startswith("/facades/"))
    print(f"Fitxes de casa → {out} ({len(cards)} cases, {photos} fotos locals)")
    return out


def main() -> None:
    village = ROOT / "web" / "public" / "village.json"
    if not village.is_file():
        sys.exit("Falta web/public/village.json: genera el món primer (build_world.py)")
    refs = set(json.loads(village.read_text(encoding="utf-8"))["houses"].values())
    write_house_cards(load_config(), refs)


if __name__ == "__main__":
    main()
