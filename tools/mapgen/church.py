"""Església de Santiago Apòstol d'Abraveses de Tera, modelada a partir de la seva planta cadastral
i de les descripcions i l'ortofoto:

- nau d'una sola volada en maçoneria, amb la capçalera (capella major, s. XV–XVI) més alta a l'est;
- espadanya de carreus a la façana oest amb dos ulls de campana de mig punt, frontó i creu, amb
  un gran niu de cigonya al capdamunt, i el "tejadillo adosado" (cos baix d'un aiguavés) al costat;
- entrada pel carrer de l'església: porxo sota el vessant allargat de la teulada, obert al carrer
  amb tres arcs de mig punt; al fons, porta ampla de doble fulla amb arc de grans dovelles;
- contraforts a la capçalera, finestres espitllerades i teulades de teula àrab.

Coordenades: locals del joc (x est, y nord) i món (x, alçada, z = −nord), com a village.py.
"""

from __future__ import annotations

import numpy as np
import trimesh
from shapely.geometry import Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

STONE = (168, 152, 128)  # maçoneria de pissarra i quarsita, to gris torrat
ASHLAR = (192, 176, 146)  # carreus de l'espadanya i la portada
WOOD = (82, 52, 30)
BRONZE = (122, 92, 48)
IRON = (40, 38, 36)
NEST = (96, 76, 52)
NEST_STICKS = (134, 110, 76)
NEST_HOLLOW = (62, 48, 34)
WINDOW = (30, 28, 26)

NAVE_EAVE = 6.8
CHANCEL_EAVE = 7.8
PITCH = np.radians(22)
# Fondària del porxo d'entrada: la franja de la planta cadastral del costat del carrer.
PORCH_DEPTH = 4.0


class Frame:
    """Eixos de l'església: `a` al llarg de la nau (cap a l'est), `b` perpendicular (cap al nord)."""

    def __init__(self, poly: Polygon) -> None:
        rect = poly.minimum_rotated_rectangle
        xs, ys = rect.exterior.coords.xy
        e1 = np.array([xs[1] - xs[0], ys[1] - ys[0]])
        e2 = np.array([xs[2] - xs[1], ys[2] - ys[1]])
        long_e, short_e = (e1, e2) if np.linalg.norm(e1) >= np.linalg.norm(e2) else (e2, e1)
        self.length = float(np.linalg.norm(long_e))
        self.width = float(np.linalg.norm(short_e))
        a = long_e / self.length
        if a[0] < 0:  # la capçalera mira a l'est
            a = -a
        self.a = a
        self.b = np.array([-a[1], a[0]])  # a girat 90° a l'esquerra: cap al nord
        c = rect.centroid
        self.c = np.array([c.x, c.y])

    def sub(self, u: float, v: float, rotate: bool = False) -> "Frame":
        """Marc desplaçat a (u, v); amb `rotate`, girat 90° (a ← b): per a volums transversals."""
        f = object.__new__(Frame)
        f.c = self.local(u, v)
        f.a = self.b.copy() if rotate else self.a.copy()
        f.b = np.array([-f.a[1], f.a[0]])
        f.length, f.width = (self.width, self.length) if rotate else (self.length, self.width)
        return f

    def local(self, u: float, v: float) -> np.ndarray:
        """(u al llarg de la nau, v cap al nord) → local (x, y)."""
        return self.c + self.a * u + self.b * v

    def world(self, u: float, v: float, h: float) -> list[float]:
        x, y = self.local(u, v)
        return [float(x), float(h), float(-y)]

    @property
    def yaw(self) -> float:
        """Rotació al voltant de l'eix Y del món que porta +X a la direcció `a`."""
        return float(np.arctan2(self.a[1], self.a[0]))


def _colored(mesh: trimesh.Trimesh, color: tuple[int, int, int]) -> trimesh.Trimesh:
    mesh.visual.vertex_colors = np.tile([*color, 255], (len(mesh.vertices), 1)).astype(np.uint8)
    return mesh


def _box(f: Frame, u: float, v: float, z0: float, z1: float, du: float, dv: float, color, yaw_extra: float = 0.0):
    """Caixa centrada a (u, v) amb mides du (llarg de la nau) × dv, de z0 a z1."""
    m = trimesh.creation.box(extents=[du, z1 - z0, dv])
    m.apply_transform(trimesh.transformations.rotation_matrix(f.yaw + yaw_extra, [0, 1, 0]))
    m.apply_translation(f.world(u, v, (z0 + z1) / 2))
    return _colored(m, color)


