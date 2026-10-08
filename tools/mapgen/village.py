"""Poble en 3D a partir del Cadastre + anàlisi de l'ortofoto PNOA, als carrers de detall.

- Cases: plantes i nombre de pisos del Cadastre (BuildingPart), teulada a quatre aigües.
- Coberts que no surten al Cadastre: teules rosades o vermelles detectades a la imatge.
- Arbres: copes detectades a la imatge (vegetació fosca i amb textura), mida i color reals.
- Parcel·les: classificades com a pati, hort, arbrat, prat o terra segons la imatge.
- Tàpies: murs al voltant de patis i horts, on no hi ha edifici.
"""

from __future__ import annotations

import itertools
import zlib
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
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

    rgb: np.ndarray  # H×W×3 uint8 (la mestra de 8192² en float ocuparia ~800 MB)
    size_m: float

    @classmethod
    def load(cls, path: str | Path, size_m: float) -> "Ortho":
        Image.MAX_IMAGE_PIXELS = None
        return cls(np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8), size_m)

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
        m = patch.reshape(-1, 3).astype(np.float32).mean(axis=0)
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
        img = Image.fromarray(crop).resize((w, h), Image.LANCZOS)
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

    def window_mask(self, geom) -> tuple[tuple[slice, slice], np.ndarray]:
        """(finestra, màscara) de la geometria: rasteritzar tot el mapa per a cada una és O(N·mapa)."""
        x0, y0, res = self.transform
        minx, miny, maxx, maxy = geom.bounds
        c0 = max(0, int((minx - x0) / res))
        c1 = min(self.labels.shape[1], int(np.ceil((maxx - x0) / res)) + 1)
        r0 = max(0, int((y0 - maxy) / res))
        r1 = min(self.labels.shape[0], int(np.ceil((y0 - miny) / res)) + 1)
        win = (slice(r0, max(r0, r1)), slice(c0, max(c0, c1)))
        if c1 <= c0 or r1 <= r0:
            return win, np.zeros((0, 0), dtype=bool)
        return win, _rasterize([geom], (r1 - r0, c1 - c0), (x0 + c0 * res, y0 - r0 * res, res))

    def fractions(self, geom) -> np.ndarray:
        win, mask = self.window_mask(geom)
        if not mask.any():
            return np.zeros(len(CLASS_NAMES))
        counts = np.bincount(self.labels[win][mask], minlength=len(CLASS_NAMES)).astype(float)
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
    # Graella espacial: cada copa només es compara amb les de les cel·les veïnes (abans O(n²)).
    cell = 2 * max_radius_m
    grid: dict[tuple[int, int], list[TreeCrown]] = {}
    for i in order:
        rad = float(min(dist[rows[i], cols[i]] + 0.4, max_radius_m))
        x, y = cls.to_local(cols[i], rows[i])
        gx, gy = int(x // cell), int(y // cell)
        near = (c for dx in (-1, 0, 1) for dy in (-1, 0, 1) for c in grid.get((gx + dx, gy + dy), ()))
        if any(np.hypot(c.x - x, c.y - y) < 0.85 * (c.radius + rad) for c in near):
            continue
        k = max(1, int(rad * 0.6 / res))
        patch = cls.rgb[max(0, rows[i] - k) : rows[i] + k + 1, max(0, cols[i] - k) : cols[i] + k + 1]
        col = patch.reshape(-1, 3).mean(axis=0)
        crown = TreeCrown(float(x), float(y), rad, (int(col[0]), int(col[1]), int(col[2])))
        crowns.append(crown)
        grid.setdefault((gx, gy), []).append(crown)
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
WINDOW_COLOR = (38, 44, 54)  # església i models propis (material pla)
GLASS_COLOR = (148, 162, 178)  # prop_windows: es barreja amb la textura de reflex al joc
FRAME_COLOR = (235, 232, 224)
DOOR_COLOR = (98, 62, 36)
FLOOR_H = 2.9
PLINTH_H = 0.7
# Façanes de pati / laterals (no d'accés): probabilitat que tinguin alguna finestra.
SIDE_FACADE_WINDOW_CHANCE = 0.88
# Ampit sobre el terra just davant de la finestra (planta baixa) o sobre el forjat (pisos).
GROUND_SILL_M = 1.45
UPPER_SILL_M = 0.95
IRON_COLOR = (44, 42, 40)
SILL_STONE = (206, 198, 182)
# Marcs: blanc, pedra, maó i fusta fosca; None = finestra sense marc, només llinda i ampit.
FRAME_COLORS = [FRAME_COLOR, FRAME_COLOR, (196, 186, 166), (168, 98, 66), (92, 66, 46), None]
# Porticons de llibret oberts a banda i banda (verd, marró, blau, granat, crema).
SHUTTER_COLORS = [None, None, (66, 98, 72), (104, 70, 44), (84, 106, 128), (128, 52, 42), (214, 204, 176)]


@dataclass(frozen=True)
class WindowShape:
    w: float
    h: float
    mullion: bool = False  # travesser vertical al mig
    balcony: bool = False  # balconera: arriba gairebé al forjat i porta balcó


# Formes per planta baixa i per pisos; cada casa en tria una de cada (amb repeticions = pes).
GROUND_SHAPES = [
    WindowShape(0.8, 1.15),
    WindowShape(0.9, 0.9),
    WindowShape(0.6, 0.95),
    WindowShape(0.55, 0.55),
    WindowShape(1.25, 1.0, mullion=True),
]
UPPER_SHAPES = [
    WindowShape(0.8, 1.25),
    WindowShape(0.8, 1.25),
    WindowShape(0.95, 1.0),
    WindowShape(0.65, 1.15),
    WindowShape(1.3, 1.1, mullion=True),
    WindowShape(0.95, 2.05, balcony=True),
    WindowShape(0.9, 2.0),  # balconera sense balcó, amb barana de ferro arran de façana
]
ATTIC_SHAPE = WindowShape(0.6, 0.55)


@dataclass(frozen=True)
class WindowStyle:
    """Aspecte de les finestres d'una casa: totes comparteixen marc i porticons."""

    ground: WindowShape
    upper: WindowShape
    frame: tuple[int, int, int] | None
    shutters: tuple[int, int, int] | None
    bars: bool  # reixa a la planta baixa
    attic: bool  # l'últim pis (si n'hi ha 3 o més) amb finestretes de golfes

    @classmethod
    def pick(cls, rng: np.random.Generator, floors: int) -> "WindowStyle":
        ground = GROUND_SHAPES[rng.integers(len(GROUND_SHAPES))]
        upper = UPPER_SHAPES[rng.integers(len(UPPER_SHAPES))]
        shutters = SHUTTER_COLORS[rng.integers(len(SHUTTER_COLORS))]
        return cls(
            ground=ground,
            upper=upper,
            frame=FRAME_COLORS[rng.integers(len(FRAME_COLORS))],
            shutters=shutters,
            bars=ground.h > 0.6 and rng.random() < 0.45,
            attic=floors >= 3 and rng.random() < 0.6,
        )

    def shape(self, floor: int, floors: int) -> WindowShape:
        if floor == 0:
            return self.ground
        if self.attic and floor == floors - 1:
            return ATTIC_SHAPE
        return self.upper


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


def _primary_street_edge_index(ext: np.ndarray, facing_street, roads_u) -> int:
    """Índex de l'aresta d'accés al carrer: façana que mira al carrer o, si cap, la més propera."""
    best_i = -1
    best_score = -1e9
    for i in range(len(ext)):
        a, b = ext[i], ext[(i + 1) % len(ext)]
        length = float(np.hypot(*(b - a)))
        if length < 0.6:
            continue
        nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if facing_street(a[0], a[1], b[0], b[1], nx, ny):
            score = 1000.0 + length
        elif roads_u is not None and not roads_u.is_empty:
            score = -float(roads_u.distance(Point(mx, my)))
        else:
            score = length
        if score > best_score:
            best_score = score
            best_i = i
    return best_i


def _wall_ground(ground, a, b, t0: float, t1: float) -> np.ndarray:
    """Alçada del terra al peu del mur entre les fraccions t0..t1 de l'aresta (3 mostres)."""
    ts = np.linspace(t0, t1, 3)
    return ground.height(a[0] + (b[0] - a[0]) * ts, a[1] + (b[1] - a[1]) * ts)


def _fit_window(shape: WindowShape, style: WindowStyle, avail_m: float) -> tuple[WindowShape, bool] | None:
    """Ajusta la finestra a l'amplada lliure del mur: primer treu els porticons, després l'estreny.
    Retorna (forma, amb_porticons) o None si no hi cap."""
    margin = 0.16  # marc
    if style.shutters is not None and shape.h >= 0.8 and 2 * shape.w + margin <= avail_m:
        return shape, True
    if shape.w + margin <= avail_m:
        return shape, False
    w = avail_m - margin
    if w < 0.45:
        return None
    return WindowShape(w, shape.h, mullion=shape.mullion and w >= 1.0, balcony=False), False


def _window_half_extent_m(shape: WindowShape, shutters: bool) -> float:
    return (shape.w if shutters else shape.w / 2) + 0.08


def _overlaps_door_t(tc: float, length: float, half_m: float, door_tc: float, door_hw: float) -> bool:
    """True si una finestra centrada a `tc` (mitja amplada `half_m`, en metres) topa amb la porta."""
    return abs(tc - door_tc) < door_hw + (half_m + 0.06) / max(length, 1e-6)


def _window_z0(shape: WindowShape, floor: int, level0: float, local_ground: float) -> float:
    """Cota de l'ampit: la planta baixa es mesura des del terra real davant la finestra."""
    if floor == 0:
        return local_ground + GROUND_SILL_M
    level = level0 + floor * FLOOR_H
    return level + (0.1 if shape.h >= 1.9 else UPPER_SILL_M)


def _railing(box, t0: float, t1: float, z0: float, d0: float, length: float, details: list) -> None:
    """Barana de ferro (barrots + passamà) entre t0..t1, de z0 a z0 + 0,95, a `d0` del mur."""
    top = z0 + 0.95
    details.append(box(t0, t1, top - 0.04, top, d0 + 0.04, IRON_COLOR, d0))
    details.append(box(t0, t1, z0 + 0.08, z0 + 0.11, d0 + 0.03, IRON_COLOR, d0))
    n = max(2, int((t1 - t0) * length / 0.18))
    for k in range(1, n):
        t = t0 + (t1 - t0) * k / n
        details.append(box(t - 0.012 / length, t + 0.012 / length, z0, top, d0 + 0.025, IRON_COLOR, d0))


def _add_window(
    a, b, nx, ny, length: float, tc: float, z0: float, shape: WindowShape, style: WindowStyle,
    shutters: bool, floor: int, details: list, windows: list,
) -> None:
    L = max(length, 1e-6)
    hw = shape.w / 2 / L
    z1 = z0 + shape.h

    def box(t0, t1, zb, zt, depth, color, d0=0.0):
        return _box_on_wall(*a, *b, t0, t1, zb, zt, depth, nx, ny, color, d0)

    if style.frame is not None:
        details.append(box(tc - hw - 0.08 / L, tc + hw + 0.08 / L, z0 - 0.08, z1 + 0.08, 0.03, style.frame))
    else:
        details.append(box(tc - hw - 0.15 / L, tc + hw + 0.15 / L, z1, z1 + 0.2, 0.05, SILL_STONE))  # llinda
    windows.append(box(tc - hw, tc + hw, z0, z1, 0.06, GLASS_COLOR))
    if shape.mullion:
        details.append(box(tc - 0.035 / L, tc + 0.035 / L, z0, z1, 0.075, style.frame or FRAME_COLOR))
    if shutters:
        leaf = shape.w / 2 / L
        edge = hw + 0.08 / L
        for s in (-1, 1):
            t_in, t_out = tc + s * edge, tc + s * (edge + leaf)
            details.append(box(min(t_in, t_out), max(t_in, t_out), z0, z1, 0.05, style.shutters))

    if shape.balcony and floor > 0:
        # Balcó: llosana de pedra que surt de la façana i barana de ferro al voltant.
        bw = (shape.w / 2 + 0.35) / L
        t0, t1 = tc - bw, tc + bw
        details.append(box(t0, t1, z0 - 0.16, z0 - 0.02, 0.6, SILL_STONE))
        _railing(box, t0, t1, z0 - 0.02, 0.54, L, details)
        for t in (t0, t1 - 0.03 / L):
            details.append(box(t, t + 0.03 / L, z0 + 0.89, z0 + 0.93, 0.58, IRON_COLOR))
        return
    if shape.h >= 1.9 and floor > 0:
        # Balconera sense balcó: barana arran de façana a la part baixa.
        _railing(box, tc - hw, tc + hw, z0, 0.07, L, details)
        return
    details.append(box(tc - hw - 0.1 / L, tc + hw + 0.1 / L, z0 - 0.12, z0 - 0.03, 0.11, SILL_STONE))  # ampit
    if floor == 0 and style.bars and shape.h > 0.6:
        # Reixa de planta baixa: barrots verticals i dues travesses.
        n = max(2, int(shape.w / 0.17))
        for k in range(1, n):
            t = tc - hw + 2 * hw * k / n
            details.append(box(t - 0.012 / L, t + 0.012 / L, z0 - 0.02, z1 + 0.02, 0.11, IRON_COLOR, 0.08))
        for zb in (z0 + 0.12, z1 - 0.15):
            details.append(box(tc - hw, tc + hw, zb, zb + 0.03, 0.11, IRON_COLOR, 0.08))


class OpeningRegistry:
    """Obertures ja col·locades al poble (graella de 4 m), perquè dues parts cadastrals que
    comparteixen façana no hi posin finestres trepitjant-se."""

    CELL = 4.0

    def __init__(self) -> None:
        self._cells: dict[tuple[int, int], list[tuple[float, float, float, float, float]]] = {}

    def claim(self, x: float, y: float, half_m: float, z0: float, z1: float) -> bool:
        """Reserva l'obertura si no en topa cap altra; retorna si s'ha pogut."""
        cx, cy = int(np.floor(x / self.CELL)), int(np.floor(y / self.CELL))
        for i in (cx - 1, cx, cx + 1):
            for j in (cy - 1, cy, cy + 1):
                for ox, oy, oh, oz0, oz1 in self._cells.get((i, j), ()):
                    if np.hypot(x - ox, y - oy) < half_m + oh + 0.1 and z0 < oz1 and oz0 < z1:
                        return False
        self._cells.setdefault((cx, cy), []).append((x, y, half_m, z0, z1))
        return True


def _claim(taken: OpeningRegistry | None, a, b, tc: float, half_m: float, z0: float, z1: float) -> bool:
    if taken is None:
        return True
    return taken.claim(a[0] + (b[0] - a[0]) * tc, a[1] + (b[1] - a[1]) * tc, half_m, z0, z1)


def _place_window(
    a, b, nx, ny, length: float, tc: float, avail_m: float, floor: int, floors: int,
    level0: float, ground, style: WindowStyle, details: list, windows: list,
    door: tuple[float, float] | None = None, taken: OpeningRegistry | None = None,
) -> None:
    """Col·loca una finestra centrada a `tc` si hi cap (dins `avail_m` i sense trepitjar la porta)."""
    fit = _fit_window(style.shape(floor, floors), style, avail_m)
    if fit is None:
        return
    shape, shutters = fit
    if door is not None and _overlaps_door_t(tc, length, _window_half_extent_m(shape, shutters), *door):
        if not shutters:
            return
        shutters = False
        if _overlaps_door_t(tc, length, _window_half_extent_m(shape, False), *door):
            return
    hw = shape.w / 2 / max(length, 1e-6)
    local = float(_wall_ground(ground, a, b, tc - hw, tc + hw).max())
    z0 = _window_z0(shape, floor, level0, local)
    if not _claim(taken, a, b, tc, _window_half_extent_m(shape, shutters), z0 - 0.1, z0 + shape.h + 0.1):
        return
    _add_window(a, b, nx, ny, length, tc, z0, shape, style, shutters, floor, details, windows)


def _facade_door_window(
    a, b, nx, ny, length: float, floors: int, level0: float, ground, style: WindowStyle,
    details: list, windows: list, taken: OpeningRegistry | None = None,
) -> tuple[float, float]:
    """Almenys una porta i una finestra a la façana d'accés (també si el mur és curt). Retorna (door_tc, door_hw)."""
    door_tc = 0.5
    door_hw = min(0.55, max(0.32, length * 0.38)) / max(length, 1e-6)
    door_z = float(_wall_ground(ground, a, b, door_tc - door_hw, door_tc + door_hw).min()) - 0.02
    _claim(taken, a, b, door_tc, door_hw * length, door_z, door_z + 2.15)
    details.append(
        _box_on_wall(*a, *b, door_tc - door_hw, door_tc + door_hw, door_z, door_z + 2.15, 0.06, nx, ny, DOOR_COLOR)
    )
    # Finestra de planta baixa al centre del tros lliure al costat de la porta.
    free_m = (door_tc - door_hw) * length - 0.15
    if free_m >= 0.6:
        tc = (door_tc - door_hw) / 2
        _place_window(a, b, nx, ny, length, tc, free_m, 0, floors, level0, ground, style, details, windows, taken=taken)
    elif floors > 1 and length < 2.4:  # a partir de 2,4 m els pisos ja els omple house_meshes
        _place_window(
            a, b, nx, ny, length, door_tc, length - 0.3, 1, floors, level0, ground, style, details, windows, taken=taken
        )
    else:
        # Mur massa curt i casa d'una planta: finestreta sobre la porta.
        fit = _fit_window(ATTIC_SHAPE, style, length - 0.3)
        if fit is not None and _claim(taken, a, b, door_tc, fit[0].w / 2 + 0.08, door_z + 2.2, door_z + 3.0):
            _add_window(a, b, nx, ny, length, door_tc, door_z + 2.35, fit[0], style, False, 1, details, windows)
    return door_tc, door_hw


def _facade_window_slots(length: float) -> int:
    """Nombre de bays de finestra al llarg del mur (espaiat ample, màxim baix)."""
    return max(1, min(3, int(length // 4.8)))


def _street_window_slot_indices(slots: int, door_slot: int) -> list[int]:
    """Quins bays porten finestra: si n'hi ha més d'un, només una part dels bays."""
    candidates = [s for s in range(slots) if s != door_slot]
    if not candidates:
        return []
    if slots <= 2:
        return candidates[:1]
    return [s for s in candidates if s % 2 == 0][:2]


def _openings_courtyard_facades(
    rng: np.random.Generator,
    ext: np.ndarray,
    primary_i: int,
    facing_street,
    floors: int,
    level0: float,
    ground,
    style: WindowStyle,
    details: list,
    windows: list,
    taken: OpeningRegistry | None = None,
) -> None:
    """Finestres a façanes que no són la d'accés ni donen directament al carrer."""
    for i in range(len(ext)):
        if i == primary_i:
            continue
        a, b = ext[i], ext[(i + 1) % len(ext)]
        length = float(np.hypot(*(b - a)))
        if length < 1.35:
            continue
        nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length
        if facing_street(a[0], a[1], b[0], b[1], nx, ny):
            continue
        if rng.random() > SIDE_FACADE_WINDOW_CHANCE:
            continue
        slots = max(1, min(2, int(length // 4.8)))
        for f in range(floors):
            n = 1 if slots == 1 else rng.integers(1, 2)
            for s in sorted(rng.choice(slots, size=n, replace=False)):
                tc = (s + 0.5) / slots
                _place_window(
                    a, b, nx, ny, length, tc, length / slots - 0.3, f, floors, level0, ground, style, details, windows,
                    taken=taken,
                )


def _box_on_wall(ax, ay, bx, by, t0, t1, z0, z1, depth, nx, ny, color, d0=0.0):
    """Caixa plana enganxada a la façana entre les fraccions t0..t1 de l'aresta i alçades z0..z1;
    sobresurt del mur de `d0` a `depth`."""
    import trimesh

    p0 = np.array([ax + (bx - ax) * t0, ay + (by - ay) * t0])
    p1 = np.array([ax + (bx - ax) * t1, ay + (by - ay) * t1])
    n = np.array([nx, ny])
    p0, p1, off = p0 + n * d0, p1 + n * d0, n * (depth - d0)
    corners = [p0, p1, p1 + off, p0 + off]
    verts = [_w(c[0], c[1], z0) for c in corners] + [_w(c[0], c[1], z1) for c in corners]
    faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]]
    m = _vc(np.array(verts), np.array(faces), color)
    trimesh.repair.fix_normals(m)
    # La cara que mira al mur no es veu mai: fora (orienta primer amb la caixa tancada).
    keep = np.ones(len(faces), dtype=bool)
    keep[4:6] = False
    m.update_faces(keep)
    return m


def house_meshes(
    poly: Polygon, floors: int, ground, wall_color, facing_street, roads_u=None, seed: int = 0,
    taken: OpeningRegistry | None = None,
) -> tuple[list, list, list, list]:
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

    rng = np.random.default_rng(seed & 0xFFFFFFFF)
    walls, details, windows = [], [], []
    plinth_top = base + 0.25 + PLINTH_H
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        (ax, ay), (bx, by) = ring[i], ring[j]
        seg = max(1e-6, float(np.hypot(bx - ax, by - ay)))
        outward = np.array([(by - ay) / seg, 0.0, (bx - ax) / seg])  # (nx, 0, −ny) amb n = (dy, −dx)
        walls.append(_quad(_w(ax, ay, base), _w(bx, by, base), _w(bx, by, plinth_top), _w(ax, ay, plinth_top), PLINTH_COLOR, outward))
        walls.append(_quad(_w(ax, ay, plinth_top), _w(bx, by, plinth_top), _w(bx, by, tops[j]), _w(ax, ay, tops[i]), wall_color, outward))

    # Porta i finestra mínimes a la façana d'accés; més obertures a les altres façanes al carrer.
    # Els pisos es compten des del ràfec cap avall (planta baixa a g.max() + 0,3), perquè les
    # finestres de dalt quedin sempre per sota la teulada encara que la casa sigui en pendent.
    level0 = eave - floors * FLOOR_H
    style = WindowStyle.pick(rng, floors)
    primary_i = _primary_street_edge_index(ext, facing_street, roads_u)
    primary_door: tuple[float, float] | None = None
    if primary_i >= 0:
        a, b = ext[primary_i], ext[(primary_i + 1) % len(ext)]
        length = float(np.hypot(*(b - a)))
        nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length
        primary_door = _facade_door_window(
            a, b, nx, ny, length, floors, level0, ground, style, details, windows, taken
        )

    for i in range(len(ext)):
        a, b = ext[i], ext[(i + 1) % len(ext)]
        length = float(np.hypot(*(b - a)))
        if length < 2.4:
            continue
        nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length  # normal exterior (anell antihorari)
        if not facing_street(a[0], a[1], b[0], b[1], nx, ny):
            continue
        slots = _facade_window_slots(length)
        door_slot = slots // 2
        win_slots = _street_window_slot_indices(slots, door_slot if i != primary_i else -1)
        for f in range(floors):
            # Planta baixa de la façana d'accés: només porta + finestra de _facade_door_window.
            if i == primary_i and f == 0:
                continue
            for s in win_slots:
                tc = (s + 0.5) / slots
                door = primary_door if i == primary_i else None
                _place_window(
                    a, b, nx, ny, length, tc, length / slots - 0.3, f, floors, level0, ground, style, details, windows,
                    door, taken,
                )

    _openings_courtyard_facades(
        rng, ext, primary_i, facing_street, floors, level0, ground, style, details, windows, taken
    )

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
        # Direcció del carener al món (x, z) codificada al color de vèrtex: el joc hi alinea les
        # fileres de teules. glTF desa els colors en lineal, sense conversió.
        ux, uy = -roof.ny, roof.nx
        ridge_rgb = [int(round((ux * 0.5 + 0.5) * 255)), int(round((-uy * 0.5 + 0.5) * 255)), 0, 255]
        m.visual.vertex_colors = np.tile(ridge_rgb, (len(m.vertices), 1)).astype(np.uint8)
        roof_meshes.append(m)
    return walls, roof_meshes, details, windows


# --- Tàpies --------------------------------------------------------------------------------

WALL_HEIGHT_M = 1.9
# Totxo (sRGB): tons molt clars i semblants entre trams. Les juntes clares les posa el joc.
TAPIA_COLORS = [(238, 228, 212), (232, 222, 206), (242, 234, 220), (228, 218, 202), (235, 226, 210)]
# Albardilla (remat de morter o de teula plana) d'alguns murs.
TAPIA_CAP_COLORS = [(196, 190, 178), (204, 198, 186), (188, 182, 172)]
# Llargada màxima d'un bloc de tàpia: cada tram es parteix en caixes d'aquesta mida.
TAPIA_BLOCK_M = 4.0
# Alçada d'una filada de totxo: els trencaments del mur van a esglaons d'aquesta mida.
BRICK_COURSE_M = 0.15


def _srgb_to_linear(c, jitter: float = 1.0) -> list[int]:
    """Els colors de vèrtex del glTF són lineals; la paleta és sRGB."""
    lin = [(min(1.0, ch / 255.0 * jitter)) ** 2.2 for ch in c]
    return [int(round(x * 255)) for x in lin] + [255]


def drop_lone_blocks(lines: list[LineString], min_len: float = TAPIA_BLOCK_M) -> list[LineString]:
    """Treu les tàpies soltes d'un sol bloc: restes de la vora d'una parcel·la entre cases i
    carrers que queden com un mur aïllat. Els trams connectats compten junts, perquè la unió de
    les vores talla una tàpia llarga a cada cruïlla."""
    if not lines:
        return lines
    groups = unary_union([ln.buffer(0.05) for ln in lines])
    tree = shapely.STRtree(lines)
    keep: list[LineString] = []
    for g in getattr(groups, "geoms", [groups]):
        idx = tree.query(g, predicate="intersects")
        if sum(lines[i].length for i in idx) > min_len:
            keep.extend(lines[i] for i in idx)
    return keep


def _broken_edge(rng, u_edge: float, inward: int, width: float, depth: float, top) -> list[tuple[float, float]]:
    """Cantonada esbotzada: esglaons de filades de totxo des de `u_edge` (a `depth` per sota del
    capdamunt) fins a l'alçada sencera a `width` cap a dins (`inward` = ±1). Punts en ordre de u."""
    steps = max(2, int(round(depth / BRICK_COURSE_M * 0.6)))
    frac = np.cumsum(rng.uniform(0.6, 1.4, steps))
    us = u_edge + inward * width * np.concatenate([[0.0], frac / frac[-1]])
    pts = []
    for k in range(steps):
        d = max(BRICK_COURSE_M, round(depth * (1 - k / steps) / BRICK_COURSE_M) * BRICK_COURSE_M)
        pts += [(us[k], top(us[k]) - d), (us[k + 1], top(us[k + 1]) - d)]
    pts.append((us[-1], top(us[-1])))
    return pts if inward > 0 else pts[::-1]


def _tapia_block(rng, seg: float, e0: float, e1: float, za: float, zb: float, z_bot: float, damage: dict):
    """Perfil (u al llarg del mur, alçada) d'un bloc: capdamunt inclinat de za (u=0) a zb (u=seg),
    amb les cantonades esbotzades o el forat del capdamunt que demani `damage`."""
    from shapely.geometry.polygon import orient

    def top(u: float) -> float:
        return za + (zb - za) * (u / seg)

    u0, u1 = -e0, seg + e1
    upper: list[tuple[float, float]] = []  # capdamunt, de u0 a u1
    if "start" in damage:
        w, d = damage["start"]
        upper += _broken_edge(rng, u0, 1, w, d, top)
    else:
        upper.append((u0, top(u0)))
    if "dip" in damage:
        c, w, d = damage["dip"]
        left = _broken_edge(rng, c, -1, w / 2, d, top)  # de c-w/2 fins a c
        right = _broken_edge(rng, c, 1, w / 2, d, top)  # de c fins a c+w/2
        upper += left + right[1:]
    if "end" in damage:
        w, d = damage["end"]
        upper += _broken_edge(rng, u1, -1, w, d, top)
    else:
        upper.append((u1, top(u1)))
    poly = Polygon([(u0, z_bot), (u1, z_bot), *reversed(upper)]).buffer(0)
    if poly.geom_type != "Polygon":
        poly = max(getattr(poly, "geoms", [poly]), key=lambda g: g.area)
    return orient(poly)


def tapia_meshes(lines, ground) -> tuple[list, list]:
    """Tàpies de totxo al llarg de les línies. Cada mur té la seva alçada, gruix, color i pendent;
    alguns tenen albardilla, i n'hi ha amb cantonades esbotzades, forats al capdamunt i esglaons.
    Torna (murs, albardilles); les albardilles són detall (sense col·lisió ni textura de totxo)."""
    import trimesh

    out, caps = [], []
    for k, line in enumerate(lines):
        if line.length < 1.0:
            continue
        # Llavor estable segons la posició del mur: el mateix mur surt igual a cada generació.
        x0, y0 = line.coords[0]
        rng = np.random.default_rng([int(abs(x0) * 100), int(abs(y0) * 100), k])
        color = TAPIA_COLORS[rng.integers(len(TAPIA_COLORS))]
        height = rng.uniform(1.45, 2.35)
        thick = float(rng.choice([0.24, 0.3, 0.3, 0.38]))
        total = line.length
        # Pendent suau al llarg de tot el mur: una punta fins a ~50 cm més alta que l'altra.
        slope = rng.uniform(-0.5, 0.5) / max(total, 4.0)
        cap = rng.random() < 0.45
        cap_color = TAPIA_CAP_COLORS[rng.integers(len(TAPIA_CAP_COLORS))]
        broken_start = rng.random() < 0.35
        broken_end = rng.random() < 0.35
        pts = np.array(line.segmentize(TAPIA_BLOCK_M).coords)
        n = len(pts) - 1
        step = 0.0
        s = 0.0
        for i, (a, b) in enumerate(zip(pts[:-1], pts[1:])):
            seg = float(np.hypot(*(b - a)))
            if seg < 0.2:
                s += seg
                continue
            # De tant en tant el mur fa un esglaó (un tram refet més alt o més baix).
            if i and rng.random() < 0.15:
                step = float(np.clip(step + rng.choice([-1, 1]) * rng.uniform(0.15, 0.4), -0.5, 0.5))
            ga, gb = ground.height(np.array([a[0], b[0]]), np.array([a[1], b[1]]))
            # El capdamunt segueix el terreny (alçada sobre el punt més alt de cada punta) i el pendent.
            ref = max(ga, gb)
            za = ref + height + step + slope * (s - total / 2) + (ga - ref) * 0.5
            zb = ref + height + step + slope * (s + seg - total / 2) + (gb - ref) * 0.5
            z_bot = min(ga, gb) - 0.2
            damage = {}
            if i == 0 and broken_start and seg > 1.2:
                damage["start"] = (rng.uniform(0.4, min(1.4, seg * 0.45)), rng.uniform(0.3, 0.9))
            if i == n - 1 and broken_end and seg > 1.2:
                damage["end"] = (rng.uniform(0.4, min(1.4, seg * 0.45)), rng.uniform(0.3, 0.9))
            if not damage and seg > 2.5 and rng.random() < 0.12:
                w = rng.uniform(0.7, min(1.8, seg * 0.4))
                damage["dip"] = (rng.uniform(0.3, 0.7) * seg, w, rng.uniform(0.25, 0.6))
            # Les puntes s'allarguen per tancar les juntes en angle, però no dins d'un tros esbotzat.
            e0 = 0.0 if "start" in damage else 0.15
            e1 = 0.0 if "end" in damage else 0.15
            profile = _tapia_block(rng, seg, e0, e1, za, zb, z_bot, damage)
            m = trimesh.creation.extrude_polygon(profile, height=thick)
            m.apply_translation([0, 0, -thick / 2])
            ang = np.arctan2(b[1] - a[1], b[0] - a[0])
            # Perfil: x al llarg del mur, y = alçada; al món la direcció local (cos, sin) és (x, −z).
            m.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 1, 0]))
            m.apply_translation([a[0], 0, -a[1]])
            # Cada bloc, un pèl diferent de to (tongades de totxo, sol, humitat).
            rgba = _srgb_to_linear(color, rng.uniform(0.97, 1.03))
            m.visual.vertex_colors = np.tile(rgba, (len(m.vertices), 1)).astype(np.uint8)
            out.append(m)
            if cap and not damage:
                # Albardilla: llosa una mica més ampla que el mur, seguint el capdamunt.
                lip = Polygon([(-e0, za - 0.04), (seg + e1, zb - 0.04), (seg + e1, zb + 0.06), (-e0, za + 0.06)])
                c = trimesh.creation.extrude_polygon(lip, height=thick + 0.08)
                c.apply_translation([0, 0, -(thick + 0.08) / 2])
                c.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 1, 0]))
                c.apply_translation([a[0], 0, -a[1]])
                c.visual.vertex_colors = np.tile(_srgb_to_linear(cap_color), (len(c.vertices), 1)).astype(np.uint8)
                caps.append(c)
            s += seg
    return out, caps


