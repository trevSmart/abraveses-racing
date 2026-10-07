"""Download the orthophoto for exactly the terrain square (UTM), so texture and OSM line up."""

from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.config import ensure_parent, load_config, utm_origin  # noqa: E402

# PNOA Máxima Actualidad (IGN): ortofoto oficial 25 cm o millor, CC BY 4.0 scne.es.
PNOA_WMS = "https://www.ign.es/wms-inspire/pnoa-ma"
# Esri World Imagery — fallback (dev / educational use; see game credits).
ESRI_EXPORT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"

HEADERS = {"User-Agent": "abraveses-racing/0.1 (local mapgen; educational)"}
TILE_PX = 2048  # els dos serveis limiten a 4096 px per petició; trossos més petits fallen menys


def _pnoa_request(epsg: int, bbox: tuple[float, float, float, float], px: int) -> dict:
    minx, miny, maxx, maxy = bbox
    return {
        "url": PNOA_WMS,
        "params": {
            "SERVICE": "WMS",
            "REQUEST": "GetMap",
            "VERSION": "1.3.0",
            "LAYERS": "OI.OrthoimageCoverage",
            "STYLES": "",
            "CRS": f"EPSG:{epsg}",
            # En CRS projectats WMS 1.3.0 l'ordre d'eixos és est, nord.
            "BBOX": f"{minx},{miny},{maxx},{maxy}",
            "WIDTH": px,
            "HEIGHT": px,
            "FORMAT": "image/jpeg",
        },
    }


def _esri_request(epsg: int, bbox: tuple[float, float, float, float], px: int) -> dict:
    minx, miny, maxx, maxy = bbox
    return {
        "url": ESRI_EXPORT,
        "params": {
            "bbox": f"{minx},{miny},{maxx},{maxy}",
            "bboxSR": str(epsg),
            "imageSR": str(epsg),
            "size": f"{px},{px}",
            "format": "jpg",
            "f": "image",
        },
    }


SOURCES = {"pnoa": _pnoa_request, "esri": _esri_request}


def _download_mosaic(source: str, epsg: int, ox: float, oy: float, size_m: float, pixels: int) -> Image.Image:
    tiles = max(1, -(-pixels // TILE_PX))
    tile_px = pixels // tiles
    tile_m = size_m / tiles
    x0 = ox - size_m / 2.0
    y_top = oy + size_m / 2.0
    mosaic = Image.new("RGB", (tile_px * tiles, tile_px * tiles))
    for row in range(tiles):
        for col in range(tiles):
            bbox = (
                x0 + col * tile_m,
                y_top - (row + 1) * tile_m,
                x0 + (col + 1) * tile_m,
                y_top - row * tile_m,
            )
            req = SOURCES[source](epsg, bbox, tile_px)
            resp = requests.get(req["url"], params=req["params"], timeout=180, headers=HEADERS)
            resp.raise_for_status()
            if not resp.headers.get("Content-Type", "").startswith("image/"):
                raise RuntimeError(f"{source} no ha retornat una imatge: {resp.text[:200]}")
            tile = Image.open(BytesIO(resp.content)).convert("RGB")
            mosaic.paste(tile, (col * tile_px, row * tile_px))
            print(f"  {source} tile {row * tiles + col + 1}/{tiles * tiles}")
    return mosaic


def fetch_ortho(pixels: int | None = None) -> Path | None:
    cfg = load_config()
    out_path = ensure_parent(cfg["paths"]["ortho_jpg"])
    pixels = int(pixels or cfg.get("ortho_px", 4096))
    size_m = float(cfg["terrain_size_m"])
    ox, oy = utm_origin(cfg)
    epsg = int(cfg["utm_epsg"])
    preferred = str(cfg.get("ortho_source", "pnoa"))
    order = [preferred] + [s for s in SOURCES if s != preferred]

    for source in order:
        print(f"Fetching orthophoto from {source} ({pixels}px, {size_m / pixels * 100:.0f} cm/px)…")
        try:
            img = _download_mosaic(source, epsg, ox, oy, size_m, pixels)
        except Exception as exc:  # noqa: BLE001
            print(f"  {source} failed ({exc})")
            continue
        img.save(out_path, quality=85, optimize=True, progressive=True)
        print(f"Orthophoto → {out_path} ({source})")
        return out_path
    print("Orthophoto skipped. Terrain will use flat color.")
    return None


if __name__ == "__main__":
    fetch_ortho()
