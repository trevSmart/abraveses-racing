"""Ermita de Nuestra Señora de las Encinas (Abraveses de Tera), segons la fitxa de patrimoni de la
Junta de Castella i Lleó i l'ortofoto:

- finals del s. XVIII; planta de creu llatina amb nau llarga, cúpula sobre el creuer (per fora, un
  cimbori quadrat amb teulada de quatre aigües) i capçalera quadrada;
- alta espadanya de dos cossos i dos ulls (l'inferior cegat) sobre la portada, amb un recrescut
  modern de maó, i un frontó partit per l'espadanya;
- pòrtic tancat als peus amb un gran arc de rosca de maó; al costat de l'epístola (sud) un pòrtic
  igual; al de l'evangeli (nord) una galeria de cinc arcs de mig punt de maó sobre pilars;
- portada d'arc de mig punt de dovelles de pedra. S'alça sobre un altozano a la vega del Tera.
"""

from __future__ import annotations

import numpy as np
import trimesh
from shapely.geometry import Polygon, box

from church import (
    ASHLAR,
    BRONZE,
    IRON,
    PITCH,
    WOOD,
    Frame,
    _arch_hole,
    _box,
    _colored,
    _extrude_profile,
    _gable_volume,
    _ridge_rgb,
    _roof,
)

RENDER = (214, 200, 172)  # maçoneria arrebossada amb calç
BRICK = (168, 92, 62)
DARK = (34, 30, 28)


def _quad_roof(f: Frame, corners: list[tuple[float, float, float]], ridge_frame: Frame) -> trimesh.Trimesh:
    m = trimesh.Trimesh(vertices=np.array([f.world(u, v, h) for u, v, h in corners]), faces=np.array([[0, 1, 2], [0, 2, 3]]), process=False)
    if m.face_normals[:, 1].mean() < 0:
        m.invert()
    m.visual.vertex_colors = np.tile(_ridge_rgb(ridge_frame), (len(m.vertices), 1)).astype(np.uint8)
    return m


def _pyramid_roof(f: Frame, u: float, half: float, eave: float, apex: float) -> list[trimesh.Trimesh]:
    """Teulada de quatre aigües sobre un cimbori quadrat centrat a (u, 0)."""
    out = []
    h = half + 0.35
    drop = (apex - eave) / half * 0.35
    corners = [(u - h, -h), (u + h, -h), (u + h, h), (u - h, h)]
    for i in range(4):
        (u0, v0), (u1, v1) = corners[i], corners[(i + 1) % 4]
        tri = np.array([f.world(u0, v0, eave - drop), f.world(u1, v1, eave - drop), f.world(u, 0, apex)])
        m = trimesh.Trimesh(vertices=tri, faces=np.array([[0, 1, 2]]), process=False)
        if m.face_normals[:, 1].mean() < 0:
            m.invert()
        # Les fileres de teules van paral·leles al ràfec de cada aigua.
        edge_frame = f.sub(0, 0, rotate=(i % 2 == 1))
        m.visual.vertex_colors = np.tile(_ridge_rgb(edge_frame), (3, 1)).astype(np.uint8)
        out.append(m)
    return out


def _arcade(f: Frame, u0: float, u1: float, v: float, base: float, top: float, n: int, color, thickness: float = 0.45):
    """Mur amb `n` arcs de mig punt (galeria) en el pla (u, alçada), a la posició transversal v."""
    length = u1 - u0
    pitch = length / n
    arch_w = pitch * 0.68
    arch_h = min(top - base - 0.5, arch_w * 1.6)
    holes = [_arch_hole(-length / 2 + pitch * (i + 0.5), base + 0.0, arch_w, arch_h) for i in range(n)]
    outline = box(-length / 2, base, length / 2, top).exterior.coords
    prof = Polygon(list(outline), [h for h in holes])
    m = trimesh.creation.extrude_polygon(prof, height=thickness)
    uu, hh, vv = m.vertices[:, 0] + (u0 + u1) / 2, m.vertices[:, 1], m.vertices[:, 2] + v - thickness / 2
    pts = f.c[None, :] + np.outer(uu, f.a) + np.outer(vv, f.b)
    m.vertices = np.column_stack([pts[:, 0], hh, -pts[:, 1]])
    trimesh.repair.fix_normals(m)
    return _colored(m, color)


