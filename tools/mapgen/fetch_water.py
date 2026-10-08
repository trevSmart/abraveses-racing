"""Download the IGN hydrographic network (rivers, streams, ditches, canals) for the configured bbox."""

from __future__ import annotations

import re
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests
from shapely.geometry import LineString

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.config import ensure_parent, load_config  # noqa: E402

# IGN — Información Geográfica de Referencia: Hidrografía (INSPIRE, CC BY 4.0). A diferència de
# l'OSM, inclou els rierols estacionals i les sèquies de rec, amb el tipus i l'amplada.
WFS_URL = "https://servicios.idee.es/wfs-inspire/hidrografia"
HEADERS = {"User-Agent": "abraveses-racing/0.1 (local mapgen; educational)"}


def _kind(local_type: str, persistence: str) -> str:
    """river / stream / canal / ditch: és la classe que fa servir water.py per a la secció del llit."""
    t = local_type.lower()
    if "acequia" in t:
        return "ditch"
    if "canal" in t:
        return "canal"
    return "river" if persistence == "perennial" else "stream"


def _parse(gml: str) -> list[dict]:
    rows = []
    for member in re.findall(r"<wfs:member>(.*?)</wfs:member>", gml, re.S):
        name = re.search(r"<gn:text>([^<]+)</gn:text>", member)
        local_type = re.search(r"<hy-p:localType>.*?>([^<]+)</gmd:LocalisedCharacterString>", member, re.S)
        persistence = re.search(r'<hy-p:persistence[^>]*href="[^"]*/([^/"]+)"', member)
        width = re.search(r"<hy-p:lower[^>]*>([\d.]+)</hy-p:lower>\s*<hy-p:upper[^>]*>([\d.]+)</hy-p:upper>", member)
        kind = _kind(local_type.group(1) if local_type else "", persistence.group(1) if persistence else "")
        for pos in re.findall(r"<gml:posList[^>]*>([^<]+)</gml:posList>", member):
            xy = np.array(pos.split(), dtype=float).reshape(-1, 2)
            if len(xy) < 2:
                continue
            rows.append(
                {
                    "name": name.group(1) if name else None,
                    "kind": kind,
                    "width_min_m": float(width.group(1)) if width else None,
                    "width_max_m": float(width.group(2)) if width else None,
                    "geometry": LineString(xy),
                }
            )
    return rows


def fetch_water() -> Path:
    cfg = load_config()
    bbox = cfg["bbox_wgs84"]
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": "hy-p:Watercourse",
        "SRSNAME": "EPSG:25830",
        # EPSG:4258 en WFS 2.0 va en ordre lat, lon.
        "BBOX": f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']},urn:ogc:def:crs:EPSG::4258",
        "COUNT": "2000",
    }
    print(f"Querying IGN hydrography ({WFS_URL})…")
    resp = requests.get(WFS_URL, params=params, timeout=180, headers=HEADERS)
    resp.raise_for_status()
    if "ExceptionReport" in resp.text[:600]:
        raise RuntimeError(f"IGN hydrography: {resp.text[:300]}")
    rows = _parse(resp.text)
    gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs=f"EPSG:{cfg['utm_epsg']}").to_crs(epsg=4326)
    out_path = ensure_parent(cfg["paths"]["water_geojson"])
    gdf.to_file(out_path, driver="GeoJSON")
    counts = gdf["kind"].value_counts().to_dict() if len(gdf) else {}
    print(f"Saved {len(gdf)} watercourses {counts} → {out_path}")
    return out_path


if __name__ == "__main__":
    fetch_water()