def _extrude_profile(f: Frame, profile: Polygon, u0: float, thickness: float, color) -> trimesh.Trimesh:
    """Perfil dibuixat en el pla (v, alçada) i extrudit al llarg de la nau des de u0 (cap a +u)."""
    m = trimesh.creation.extrude_polygon(profile, height=thickness)
    # Perfil: x = v, y = alçada; extrusió: z = u. Ho passem a (u, alçada, v) i després al món.
    v, h, u = m.vertices[:, 0], m.vertices[:, 1], m.vertices[:, 2] + u0
    pts = f.c[None, :] + np.outer(u, f.a) + np.outer(v, f.b)
    m.vertices = np.column_stack([pts[:, 0], h, -pts[:, 1]])
    trimesh.repair.fix_normals(m)
    return _colored(m, color)


def _gable_volume(f: Frame, u0: float, u1: float, half_w: float, base: float, eave: float, color):
    """Volum de parets amb frontons (perfil de casa) entre u0 i u1."""
    ridge = eave + np.tan(PITCH) * half_w
    profile = Polygon([(-half_w, base), (half_w, base), (half_w, eave), (0, ridge), (-half_w, eave)])
    return _extrude_profile(f, profile, u0, u1 - u0, color), ridge


def _ridge_rgb(f: Frame) -> list[int]:
    """Direcció del carener al món (x, z) codificada com a color, igual que a les cases."""
    ux, uy = f.a
    return [int(round((ux * 0.5 + 0.5) * 255)), int(round((-uy * 0.5 + 0.5) * 255)), 0, 255]


def _roof(
    f: Frame,
    u0: float,
    u1: float,
    half_w: float,
    eave: float,
    overhang: float = 0.4,
    extend_side: int = 0,
    extend: float = 0.0,
) -> list[trimesh.Trimesh]:
    """Dues aigües de teula sobre el volum, amb ràfec. El color de vèrtex codifica el carener
    (com a les cases) perquè el joc hi alineï les fileres de teules. L'aigua del costat
    `extend_side` (±1) s'allarga `extend` metres amb el mateix pendent (un porxo a sota)."""
    ridge = eave + np.tan(PITCH) * half_w
    out = []
    for side in (-1, 1):
        reach = overhang + (extend if side == extend_side else 0.0)
        drop = np.tan(PITCH) * reach
        e = side * (half_w + reach)
        quad = [
            f.world(u0 - overhang, 0, ridge + 0.05),
            f.world(u1 + overhang, 0, ridge + 0.05),
            f.world(u1 + overhang, e, eave - drop + 0.05),
            f.world(u0 - overhang, e, eave - drop + 0.05),
        ]
        m = trimesh.Trimesh(vertices=np.array(quad), faces=np.array([[0, 1, 2], [0, 2, 3]]), process=False)
        if m.face_normals[:, 1].mean() < 0:
            m.invert()
        m.visual.vertex_colors = np.tile(_ridge_rgb(f), (4, 1)).astype(np.uint8)
        out.append(m)
    return out


def _arch_hole(cx: float, bottom: float, width: float, height: float, segments: int = 12) -> list[tuple[float, float]]:
    """Obertura d'arc de mig punt en el pla (v, alçada)."""
    r = width / 2
    spring = bottom + height - r
    pts = [(cx - r, bottom), (cx + r, bottom), (cx + r, spring)]
    for i in range(1, segments):
        t = np.pi * i / segments
        pts.append((cx + r * np.cos(t), spring + r * np.sin(t)))
    pts.append((cx - r, spring))
    return pts


def _extrude_front(f: Frame, profile: Polygon, v0: float, thickness: float, color) -> trimesh.Trimesh:
    """Perfil dibuixat en el pla (u, alçada), paral·lel a la nau, i extrudit des de v0 (cap a +v)."""
    m = trimesh.creation.extrude_polygon(profile, height=thickness)
    u, h, v = m.vertices[:, 0], m.vertices[:, 1], m.vertices[:, 2] + v0
    pts = f.c[None, :] + np.outer(u, f.a) + np.outer(v, f.b)
    m.vertices = np.column_stack([pts[:, 0], h, -pts[:, 1]])
    trimesh.repair.fix_normals(m)
    return _colored(m, color)


def _slab(f: Frame, profile: Polygon, v_wall: float, out: int, offset: float, thickness: float, color) -> trimesh.Trimesh:
    """Peça plana (perfil en u, alçada) sobre un mur a v_wall, des de `offset` fins a `offset +
    thickness` cap enfora (`out` = ±1 en v)."""
    a, b = v_wall + out * offset, v_wall + out * (offset + thickness)
    return _extrude_front(f, profile, min(a, b), thickness, color)


