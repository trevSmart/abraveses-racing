"""Download OSM features (roads, buildings, greens) for the configured bbox."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import LineString, Polygon, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.config import ensure_parent, load_config  # noqa: E402

GREEN_LANDUSE = {"grass", "meadow", "forest", "orchard", "vineyard", "farmland"}
GREEN_LEISURE = {"park", "garden", "pitch", "playground", "recreation_ground"}
GREEN_NATURAL = {"wood", "scrub", "grassland", "tree_row"}


def _is_green_tags(tags: dict) -> bool:
    return (
        tags.get("landuse") in GREEN_LANDUSE
        or tags.get("leisure") in GREEN_LEISURE
        or tags.get("natural") in GREEN_NATURAL
    )


def _way_line_or_polygon(tags: dict, coords: list[tuple[float, float]]):
    is_road = "highway" in tags
    is_building = "building" in tags
    is_green = _is_green_tags(tags)
    if is_building or is_green:
        if len(coords) < 3:
            return None
        if coords[0] != coords[-1]:
            coords = coords + [coords[0]]
        return Polygon(coords)
    if is_road and len(coords) >= 2:
        return LineString(coords)
    return None


def _relation_multipolygon(tags: dict, el: dict) -> Polygon | None:
    if tags.get("type") != "multipolygon":
        return None
    outers: list[list[tuple[float, float]]] = []
    for member in el.get("members", []):
        if member.get("role") != "outer" or member.get("type") != "way":
            continue
        geom = member.get("geometry")
        if not geom:
            continue
        ring = [(p["lon"], p["lat"]) for p in geom]
        if len(ring) >= 3:
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            outers.append(ring)
    if not outers:
        return None
    if len(outers) == 1:
        return Polygon(outers[0])
    return Polygon(outers[0], outers[1:])


def overpass_to_geojson(elements: list[dict]) -> dict:
    features = []
    for el in elements:
        tags = el.get("tags") or {}
        is_road = "highway" in tags
        is_building = "building" in tags
        is_green = _is_green_tags(tags)
        if not is_road and not is_building and not is_green:
            continue

        geom = None
        if el["type"] == "way" and "geometry" in el:
            coords = [(p["lon"], p["lat"]) for p in el["geometry"]]
            geom = _way_line_or_polygon(tags, coords)
        elif el["type"] == "relation" and (is_building or is_green):
            geom = _relation_multipolygon(tags, el)
        if geom is None or geom.is_empty:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": tags,
                "geometry": geom.__geo_interface__,
            }
        )

    return {"type": "FeatureCollection", "features": features}


def fetch_osm() -> Path:
    cfg = load_config()
    bbox = cfg["bbox_wgs84"]
    south, west, north, east = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    query = f"""
    [out:json][timeout:180];
    (
      way["highway"]({south},{west},{north},{east});
      nwr["building"]({south},{west},{north},{east});
      way["landuse"~"grass|meadow|forest|orchard|vineyard|farmland"]({south},{west},{north},{east});
      way["leisure"~"park|garden|pitch|playground|recreation_ground"]({south},{west},{north},{east});
      way["natural"~"wood|scrub|grassland|tree_row"]({south},{west},{north},{east});
      relation["landuse"~"grass|meadow|forest|orchard|vineyard|farmland"]({south},{west},{north},{east});
      relation["leisure"~"park|garden|pitch|playground|recreation_ground"]({south},{west},{north},{east});
      relation["natural"~"wood|scrub|grassland"]({south},{west},{north},{east});
    );
    out geom;
    """
    urls = cfg.get("overpass_urls") or [cfg["overpass_url"]]
    headers = {
        "User-Agent": "abraveses-racing/0.1 (local mapgen)",
        "Accept": "application/json",
    }
    last_err: Exception | None = None
    resp = None
    for attempt in range(4):
        for url in urls:
            print(f"Querying Overpass ({url})…")
            try:
                resp = requests.post(url, data={"data": query}, timeout=180, headers=headers)
                if resp.status_code == 406:
                    resp = requests.get(url, params={"data": query}, timeout=180, headers=headers)
                resp.raise_for_status()
                break
            except Exception as exc:
                last_err = exc
                print(f"  failed: {exc}")
                resp = None
        if resp is not None:
            break
        if attempt < 3:
            wait_s = 15 * (attempt + 1)
            print(f"  cap servidor ha respost; es torna a provar d'aquí {wait_s} s")
            time.sleep(wait_s)
    if resp is None:
        raise RuntimeError(f"All Overpass endpoints failed: {last_err}")
    data = resp.json()
    geojson = overpass_to_geojson(data.get("elements", []))
    out_path = ensure_parent(cfg["paths"]["osm_geojson"])
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(geojson, f)
    gdf = gpd.GeoDataFrame.from_features(geojson["features"], crs="EPSG:4326")
    bldg = int(gdf["building"].notna().sum()) if "building" in gdf.columns else 0
    print(f"Saved {len(gdf)} features ({bldg} buildings) → {out_path}")
    return out_path


if __name__ == "__main__":
    fetch_osm()
