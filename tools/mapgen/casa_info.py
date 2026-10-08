"""Expedient d'una casa per fer-ne la fitxa de cases.yaml: dades del Cadastre, parts amb la
façana de cada orientació, foto de façana del Cadastre, retall de l'ortofoto i enllaços de
Street View des del carrer.

    python tools/mapgen/casa_info.py 0132102TM6503S            # per referència cadastral
    python tools/mapgen/casa_info.py --near 259920 4653015     # l'edifici més proper (UTM)

Tot queda desat a data/cases/<ref>/ (l'expedient permanent de la casa):
    expedient.txt          aquesta sortida
    cadastre_facana.jpg    foto de façana del Cadastre (no se sobreescriu si el servei falla)
    ortofoto.png           retall de l'ortofoto amb les parts
    notes.md               plantilla per a les mesures i les observacions (no se sobreescriu)
    streetview/            captures de Street View: només referència, fora del git
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.config import ROOT, load_config, utm_origin  # noqa: E402
from village import COMPASS_DEG, _ccw, read_cadastre  # noqa: E402

CASES_DIR = ROOT / "data" / "cases"
FOTO_URL = "http://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/RecuperarFotoFachadaGet?ReferenciaCatastral={ref}"
PANO_URL = "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat:.7f},{lon:.7f}&heading={heading:.0f}&pitch=8&fov=100"


def _compass(nx: float, ny: float) -> str:
    az = np.degrees(np.arctan2(nx, ny)) % 360
    return min(("N", "NE", "E", "SE", "S", "SO", "O", "NO"), key=lambda k: abs((COMPASS_DEG[k] - az + 180) % 360 - 180))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ref", nargs="?")
    ap.add_argument("--near", nargs=2, type=float, metavar=("E", "N"))
    args = ap.parse_args()
    log: list[str] = []

    def say(text: str) -> None:
        print(text)
        log.append(text)

    from pyproj import Transformer
    from shapely.geometry import Point
    from shapely.ops import unary_union

    cfg = load_config()
    cad = Path(cfg["paths"]["cadastre_dir"])
    parts = read_cadastre(cad, "BuildingPart")
    parts["building"] = parts["localId"].astype(str).str.split("_part").str[0]
    ref = args.ref
    if args.near:
        p = Point(*args.near)
        ref = str(parts.loc[parts.distance(p).idxmin(), "building"])
    rows = parts[parts["building"] == ref]
    if rows.empty:
        sys.exit(f"Cap part del Cadastre amb referència {ref}")

    buildings = read_cadastre(cad, "Building")
    b = buildings[buildings["localId"] == ref]
    say(f"== {ref}")
    if len(b):
        r = b.iloc[0]
        say(f"   ús {r.get('currentUse')} · {r.get('numberOfDwellings')} habitatges · {r.get('value')} m² construïts"
              f" · construïda {str(r.get('beginning'))[:4]} · {r.get('conditionOfConstruction')}")

    to_wgs = Transformer.from_crs(f"EPSG:{cfg['utm_epsg']}", "EPSG:4326", always_xy=True)
    roads = None
    try:
        import geopandas as gpd

        osm = gpd.read_file(cfg["paths"]["osm_geojson"]).to_crs(epsg=int(cfg["utm_epsg"]))
        roads = unary_union(list(osm[osm["highway"].notna()].geometry))
    except Exception:  # noqa: BLE001 — sense OSM no hi ha punts de vista, la resta funciona
        pass

    for _, row in rows.sort_values("localId").iterrows():
        g = row.geometry
        g = max(getattr(g, "geoms", [g]), key=lambda q: q.area)
        key = str(row["localId"]).split("_")[-1]
        c = g.centroid
        say(f"-- {key}: {row['numberOfFloorsAboveGround']} plantes · {g.area:.0f} m² · centre UTM {c.x:.1f}, {c.y:.1f}")
        ext = np.array(_ccw(g.simplify(0.15)).exterior.coords)[:-1]
        for i in range(len(ext)):
            a, bb = ext[i], ext[(i + 1) % len(ext)]
            L = float(np.hypot(*(bb - a)))
            if L < 2.0:
                continue
            nx, ny = (bb[1] - a[1]) / L, -(bb[0] - a[0]) / L
            m = (a + bb) / 2
            line = f"     façana {_compass(nx, ny):>2}: {L:5.2f} m, esquerra (t=0) a {a[0]:.1f}, {a[1]:.1f}"
            probe = Point(m[0] + nx * 0.5, m[1] + ny * 0.5)
            if any(o.buffer(0.2).contains(probe) for o in parts.geometry if o.distance(probe) < 1):
                say(line + " (mitgera: toca una altra part o un altre edifici)")
                continue
            if roads is not None:
                # Punt de vista: el carrer més proper davant de la façana, mirant-la de cara.
                q = roads.interpolate(roads.project(Point(m[0] + nx * 8, m[1] + ny * 8)))
                if q.distance(Point(*m)) < 25 and np.dot([q.x - m[0], q.y - m[1]], [nx, ny]) > 0:
                    lon, lat = to_wgs.transform(q.x, q.y)
                    heading = np.degrees(np.arctan2(-nx, -ny)) % 360
                    line += f"\n        Street View: {PANO_URL.format(lat=lat, lon=lon, heading=heading)}"
            say(line)

    out = CASES_DIR / ref
    (out / "streetview").mkdir(parents=True, exist_ok=True)
    try:
        res = requests.get(FOTO_URL.format(ref=ref), timeout=40)
        if res.ok and res.headers.get("content-type", "").startswith("image"):
            (out / "cadastre_facana.jpg").write_bytes(res.content)
            say(f"Foto de façana del Cadastre → {out / 'cadastre_facana.jpg'}")
        else:
            say(f"Foto de façana del Cadastre: no disponible ({res.status_code})")
    except requests.RequestException as e:
        say(f"Foto de façana del Cadastre: error ({e}); torna-ho a provar")

    _ortho_crop(cfg, rows, out / "ortofoto.png")
    say(f"Ortofoto amb les parts → {out / 'ortofoto.png'}")
    (out / "expedient.txt").write_text("\n".join(log) + "\n", encoding="utf-8")
    notes = out / "notes.md"
    if not notes.exists():
        notes.write_text(NOTES_TEMPLATE.format(ref=ref), encoding="utf-8")
    print(f"Expedient → {out}")


NOTES_TEMPLATE = """# {ref}

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de Street View: `expedient.txt`.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg` (data de la foto: …)
- Street View (data del panell, adreça, enllaç i rumb de cada captura de `streetview/`):
  - …

## Façanes

Per a cada façana vista des d'un carrer: orientació, llargada cadastral, materials, i cada
obertura amb la seva `t`, mides i alçades, i d'on surt cada mesura.

## Dubtes i decisions

- …
"""


def _ortho_crop(cfg: dict, rows, path: Path, margin: float = 14.0) -> None:
    from PIL import Image, ImageDraw
    from shapely.ops import unary_union

    ox, oy = utm_origin(cfg)
    size = float(cfg["terrain_size_m"])
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(cfg["paths"]["ortho_master"])
    s = im.size[0] / size
    minx, miny, maxx, maxy = unary_union(list(rows.geometry)).buffer(margin).bounds

    def px(x, y):
        return (x - ox + size / 2) * s, (size / 2 - (y - oy)) * s

    x0, y0 = px(minx, maxy)
    x1, y1 = px(maxx, miny)
    crop = im.crop((int(x0), int(y0), int(x1), int(y1))).convert("RGB")
    k = 800 / crop.size[0]
    crop = crop.resize((800, int(crop.size[1] * k)), Image.LANCZOS)
    d = ImageDraw.Draw(crop)
    for _, row in rows.iterrows():
        for p in getattr(row.geometry, "geoms", [row.geometry]):
            d.line([((px(*q)[0] - int(x0)) * k, (px(*q)[1] - int(y0)) * k) for q in p.exterior.coords], fill=(255, 220, 0), width=3)
            c = p.centroid
            d.text(((px(c.x, c.y)[0] - int(x0)) * k, (px(c.x, c.y)[1] - int(y0)) * k), str(row["localId"]).split("_")[-1], fill=(255, 255, 0))
    crop.save(path)


if __name__ == "__main__":
    main()