def _stork_nest(f: Frame, u: float, v: float, bottom: float, radius: float = 1.7, height: float = 1.4) -> list[trimesh.Trimesh]:
    """Niu de cigonya gros: tronc de con de branques (més ample a dalt), cavitat fosca i branques
    que sobresurten. Irregular però sempre igual (llavor fixa)."""
    rng = np.random.default_rng(12)
    body = trimesh.creation.cylinder(radius=1.0, height=height, sections=22)  # eix z, centrat
    vtx = body.vertices.copy()
    t = vtx[:, 2] / height + 0.5  # 0 a baix, 1 a dalt
    scale = radius * (0.55 + 0.45 * t) * (1 + rng.uniform(-0.09, 0.09, len(vtx)))
    vtx[:, :2] *= scale[:, None]
    vtx[:, 2] += rng.uniform(-0.08, 0.08, len(vtx)) * t
    body.vertices = vtx
    up = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])  # eix z → amunt
    body.apply_transform(up)
    body.apply_translation(f.world(u, v, bottom + height / 2))
    out = [_colored(body, NEST)]

    hollow = trimesh.creation.cylinder(radius=radius * 0.72, height=0.1, sections=18)
    hollow.apply_transform(up)
    hollow.apply_translation(f.world(u, v, bottom + height - 0.06))
    out.append(_colored(hollow, NEST_HOLLOW))

    cx, cy, cz = f.world(u, v, bottom + height - 0.2)
    for i in range(18):
        phi = 2 * np.pi * i / 18 + rng.uniform(-0.15, 0.15)
        stick = trimesh.creation.box(extents=[rng.uniform(1.2, 2.0), 0.08, 0.08])
        stick.apply_transform(trimesh.transformations.rotation_matrix(rng.uniform(-0.35, 0.35), [0, 0, 1]))
        stick.apply_transform(trimesh.transformations.rotation_matrix(-phi + np.pi / 2 + rng.uniform(-0.5, 0.5), [0, 1, 0]))
        r = radius * rng.uniform(0.85, 1.0)
        stick.apply_translation([cx + np.cos(phi) * r, cy + rng.uniform(-0.25, 0.1), cz + np.sin(phi) * r])
        out.append(_colored(stick, NEST_STICKS))
    return out


