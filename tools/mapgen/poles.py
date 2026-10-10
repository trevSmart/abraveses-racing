"""Postes de la xarxa elèctrica i els cables que els uneixen.

Les posicions surten de Street View (setembre 2024), anotades a `poles.yaml`. No s'hi posa
cap píxel de Google: el pal és un model genèric de formigó, i el fanal, un braç sobre el
carrer. Els pals tenen col·lisió (`building_poles`); els cables, no (`prop_wires`).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh
import yaml
from shapely.geometry import Point

from village import _srgb_to_linear, _w

# Formigó gris, cables negres, braç del fanal i carcassa.
CONCRETE = (174, 168, 158)
CONCRETE_DARK = (128, 122, 112)
WIRE = (42, 42, 44)
ARM = (70, 70, 72)
LAMP = (214, 210, 196)
# Tres cables, separats en vertical, amb una fletxa al mig del tram.
CABLE_DROP_M = (0.55, 0.85, 1.15)
CABLE_SAG_M = 0.7
CABLE_MAX_M = 72.0
POLE_H_M = 9.4


def load_poles(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or []
    return list(data)


def _lin(c) -> tuple[int, int, int]:
    r, g, b, _ = _srgb_to_linear(c)
    return r, g, b


def _paint(mesh: trimesh.Trimesh, color) -> trimesh.Trimesh:
    mesh.visual.vertex_colors = np.tile([*_lin(color), 255], (len(mesh.vertices), 1)).astype(np.uint8)
    return mesh


def _to_y_up(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """El cilindre de trimesh va al llarg de Z; el món és Y amunt."""
    mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    return mesh


def _tapered_pole(height: float, r0: float, r1: float) -> trimesh.Trimesh:
    mesh = trimesh.creation.cylinder(radius=1.0, height=height, sections=8)
    mesh.apply_translation([0, 0, height / 2])
    v = mesh.vertices
    t = np.clip(v[:, 2] / height, 0, 1)
    radius = r0 * (1 - t) + r1 * t
    v[:, 0] *= radius
    v[:, 1] *= radius
    mesh.vertices = v
    return _to_y_up(mesh)


def _place(mesh: trimesh.Trimesh, x: float, y: float, z: float) -> trimesh.Trimesh:
    """Local (x est, y nord) i alçada → món."""
    mesh.apply_translation(_w(x, y, z))
    return mesh


def _ribbon(a, b, width: float, color) -> trimesh.Trimesh:
    """Un cable pla entre dos punts del món, amb amplada horitzontal."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    d = b - a
    length = float(np.linalg.norm(d))
    if length < 0.05:
        return trimesh.Trimesh()
    # Direcció horitzontal perpendicular al tram, perquè el cable es vegi de costat.
    horiz = np.array([d[0], 0.0, d[2]])
    hn = float(np.linalg.norm(horiz))
    side = np.array([-d[2], 0.0, d[0]]) / length if hn < 1e-4 else np.array([-horiz[2], 0.0, horiz[0]]) / max(hn, 1e-6)
    side *= width / 2
    up = np.array([0.0, width / 2, 0.0])
    v = np.array([a - side, a + side, b + side, b - side, a - up, a + up, b + up, b - up])
    f = np.array([
        [0, 1, 2], [0, 2, 3],
        [4, 6, 5], [4, 7, 6],
    ])
    # Les dues cares: el material del joc només il·lumina el davant.
    f = np.vstack([f, f[:, ::-1]])
    return _paint(trimesh.Trimesh(vertices=v, faces=f, process=False), color)


def _catenary(p0, p1, sag: float, steps: int = 7) -> list[np.ndarray]:
    pts = []
    for i in range(steps + 1):
        t = i / steps
        p = p0 * (1 - t) + p1 * t
        p = p.copy()
        p[1] -= sag * 4 * t * (1 - t)
        pts.append(p)
    return pts