# --- Coberts que no surten al Cadastre -----------------------------------------------------


def roof_hue(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(to en graus al voltant del vermell, croma). Negatiu = cap al magenta; 99 si no domina el vermell."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=2)
    chroma = mx - rgb.min(axis=2)
    hue = np.where(r >= mx, 60 * (g - b) / np.maximum(chroma, 1e-3), 99.0)
    return hue, chroma


def roof_mask(rgb: np.ndarray) -> np.ndarray:
    """Teula àrab: rosat o vermell apagat (to −20…23°). La terra dels camps és més groga (to ≥ 20°)
    i menys saturada; el verd i l'asfalt queden lluny. Inclou el vessant a l'ombra (fins a valor 60)."""
    hue, chroma = roof_hue(rgb)
    value = rgb.mean(axis=2)
    return (hue > -20) & (hue < 23) & (chroma > 18) & (value > 60) & (value < 235)


def detect_extra_roofs(
    cls: Classification,
    known: list[Polygon],
    roads,
    near,
    min_area_m2: float = 10.0,
) -> list[Polygon]:
    """Teulades a la imatge que no surten al Cadastre: coberts, garatges, naus i annexos.

    El rosat de les teules és molt semblant a la terra llaurada, així que només es busca a prop
    dels edificis coneguts (`near`). Un tros pàl·lid (to de terra) només s'accepta si toca una
    casa o és clarament rectangular; un de rosat/vermell intens, sempre que sigui compacte.
    La calçada de l'OSM sovint s'enfila uns metres sobre les cases: se'n retalla, no es descarta."""
    from rasterio import features
    from rasterio.transform import from_origin
    from shapely.geometry import shape

    x0, y0, res = cls.transform
    hue, chroma = roof_hue(cls.rgb)
    tiles = roof_mask(cls.rgb) & np.isin(cls.labels, [PAVED, SOIL, ROAD])
    # Primer tanca els forats (ombres de xemeneies, antenes), després treu el soroll.
    tiles = ndimage.binary_closing(tiles, iterations=2)
    tiles = ndimage.binary_opening(tiles, iterations=2)
    tiles = _drop_small(tiles, min_area_m2 / res**2)

    known_u = unary_union(known) if known else Polygon()
    blocked = known_u.buffer(0.05).union(roads)
    out: list[Polygon] = []
    for geom, _ in features.shapes(tiles.astype(np.uint8), mask=tiles, transform=from_origin(x0, y0, res, res)):
        poly = shape(geom).buffer(0).difference(blocked)
        # Fora les franges de menys d'1,4 m: voladissos i el desplaçament de perspectiva de les
        # teulades del Cadastre, que la teulada 3D ja tapa.
        poly = poly.buffer(-0.7, join_style=2).buffer(0.7, join_style=2)
        for p in getattr(poly, "geoms", [poly]):
            if not isinstance(p, Polygon) or p.area < min_area_m2 or not p.within(near):
                continue
            solidity = p.area / max(p.convex_hull.area, 1e-6)
            if solidity < 0.7:
                continue  # franges disperses o en forma de L estranya: terra o ombres
            rect = p.minimum_rotated_rectangle
            fill = p.area / max(rect.area, 1e-6)
            win, mask = cls.window_mask(p.buffer(-0.4))
            h = hue[win][mask]
            h = h[h < 90]
            if h.size == 0:
                continue
            strong = np.median(h) < 12 or np.median(chroma[win][mask]) >= 46
            touches_house = p.distance(known_u) < 1.5
            if not (strong or touches_house or (fill >= 0.85 and solidity >= 0.9)):
                continue
            shape_poly = rect if fill >= 0.75 else p.simplify(0.4)
            shape_poly = shape_poly.difference(blocked)
            for q in getattr(shape_poly, "geoms", [shape_poly]):
                if isinstance(q, Polygon) and q.area >= min_area_m2:
                    out.append(q)
    return out


# --- Orquestració ----------------------------------------------------------------------------


@dataclass
class Village:
    zone: Polygon | MultiPolygon  # local
    meshes: list  # (nom, trimesh)
    trees: list[dict]
    plants: list[list]
    parcels: list[dict]


def _occupied(meshes: list) -> Polygon:
    """Envolupant en planta (local x, y) dels vèrtexs d'un edifici."""
    from shapely.geometry import MultiPoint

    return MultiPoint([(x, -z) for m in meshes for x, _, z in m.vertices]).convex_hull


def read_cadastre(cad_dir: Path, name: str) -> gpd.GeoDataFrame:
    """Uneix els trossos baixats (`{name}_i_j.gml`) i treu els duplicats de les vores."""
    import pandas as pd

    files = sorted(cad_dir.glob(f"{name}_*.gml")) or [cad_dir / f"{name}.gml"]
    frames = []
    for f in files:
        if not f.is_file():
            continue
        try:
            frames.append(gpd.read_file(f))
        except (IndexError, ValueError):
            continue  # tros sense cap element (p. ex. camps sense edificis): GML sense capa
    if not frames:
        raise FileNotFoundError(f"Cadastre {name}: cap fitxer a {cad_dir}")
    gdf = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=frames[0].crs)
    return gdf.drop_duplicates(subset="gml_id").reset_index(drop=True)