def church_meshes(poly: Polygon, ground, toward: tuple[float, float] | None = None) -> tuple[list, list, list]:
    """(pedra amb col·lisió, teulades, detalls sense col·lisió). `toward`: punt del carrer on dona
    l'entrada; el porxo es fa al costat llarg de la planta que hi mira (per defecte, el nord)."""
    f = Frame(poly)
    L, W = f.length, f.width
    outer = W / 2 - 0.3  # mig ample de la planta (fins a la cara del porxo al carrer)
    g = [float(ground.height(*f.local(u, v))) for u in (-L / 2, 0, L / 2) for v in (-outer, outer)]
    base = min(g) - 0.4
    floor = max(g) + 0.1

    # Costat del carrer (s = ±1 en v): allà la planta inclou el porxo; la nau és la resta.
    s = 1
    if toward is not None:
        s = 1 if float(np.dot(np.asarray(toward) - f.c, f.b)) >= 0 else -1
    half_w = (2 * outer - PORCH_DEPTH) / 2
    fn = f.sub(0, -s * PORCH_DEPTH / 2)  # eix de la nau
    v_wall = s * half_w  # mur de la nau que dona al porxo
    v_front = s * (half_w + PORCH_DEPTH)  # cara dels arcs, al carrer

    stone, roofs, details = [], [], []
    west, east = -L / 2 + 0.3, L / 2 - 0.3
    chancel_start = east - min(8.5, L * 0.32)
    nave_eave = floor + NAVE_EAVE

    # Nau i capçalera (la capella major, més alta). L'aigua del carrer s'allarga sobre el porxo.
    nave, nave_ridge = _gable_volume(fn, west, chancel_start, half_w, base, nave_eave, STONE)
    chancel, chancel_ridge = _gable_volume(fn, chancel_start, east, half_w + 0.15, base, floor + CHANCEL_EAVE, STONE)
    stone += [nave, chancel]
    roofs += _roof(fn, west, chancel_start, half_w, nave_eave, extend_side=s, extend=PORCH_DEPTH)
    roofs += _roof(fn, chancel_start, east, half_w + 0.15, floor + CHANCEL_EAVE)

    # Contraforts a les cantonades de la capçalera.
    for v in (-1, 1):
        stone.append(_box(fn, east - 0.2, v * (half_w + 0.55), base, floor + 5.2, 1.4, 0.9, STONE))
        stone.append(_box(fn, chancel_start + 0.6, v * (half_w + 0.6), base, floor + 4.6, 1.0, 1.0, STONE))

    # Porxo: mur d'arcs al carrer, sota el ràfec, i murs de tancament als extrems seguint el pendent.
    slope = np.tan(PITCH)
    front_top = nave_eave - slope * PORCH_DEPTH
    arc_w, arc_h, arc_step, arc_t = 2.8, 3.6, 4.0, 0.6
    pu = (west + chancel_start) / 2
    arch_us = [pu - arc_step, pu, pu + arc_step]
    openings = [
        Polygon(_arch_hole(cu, floor - 0.1, arc_w, arc_h)).union(box(cu - arc_w / 2, base - 1, cu + arc_w / 2, floor))
        for cu in arch_us
    ]
    arcade = box(west, base, chancel_start, front_top).difference(unary_union(openings))
    for piece in getattr(arcade, "geoms", [arcade]):
        stone.append(_slab(fn, piece, v_front, -s, 0.0, arc_t, STONE))
    # Arquivoltes de carreus sobre cada arc i imposta a l'arrencada.
    for cu in arch_us:
        ring = Polygon(_arch_hole(cu, floor - 0.1, arc_w + 0.7, arc_h + 0.35)).difference(
            Polygon(_arch_hole(cu, floor - 0.1, arc_w, arc_h)).union(box(cu - arc_w, base - 1, cu + arc_w, floor + arc_h - arc_w / 2 - 0.1))
        )
        for piece in getattr(ring, "geoms", [ring]):
            details.append(_slab(fn, piece, v_front, s, -0.02, 0.1, ASHLAR))
        for side in (-1, 1):
            imp_u = cu + side * (arc_w / 2 + 0.2)
            details.append(_box(fn, imp_u, v_front - s * arc_t / 2, floor + arc_h - arc_w / 2 - 0.25, floor + arc_h - arc_w / 2 - 0.05, 0.5, arc_t + 0.16, ASHLAR))
    for u0 in (west, chancel_start - 0.6):
        end = orient(Polygon([(v_wall, base), (v_front, base), (v_front, front_top), (v_wall, nave_eave)]))
        stone.append(_extrude_profile(fn, end, u0, 0.6, STONE))

    # Porta d'entrada al fons del porxo, davant de l'arc central: ampla, de doble fulla, amb un
    # arc de mig punt de grans dovelles.
    door_w, door_h = 2.6, 3.6
    portal = Polygon(_arch_hole(pu, floor - 0.1, door_w + 1.6, door_h + 1.0), [_arch_hole(pu, floor - 0.1, door_w, door_h)])
    stone.append(_slab(fn, portal, v_wall, s, -0.05, 0.35, ASHLAR))
    r_in, r_out = door_w / 2, door_w / 2 + 0.8
    spring = floor - 0.1 + door_h - r_in
    for i in range(11):
        t = np.pi * (i + 0.5) / 11
        mid_r = (r_in + r_out) / 2
        block = trimesh.creation.box(extents=[0.34, r_out - r_in, 0.1])
        block.apply_transform(trimesh.transformations.rotation_matrix(t - np.pi / 2, [0, 0, 1]))
        bv = block.vertices
        uu, hh, vv = bv[:, 0] + pu + np.cos(t) * mid_r, bv[:, 1] + spring + np.sin(t) * mid_r, bv[:, 2] + v_wall + s * 0.38
        p2 = fn.c[None, :] + np.outer(uu, fn.a) + np.outer(vv, fn.b)
        block.vertices = np.column_stack([p2[:, 0], hh, -p2[:, 1]])
        trimesh.repair.fix_normals(block)
        details.append(_colored(block, (176, 160, 132) if i % 2 else ASHLAR))
    details.append(_slab(fn, Polygon(_arch_hole(pu, floor - 0.1, door_w, door_h)), v_wall, s, -0.02, 0.12, WOOD))
    # Junta de les dues fulles i ferramenta.
    details.append(_box(fn, pu, v_wall + s * 0.12, floor - 0.1, floor - 0.1 + door_h - 0.05, 0.06, 0.04, WINDOW))
    for side in (-1, 1):
        details.append(_box(fn, pu + side * 0.25, v_wall + s * 0.13, floor + 1.0, floor + 1.15, 0.1, 0.05, IRON))
        for hz in (0.6, 2.4):
            details.append(_box(fn, pu + side * (door_w / 2 - 0.45), v_wall + s * 0.12, floor + hz, floor + hz + 0.08, 0.8, 0.04, IRON))

    # Espadanya a la façana oest: carreus, dos ulls de campana, frontó.
    esp_w = min(2 * half_w * 0.7, 6.5)
    esp_t = 1.1
    esp_top = nave_ridge + 5.0
    bells_bottom = nave_ridge + 0.6
    pediment = esp_top + 1.6
    outline = [(-esp_w / 2, base), (esp_w / 2, base), (esp_w / 2, esp_top), (0, pediment), (-esp_w / 2, esp_top)]
    hole_w = esp_w * 0.3
    holes = [_arch_hole(c * esp_w * 0.24, bells_bottom, hole_w, 2.9) for c in (-1, 1)]
    holes.append(_arch_hole(0, esp_top - 0.3, 0.9, 1.5))  # campaneta del frontó
    espadanya = Polygon(outline, holes)
    stone.append(_extrude_profile(fn, espadanya, west - esp_t + 0.4, esp_t, ASHLAR))

    # Campanes de bronze dins dels ulls (i la petita al frontó).
    for cv, bottom, size in [(-esp_w * 0.24, bells_bottom, 1.0), (esp_w * 0.24, bells_bottom, 1.0), (0, esp_top - 0.3, 0.55)]:
        bell = trimesh.creation.cone(radius=0.42 * size, height=0.95 * size, sections=16)
        bell.apply_translation([0, 0, -0.95 * size])  # boca avall: el vèrtex a dalt
        bell.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
        bell.apply_translation(fn.world(west - esp_t / 2 + 0.4, cv, bottom + 1.55 * size))
        details.append(_colored(bell, BRONZE))
        details.append(_box(fn, west - esp_t / 2 + 0.4, cv, bottom + 1.5 * size, bottom + 1.62 * size, 0.12, hole_w * size, IRON))

    # Al capdamunt, el gran niu de cigonya assegut al vèrtex del frontó; la creu de ferro en surt.
    cu = west - esp_t / 2 + 0.4
    details += _stork_nest(fn, cu, 0, pediment - 0.45)
    details.append(_box(fn, cu, 0, pediment + 0.3, pediment + 2.7, 0.1, 0.1, IRON))
    details.append(_box(fn, cu, 0, pediment + 2.15, pediment + 2.27, 0.1, 0.7, IRON))

    # "Tejadillo adosado": cos baix al costat de l'espadanya que no dona al carrer, d'un aiguavés.
    t = -s
    an_u0, an_u1 = west - esp_t + 0.4, west + 2.4
    an_v0, an_v1 = esp_w / 2, half_w + 1.6
    an_h = floor + 3.4
    stone.append(_box(fn, (an_u0 + an_u1) / 2, t * (an_v0 + an_v1) / 2, base, an_h, an_u1 - an_u0, an_v1 - an_v0, STONE))
    lean = [
        fn.world(an_u0 - 0.3, t * an_v0, an_h + 0.9),
        fn.world(an_u1 + 0.3, t * an_v0, an_h + 0.9),
        fn.world(an_u1 + 0.3, t * (an_v1 + 0.4), an_h - 0.1),
        fn.world(an_u0 - 0.3, t * (an_v1 + 0.4), an_h - 0.1),
    ]
    m = trimesh.Trimesh(vertices=np.array(lean), faces=np.array([[0, 1, 2], [0, 2, 3]]), process=False)
    if m.face_normals[:, 1].mean() < 0:
        m.invert()
    # Les fileres de teules van al llarg de la nau, com a les aigües grans.
    m.visual.vertex_colors = np.tile(_ridge_rgb(fn), (4, 1)).astype(np.uint8)
    roofs.append(m)

    # Finestres espitllerades alts als murs de la nau (la del porxo queda a l'ombra) i a la capçalera.
    for u in np.linspace(west + 3, chancel_start - 2, 3):
        for v in (-1, 1):
            if v == s and abs(u - pu) < door_w:
                continue  # sobre la porta, no
            details.append(_box(fn, u, v * (half_w + 0.03), floor + 4.0, floor + 5.6, 0.35, 0.08, WINDOW))
    for v in (-1, 1):
        details.append(_box(fn, (chancel_start + east) / 2, v * (half_w + 0.18), floor + 4.6, floor + 6.4, 0.45, 0.08, WINDOW))
    return stone, roofs, details


def contains(poly: Polygon, x: float, y: float) -> bool:
    return poly.buffer(1.0).contains(Point(x, y))
