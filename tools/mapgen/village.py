"""Poble en 3D a partir del Cadastre + anàlisi de l'ortofoto PNOA, als carrers de detall.

- Cases: plantes i nombre de pisos del Cadastre (BuildingPart), teulada a quatre aigües.
- Coberts que no surten al Cadastre: teules vermelles detectades a la imatge.
- Arbres: copes detectades a la imatge (vegetació fosca i amb textura), mida i color reals.
- Parcel·les: classificades com a pati, hort, arbrat, prat o terra segons la imatge.
- Tàpies: murs al voltant de patis i horts, on no hi ha edifici.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
from PIL import Image
from scipy import ndimage
from shapely import affinity
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union

# Mida de píxel de treball per a la classificació (m). L'ortofoto és a ~17 cm.
CLASS_RES_M = 0.35

CLASS_NAMES = ["other", "building", "road", "tree", "grass", "soil", "paved"]
OTHER, BUILDING, ROAD, TREE, GRASS, SOIL, PAVED = range(len(CLASS_NAMES))


def detail_zone_utm(cfg: dict) -> Polygon | MultiPolygon:
    """Zona de detall (UTM): tot el quadrat del terreny, o una franja a banda i banda dels carrers."""
    detail = cfg.get("village_detail", {})
    if detail.get("full_map"):
        from lib.config import utm_origin

        ox, oy = utm_origin(cfg)
        half = float(cfg["terrain_size_m"]) / 2.0
        return box(ox - half, oy - half, ox + half, oy + half)
    names = set(detail.get("streets", []))
    buffer_m = float(detail.get("buffer_m", 45.0))
    osm = gpd.read_file(cfg["paths"]["osm_geojson"]).to_crs(epsg=int(cfg["utm_epsg"]))
    lines = osm[osm["highway"].notna() & osm["name"].isin(names)]
    if lines.empty:
        raise RuntimeError(f"Cap carrer de detall trobat a l'OSM: {sorted(names)}")
    return unary_union([g.buffer(buffer_m) for g in lines.geometry])


@dataclass
class Ortho:
    """Ortofoto del terreny (quadrat UTM centrat a l'origen) amb accés per coordenades locals."""

    rgb: np.ndarray  # H×W×3 float32 0..255
    size_m: float

    @classmethod
    def load(cls, path: str | Path, size_m: float) -> "Ortho":
        return cls(np.asarray(Image.open(path).convert("RGB"), dtype=np.float32), size_m)

    @property
    def px_m(self) -> float:
        return self.size_m / self.rgb.shape[1]

    def to_px(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Local (x est, y nord) → (columna, fila) flotants."""
        n = self.rgb.shape[1]
        col = (np.asarray(x) + self.size_m / 2) / self.size_m * n
        row = (self.size_m / 2 - np.asarray(y)) / self.size_m * n
        return col, row

    def color_at(self, x: float, y: float, radius_m: float = 0.5) -> tuple[int, int, int]:
        col, row = self.to_px(np.array(x), np.array(y))
        r = max(1, int(radius_m / self.px_m))
        c0, r0 = int(col), int(row)
        patch = self.rgb[max(0, r0 - r) : r0 + r + 1, max(0, c0 - r) : c0 + r + 1]
        if patch.size == 0:
            return (128, 128, 128)
        m = patch.reshape(-1, 3).mean(axis=0)
        return int(m[0]), int(m[1]), int(m[2])

    def window(self, bounds: tuple[float, float, float, float], res_m: float) -> tuple[np.ndarray, tuple]:
        """Retall reescalat a `res_m` de la caixa local (minx, miny, maxx, maxy). Retorna (rgb, transform)."""
        minx, miny, maxx, maxy = bounds
        c0, r0 = self.to_px(minx, maxy)
        c1, r1 = self.to_px(maxx, miny)
        c0, r0 = max(0, int(c0)), max(0, int(r0))
        c1, r1 = min(self.rgb.shape[1], int(np.ceil(c1))), min(self.rgb.shape[0], int(np.ceil(r1)))
        crop = self.rgb[r0:r1, c0:c1]
        w = max(1, int(round((c1 - c0) * self.px_m / res_m)))
        h = max(1, int(round((r1 - r0) * self.px_m / res_m)))
        img = Image.fromarray(crop.astype(np.uint8)).resize((w, h), Image.LANCZOS)
        x0 = c0 * self.px_m - self.size_m / 2
        y0 = self.size_m / 2 - r0 * self.px_m
        return np.asarray(img, dtype=np.float32), (x0, y0, res_m)


def _rasterize(geoms, shape: tuple[int, int], transform: tuple) -> np.ndarray:
    from rasterio import features
    from rasterio.transform import from_origin

    x0, y0, res = transform
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms:
        return np.zeros(shape, dtype=bool)
    return features.rasterize(
        [(g, 1) for g in geoms], out_shape=shape, transform=from_origin(x0, y0, res, res), fill=0
    ).astype(bool)


@dataclass
class Classification:
    labels: np.ndarray  # H×W classe per píxel
    transform: tuple  # (x0, y0 nord-oest, res)
    rgb: np.ndarray
    tree_mask: np.ndarray

    def to_local(self, col: np.ndarray, row: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        x0, y0, res = self.transform
        return x0 + (np.asarray(col) + 0.5) * res, y0 - (np.asarray(row) + 0.5) * res

    def fractions(self, geom) -> np.ndarray:
        mask = _rasterize([geom], self.labels.shape, self.transform)
        counts = np.bincount(self.labels[mask], minlength=len(CLASS_NAMES)).astype(float)
        return counts / max(1.0, counts.sum())

def classify(ortho: Ortho, zone_local, buildings_local, roads_local) -> Classification:
    """Classificació per píxel: vegetació (ExG), foscor i textura separen arbres de prat;
    la saturació separa terra nua de paviment. Edificis i carrers venen dels vectors."""
    rgb, transform = ortho.window(zone_local.bounds, CLASS_RES_M)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    total = r + g + b + 1e-3
    exg = (2 * g - r - b) / total  # índex de verd en excés, robust a la il·luminació
    value = total / 3
    sat = (rgb.max(axis=2) - rgb.min(axis=2)) / (rgb.max(axis=2) + 1e-3)
    # Textura: desviació local de la lluminositat en ~1,5 m.
    k = max(3, int(round(1.5 / CLASS_RES_M)))
    mean = ndimage.uniform_filter(value, k)
    texture = np.sqrt(np.maximum(ndimage.uniform_filter(value**2, k) - mean**2, 0))
    # Ombres: molt fosques i poc saturades; als arbres solen anar enganxades a les copes.
    shadow = (value < 55) & (sat < 0.35)

    veg = exg > 0.04
    # Copa: verd fosc, o verd mitjà amb molta textura (fulles i ombres internes). Les ombres
    # enganxades a una copa també hi compten, perquè l'ortofoto les deixa al costat.
    # Un camp de regadiu pot ser verd fosc però és llis: la copa sempre té una mica de textura.
    canopy = veg & (((value < 88) & (texture > 9)) | ((value < 115) & (texture > 22)))
    tree = canopy | (shadow & ndimage.binary_dilation(canopy, iterations=3))
    tree = ndimage.binary_opening(tree, iterations=3)
    tree = ndimage.binary_closing(tree, iterations=2)
    tree = _drop_small(tree, 7.0 / CLASS_RES_M**2)

    labels = np.full(value.shape, OTHER, dtype=np.uint8)
    labels[(sat < 0.18) & ~veg] = PAVED
    labels[(sat >= 0.18) & ~veg] = SOIL
    labels[veg] = GRASS
    labels[tree] = TREE
    labels[_rasterize(roads_local, value.shape, transform)] = ROAD
    labels[_rasterize(buildings_local, value.shape, transform)] = BUILDING
    labels[~_rasterize([zone_local], value.shape, transform)] = OTHER
    return Classification(labels, transform, rgb, tree & (labels == TREE))


def _drop_small(mask: np.ndarray, min_px: float) -> np.ndarray:
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = sizes >= min_px
    return keep[lab]


@dataclass
class TreeCrown:
    x: float  # local est
    y: float  # local nord
    radius: float
    color: tuple[int, int, int]


def detect_trees(cls: Classification, max_radius_m: float = 5.5) -> list[TreeCrown]:
    """Copes = màxims locals de la distància a la vora de la màscara d'arbres."""
    res = cls.transform[2]
    dist = ndimage.distance_transform_edt(cls.tree_mask) * res
    peaks = (dist == ndimage.maximum_filter(dist, size=int(round(2.5 / res)) | 1)) & (dist >= 1.1)
    rows, cols = np.nonzero(peaks)
    order = np.argsort(-dist[rows, cols])
    crowns: list[TreeCrown] = []
    for i in order:
        rad = float(min(dist[rows[i], cols[i]] + 0.4, max_radius_m))
        x, y = cls.to_local(cols[i], rows[i])
        if any(np.hypot(c.x - x, c.y - y) < 0.85 * (c.radius + rad) for c in crowns):
            continue
        k = max(1, int(rad * 0.6 / res))
        patch = cls.rgb[max(0, rows[i] - k) : rows[i] + k + 1, max(0, cols[i] - k) : cols[i] + k + 1]
        col = patch.reshape(-1, 3).mean(axis=0)
        crowns.append(TreeCrown(float(x), float(y), rad, (int(col[0]), int(col[1]), int(col[2]))))
    return crowns


def to_local(geom, ox: float, oy: float):
    return affinity.translate(geom, xoff=-ox, yoff=-oy)


# --- Parcel·les ---------------------------------------------------------------------------

PARCEL_TYPES = ("pati", "jardi", "hort", "conreu", "arbrat", "prat", "erm")
# Per sobre d'aquesta àrea, una parcel·la amb fileres és un camp de conreu, no un hort.
HORT_MAX_AREA_M2 = 3000.0
WALLED_TYPES = {"pati", "jardi", "hort"}


# Desviació de lluminositat dins el verd (finestres de ~0,85 m a 17 cm/px): els prats donen
# 6–10 (gespa uniforme), els horts 11–16 (plantes, solcs i ombres petites en fileres).
HORT_TEXTURE_MIN = 11.0


def vegetation_texture(ortho: Ortho, geom) -> tuple[float, float]:
    """(fracció de verd clar, textura mediana del verd) a resolució completa, lluny de les vores."""
    inner = geom.buffer(-0.8)
    if inner.is_empty or inner.area < 8:
        return 0.0, 0.0
    rgb, transform = ortho.window(inner.bounds, ortho.px_m)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    total = r + g + b + 1e-3
    lum = total / 3
    mask = _rasterize([inner], lum.shape, transform)
    veg = mask & ((2 * g - r - b) / total > 0.04) & (lum > 70)  # verd no fosc: fora de les copes
    if mask.sum() == 0 or veg.sum() < 50:
        return float(veg.sum() / max(1, mask.sum())), 0.0
    mean = ndimage.uniform_filter(lum, 5)
    sd = np.sqrt(np.maximum(ndimage.uniform_filter(lum**2, 5) - mean**2, 0))
    return float(veg.sum() / mask.sum()), float(np.median(sd[veg]))


def classify_parcel(fr: np.ndarray, veg_frac: float, veg_sd: float, has_building: bool, area: float) -> str:
    """Tipus de parcel·la a partir de la part no edificada: arbres (classificació), verd clar
    i la seva textura (ortofoto a resolució completa)."""
    open_area = max(1e-6, fr[TREE] + fr[GRASS] + fr[SOIL] + fr[PAVED])
    if fr[TREE] / open_area > 0.4:
        return "arbrat"
    # En parcel·les amb casa, el pati té ombres i objectes que també fan textura: cal més verd.
    if has_building:
        if veg_frac >= 0.35 and veg_sd >= HORT_TEXTURE_MIN + 1:
            return "hort"
    elif veg_frac >= 0.2 and veg_sd >= HORT_TEXTURE_MIN:
        return "hort" if area <= HORT_MAX_AREA_M2 else "conreu"
    if has_building and area < 4000:
        return "jardi" if veg_frac > 0.45 else "pati"
    return "prat" if veg_frac > 0.45 else "erm"


# --- Geometria: cases --------------------------------------------------------------------

WALL_PALETTE = [
    (238, 233, 222),  # emblanquinat
    (226, 211, 180),  # arrebossat crema
    (199, 163, 117),  # tova ocre
    (165, 150, 128),  # pedra
    (178, 108, 78),  # maó
]
PLINTH_COLOR = (120, 112, 100)
WINDOW_COLOR = (38, 44, 54)
FRAME_COLOR = (235, 232, 224)
DOOR_COLOR = (98, 62, 36)
FLOOR_H = 2.9
PLINTH_H = 0.7


def _ccw(poly: Polygon) -> Polygon:
    from shapely.geometry.polygon import orient

    return orient(poly, sign=1.0)


@dataclass
class RoofFrame:
    """Teulada a dues aigües sobre el rectangle mínim: carener al llarg de l'eix llarg."""

    cx: float
    cy: float
    nx: float  # normal al carener
    ny: float
    half_w: float
    eave: float
    slope: float  # tan(pendent)

    @classmethod
    def for_polygon(cls, poly: Polygon, eave: float) -> "RoofFrame":
        rect = poly.minimum_rotated_rectangle
        xs, ys = rect.exterior.coords.xy
        e1 = np.array([xs[1] - xs[0], ys[1] - ys[0]])
        e2 = np.array([xs[2] - xs[1], ys[2] - ys[1]])
        long_e, short_e = (e1, e2) if np.linalg.norm(e1) >= np.linalg.norm(e2) else (e2, e1)
        width = float(np.linalg.norm(short_e))
        n = short_e / max(width, 1e-6)
        c = rect.centroid
        # Teules àrabs: ~22°; naus grans una mica més planes.
        pitch = np.radians(22 if width < 12 else 17)
        return cls(c.x, c.y, float(n[0]), float(n[1]), width / 2, eave, float(np.tan(pitch)))

    def z(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        d = np.abs((np.asarray(x) - self.cx) * self.nx + (np.asarray(y) - self.cy) * self.ny)
        return self.eave + self.slope * (self.half_w - d)

    def ridge(self, length: float = 500.0) -> LineString:
        ux, uy = -self.ny, self.nx
        return LineString([(self.cx - ux * length, self.cy - uy * length), (self.cx + ux * length, self.cy + uy * length)])


def _vc(mesh_vertices: np.ndarray, faces: np.ndarray, color: tuple[int, int, int]):
    import trimesh

    m = trimesh.Trimesh(vertices=mesh_vertices, faces=faces, process=False)
    m.visual.vertex_colors = np.tile([*color, 255], (len(mesh_vertices), 1)).astype(np.uint8)
    return m


def _quad(p0, p1, p2, p3, color, outward):
    """Quad en coordenades del món (x, y amunt, z), amb la cara girada cap a `outward`."""
    m = _vc(np.array([p0, p1, p2, p3], dtype=float), np.array([[0, 1, 2], [0, 2, 3]]), color)
    if np.dot(m.face_normals.mean(axis=0), outward) < 0:
        m.invert()
    return m


def _w(x: float, y_local: float, h: float) -> list[float]:
    """Local (x est, y nord) + alçada → món (x, y amunt, z = −nord)."""
    return [x, h, -y_local]


def _box_on_wall(ax, ay, bx, by, t0, t1, z0, z1, depth, nx, ny, color):
    """Caixa plana enganxada a la façana entre les fraccions t0..t1 de l'aresta i alçades z0..z1."""
    import trimesh

    p0 = np.array([ax + (bx - ax) * t0, ay + (by - ay) * t0])
    p1 = np.array([ax + (bx - ax) * t1, ay + (by - ay) * t1])
    off = np.array([nx, ny]) * depth
    corners = [p0, p1, p1 + off, p0 + off]
    verts = [_w(c[0], c[1], z0) for c in corners] + [_w(c[0], c[1], z1) for c in corners]
    faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]]
    m = _vc(np.array(verts), np.array(faces), color)
    trimesh.repair.fix_normals(m)
    return m


def house_meshes(poly: Polygon, floors: int, ground, wall_color, facing_street) -> tuple[list, list, list]:
    """Retorna (parets, teulada, detalls de façana) per a una part d'edifici.
    `facing_street(ax, ay, bx, by, nx, ny)` diu si una aresta dóna al carrer."""
    import trimesh

    poly = _ccw(poly.simplify(0.15))
    ext = np.array(poly.exterior.coords)[:-1]
    g = ground.height(ext[:, 0], ext[:, 1])
    base = float(g.min()) - 0.25
    eave = float(g.max()) + 0.3 + floors * FLOOR_H
    roof = RoofFrame.for_polygon(poly, eave)

    # Afegim a l'anell els punts on el carener talla les arestes, perquè el capçal de les
    # parets segueixi exactament la teulada (triangle del frontó).
    ring = []
    for i in range(len(ext)):
        a, b = ext[i], ext[(i + 1) % len(ext)]
        ring.append(a)
        da = (a[0] - roof.cx) * roof.nx + (a[1] - roof.cy) * roof.ny
        db = (b[0] - roof.cx) * roof.nx + (b[1] - roof.cy) * roof.ny
        if da * db < 0:
            t = da / (da - db)
            ring.append(a + (b - a) * t)
    ring = np.array(ring)
    tops = roof.z(ring[:, 0], ring[:, 1])

    walls, details = [], []
    plinth_top = base + 0.25 + PLINTH_H
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        (ax, ay), (bx, by) = ring[i], ring[j]
        seg = max(1e-6, float(np.hypot(bx - ax, by - ay)))
        outward = np.array([(by - ay) / seg, 0.0, (bx - ax) / seg])  # (nx, 0, −ny) amb n = (dy, −dx)
        walls.append(_quad(_w(ax, ay, base), _w(bx, by, base), _w(bx, by, plinth_top), _w(ax, ay, plinth_top), PLINTH_COLOR, outward))
        walls.append(_quad(_w(ax, ay, plinth_top), _w(bx, by, plinth_top), _w(bx, by, tops[j]), _w(ax, ay, tops[i]), wall_color, outward))

    # Finestres i porta a les façanes que donen al carrer.
    floor0 = base + 0.25
    for i in range(len(ext)):
        a, b = ext[i], ext[(i + 1) % len(ext)]
        length = float(np.hypot(*(b - a)))
        if length < 2.4:
            continue
        nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length  # normal exterior (anell antihorari)
        if not facing_street(a[0], a[1], b[0], b[1], nx, ny):
            continue
        slots = max(1, int(length // 3.2))
        door_slot = slots // 2
        for f in range(floors):
            for s in range(slots):
                tc = (s + 0.5) / slots
                if f == 0 and s == door_slot:
                    hw = 0.55 / length
                    details.append(_box_on_wall(*a, *b, tc - hw, tc + hw, floor0, floor0 + 2.15, 0.06, nx, ny, DOOR_COLOR))
                    continue
                hw = 0.5 / length
                z0 = floor0 + f * FLOOR_H + 1.0
                details.append(_box_on_wall(*a, *b, tc - hw - 0.08 / length, tc + hw + 0.08 / length, z0 - 0.08, z0 + 1.18, 0.03, nx, ny, FRAME_COLOR))
                details.append(_box_on_wall(*a, *b, tc - hw, tc + hw, z0, z0 + 1.1, 0.06, nx, ny, WINDOW_COLOR))

    # Teulada: voladís de 0,3 m, partida pel carener; cada meitat és un pla.
    from shapely.ops import split

    roof_poly = poly.buffer(0.3, join_style=2)
    pieces = split(roof_poly, roof.ridge())
    roof_meshes = []
    for piece in getattr(pieces, "geoms", [pieces]):
        if not isinstance(piece, Polygon) or piece.area < 0.05:
            continue
        v2, f = trimesh.creation.triangulate_polygon(piece)
        zz = roof.z(v2[:, 0], v2[:, 1])
        verts = np.column_stack([v2[:, 0], zz, -v2[:, 1]])
        m = trimesh.Trimesh(vertices=verts, faces=f, process=False)
        if m.face_normals[:, 1].mean() < 0:
            m.invert()
        roof_meshes.append(m)
    return walls, roof_meshes, details


# --- Tàpies --------------------------------------------------------------------------------

WALL_HEIGHT_M = 1.9
TAPIA_COLORS = [(196, 168, 128), (172, 158, 138), (214, 200, 170)]


def tapia_meshes(lines, ground) -> list:
    import trimesh

    out = []
    for k, line in enumerate(lines):
        if line.length < 1.0:
            continue
        color = TAPIA_COLORS[k % len(TAPIA_COLORS)]
        pts = np.array(line.segmentize(4.0).coords)
        for a, b in zip(pts[:-1], pts[1:]):
            seg = float(np.hypot(*(b - a)))
            if seg < 0.2:
                continue
            ga, gb = ground.height(np.array([a[0], b[0]]), np.array([a[1], b[1]]))
            z0 = min(ga, gb) - 0.2
            z1 = max(ga, gb) + WALL_HEIGHT_M
            mid = (a + b) / 2
            ang = np.arctan2(b[1] - a[1], b[0] - a[0])
            m = trimesh.creation.box(extents=[seg + 0.3, z1 - z0, 0.3])
            # Box: x al llarg del mur; al món la direcció local (cos, sin) és (x, −z).
            rot = trimesh.transformations.rotation_matrix(ang, [0, 1, 0])
            m.apply_transform(rot)
            m.apply_translation([mid[0], (z0 + z1) / 2, -mid[1]])
            m.visual.vertex_colors = np.tile([*color, 255], (len(m.vertices), 1)).astype(np.uint8)
            out.append(m)
    return out


# --- Coberts que no surten al Cadastre -----------------------------------------------------


def detect_extra_roofs(cls: Classification, known: list[Polygon], min_area_m2: float = 10.0) -> list[Polygon]:
    """Teules vermelles a la imatge fora dels edificis del Cadastre i dels carrers: coberts, garatges."""
    from rasterio import features
    from rasterio.transform import from_origin
    from shapely.geometry import shape

    rgb = cls.rgb
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    value = (r + g + b) / 3
    tiles = (r > g * 1.15) & (r > b * 1.3) & (value > 70) & (value < 220)
    tiles &= np.isin(cls.labels, [PAVED, SOIL, OTHER]) & (cls.labels != OTHER)
    tiles = ndimage.binary_opening(tiles, iterations=2)
    tiles = ndimage.binary_closing(tiles, iterations=2)
    tiles = _drop_small(tiles, min_area_m2 / cls.transform[2] ** 2)
    x0, y0, res = cls.transform
    known_u = unary_union(known).buffer(0.8) if known else None
    out = []
    for geom, val in features.shapes(tiles.astype(np.uint8), mask=tiles, transform=from_origin(x0, y0, res, res)):
        poly = shape(geom).buffer(0)
        if known_u is not None:
            poly = poly.difference(known_u)
        for p in getattr(poly, "geoms", [poly]):
            if not isinstance(p, Polygon) or p.area < min_area_m2:
                continue
            rect = p.minimum_rotated_rectangle
            # Només formes compactes (una teulada), no franges disperses.
            if p.area / max(rect.area, 1e-6) > 0.6:
                out.append(rect)
    return out


# --- Orquestració ----------------------------------------------------------------------------


@dataclass
class Village:
    zone: Polygon | MultiPolygon  # local
    meshes: list  # (nom, trimesh)
    trees: list[dict]
    plants: list[dict]
    parcels: list[dict]


def _floors(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 1


def build_village(cfg: dict, ground, ortho: Ortho, roads_local: list[Polygon], ox: float, oy: float) -> Village:
    import trimesh

    cad = Path(cfg["paths"]["cadastre_dir"])
    zone = to_local(detail_zone_utm(cfg), ox, oy)
    roads_u = unary_union(roads_local) if roads_local else Polygon()

    parts = gpd.read_file(cad / "BuildingPart.gml")
    parts["geometry"] = parts.geometry.apply(lambda g: to_local(g, ox, oy))
    parts = parts[parts.intersects(zone) & (parts["numberOfFloorsAboveGround"].apply(_floors) > 0)]
    parts["building"] = parts["localId"].astype(str).str.split("_part").str[0]
    part_polys = [g for g in parts.geometry]

    parcels = gpd.read_file(cad / "CadastralParcel.gml")
    parcels["geometry"] = parcels.geometry.apply(lambda g: to_local(g, ox, oy))
    parcels = parcels[parcels.intersects(zone)]

    cls = classify(ortho, zone, part_polys, roads_local)
    # Coberts nous només a prop d'edificis coneguts: lluny, la terra vermella dels camps enganya.
    near_buildings = unary_union(part_polys).buffer(25.0) if part_polys else Polygon()
    extra = [
        r
        for r in detect_extra_roofs(cls, part_polys)
        if r.intersects(zone) and not r.intersects(roads_u) and r.within(near_buildings)
    ]
    print(f"Village: {len(parts)} parts del Cadastre, {len(extra)} coberts detectats a la imatge")

    buildings_u = unary_union(part_polys + extra)
    road_core = roads_u.buffer(1.0)

    def facing_street(ax, ay, bx, by, nx, ny) -> bool:
        mx, my = (ax + bx) / 2, (ay + by) / 2
        probe = LineString([(mx + nx * 0.3, my + ny * 0.3), (mx + nx * 6.0, my + ny * 6.0)])
        return probe.intersects(roads_u) and not probe.intersects(buildings_u.buffer(-0.05))

    walls, roofs, details = [], [], []
    for _, row in parts.iterrows():
        seed = sum(ord(c) for c in row["building"])
        color = WALL_PALETTE[seed % len(WALL_PALETTE)]
        for poly in getattr(row.geometry, "geoms", [row.geometry]):
            if poly.area < 4:
                continue
            w, r, d = house_meshes(poly, _floors(row["numberOfFloorsAboveGround"]), ground, color, facing_street)
            walls += w
            roofs += r
            details += d
    for k, rect in enumerate(extra):
        w, r, _ = house_meshes(rect, 1, ground, WALL_PALETTE[(k * 3 + 1) % len(WALL_PALETTE)], lambda *a: False)
        walls += w
        roofs += r

    # Parcel·les: tipus segons la imatge; tàpies al voltant de patis, jardins i horts.
    parcel_info, walled, hort_polys = [], [], []
    for _, row in parcels.iterrows():
        geom = row.geometry.intersection(zone)
        if geom.is_empty or geom.area < 15:
            continue
        open_geom = geom.difference(buildings_u).difference(roads_u)
        if open_geom.is_empty or open_geom.area < 5:
            continue
        has_building = row.geometry.buffer(-0.3).intersects(buildings_u)
        veg_frac, veg_sd = vegetation_texture(ortho, open_geom)
        kind = classify_parcel(cls.fractions(open_geom), veg_frac, veg_sd, has_building, float(row.geometry.area))
        c = geom.representative_point()
        parcel_info.append({"ref": str(row.get("nationalCadastralReference", "")), "type": kind, "x": round(c.x, 1), "z": round(-c.y, 1)})
        # Patis i jardins sempre tancats; un hort només si és d'una casa (els de fora del poble
        # se separen amb marges, no amb murs).
        if kind in WALLED_TYPES and (kind != "hort" or has_building):
            walled.append(row.geometry)
        if kind == "hort":
            hort_polys.append(open_geom)

    tapia_lines = []
    if walled:
        lines = unary_union([g.boundary for g in walled]).intersection(zone)
        lines = lines.difference(buildings_u.buffer(0.35)).difference(roads_u.buffer(0.3))
        tapia_lines = [ln for ln in getattr(lines, "geoms", [lines]) if isinstance(ln, LineString)]
    tapias = tapia_meshes(tapia_lines, ground)

    # Arbres de la imatge (fora d'edificis i carrers) i plantes d'hort on hi ha verd.
    trees = []
    for t in detect_trees(cls):
        if buildings_u.contains(Point(t.x, t.y)) or road_core.contains(Point(t.x, t.y)):
            continue
        y = float(ground.height(t.x, t.y))
        height = float(np.clip(1.6 + t.radius * 2.1, 3.0, 14.0))
        trees.append({"x": round(t.x, 2), "y": round(y, 2), "z": round(-t.y, 2), "r": round(t.radius, 2), "h": round(height, 2), "c": list(t.color)})
    plants = _hort_plants(hort_polys, cls, ground)

    meshes = []
    if walls:
        meshes.append(("building_houses", trimesh.util.concatenate(walls)))
    if tapias:
        meshes.append(("building_tapias", trimesh.util.concatenate(tapias)))
    if details:
        meshes.append(("prop_facades", trimesh.util.concatenate(details)))
    if roofs:
        meshes.append(("roofs", trimesh.util.concatenate(roofs)))
    counts = {k: sum(1 for p in parcel_info if p["type"] == k) for k in PARCEL_TYPES}
    print(f"Village: parcel·les {counts}, {len(tapia_lines)} trams de tàpia, {len(trees)} arbres, {len(plants)} plantes d'hort")
    return Village(zone, meshes, trees, plants, parcel_info)


def _hort_plants(polys: list, cls: Classification, ground, spacing: float = 0.85) -> list[dict]:
    """Plantes en fileres alineades amb l'eix llarg de l'hort, només on la imatge mostra verd."""
    plants = []
    res = cls.transform[2]
    veg = np.isin(cls.labels, [GRASS, TREE])
    for poly in polys:
        for p in getattr(poly, "geoms", [poly]):
            if not isinstance(p, Polygon) or p.area < 6:
                continue
            rect = p.minimum_rotated_rectangle
            xs, ys = rect.exterior.coords.xy
            e = np.array([xs[1] - xs[0], ys[1] - ys[0]])
            f = np.array([xs[2] - xs[1], ys[2] - ys[1]])
            u = e / np.linalg.norm(e) if np.linalg.norm(e) >= np.linalg.norm(f) else f / np.linalg.norm(f)
            v = np.array([-u[1], u[0]])
            c = np.array(p.centroid.coords[0])
            ext = np.hypot(*(np.array(p.bounds[2:]) - np.array(p.bounds[:2])))
            a = np.arange(-ext / 2, ext / 2, spacing * 0.75)
            bb = np.arange(-ext / 2, ext / 2, spacing * 1.4)  # separació entre fileres
            A, B = np.meshgrid(a, bb)
            px = c[0] + A.ravel() * u[0] + B.ravel() * v[0]
            py = c[1] + A.ravel() * u[1] + B.ravel() * v[1]
            inside = np.array([p.contains(Point(x, y)) for x, y in zip(px, py)])
            px, py = px[inside], py[inside]
            x0, y0, _ = cls.transform
            col = ((px - x0) / res).astype(int).clip(0, veg.shape[1] - 1)
            row = ((y0 - py) / res).astype(int).clip(0, veg.shape[0] - 1)
            green = veg[row, col]
            hs = ground.height(px[green], py[green])
            for x, y, h, rr, cc in zip(px[green], py[green], hs, row[green], col[green]):
                rgb = cls.rgb[rr, cc]
                plants.append({"x": round(float(x), 2), "y": round(float(h), 2), "z": round(float(-y), 2), "c": [int(rgb[0]), int(rgb[1]), int(rgb[2])]})
    return plants
