"""Previsualització d'una casa amb fitxa i les seves tàpies, sobre terreny pla, sense regenerar el món.

    python tools/mapgen/preview_casa.py <ref>                    # → tmp/casa_<ref>.glb
    python tools/mapgen/preview_casa.py <ref> --cam E N h --target E N h

Construeix totes les parts de la casa com ho fa build_village (amb la fitxa de cases.yaml, `join`
inclòs) i les tàpies de walls.yaml de la mateixa parcel·la. Escriu també:

- les arestes finals de cada part (després de `join` i de simplificar), amb l'orientació, la
  llargada, el `nth` que li toca per a aquella orientació i la cantonada de t = 0 (UTM);
- les vores de la parcel·la (UTM), per situar-hi tàpies i portals;
- l'URL de la pàgina de previsualització (tmp/preview_casa.html) amb la càmera en coordenades UTM.

El terreny és pla (alçada 0): la càmera es dona en metres sobre el terra.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.config import ROOT, load_config  # noqa: E402
from village import (  # noqa: E402
    COMPASS_DEG, OpeningRegistry, WALL_PALETTE, _ccw, _floors, _lin, house_meshes, join_footprint,
    load_house_specs, read_cadastre, tapia_meshes,
)
from walls import load_wall_specs, resolve_wall_specs  # noqa: E402

PREVIEW_PORT = 8765


class Flat:
    def height(self, xs, ys, raised=True):
        return np.zeros(np.shape(np.atleast_1d(xs)))


def _compass(nx: float, ny: float) -> str:
    az = np.degrees(np.arctan2(nx, ny)) % 360
    names = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]
    return names[int((az + 22.5) // 45) % 8]


def _edges_report(name: str, poly, cx: float, cy: float) -> None:
    """Arestes tal com les veu house_meshes, amb el `nth` de cada orientació."""
    ext = np.array(_ccw(poly.simplify(0.15)).exterior.coords)[:-1]
    rows = []
    for i in range(len(ext)):
        a, b = ext[i], ext[(i + 1) % len(ext)]
        L = float(np.hypot(*(b - a)))
        n = ((b[1] - a[1]) / L, -(b[0] - a[0]) / L)
        rows.append((i, a, b, L, n))
    print(f"-- {name}: arestes (t = 0 a l'esquerra mirant la façana des de fora)")
    for i, a, b, L, n in rows:
        comp = _compass(*n)
        az = np.radians(COMPASS_DEG[comp])
        want = np.array([np.sin(az), np.cos(az)])
        ranked = sorted((r for r in rows if r[3] >= 1.5), key=lambda r: -float(np.dot(r[4], want)))
        nth = 1 + [r[0] for r in ranked].index(i) if L >= 1.5 else "-"
        print(f"   [{i}] {comp:>2} nth {nth}  {L:5.2f} m  t=0 a {a[0] + cx:.1f}, {a[1] + cy:.1f}"
              f"  → {b[0] + cx:.1f}, {b[1] + cy:.1f}")


def main() -> None:
    import trimesh
    from shapely import affinity
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    ap = argparse.ArgumentParser()
    ap.add_argument("ref")
    ap.add_argument("--cam", nargs=3, type=float, metavar=("E", "N", "H"), help="càmera (UTM i alçada)")
    ap.add_argument("--target", nargs=3, type=float, metavar=("E", "N", "H"), help="punt mirat (UTM i alçada)")
    args = ap.parse_args()
    ref = args.ref

    cfg = load_config()
    cad = Path(cfg["paths"]["cadastre_dir"])
    parts = read_cadastre(cad, "BuildingPart")
    parts["building"] = parts["localId"].astype(str).str.split("_part").str[0]
    key = parts["localId"].astype(str).str.split("_").str[-1]
    rows = parts[parts["building"] == ref]
    if rows.empty:
        sys.exit(f"Cap part del Cadastre amb referència {ref}")
    spec = load_house_specs(Path(__file__).with_name("cases.yaml")).get(ref)
    if spec is None:
        print(f"Avís: {ref} no té fitxa a cases.yaml; es fa genèrica")
    c = unary_union(list(rows.geometry)).centroid
    cx, cy = c.x, c.y
    print(f"== {ref} · origen de la previsualització (UTM) {cx:.1f}, {cy:.1f}")

    def local(g):
        return affinity.translate(g, -cx, -cy)

    # Feines com a build_village: diccionari de parts (cadascuna amb la seva fitxa i les altres
    # genèriques), llista (unides en una sola casa) o tota la casa.
    sel = (spec or {}).get("parts")
    if isinstance(sel, dict):
        common = {k: v for k, v in spec.items() if k != "parts"}
        jobs = [(k, rows[key[rows.index] == k], {**common, **(v or {})}) for k, v in sel.items()]
        jobs += [(k, rows[key[rows.index] == k], None) for k in sorted(set(key[rows.index]) - set(sel))]
    elif spec is not None:
        jobs = [("casa", rows[key[rows.index].isin(sel)] if sel else rows, spec)]
    else:
        jobs = [(k, rows[key[rows.index] == k], None) for k in sorted(set(key[rows.index]))]

    groups: dict[str, list] = {"building": [], "stone": [], "roof": [], "prop": [], "prop_windows": []}
    taken = OpeningRegistry()
    for name, sub, sp in jobs:
        if not len(sub):
            print(f"Avís: {name} no és al Cadastre")
            continue
        fp = unary_union([local(g) for g in sub.geometry])
        fp = max(getattr(fp, "geoms", [fp]), key=lambda g: g.area)
        if sp and sp.get("footprint") == "rect":
            fp = fp.minimum_rotated_rectangle
        if sp and sp.get("join"):
            other = unary_union([local(g) for g in rows[key[rows.index].isin(sp["join"])].geometry])
            fp, sp = join_footprint(fp, other), {**sp, "_shared": other}
        fl = int((sp or {}).get("floors", max(_floors(f) for f in sub["numberOfFloorsAboveGround"])))
        color = _lin(sp["wall"]) if sp and "wall" in sp else WALL_PALETTE[0]
        _edges_report(f"{name} ({fl} pl.{', fitxa' if sp else ', genèrica'})", fp, cx, cy)
        w, r, d, win = house_meshes(fp, fl, Flat(), color, lambda *a: False, None, 1, taken, sp)
        groups["building"] += [m for m in w if m.metadata.get("mat") != "stone"]
        groups["stone"] += [m for m in w if m.metadata.get("mat") == "stone"]
        groups["roof"] += r
        groups["prop"] += d
        groups["prop_windows"] += win
    # Volums que no surten al Cadastre (`extra_parts`), com a build_village.
    common = {k: v for k, v in (spec or {}).items() if k not in ("parts", "extra_parts")}
    for k, ep in enumerate((spec or {}).get("extra_parts", [])):
        fp = Polygon([(float(e) - cx, float(n) - cy) for e, n in ep["outline"]])
        sp = {**common, **{kk: v for kk, v in ep.items() if kk != "outline"}}
        color = _lin(sp["wall"]) if "wall" in sp else WALL_PALETTE[0]
        _edges_report(f"extra{k + 1} ({int(sp.get('floors', 1))} pl., fora del Cadastre)", fp, cx, cy)
        w, r, d, win = house_meshes(fp, int(sp.get("floors", 1)), Flat(), color, lambda *a: False, None, 1, taken, sp)
        groups["building"] += [m for m in w if m.metadata.get("mat") != "stone"]
        groups["stone"] += [m for m in w if m.metadata.get("mat") == "stone"]
        groups["roof"] += r
        groups["prop"] += d
        groups["prop_windows"] += win

    parcels = read_cadastre(cad, "CadastralParcel")
    prow = parcels[parcels["nationalCadastralReference"].astype(str) == ref]
    if len(prow):
        pg = prow.geometry.iloc[0]
        pg = max(getattr(pg, "geoms", [pg]), key=lambda g: g.area)
        print("-- parcel·la: vores (UTM)")
        coords = list(_ccw(pg).exterior.coords)
        for a, b in zip(coords[:-1], coords[1:]):
            L = float(np.hypot(b[0] - a[0], b[1] - a[1]))
            if L >= 1.0:
                n = ((b[1] - a[1]) / L, -(b[0] - a[0]) / L)
                print(f"   {_compass(*n):>2} {L:5.2f} m  {a[0]:.1f}, {a[1]:.1f} → {b[0]:.1f}, {b[1]:.1f}")

    # Tàpies de walls.yaml d'aquesta parcel·la, amb les mateixes coordenades locals.
    parcels["geometry"] = parcels.geometry.translate(-cx, -cy)
    wspecs = {k: v for k, v in load_wall_specs(Path(__file__).with_name("walls.yaml")).items() if str(v.get("parcel")) == ref}
    if wspecs:
        house_u = unary_union([local(g) for g in rows.geometry])
        lines, sps = [], []
        # Carrers de l'OSM (per a `along: street`), en les mateixes coordenades locals.
        roads = Polygon()
        try:
            import geopandas as gpd

            osm = gpd.read_file(cfg["paths"]["osm_geojson"]).to_crs(epsg=int(cfg["utm_epsg"]))
            roads = unary_union([local(g) for g in osm[osm["highway"].notna()].geometry]).buffer(2.5)
        except Exception:  # noqa: BLE001 — sense OSM, `along: street` no troba cap vora
            pass
        for ln, s in resolve_wall_specs(wspecs, parcels, roads, cx, cy):
            rest = ln.difference(house_u.buffer(0.2))
            for g in getattr(rest, "geoms", [rest]):
                if g.length > 0.8:
                    lines.append(g)
                    sps.append(s)
        built = [(ln, s) for ln, s in zip(lines, sps) if str(s.get("material")) != "none"]
        wm, wc = tapia_meshes([ln for ln, _ in built], Flat(), [s for _, s in built])
        groups["building"] += [m for m in wm if m.metadata.get("wall_mat") != "stone"]
        groups["stone"] += [m for m in wm if m.metadata.get("wall_mat") == "stone"]
        groups["prop"] += wc

    out_dir = ROOT / "tmp"
    out_dir.mkdir(exist_ok=True)
    scene = trimesh.Scene()
    for name, ms in groups.items():
        if ms:
            scene.add_geometry(trimesh.util.concatenate(ms), node_name=name, geom_name=name)
    glb = out_dir / f"casa_{ref}.glb"
    scene.export(glb)
    page = out_dir / "preview_casa.html"
    shutil.copyfile(Path(__file__).with_name("preview_casa.html"), page)

    def world(e: float, n: float, h: float) -> str:
        return f"{e - cx:.1f},{h:.1f},{-(n - cy):.1f}"

    cam = world(*args.cam) if args.cam else "-12,8,14"
    target = world(*args.target) if args.target else "0,3,0"
    print(f"→ {glb.relative_to(ROOT)}")
    print(f"   cd tmp && python3 -m http.server {PREVIEW_PORT}   (si no hi és)")
    print(f"   http://localhost:{PREVIEW_PORT}/preview_casa.html?glb={glb.name}&cam={cam}&target={target}&fov=65")


if __name__ == "__main__":
    main()