def _street_point(cfg: dict, name: str, geom, ox: float, oy: float) -> tuple[float, float] | None:
    """Punt (local) del carrer `name` de l'OSM més proper a la geometria; None si no hi és."""
    from shapely.ops import nearest_points

    osm = gpd.read_file(cfg["paths"]["osm_geojson"]).to_crs(epsg=int(cfg["utm_epsg"]))
    lines = osm[osm["highway"].notna() & (osm["name"] == name)]
    if lines.empty:
        print(f"Village: carrer '{name}' no trobat a l'OSM")
        return None
    street = to_local(unary_union(list(lines.geometry)), ox, oy)
    p = nearest_points(street, geom)[0]
    return float(p.x), float(p.y)


def _roof_fraction(ortho: Ortho, geom) -> float:
    if geom.is_empty or geom.area < 1:
        return 0.0
    rgb, transform = ortho.window(geom.bounds, CLASS_RES_M)
    mask = _rasterize([geom], rgb.shape[:2], transform)
    return float(roof_mask(rgb)[mask].mean()) if mask.any() else 0.0


def _floors(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 1


# Atribut de vèrtex amb l'identificador de casa (glTF `_HOUSE`, al joc `_house`): el mode dev
# (Maj+D) pinta cada casa d'un color. 0 = no és cap casa (tàpies, albardilles).
HOUSE_ATTR = "_HOUSE"


def tag_house(meshes: list, house_id: int) -> list:
    for m in meshes:
        m.vertex_attributes[HOUSE_ATTR] = np.full(len(m.vertices), house_id, dtype=np.float32)
    return meshes


def concat_tagged(meshes: list):
    """Com trimesh.util.concatenate, però l'atribut de casa només es conserva si el tenen totes
    les malles: les que no en tenen hi van amb 0."""
    import trimesh

    if any(HOUSE_ATTR in m.vertex_attributes for m in meshes):
        for m in meshes:
            if HOUSE_ATTR not in m.vertex_attributes:
                tag_house([m], 0)
    return trimesh.util.concatenate(meshes)


def build_village(cfg: dict, ground, ortho: Ortho, roads_local: list[Polygon], ox: float, oy: float) -> Village:
    import trimesh

    cad = Path(cfg["paths"]["cadastre_dir"])
    zone = to_local(detail_zone_utm(cfg), ox, oy)
    roads_u = unary_union(roads_local) if roads_local else Polygon()

    parts = read_cadastre(cad, "BuildingPart")
    parts["geometry"] = parts.geometry.apply(lambda g: to_local(g, ox, oy))
    parts = parts[parts.intersects(zone)].copy()
    # Parts sense plantes: piscines i patis, però també porxos i coberts. Si a la imatge hi ha
    # teula, és un cobert d'una planta.
    floors = parts["numberOfFloorsAboveGround"].apply(_floors)
    for i in parts.index[floors <= 0]:
        if _roof_fraction(ortho, parts.at[i, "geometry"]) >= 0.5:
            floors[i] = 1
    parts["numberOfFloorsAboveGround"] = floors
    parts = parts[floors > 0]
    parts["building"] = parts["localId"].astype(str).str.split("_part").str[0]
    part_polys = [g for g in parts.geometry]

    parcels = read_cadastre(cad, "CadastralParcel")
    parcels["geometry"] = parcels.geometry.apply(lambda g: to_local(g, ox, oy))
    parcels = parcels[parcels.intersects(zone)]

    cls = classify(ortho, zone, part_polys, roads_local)
    # Coberts nous només a prop d'edificis coneguts: lluny, la terra vermella dels camps enganya.
    near_buildings = unary_union(part_polys).buffer(25.0) if part_polys else Polygon()
    extra = [r for r in detect_extra_roofs(cls, part_polys, roads_u, near_buildings) if r.intersects(zone)]
    print(f"Village: {len(parts)} parts del Cadastre, {len(extra)} coberts detectats a la imatge")

    buildings_u = unary_union(part_polys + extra)
    road_core = roads_u.buffer(1.0)

    def facing_street(ax, ay, bx, by, nx, ny) -> bool:
        mx, my = (ax + bx) / 2, (ay + by) / 2
        probe = LineString([(mx + nx * 0.3, my + ny * 0.3), (mx + nx * 6.0, my + ny * 6.0)])
        return probe.intersects(roads_u) and not probe.intersects(buildings_u.buffer(-0.05))

    walls, roofs, details, window_panes = [], [], [], []
    taken = OpeningRegistry()
    # Un identificador per model de casa (cada part del Cadastre, cada cobert detectat i cada
    # model propi): el mode dev del joc el fa servir per pintar-les de colors diferents.
    house_ids = itertools.count(1)
    # Edificis singulars amb model propi (ara, l'església): les seves parts no es fan com a casa.
    church_ref = str(cfg.get("village_detail", {}).get("church_ref", ""))
    church_rows = parts[parts["building"] == church_ref] if church_ref else parts.iloc[0:0]
    church_stone = []
    landmark_hulls = []  # superfície ocupada per cada model propi (un per edifici)
    if len(church_rows):
        from church import church_meshes

        footprint = unary_union(list(church_rows.geometry))
        footprint = max(getattr(footprint, "geoms", [footprint]), key=lambda g: g.area)
        street = str(cfg.get("village_detail", {}).get("church_street", ""))
        toward = _street_point(cfg, street, footprint, ox, oy) if street else None
        st, rf, dt = church_meshes(footprint, ground, toward)
        tag_house(st + rf + dt, next(house_ids))
        landmark_hulls.append(_occupied(st))
        church_stone += st
        roofs += rf
        details += dt
        print(f"Village: església ({church_ref}) amb model propi")
    hermitage_ref = str(cfg.get("village_detail", {}).get("hermitage_ref", ""))
    hermitage_rows = parts[parts["building"] == hermitage_ref] if hermitage_ref else parts.iloc[0:0]
    # Parcel·la de l'ermita: queda oberta al camp, sense tàpia al voltant.
    unwalled = Polygon()
    if len(hermitage_rows):
        from hermitage import hermitage_meshes

        footprint = unary_union(list(hermitage_rows.geometry))
        footprint = max(getattr(footprint, "geoms", [footprint]), key=lambda g: g.area)
        unwalled = unary_union(list(parcels[parcels.intersects(footprint)].geometry) + [footprint])
        st, rf, dt = hermitage_meshes(footprint, ground)
        tag_house(st + rf + dt, next(house_ids))
        landmark_hulls.append(_occupied(st))
        church_stone += st
        roofs += rf
        details += dt
        print(f"Village: ermita de las Encinas ({hermitage_ref}) amb model propi")
    if landmark_hulls:
        # Els models propis surten de la planta cadastral (pòrtics, galeries): arbres i tàpies
        # han d'evitar tot el que ocupen, no només la planta. Una envolupant per edifici.
        buildings_u = unary_union([buildings_u, *[h.buffer(0.5) for h in landmark_hulls]])
    for _, row in parts.iterrows():
        if row["building"] in {church_ref, hermitage_ref}:
            continue
        color = WALL_PALETTE[sum(ord(c) for c in row["building"]) % len(WALL_PALETTE)]
        # Llavor per edifici (totes les parts amb el mateix estil de finestra); la suma de
        # caràcters es repetia massa entre referències cadastrals.
        seed = zlib.crc32(str(row["building"]).encode())
        for poly in getattr(row.geometry, "geoms", [row.geometry]):
            if poly.area < 4:
                continue
            w, r, d, win = house_meshes(
                poly, _floors(row["numberOfFloorsAboveGround"]), ground, color, facing_street, roads_u, seed, taken
            )
            tag_house(w + r + d + win, next(house_ids))
            walls += w
            roofs += r
            details += d
            window_panes += win
    for k, rect in enumerate(extra):
        w, r, d, win = house_meshes(
            rect, 1, ground, WALL_PALETTE[(k * 3 + 1) % len(WALL_PALETTE)], facing_street, roads_u, 9000 + k, taken
        )
        tag_house(w + r + d + win, next(house_ids))
        walls += w
        roofs += r
        details += d
        window_panes += win

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
        if not unwalled.is_empty:
            lines = lines.difference(unwalled.buffer(0.3))
        tapia_lines = [ln for ln in getattr(lines, "geoms", [lines]) if isinstance(ln, LineString)]
        n_lines = len(tapia_lines)
        tapia_lines = drop_lone_blocks(tapia_lines)
        print(f"Village: {n_lines - len(tapia_lines)} tàpies soltes d'un sol bloc eliminades")
    tapias, tapia_caps = tapia_meshes(tapia_lines, ground)
    details += tapia_caps

    # Arbres de la imatge (fora d'edificis i carrers) i plantes d'hort on hi ha verd.
    crowns = detect_trees(cls)
    cx = np.array([t.x for t in crowns])
    cy = np.array([t.y for t in crowns])
    keep = ~(shapely.contains_xy(buildings_u, cx, cy) | shapely.contains_xy(road_core, cx, cy) | ground.in_water(cx, cy)) if crowns else np.array([], bool)
    kept = [t for t, k in zip(crowns, keep) if k]
    heights = ground.height(cx[keep], cy[keep]) if kept else []
    trees = []
    for t, y in zip(kept, heights):
        height = float(np.clip(1.6 + t.radius * 2.1, 3.0, 14.0))
        trees.append({"x": round(t.x, 2), "y": round(float(y), 2), "z": round(-t.y, 2), "r": round(t.radius, 2), "h": round(height, 2), "c": list(t.color)})
    plants = _hort_plants(hort_polys, cls, ground)

    meshes = []
    if church_stone:
        meshes.append(("building_church_stone", concat_tagged(church_stone)))
    if walls:
        meshes.append(("building_houses", concat_tagged(walls)))
    if tapias:
        meshes.append(("building_tapias", concat_tagged(tapias)))
    if details:
        meshes.append(("prop_facades", concat_tagged(details)))
    if window_panes:
        meshes.append(("prop_windows", concat_tagged(window_panes)))
    if roofs:
        meshes.append(("roofs", concat_tagged(roofs)))
    counts = {k: sum(1 for p in parcel_info if p["type"] == k) for k in PARCEL_TYPES}
    print(f"Village: parcel·les {counts}, {len(tapia_lines)} trams de tàpia, {len(trees)} arbres, {len(plants)} plantes d'hort")
    return Village(zone, meshes, trees, plants, parcel_info)


def _hort_plants(polys: list, cls: Classification, ground, spacing: float = 0.85) -> list[list]:
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
            inside = shapely.contains_xy(p, px, py)
            px, py = px[inside], py[inside]
            x0, y0, _ = cls.transform
            col = ((px - x0) / res).astype(int).clip(0, veg.shape[1] - 1)
            row = ((y0 - py) / res).astype(int).clip(0, veg.shape[0] - 1)
            green = veg[row, col] & ~ground.in_water(px, py)
            hs = ground.height(px[green], py[green])
            for x, y, h, rr, cc in zip(px[green], py[green], hs, row[green], col[green]):
                rgb = cls.rgb[rr, cc]
                # Format compacte [x, y, z, r, g, b]: n'hi ha desenes de milers.
                plants.append([round(float(x), 2), round(float(h), 2), round(float(-y), 2), int(rgb[0]), int(rgb[1]), int(rgb[2])])
    return plants
