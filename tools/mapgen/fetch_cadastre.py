"""Download Catastro INSPIRE buildings, building parts and parcels around the detail streets."""

from __future__ import annotations

import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.config import ensure_parent, load_config  # noqa: E402
from village import detail_zone_utm  # noqa: E402

# Dirección General del Catastro — serveis INSPIRE (dades obertes, cal citar la font).
WFS = {
    "Building": ("BU", "BU:Building"),
    "BuildingPart": ("BU", "BU:BuildingPart"),
    "CadastralParcel": ("CP", "CP:CadastralParcel"),
}
HEADERS = {"User-Agent": "abraveses-racing/0.1 (local mapgen; educational)"}


def fetch_cadastre() -> Path:
    cfg = load_config()
    out_dir = Path(cfg["paths"]["cadastre_dir"])
    zone = detail_zone_utm(cfg)
    minx, miny, maxx, maxy = zone.buffer(20).bounds
    for name, (service, typename) in WFS.items():
        params = {
            "service": "wfs",
            "version": "2.0.0",
            "request": "GetFeature",
            "typenames": typename,
            "srsname": "EPSG::25830",
            "bbox": f"{minx:.0f},{miny:.0f},{maxx:.0f},{maxy:.0f}",
        }
        url = f"http://ovc.catastro.meh.es/INSPIRE/wfs{service}.aspx"
        print(f"Fetching cadastre {name}…")
        resp = requests.get(url, params=params, timeout=180, headers=HEADERS)
        resp.raise_for_status()
        if b"ExceptionReport" in resp.content[:600]:
            raise RuntimeError(f"Catastro {name}: {resp.text[:300]}")
        path = ensure_parent(out_dir / f"{name}.gml")
        path.write_bytes(resp.content)
        print(f"  → {path} ({len(resp.content) // 1024} KB)")
    return out_dir


if __name__ == "__main__":
    fetch_cadastre()
