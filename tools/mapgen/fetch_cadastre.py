"""Download Catastro INSPIRE buildings, building parts and parcels around the detail streets."""

from __future__ import annotations

import sys
import time
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.config import load_config  # noqa: E402
from village import detail_zone_utm  # noqa: E402

# Dirección General del Catastro — serveis INSPIRE (dades obertes, cal citar la font).
WFS = {
    "Building": ("BU", "BU:Building"),
    "BuildingPart": ("BU", "BU:BuildingPart"),
    "CadastralParcel": ("CP", "CP:CadastralParcel"),
}
HEADERS = {"User-Agent": "abraveses-racing/0.1 (local mapgen; educational)"}


def _session() -> requests.Session:
    retry = Retry(total=8, backoff_factor=1.5, status_forcelist=(502, 503, 504), allowed_methods=["GET"])
    s = requests.Session()
    s.mount("http://", HTTPAdapter(max_retries=retry))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.headers.update(HEADERS)
    return s


def fetch_cadastre(grid: int | None = None) -> Path:
    """Baixa la zona en grid×grid trossos: el WFS del Cadastre limita l'àrea per petició."""
    cfg = load_config()
    grid = int(grid or cfg.get("cadastre_grid", 2))
    out_dir = Path(cfg["paths"]["cadastre_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    session = _session()
    zone = detail_zone_utm(cfg)
    minx, miny, maxx, maxy = zone.buffer(20).bounds
    xs = [minx + (maxx - minx) * i / grid for i in range(grid + 1)]
    ys = [miny + (maxy - miny) * j / grid for j in range(grid + 1)]
    for name, (service, typename) in WFS.items():
        for i in range(grid):
            for j in range(grid):
                params = {
                    "service": "wfs",
                    "version": "2.0.0",
                    "request": "GetFeature",
                    "typenames": typename,
                    "srsname": "EPSG::25830",
                    "bbox": f"{xs[i]:.0f},{ys[j]:.0f},{xs[i + 1]:.0f},{ys[j + 1]:.0f}",
                }
                url = f"http://ovc.catastro.meh.es/INSPIRE/wfs{service}.aspx"
                path = out_dir / f"{name}_{i}_{j}.gml"
                last_err: Exception | None = None
                for attempt in range(12):
                    try:
                        resp = session.get(url, params=params, timeout=180)
                        resp.raise_for_status()
                        if b"ExceptionReport" in resp.content[:600]:
                            raise RuntimeError(f"Catastro {name} ({i},{j}): {resp.text[:300]}")
                        path.write_bytes(resp.content)
                        print(f"  {name} {i},{j} → {path.name} ({len(resp.content) // 1024} KB)")
                        last_err = None
                        break
                    except (requests.RequestException, OSError) as e:
                        last_err = e
                        time.sleep(min(30, 2 ** attempt))
                if last_err is not None:
                    raise RuntimeError(f"Catastro {name} ({i},{j}) failed after retries: {last_err}") from last_err
                time.sleep(0.35)
    return out_dir


if __name__ == "__main__":
    fetch_cadastre()