def hermitage_meshes(poly: Polygon, ground) -> tuple[list, list, list]:
    """(pedra amb col·lisió, teulades, detalls sense col·lisió)."""
    f = Frame(poly)
    L, W = f.length, f.width
    g = [float(ground.height(*f.local(u, v))) for u in (-L / 2 - 5, 0, L / 2) for v in (-W / 2, W / 2)]
    base = min(g) - 0.4
    floor = max(g) + 0.1

    nave_hw = 4.2
    transept_hw = min(W / 2 - 0.4, 6.6)
    chancel_hw = 3.8
    west, east = -L / 2, L / 2
    chancel_len = 7.0
    cross_len = 8.6
    cross_u0 = east - chancel_len - cross_len
    cross_uc = cross_u0 + cross_len / 2
    eave = floor + 6.2

    stone, roofs, details = [], [], []

    # Nau, capçalera i braços del creuer.
    nave, nave_ridge = _gable_volume(f, west, cross_u0, nave_hw, base, eave, RENDER)
    chancel, _ = _gable_volume(f, cross_u0 + cross_len, east, chancel_hw, base, eave - 0.3, RENDER)
    tf = f.sub(cross_uc, 0, rotate=True)  # transsepte: el carener va de nord a sud
    transept, _ = _gable_volume(tf, -transept_hw, transept_hw, cross_len / 2 - 0.3, base, eave, RENDER)
    stone += [nave, chancel, transept]
    roofs += _roof(f, west, cross_u0, nave_hw, eave)
    roofs += _roof(f, cross_u0 + cross_len, east, chancel_hw, eave - 0.3)
    roofs += _roof(tf, -transept_hw, transept_hw, cross_len / 2 - 0.3, eave)

    # Cimbori sobre el creuer (per fora amaga la cúpula) amb teulada de quatre aigües.
    cim_half = 3.4
    cim_top = nave_ridge + 2.2
    stone.append(_box(f, cross_uc, 0, eave, cim_top, cim_half * 2, cim_half * 2, RENDER))
    roofs += _pyramid_roof(f, cross_uc, cim_half, cim_top, cim_top + np.tan(PITCH) * cim_half)

    # Pòrtic tancat als peus: murs baixos amb un gran arc de rosca de maó a l'oest.
    porch_u0, porch_u1 = west - 5.0, west
    porch_hw = nave_hw + 1.0
    porch_eave = floor + 3.6
    porch_front = Polygon(
        [(-porch_hw, base), (porch_hw, base), (porch_hw, porch_eave), (-porch_hw, porch_eave)],
        [_arch_hole(0, floor - 0.1, 3.6, 3.2)],
    )
    stone.append(_extrude_profile(f, porch_front, porch_u0, 0.5, RENDER))
    ring = Polygon(_arch_hole(0, floor - 0.1, 4.2, 3.5), [_arch_hole(0, floor - 0.1, 3.6, 3.2)])
    details.append(_extrude_profile(f, ring, porch_u0 - 0.06, 0.62, BRICK))
    for side in (-1, 1):
        stone.append(_box(f, (porch_u0 + porch_u1) / 2, side * (porch_hw - 0.25), base, porch_eave, porch_u1 - porch_u0, 0.5, RENDER))
    roofs += _roof(f, porch_u0, porch_u1, porch_hw, porch_eave, overhang=0.3)

    # Galeria nord: cinc arcs de mig punt de maó sobre pilars, amb teulada d'un aiguavés.
    gal_v = nave_hw + 2.4
    gal_eave = floor + 3.4
    stone.append(_arcade(f, west, cross_u0, gal_v, base, gal_eave, 5, BRICK))
    # Pòrtic sud (epístola): tancat com el dels peus, amb un arc d'entrada.
    sp = Polygon(
        [(-(cross_u0 - west) / 2, base), ((cross_u0 - west) / 2, base), ((cross_u0 - west) / 2, gal_eave), (-(cross_u0 - west) / 2, gal_eave)],
        [_arch_hole(0, floor - 0.1, 2.8, 2.9)],
    )
    m = trimesh.creation.extrude_polygon(sp, height=0.5)
    uu, hh, vv = m.vertices[:, 0] + (west + cross_u0) / 2, m.vertices[:, 1], m.vertices[:, 2] - gal_v - 0.25
    pts = f.c[None, :] + np.outer(uu, f.a) + np.outer(vv, f.b)
    m.vertices = np.column_stack([pts[:, 0], hh, -pts[:, 1]])
    trimesh.repair.fix_normals(m)
    stone.append(_colored(m, RENDER))
    for side in (-1, 1):
        lean = [
            (west - 0.3, side * nave_hw, eave - 1.2),
            (cross_u0 + 0.1, side * nave_hw, eave - 1.2),
            (cross_u0 + 0.1, side * (gal_v + 0.6), gal_eave + 0.1),
            (west - 0.3, side * (gal_v + 0.6), gal_eave + 0.1),
        ]
        roofs.append(_quad_roof(f, lean, f))
        # Murs de tancament dels extrems de les galeries.
        for u in (west + 0.2, cross_u0 - 0.2):
            stone.append(_box(f, u, side * (nave_hw + gal_v) / 2, base, gal_eave, 0.4, gal_v - nave_hw, RENDER))

    # Espadanya sobre la portada: dos cossos, dos ulls (l'inferior cegat), recrescut de maó.
    esp_w, esp_t = 3.0, 0.9
    esp_u0 = west - 0.2
    body1_top = nave_ridge + 2.6
    body2_top = body1_top + 3.0
    lower = Polygon([(-esp_w / 2, base), (esp_w / 2, base), (esp_w / 2, body1_top), (-esp_w / 2, body1_top)])
    stone.append(_extrude_profile(f, lower, esp_u0, esp_t, ASHLAR))
    # Ull inferior cegat: arc marcat amb maçoneria més fosca.
    details.append(_extrude_profile(f, Polygon(_arch_hole(0, body1_top - 2.6, 1.2, 2.0)), esp_u0 - 0.04, 0.05, (150, 136, 112)))
    upper = Polygon(
        [(-esp_w / 2 + 0.3, body1_top), (esp_w / 2 - 0.3, body1_top), (esp_w / 2 - 0.3, body2_top), (-esp_w / 2 + 0.3, body2_top)],
        [_arch_hole(0, body1_top + 0.5, 1.2, 2.1)],
    )
    stone.append(_extrude_profile(f, upper, esp_u0 + 0.05, esp_t - 0.1, BRICK))
    pediment = Polygon([(-esp_w / 2 + 0.3, body2_top), (esp_w / 2 - 0.3, body2_top), (0, body2_top + 1.0)])
    stone.append(_extrude_profile(f, pediment, esp_u0 + 0.05, esp_t - 0.1, BRICK))
    bell = trimesh.creation.cone(radius=0.4, height=0.9, sections=16)
    bell.apply_translation([0, 0, -0.9])
    bell.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    bell.apply_translation(f.world(esp_u0 + esp_t / 2, 0, body1_top + 1.7))
    details.append(_colored(bell, BRONZE))
    details.append(_box(f, esp_u0 + esp_t / 2, 0, body2_top + 1.0, body2_top + 2.2, 0.08, 0.08, IRON))
    details.append(_box(f, esp_u0 + esp_t / 2, 0, body2_top + 1.75, body2_top + 1.85, 0.08, 0.6, IRON))
    # Frontó partit per l'espadanya: dues meitats inclinades a la façana, sobre la portada.
    for side in (-1, 1):
        half = Polygon([(side * esp_w / 2, eave), (side * nave_hw, eave), (side * esp_w / 2, eave + np.tan(PITCH) * (nave_hw - esp_w / 2))])
        details.append(_extrude_profile(f, half, west - 0.25, 0.3, ASHLAR))

    # Portada: arc de mig punt de dovelles de pedra i porta de fusta (dins del pòrtic).
    frame = Polygon(_arch_hole(0, floor - 0.1, 2.9, 3.6), [_arch_hole(0, floor - 0.1, 1.8, 3.0)])
    details.append(_extrude_profile(f, frame, west - 0.3, 0.32, ASHLAR))
    details.append(_extrude_profile(f, Polygon(_arch_hole(0, floor - 0.1, 1.8, 3.0)), west - 0.06, 0.08, WOOD))
    # Finestres altes a la nau i al cimbori.
    for u in np.linspace(west + 3, cross_u0 - 2.5, 3):
        for v in (-1, 1):
            details.append(_box(f, u, v * (nave_hw + 0.03), eave - 1.8, eave - 0.7, 0.9, 0.08, DARK))
    for v in (-1, 1):
        details.append(_box(f, cross_uc, v * (cim_half + 0.03), eave + 0.6, cim_top - 0.5, 1.0, 0.08, DARK))
    return stone, roofs, details