def _pole_meshes(x, y, z0, height, toward, lamp: bool) -> tuple[list, list]:
    """Retorna (sòlids amb col·lisió, detalls sense). `toward` és (dx, dy) cap al carrer."""
    solid = [_paint(_tapered_pole(height, 0.15, 0.075), CONCRETE)]
    # Anella més fosca a dalt, on s'agafen els cables.
    band = _paint(_tapered_pole(0.18, 0.09, 0.085), CONCRETE_DARK)
    band.apply_translation([0, height - 0.7, 0])
    solid.append(band)
    props = []
    if lamp and float(np.hypot(*toward)) > 1e-3:
        ux, uy = toward / np.hypot(*toward)
        # Braç horitzontal cap al carrer i capçal. Sense col·lisió: passa per sobre la calçada.
        arm = _paint(trimesh.creation.box(extents=[1.55, 0.07, 0.07]), ARM)
        # El braç neix al llarg de +X; el carrer, al món, és (est, −nord).
        ang = float(np.arctan2(uy, ux))
        arm.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 1, 0]))
        arm.apply_translation([ux * 0.7, height - 1.15, -uy * 0.7])
        head = _paint(trimesh.creation.box(extents=[0.42, 0.12, 0.22]), LAMP)
        head.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 1, 0]))
        head.apply_translation([ux * 1.45, height - 1.22, -uy * 1.45])
        props += [arm, head]
    for m in solid + props:
        _place(m, x, y, z0)
    return solid, props


def _order(points: list[np.ndarray]) -> list[int]:
    """Encadena els pals pel veí més proper, començant pel de més a l'oest."""
    left = set(range(len(points)))
    cur = min(left, key=lambda i: points[i][0])
    left.remove(cur)
    order = [cur]
    while left:
        nxt = min(left, key=lambda i: float(np.linalg.norm(points[i] - points[cur])))
        if float(np.linalg.norm(points[nxt] - points[cur])) > CABLE_MAX_M:
            # Un altre tram de la mateixa línia, massa lluny per un cable: se'n comença un de nou.
            nxt = min(left, key=lambda i: points[i][0])
        left.remove(nxt)
        order.append(nxt)
        cur = nxt
    return order


def build_power_poles(cfg: dict, ground, ox: float, oy: float) -> list[tuple[str, trimesh.Trimesh]]:
    path = Path(__file__).resolve().parent / "poles.yaml"
    specs = load_poles(path)
    if not specs:
        return []

    solids: list = []
    props: list = []
    by_line: dict[str, list[np.ndarray]] = {}
    for spec in specs:
        e, n = float(spec["at"][0]), float(spec["at"][1])
        x, y = e - ox, n - oy
        z0 = float(np.asarray(ground.height(x, y)).reshape(-1)[0])
        height = float(spec.get("height_m", POLE_H_M))
        # El braç del fanal mira cap al carrer més proper.
        road = ground.road_distance(np.array([x]), np.array([y]))
        toward = np.array([0.0, -1.0])
        if np.isfinite(road).all():
            eps = 0.8
            dx = float(ground.road_distance(np.array([x + eps]), np.array([y])) - road)
            dy = float(ground.road_distance(np.array([x]), np.array([y + eps])) - road)
            if abs(dx) + abs(dy) > 1e-3:
                toward = -np.array([dx, dy])
        s, p = _pole_meshes(x, y, z0, height, toward, bool(spec.get("lamp")))
        solids += s
        props += p
        raw_line = spec.get("line") or spec.get("id") or "sol"
        lines = raw_line if isinstance(raw_line, list) else [raw_line]
        top = np.array(_w(x, y, z0 + height - 0.35), dtype=float)
        for line in lines:
            by_line.setdefault(str(line), []).append(top)

    for tops in by_line.values():
        if len(tops) < 2:
            continue
        order = _order(tops)
        for a, b in zip(order, order[1:]):
            span = float(np.linalg.norm(tops[b] - tops[a]))
            if span > CABLE_MAX_M or span < 4:
                continue
            for drop in CABLE_DROP_M:
                p0 = tops[a].copy()
                p1 = tops[b].copy()
                p0[1] -= drop
                p1[1] -= drop
                pts = _catenary(p0, p1, CABLE_SAG_M)
                for u, v in zip(pts, pts[1:]):
                    props.append(_ribbon(u, v, 0.055, WIRE))

    out = []
    if solids:
        mesh = trimesh.util.concatenate(solids)
        mesh.fix_normals()
        out.append(("building_poles", mesh))
    if props:
        mesh = trimesh.util.concatenate([m for m in props if len(m.faces)])
        mesh.fix_normals()
        out.append(("prop_wires", mesh))
    n = len(specs)
    print(f"Postes: {n} pals, {sum(len(g) for g in by_line.values())} a {len(by_line)} línies")
    return out
