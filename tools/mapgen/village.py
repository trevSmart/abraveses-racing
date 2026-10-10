"""Poble en 3D a partir del Cadastre + anàlisi de l'ortofoto PNOA, als carrers de detall.

- Cases: plantes i nombre de pisos del Cadastre (BuildingPart), teulada a quatre aigües.
- Coberts que no surten al Cadastre: teules rosades o vermelles detectades a la imatge.
- Arbres: copes detectades a la imatge (vegetació fosca i amb textura), mida i color reals.
- Parcel·les: classificades com a pati, hort, arbrat, prat o terra segons la imatge.
- Tàpies: a les vores de patis i horts sense edifici, només on l'ortofoto en mostra l'ombra (walls.py).
  Les que tenen fitxa a walls.yaml es fan amb la llargada de la vora cadastral i l'alçada de la foto.
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


# Al centre (carrers amb nom) l'ortofoto deixa les copes a ~5 m, i el poble es veu massa ple.
# Fora d'aquesta franja —choperes i terme— la separació de la detecció es queda.
VILLAGE_TREE_BUFFER_M = 42.0
VILLAGE_TREE_GAP_M = 12.0


def named_streets_local(cfg: dict, ox: float, oy: float):
    """Carrers amb nom de l'OSM, en coordenades locals (x est, y nord)."""
    osm = gpd.read_file(cfg["paths"]["osm_geojson"]).to_crs(epsg=int(cfg["utm_epsg"]))
    if "name" not in osm.columns or "highway" not in osm.columns:
        return Polygon()
    named = osm["name"].map(lambda v: isinstance(v, str) and bool(v.strip()))
    lines = osm[osm["highway"].notna() & named]
    geoms = [to_local(g, ox, oy) for g in lines.geometry if g is not None and not g.is_empty]
    return unary_union(geoms) if geoms else Polygon()


def thin_village_center(crowns: list[TreeCrown], streets) -> list[TreeCrown]:
    """Al centre es queda la copa més grossa de cada grup, separades `VILLAGE_TREE_GAP_M`.
    Fora del buffer dels carrers no es treu cap arbre."""
    if not crowns or streets is None or streets.is_empty:
        return crowns
    inside = shapely.distance(shapely.points([c.x for c in crowns], [c.y for c in crowns]), streets) < VILLAGE_TREE_BUFFER_M
    if not np.any(inside):
        return crowns
    gap = VILLAGE_TREE_GAP_M
    grid: dict[tuple[int, int], list[TreeCrown]] = {}
    kept: list[TreeCrown] = []
    for i in sorted(range(len(crowns)), key=lambda i: -crowns[i].radius):
        c = crowns[i]
        if inside[i]:
            gx, gy = int(c.x // gap), int(c.y // gap)
            if any(
                np.hypot(o.x - c.x, o.y - c.y) < gap
                for dx in (-1, 0, 1)
                for dy in (-1, 0, 1)
                for o in grid.get((gx + dx, gy + dy), ())
            ):
                continue
            grid.setdefault((gx, gy), []).append(c)
        kept.append(c)
    return kept


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
    roller: float | None = None  # fracció abaixada de la persiana enrotllable (fitxes de casa)
    fill: tuple[int, int, int] | None = None  # obertura tapiada (maó, tauler): tapa el vidre


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
# Persiana enrotllable: fracció abaixada si la fitxa no la diu per a la finestra.
ROLLER_DOWN = 0.7


@dataclass(frozen=True)
class WindowStyle:
    """Aspecte de les finestres d'una casa: totes comparteixen marc i porticons."""

    ground: WindowShape
    upper: WindowShape
    frame: tuple[int, int, int] | None
    shutters: tuple[int, int, int] | None
    bars: bool  # reixa a la planta baixa
    attic: bool  # l'últim pis (si n'hi ha 3 o més) amb finestretes de golfes
    roller: tuple[int, int, int] | None = None  # persianes enrotllables (només fitxes de casa)
    frame_w: float = 0.08  # amplada del marc (els emmarcats d'obra de les fitxes són més amples)

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
    """Teulada sobre el rectangle mínim: carener al llarg de l'eix llarg. A dues aigües, o a
    quatre (`hip`) amb els aiguavessos dels caps a 45° en planta."""

    cx: float
    cy: float
    nx: float  # normal al carener
    ny: float
    half_w: float
    eave: float
    slope: float  # tan(pendent)
    half_l: float = 0.0
    hip: bool = False

    @classmethod
    def for_polygon(
        cls, poly: Polygon, eave: float, pitch_deg: float | None = None, hip: bool = False, ridge=None
    ) -> "RoofFrame":
        """`ridge`: direcció (x, y) del carener; per defecte, l'eix llarg del rectangle."""
        rect = poly.minimum_rotated_rectangle
        xs, ys = rect.exterior.coords.xy
        e1 = np.array([xs[1] - xs[0], ys[1] - ys[0]])
        e2 = np.array([xs[2] - xs[1], ys[2] - ys[1]])
        if ridge is not None:
            par = [abs(np.dot(e, ridge)) / max(np.linalg.norm(e), 1e-6) for e in (e1, e2)]
            long_e, short_e = (e1, e2) if par[0] >= par[1] else (e2, e1)
        else:
            long_e, short_e = (e1, e2) if np.linalg.norm(e1) >= np.linalg.norm(e2) else (e2, e1)
        width = float(np.linalg.norm(short_e))
        n = short_e / max(width, 1e-6)
        c = rect.centroid
        # Teules àrabs: ~22°; naus grans una mica més planes.
        pitch = np.radians(pitch_deg if pitch_deg is not None else 22 if width < 12 else 17)
        half_l = float(np.linalg.norm(long_e)) / 2
        return cls(c.x, c.y, float(n[0]), float(n[1]), width / 2, eave, float(np.tan(pitch)), half_l, hip)

    def z(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        dx, dy = np.asarray(x) - self.cx, np.asarray(y) - self.cy
        d = self.half_w - np.abs(dx * self.nx + dy * self.ny)
        if self.hip:
            d = np.minimum(d, self.half_l - np.abs(-dx * self.ny + dy * self.nx))
        return self.eave + self.slope * d

    def ridge(self, length: float = 500.0) -> LineString:
        ux, uy = -self.ny, self.nx
        return LineString([(self.cx - ux * length, self.cy - uy * length), (self.cx + ux * length, self.cy + uy * length)])


def _hip_roof_meshes(roof: RoofFrame, overhang: float, roof_lin: tuple[int, int, int]) -> list:
    """Teulada a quatre aigües amb voladís: un pla per vessant, cadascun amb les fileres de
    teules paral·leles al seu ràfec."""
    ux, uy = -roof.ny, roof.nx
    hl, hw, o = roof.half_l, roof.half_w, overhang
    r = max(0.0, hl - hw)  # mig carener
    sides = [
        ([(-hl - o, hw + o), (hl + o, hw + o), (r, 0.0), (-r, 0.0)], (ux, uy)),
        ([(hl + o, -hw - o), (-hl - o, -hw - o), (-r, 0.0), (r, 0.0)], (ux, uy)),
        ([(hl + o, hw + o), (hl + o, -hw - o), (r, 0.0)], (roof.nx, roof.ny)),
        ([(-hl - o, -hw - o), (-hl - o, hw + o), (-r, 0.0)], (roof.nx, roof.ny)),
    ]
    out = []
    for uv, (rx, ry) in sides:
        uv = [p for k, p in enumerate(uv) if k == 0 or np.hypot(p[0] - uv[k - 1][0], p[1] - uv[k - 1][1]) > 1e-6]
        xy = np.array([(roof.cx + ux * u + roof.nx * v, roof.cy + uy * u + roof.ny * v) for u, v in uv])
        verts = np.column_stack([xy[:, 0], roof.z(xy[:, 0], xy[:, 1]), -xy[:, 1]])
        faces = np.array([[0, k, k + 1] for k in range(1, len(verts) - 1)])
        m = _vc(verts, faces, (0, 0, 0))
        if m.face_normals[:, 1].mean() < 0:
            _flip_faces(m)
        m.visual.vertex_colors = np.tile(_roof_vertex_rgba(rx, ry, roof_lin), (len(verts), 1)).astype(np.uint8)
        out.append(m)
    return out


def _eave_trim(roof: RoofFrame, overhang: float, color, band: float = 0.2) -> list:
    """Ràfec encaixonat de la teulada a quatre aigües: frontis vertical a la vora del voladís i
    plafó horitzontal per sota fins a la paret."""
    import trimesh

    ux, uy = -roof.ny, roof.nx
    hl, hw, o = roof.half_l, roof.half_w, overhang

    def rect(e: float) -> Polygon:
        return Polygon([(roof.cx + ux * u + roof.nx * v, roof.cy + uy * u + roof.ny * v)
                        for u, v in [(-hl - e, -hw - e), (hl + e, -hw - e), (hl + e, hw + e), (-hl - e, hw + e)]])

    z_edge = roof.eave - roof.slope * o
    outer = _ccw(rect(o))
    corners = np.array(outer.exterior.coords)[:-1]
    out = []
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        L = float(np.hypot(*(b - a)))
        nx, ny = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
        out.append(_box_on_wall(*a, *b, 0.0, 1.0, z_edge - band, z_edge + 0.03, 0.0, nx, ny, color, -0.05))
    v2, f = trimesh.creation.triangulate_polygon(outer.difference(rect(-0.02)))
    soffit = _vc(np.column_stack([v2[:, 0], np.full(len(v2), z_edge - band), -v2[:, 1]]), f, color)
    if soffit.face_normals[:, 1].mean() > 0:
        _flip_faces(soffit)
    out.append(soffit)
    return out


def _slope_trim(outer: Polygon, z_at, overhang: float, color, band: float = 0.2) -> list:
    """Ràfec encaixonat només a les vores horitzontals (les del ràfec, no el frontó).

    Al frontó l'alçada puja fins al carener: un tauló allí tapa el vessant. A les vores
    planes, el frontal i el plafó tanquen el cantell del voladís, com a les quatre aigües."""
    outer = _ccw(outer)
    if outer.is_empty or not isinstance(outer, Polygon) or overhang < 0.02:
        return []
    corners = np.array(outer.exterior.coords)[:-1]
    out = []
    for i in range(len(corners)):
        a, b = corners[i], corners[(i + 1) % len(corners)]
        length = float(np.hypot(*(b - a)))
        if length < 0.4:
            continue
        samples = [a + (b - a) * t for t in (0.0, 0.5, 1.0)]
        zs = [float(z_at(float(p[0]), float(p[1]))) for p in samples]
        if max(zs) - min(zs) > 0.12:
            continue
        z = float(np.median(zs))
        nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length
        out.append(_box_on_wall(*a, *b, 0.0, 1.0, z - band, z + 0.03, 0.0, nx, ny, color, -0.05))
        inn = np.array([nx, ny]) * overhang
        ia, ib = a - inn, b - inn
        zz = z - band
        soffit = _quad(_w(*a, zz), _w(*b, zz), _w(*ib, zz), _w(*ia, zz), color, np.array([0.0, -1.0, 0.0]))
        out.append(soffit)
    return out


# --- Teulada per ales (plantes en L) -------------------------------------------------------


def _half_plane(a: float, b: float, c: float, around: Polygon, tie: bool = True):
    """Semiplà a·x + b·y + c ≥ 0, retallat a l'entorn de `around`. Si no depèn de x ni y
    (dos plans paral·lels), tot o res; `tie` decideix quan són el mateix pla."""
    g = float(np.hypot(a, b))
    if g < 1e-9:
        return around if (c > 1e-6 or (abs(c) <= 1e-6 and tie)) else Polygon()
    n = np.array([a, b]) / g
    q = -c / g * n  # punt de la recta
    t = np.array([-n[1], n[0]])
    R = 4000.0
    hp = Polygon([q - t * R, q + t * R, q + t * R + n * R, q - t * R + n * R])
    return hp.intersection(around)


@dataclass
class RoofWings:
    """Teulada d'una planta en L: un `RoofFrame` per ala. Cada ala té el seu domini en planta i
    la teulada és, a cada punt, la més alta de les ales que hi arriben. Així surten els
    aiguafons on es troben les ales."""

    frames: list
    domains: list
    outer: Polygon  # contorn del voladís
    eave: float
    slope: float
    hip: bool
    roof_lin: tuple[int, int, int]

    def z(self, x, y):
        xs, ys = np.atleast_1d(np.asarray(x, float)), np.atleast_1d(np.asarray(y, float))
        out = np.full(len(xs), -np.inf)
        for f, d in zip(self.frames, self.domains):
            inside = shapely.contains_xy(d.buffer(0.05), xs, ys)
            out = np.where(inside, np.maximum(out, f.z(xs, ys)), out)
        out = np.where(np.isfinite(out), out, self.frames[0].z(xs, ys))
        return out if np.ndim(x) else float(out[0])

    def planes(self, f: RoofFrame) -> list[tuple[float, float, float, tuple[float, float]]]:
        """Plans (a, b, c) de z = a·x + b·y + c de l'ala, amb la direcció de les fileres de teules."""
        s, nx, ny, cx, cy = f.slope, f.nx, f.ny, f.cx, f.cy
        dot_n = nx * cx + ny * cy
        dot_u = -ny * cx + nx * cy
        side = (-ny, nx)
        out = [
            (-s * nx, -s * ny, f.eave + s * f.half_w + s * dot_n, side),
            (s * nx, s * ny, f.eave + s * f.half_w - s * dot_n, side),
        ]
        if f.hip:
            out += [
                (s * ny, -s * nx, f.eave + s * f.half_l + s * dot_u, (nx, ny)),
                (-s * ny, s * nx, f.eave + s * f.half_l - s * dot_u, (nx, ny)),
            ]
        return out

    def meshes(self) -> list:
        """Un tros de teulada per vessant visible: on és el vessant més baix de la seva ala i
        l'ala és la més alta (o l'única) que hi ha."""
        import trimesh

        out = []
        for i, (f, dom) in enumerate(zip(self.frames, self.domains)):
            own = self.planes(f)
            for k, (a, b, c, rdir) in enumerate(own):
                region = dom
                for j, (a2, b2, c2, _) in enumerate(own):
                    if j != k:
                        region = region.intersection(_half_plane(a2 - a, b2 - b, c2 - c, dom, tie=k < j))
                for g_i, (g, gdom) in enumerate(zip(self.frames, self.domains)):
                    if g_i == i or region.is_empty:
                        continue
                    above = unary_union([
                        _half_plane(a - a2, b - b2, c - c2, region, tie=i < g_i) for a2, b2, c2, _ in self.planes(g)
                    ])
                    region = region.difference(gdom).union(region.intersection(above))
                for piece in getattr(region, "geoms", [region]):
                    if not isinstance(piece, Polygon) or piece.area < 0.02:
                        continue
                    v2, tri = trimesh.creation.triangulate_polygon(piece)
                    verts = np.column_stack([v2[:, 0], a * v2[:, 0] + b * v2[:, 1] + c, -v2[:, 1]])
                    m = trimesh.Trimesh(vertices=verts, faces=tri, process=False)
                    if m.face_normals[:, 1].mean() < 0:
                        _flip_faces(m)
                    m.visual.vertex_colors = np.tile(
                        _roof_vertex_rgba(*rdir, self.roof_lin), (len(verts), 1)
                    ).astype(np.uint8)
                    out.append(m)
        return out

    def eave_trim(self, inner: Polygon, overhang: float, color, band: float = 0.2) -> list:
        """Ràfec encaixonat al llarg del contorn: frontis a la vora del voladís i plafó fins a la paret.

        Si l'ala té un pendent més suau, el ràfec no és tot a la mateixa alçada: cada tram segueix
        la teulada. Quan és pla, un sol plafó tanca tot el contorn."""
        import trimesh

        outer = _ccw(self.outer)
        corners = np.array(outer.exterior.coords)[:-1]
        edges = []
        for i in range(len(corners)):
            a, b = corners[i], corners[(i + 1) % len(corners)]
            length = float(np.hypot(*(b - a)))
            if length < 0.05:
                continue
            mid = (a + b) * 0.5
            z = float(self.z(float(mid[0]), float(mid[1])))
            nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length
            edges.append((a, b, z, nx, ny))
        if not edges:
            return []
        zs = [e[2] for e in edges]
        out = []
        if max(zs) - min(zs) <= 0.04:
            z_edge = float(np.median(zs))
            for a, b, _z, nx, ny in edges:
                out.append(_box_on_wall(*a, *b, 0.0, 1.0, z_edge - band, z_edge + 0.03, 0.0, nx, ny, color, -0.05))
            v2, f = trimesh.creation.triangulate_polygon(outer.difference(inner.buffer(-0.02, join_style=2)))
            soffit = _vc(np.column_stack([v2[:, 0], np.full(len(v2), z_edge - band), -v2[:, 1]]), f, color)
            if soffit.face_normals[:, 1].mean() > 0:
                _flip_faces(soffit)
            out.append(soffit)
            return out
        for a, b, z, nx, ny in edges:
            out.append(_box_on_wall(*a, *b, 0.0, 1.0, z - band, z + 0.03, 0.0, nx, ny, color, -0.05))
            inn = np.array([nx, ny]) * overhang
            ia, ib = a - inn, b - inn
            zz = z - band
            out.append(_quad(_w(*a, zz), _w(*b, zz), _w(*ib, zz), _w(*ia, zz), color, np.array([0.0, -1.0, 0.0])))
        return out


def _wing_split(poly: Polygon, ridge=None) -> tuple[Polygon, Polygon, np.ndarray] | None:
    """Parteix una planta en L pel vèrtex entrant: (cos principal, ala, direcció del tall).
    Es prova de tallar per la prolongació de cada aresta que hi arriba i es queda el tall amb
    els trossos més rectangulars. `ridge`, si hi és, és la direcció del carener del cos principal."""
    from shapely.ops import split

    ext = np.array(_ccw(poly).exterior.coords)[:-1]
    best, best_score = None, -1.0
    for i in range(len(ext)):
        p, v, q = ext[i - 1], ext[i], ext[(i + 1) % len(ext)]
        d1, d2 = v - p, q - v
        if d1[0] * d2[1] - d1[1] * d2[0] >= 0:  # convex (anell antihorari)
            continue
        for d in (d1, d2):
            u = d / max(float(np.hypot(*d)), 1e-9)
            cut = LineString([v - u * 200, v + u * 200])
            pieces = [g for g in getattr(split(poly, cut), "geoms", []) if g.area > 4.0]
            if len(pieces) != 2:
                continue
            main, wing = sorted(pieces, key=lambda g: g.area, reverse=True)
            score = sum(g.area for g in pieces) / sum(g.minimum_rotated_rectangle.area for g in pieces)
            frame = RoofFrame.for_polygon(main, 0.0)
            along = np.array([-frame.ny, frame.nx])
            # El cos principal té el carener paral·lel al tall (l'ala hi entra de costat).
            if abs(float(np.dot(along, u))) < 0.8:
                score -= 0.5
            if ridge is not None and abs(float(np.dot(along, ridge))) < 0.8:
                score -= 0.3
            if score > best_score:
                best, best_score = (main, wing, u), score
    return best


def roof_wings(
    poly: Polygon,
    eave: float,
    pitch_deg,
    hip: bool,
    overhang: float,
    ridge=None,
    roof_lin: tuple[int, int, int] | None = None,
) -> RoofWings | None:
    """Teulada per ales: el cos principal amb el carener al llarg del tall i l'ala amb el
    carener perpendicular, que entra al cos principal fins al seu carener."""
    found = _wing_split(poly, ridge)
    if found is None:
        return None
    main, wing, u = found
    outer = poly.buffer(overhang, join_style=2)
    fm = RoofFrame.for_polygon(main, eave, pitch_deg, hip, ridge=u)
    fw = RoofFrame.for_polygon(wing, eave, pitch_deg, hip, ridge=np.array([-u[1], u[0]]))
    # L'ala no té aiguavés a la punta que entra al cos principal: se'n porta el centre lluny.
    uw = np.array([-fw.ny, fw.nx])
    toward = 1.0 if float(np.dot(np.array(main.centroid.coords[0]) - [fw.cx, fw.cy], uw)) > 0 else -1.0
    far = 60.0
    fw = RoofFrame(fw.cx + uw[0] * toward * far, fw.cy + uw[1] * toward * far, fw.nx, fw.ny,
                   fw.half_w, eave, fw.slope, fw.half_l + far, hip)
    # L'ala sol ser més ampla que el cos. Amb el mateix pendent el carener li quedaria més alt
    # i en sortiria un pic damunt la teulada. Es rebaixa el pendent perquè els dos careners encaixin.
    main_rise = fm.slope * fm.half_w
    if fw.half_w > 1e-3 and fw.slope * fw.half_w > main_rise:
        fw = RoofFrame(fw.cx, fw.cy, fw.nx, fw.ny, fw.half_w, eave, main_rise / fw.half_w, fw.half_l, hip)

    def rect(f: RoofFrame, e: float) -> Polygon:
        ux, uy = -f.ny, f.nx
        return Polygon([(f.cx + ux * a + f.nx * b, f.cy + uy * a + f.ny * b)
                        for a, b in [(-f.half_l - e, -f.half_w - e), (f.half_l + e, -f.half_w - e),
                                     (f.half_l + e, f.half_w + e), (-f.half_l - e, f.half_w + e)]])

    dom_m = rect(fm, overhang).intersection(outer)
    # Domini de l'ala: fins al carener del cos principal, del costat de l'ala.
    nm = np.array([fm.nx, fm.ny])
    side = 1.0 if float(np.dot(np.array(wing.centroid.coords[0]) - [fm.cx, fm.cy], nm)) > 0 else -1.0
    hp = _half_plane(side * fm.nx, side * fm.ny, -side * (fm.nx * fm.cx + fm.ny * fm.cy), outer)
    dom_w = rect(fw, overhang).intersection(hp).intersection(outer)
    lin = roof_lin if roof_lin is not None else FALLBACK_ROOF_LIN
    return RoofWings([fm, fw], [dom_m, dom_w], outer, eave, fm.slope, hip, lin)


def _vc(mesh_vertices: np.ndarray, faces: np.ndarray, color: tuple[int, int, int]):
    import trimesh

    m = trimesh.Trimesh(vertices=mesh_vertices, faces=faces, process=False)
    m.visual.vertex_colors = np.tile([*color, 255], (len(mesh_vertices), 1)).astype(np.uint8)
    return m


def _flip_faces(mesh):
    """Gira el sentit de les cares i en recalcula les normals.

    `Trimesh.invert` gira les cares, però el setter de `face_normals` rebutja la còpia
    negada (encara no coincideix amb els triangles) i la caché es queda amb les normals
    d'abans. El glTF les exporta: el plafó del ràfec, que es veu per sota, queda
    il·luminat com si mirés al cel.
    """
    mesh.invert()
    cache = mesh._cache.cache
    cache.pop("face_normals", None)
    cache.pop("vertex_normals", None)
    mesh.face_normals
    mesh.vertex_normals
    return mesh


def _quad(p0, p1, p2, p3, color, outward):
    """Quad en coordenades del món (x, y amunt, z), amb la cara girada cap a `outward`."""
    m = _vc(np.array([p0, p1, p2, p3], dtype=float), np.array([[0, 1, 2], [0, 2, 3]]), color)
    if np.dot(m.face_normals.mean(axis=0), outward) < 0:
        _flip_faces(m)
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


def _railing(box, t0: float, t1: float, z0: float, d0: float, length: float, details: list,
             color=IRON_COLOR, bar: float = 0.024) -> None:
    """Barana (barrots + passamà) entre t0..t1, de z0 a z0 + 0,95, a `d0` del mur. Per defecte de
    ferro; amb `color` i barrots gruixuts (`bar`), de fusta."""
    top = z0 + 0.95
    ex = bar - 0.024  # gruix de més respecte del ferro
    details.append(box(t0, t1, top - 0.04 - ex, top, d0 + 0.04 + ex, color, d0))
    details.append(box(t0, t1, z0 + 0.08, z0 + 0.11 + ex, d0 + 0.03 + ex, color, d0))
    n = max(2, int((t1 - t0) * length / (0.18 + 2 * ex)))
    for k in range(1, n):
        t = t0 + (t1 - t0) * k / n
        details.append(box(t - bar / 2 / length, t + bar / 2 / length, z0, top, d0 + 0.025 + ex, color, d0))


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
        fw = style.frame_w
        details.append(box(tc - hw - fw / L, tc + hw + fw / L, z0 - fw, z1 + fw, 0.03, style.frame))
    else:
        details.append(box(tc - hw - 0.15 / L, tc + hw + 0.15 / L, z1, z1 + 0.2, 0.05, SILL_STONE))  # llinda
    windows.append(box(tc - hw, tc + hw, z0, z1, 0.06, GLASS_COLOR))
    if shape.fill is not None:
        details.append(box(tc - hw + 0.02 / L, tc + hw - 0.02 / L, z0 + 0.02, z1 - 0.02, 0.07, shape.fill))
    if shape.mullion:
        details.append(box(tc - 0.035 / L, tc + 0.035 / L, z0, z1, 0.075, style.frame or FRAME_COLOR))
    if style.roller is not None:
        down = shape.roller if shape.roller is not None else ROLLER_DOWN
        details.append(box(tc - hw, tc + hw, z1 - shape.h * down, z1, 0.08, style.roller))
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
    skip: set[int] = frozenset(),
) -> None:
    """Finestres a façanes que no són la d'accés ni donen directament al carrer (ni les que
    `skip`, que ja porten les obertures de la fitxa)."""
    for i in range(len(ext)):
        if i == primary_i or i in skip:
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


def _box_on_wall(ax, ay, bx, by, t0, t1, z0, z1, depth, nx, ny, color, d0=0.0, back=False):
    """Caixa plana enganxada a la façana entre les fraccions t0..t1 de l'aresta i alçades z0..z1;
    sobresurt del mur de `d0` a `depth`. `back`: també la cara de `d0` (caixes soltes)."""
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
    keep[4:6] = back
    m.update_faces(keep)
    return m


# --- Cases amb fitxa (cases.yaml) ---------------------------------------------------------

COMPASS_DEG = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SO": 225, "SW": 225, "O": 270, "W": 270, "NO": 315, "NW": 315}
CHIMNEY_MOUTH = (40, 38, 36)


def load_house_specs(path: Path) -> dict[str, dict]:
    """Fitxes de casa per referència cadastral; buit si no hi ha fitxer."""
    import yaml

    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as f:
        return {str(k): v for k, v in (yaml.safe_load(f) or {}).items()}


def _lin(c) -> tuple[int, int, int]:
    """Color sRGB de la fitxa → lineal (vèrtexs del glTF)."""
    r, g, b, _ = _srgb_to_linear(c)
    return r, g, b


def _facing_edge_index(ext: np.ndarray, compass: str, nth: int = 1) -> int:
    """Aresta (de 1,5 m o més) amb la normal exterior més a prop de la direcció `compass`.
    `nth: 2` tria la segona més ben orientada (plantes en L, amb dues façanes cap al mateix costat)."""
    az = np.radians(COMPASS_DEG[compass.upper()])
    want = np.array([np.sin(az), np.cos(az)])
    scored = []
    for i in range(len(ext)):
        a, b = ext[i], ext[(i + 1) % len(ext)]
        length = float(np.hypot(*(b - a)))
        if length < 1.5:
            continue
        scored.append((float(np.dot([(b[1] - a[1]) / length, -(b[0] - a[0]) / length], want)), i))
    scored.sort(reverse=True)
    return scored[nth - 1][1] if len(scored) >= nth else -1


def _spec_style(spec: dict) -> WindowStyle:
    """Estil de les finestres de les altres façanes, a joc amb les de la foto."""
    win = spec.get("windows", {})
    frame = _lin(win["frame"]) if "frame" in win else FRAME_COLOR
    roller = _lin(win["roller"]) if "roller" in win else None
    return WindowStyle(
        ground=WindowShape(1.4, 1.3, mullion=True),
        upper=WindowShape(1.2, 1.3, mullion=True),
        frame=frame,
        shutters=None,
        bars=False,
        attic=False,
        roller=roller,
        frame_w=float(win.get("frame_w", 0.08)),
    )


def _spec_openings(
    openings: list[dict], a, b, nx, ny, length: float, ground, style: WindowStyle,
    details: list, windows: list, taken: OpeningRegistry | None, level0: float = 0.0,
) -> None:
    """Portes, finestres i portes de garatge de la façana fotografiada, on les diu la fitxa.
    A la planta baixa les alçades es compten des del terra; als pisos (`floor`), des del forjat."""
    L = max(length, 1e-6)
    frame = style.frame or FRAME_COLOR

    def box(t0, t1, zb, zt, depth, color, d0=0.0):
        return _box_on_wall(*a, *b, t0, t1, zb, zt, depth, nx, ny, color, d0)

    for op in openings:
        tc, w, h = float(op["t"]), float(op["w"]), float(op["h"])
        hw = w / 2 / L
        floor = int(op.get("floor", 0))
        if op["kind"] == "garage":
            z0 = float(_wall_ground(ground, a, b, tc - hw, tc + hw).min()) - 0.02
            _claim(taken, a, b, tc, w / 2 + 0.1, z0, z0 + h)
            gframe = _lin(op["frame"]) if "frame" in op else frame
            details.append(box(tc - hw - 0.07 / L, tc + hw + 0.07 / L, z0, z0 + h + 0.07, 0.03, gframe))
            details.append(box(tc - hw, tc + hw, z0, z0 + h, 0.05, _lin(op.get("color", (150, 152, 150)))))
            n = int(op.get("leaves", 3))
            for k in range(1, n):
                t = tc - hw + 2 * hw * k / n
                details.append(box(t - 0.03 / L, t + 0.03 / L, z0, z0 + h, 0.065, gframe))
            if op.get("glass_top_m"):
                gt = float(op["glass_top_m"])
                windows.append(box(tc - hw + 0.04 / L, tc + hw - 0.04 / L, z0 + h - gt, z0 + h - 0.05, 0.055, GLASS_COLOR))
                details.append(box(tc - hw, tc + hw, z0 + h - gt - 0.06, z0 + h - gt, 0.065, gframe))
            continue
        if op["kind"] == "door":
            if floor > 0:
                z0 = level0 + floor * FLOOR_H + float(op.get("bottom_m", 0.02))
            else:
                z0 = float(_wall_ground(ground, a, b, tc - hw, tc + hw).min()) + float(op.get("bottom_m", 0.0))
            t0, t1 = tc - hw, tc + hw
            side = op.get("sidelight")
            if side:
                sw = 0.4 / L
                f = 0.06 / L
                g0, g1 = (t0 - f - sw, t0 - f) if side == "left" else (t1 + f, t1 + f + sw)
                windows.append(box(g0, g1, z0 + 0.1, z0 + h - 0.05, 0.05, GLASS_COLOR))
                m0, m1 = (g1, t0) if side == "left" else (t1, g0)
                details.append(box(m0, m1, z0, z0 + h, 0.045, frame))  # muntant entre porta i vidre
                t0, t1 = min(t0, g0), max(t1, g1)
            _claim(taken, a, b, (t0 + t1) / 2, (t1 - t0) * L / 2 + 0.1, z0, z0 + h)
            details.append(box(t0 - 0.08 / L, t1 + 0.08 / L, z0, z0 + h + 0.08, 0.03, frame))
            details.append(box(tc - hw, tc + hw, z0, z0 + h, 0.06, _lin(op.get("color", DOOR_COLOR))))
            if op.get("lamp"):
                details.append(box(tc - 0.09 / L, tc + 0.09 / L, z0 + h + 0.2, z0 + h + 0.48, 0.24, IRON_COLOR, 0.04))
            n_steps = int(op.get("steps", 0))
            if n_steps:
                # Graons davant la porta, del llindar fins al terra; barana de ferro opcional.
                g_lo = float(_wall_ground(ground, a, b, tc - hw, tc + hw).min())
                sc = _lin(op.get("step_color", (196, 190, 180)))
                sw = (w / 2 + 0.25) / L
                for k in range(n_steps):
                    top = z0 - (z0 - g_lo) * k / n_steps
                    details.append(box(tc - sw, tc + sw, g_lo - 0.2, top, 0.3 * (k + 1), sc))
                for side in op.get("step_rail", []):
                    t = tc - sw if side == "left" else tc + sw
                    d1 = 0.3 * n_steps
                    for d in np.linspace(0.05, d1, 4):
                        zt = z0 - (z0 - g_lo) * min(n_steps - 1, int(d / 0.3)) / n_steps + 0.9
                        details.append(box(t - 0.015 / L, t + 0.015 / L, g_lo, zt, d + 0.015, IRON_COLOR, d - 0.015))
                    rail = _box_on_wall(
                        *(a + (b - a) * t), *(a + (b - a) * t + np.array([nx, ny]) * d1), 0, 1,
                        z0 + 0.87, z0 + 0.92, 0.015, -(ny), nx, IRON_COLOR, -0.015, back=True,
                    )
                    details.append(rail)
            continue
        fill = _lin(op["fill"]) if op.get("fill") else None
        shape = WindowShape(w, h, mullion=w >= 1.6 and fill is None, roller=None if fill else op.get("roller"), fill=fill)
        if floor > 0:
            z0 = level0 + floor * FLOOR_H + float(op.get("sill_m", UPPER_SILL_M))
        else:
            z0 = float(_wall_ground(ground, a, b, tc - hw, tc + hw).max()) + float(op.get("sill_m", GROUND_SILL_M))
        if _claim(taken, a, b, tc, w / 2 + 0.08, z0 - 0.1, z0 + h + 0.1):
            _add_window(a, b, nx, ny, L, tc, z0, shape, style, False, floor, details, windows)
            if op.get("awning"):
                _spec_awning(op["awning"], box, tc, hw, z0 + h, L, details)


def _spec_awning(aw, box, tc: float, hw: float, z_top: float, length: float, details: list) -> None:
    """Tendal que surt de dalt de la finestra. `stripe`, si hi és, alterna franges amb `color`."""
    if not isinstance(aw, dict):
        return
    depth = float(aw.get("depth_m", 0.7))
    color = _lin(aw.get("color", (160, 96, 64)))
    stripe = _lin(aw["stripe"]) if aw.get("stripe") else None
    n = 7 if stripe else 1
    span = 2 * hw
    for k in range(n):
        t0 = tc - hw + span * k / n
        t1 = tc - hw + span * (k + 1) / n
        details.append(box(t0, t1, z_top - 0.22, z_top - 0.04, depth, stripe if stripe and k % 2 else color, 0.04))


def _balustrade(p, q, base_z, height: float, rail, base_color, socle_h: float = 0.0,
                post_every: float = 3.5, gaps=(), urns: bool = True) -> list:
    """Barana de balustres de `p` a `q` (local) sobre `base_z(xs, ys)`: sòcol opcional, pilars
    amb gerro cada `post_every` i als extrems; `gaps` són trams (fraccions 0..1) oberts."""
    p, q = np.asarray(p, float), np.asarray(q, float)
    L = float(np.hypot(*(q - p)))
    if L < 0.3:
        return []
    nx, ny = -(q[1] - p[1]) / L, (q[0] - p[0]) / L
    spans, s0 = [], 0.0
    for g0, g1 in sorted(gaps):
        if g0 > s0:
            spans.append((s0, g0))
        s0 = max(s0, g1)
    if s0 < 1.0:
        spans.append((s0, 1.0))

    def box(t0, t1, z0, z1, w, color):
        return _box_on_wall(*p, *q, t0, t1, z0, z1, w / 2, nx, ny, color, -w / 2, back=True)

    out = []
    post = 0.3 / L
    for a0, a1 in spans:
        n_seg = max(1, int(round((a1 - a0) * L / post_every)))
        ts = np.linspace(a0, a1, n_seg + 1)
        zs = base_z(p[0] + (q[0] - p[0]) * ts, p[1] + (q[1] - p[1]) * ts)
        for k in range(n_seg):
            t0, t1 = ts[k], ts[k + 1]
            zb, zlo = float(max(zs[k], zs[k + 1])), float(min(zs[k], zs[k + 1])) - 0.15
            if socle_h > 0:
                out.append(box(t0, t1, zlo, zb + socle_h, 0.32, base_color))
            z_bal = zb + socle_h
            out.append(box(t0, t1, z_bal, z_bal + 0.07, 0.2, rail))
            out.append(box(t0, t1, zb + height - 0.1, zb + height, 0.24, rail))
            nb = max(1, int((t1 - t0) * L / 0.2))
            for j in range(1, nb):
                t = t0 + (t1 - t0) * j / nb
                out.append(box(t - 0.045 / L, t + 0.045 / L, z_bal + 0.07, zb + height - 0.1, 0.09, rail))
        for k, t in enumerate(ts):
            z = float(zs[k])
            t0, t1 = max(0.0, t - post / 2), min(1.0, t + post / 2)
            out.append(box(t0, t1, z - 0.15, z + height + 0.1, 0.32, rail))
            if urns:
                out.append(box(t0 + 0.04 / L, t1 - 0.04 / L, z + height + 0.1, z + height + 0.38, 0.26, rail))
    return out


def _spec_extras(
    spec: dict, roof: RoofFrame, a, b, nx, ny, length: float, ground, plinth, level0: float = 0.0
) -> tuple[list, list]:
    """Xemeneies, porxo i tanca de la fitxa, situats respecte de la façana fotografiada.
    Torna (sòlids, detalls)."""
    L = max(length, 1e-6)
    u = (b - a) / L
    n = np.array([nx, ny])

    def at(t: float, d: float) -> np.ndarray:
        return a + (b - a) * t + n * d

    solid, details = [], []
    for c in spec.get("chimneys", []):
        s = float(c.get("size_m", 0.5))
        p = at(float(c["t"]), -float(c["depth_m"]))
        zr = float(roof.z(p[0], p[1]))
        top = zr + float(c.get("above_m", 1.0))
        p0, p1 = p - u * s / 2, p + u * s / 2

        def cbox(z0, z1, half, color):
            q0, q1 = p - u * half, p + u * half
            return _box_on_wall(*q0, *q1, 0.0, 1.0, z0, z1, half, nx, ny, color, -half, back=True)

        solid.append(_box_on_wall(*p0, *p1, 0.0, 1.0, zr - 0.6, top, s / 2, nx, ny, _lin(c.get("color", (178, 166, 150))), -s / 2, back=True))
        details.append(cbox(top, top + 0.16, s / 2 - 0.06, CHIMNEY_MOUTH))
        details.append(cbox(top + 0.16, top + 0.26, s / 2 + 0.07, _lin(c.get("cap", (118, 114, 106)))))

    for bal in spec.get("balconies", []):
        # Balcó corregut: llosana que surt de la façana, cantell vist i barana de ferro.
        t0, t1, d = float(bal["from"]), float(bal["to"]), float(bal.get("depth_m", 1.0))
        z = level0 + int(bal.get("floor", 1)) * FLOOR_H
        slab = _lin(bal.get("slab", (206, 198, 182)))
        edge = _lin(bal["edge"]) if "edge" in bal else slab
        solid.append(_box_on_wall(*a, *b, t0, t1, z - 0.18, z + 0.02, d, nx, ny, slab))
        details.append(_box_on_wall(*a, *b, t0, t1, z - 0.2, z + 0.03, d + 0.03, nx, ny, edge, d - 0.01))

        def bbox(u0, u1, zb, zt, depth, color, d0=0.0):
            return _box_on_wall(*a, *b, u0, u1, zb, zt, depth, nx, ny, color, d0)

        # `rail`: color de la barana (per defecte, ferro); `rail_bar_m`: gruix dels barrots (fusta, ~0,06).
        rc = _lin(bal["rail"]) if "rail" in bal else IRON_COLOR
        bw = float(bal.get("rail_bar_m", 0.024))
        _railing(bbox, t0, t1, z + 0.02, d - 0.06, L, details, rc, bw)
        ex = bw - 0.024
        for t in (t0, t1):
            p, q = at(t, 0.0), at(t, d - 0.06)
            for zb, zt in ((z + 0.93 - ex, z + 0.97), (z + 0.1, z + 0.13 + ex)):
                details.append(_box_on_wall(*p, *q, 0, 1, zb, zt, 0.02 + ex / 2, -ny, nx, rc, -0.02 - ex / 2, back=True))
            nb = max(2, int(d / (0.15 + 2 * ex)))
            for k in range(1, nb):
                c = at(t, (d - 0.06) * k / nb)
                details.append(_box_on_wall(*(c - u * bw / 2), *(c + u * bw / 2), 0, 1, z + 0.02, z + 0.95, bw / 2, nx, ny, rc, -bw / 2, back=True))

    ter = spec.get("terrace")
    if ter:
        t0, t1, d = float(ter["from"]), float(ter["to"]), float(ter["depth_m"])
        corners = np.array([at(t0, 0), at(t1, 0), at(t1, d), at(t0, d)])
        g = ground.height(corners[:, 0], corners[:, 1])
        top = float(g.max()) + float(ter.get("height_m", 0.35))
        floor = _lin(ter.get("floor", (176, 104, 80)))
        rail = _lin(ter.get("rail", (228, 222, 205)))
        solid.append(_box_on_wall(*a, *b, t0, t1, float(g.min()) - 0.2, top - 0.04, d, nx, ny, plinth))
        details.append(_box_on_wall(*a, *b, t0 - 0.03 / L, t1 + 0.03 / L, top - 0.04, top, d + 0.03, nx, ny, floor))
        gaps = []
        if "steps" in ter:
            s0, s1 = (float(x) for x in ter["steps"])
            rise = top - float(g.min())
            n_steps = max(1, int(round(rise / 0.18)))
            for k in range(1, n_steps):
                details.append(_box_on_wall(*a, *b, s0, s1, float(g.min()) - 0.2, top - rise * k / n_steps, d + 0.32 * k, nx, ny, floor, d))
            gaps.append(((s0 - t0) / (t1 - t0), (s1 - t0) / (t1 - t0)))

        def flat(xs, ys):
            return np.full(len(np.atleast_1d(xs)), top)

        solid += _balustrade(at(t0, d - 0.12), at(t1, d - 0.12), flat, 0.85, rail, rail, post_every=2.5, gaps=gaps)
        for t in (t0, t1):
            solid += _balustrade(at(t, 0.2), at(t, d - 0.12), flat, 0.85, rail, rail, post_every=2.5, urns=False)

    fence = spec.get("fence")
    if fence:
        f0, f1, off = float(fence["from"]), float(fence["to"]), float(fence["offset_m"])
        gaps = []
        if "gate" in fence:
            g0, g1 = (float(x) for x in fence["gate"])
            gaps.append(((g0 - f0) / (f1 - f0), (g1 - f0) / (f1 - f0)))
        solid += _balustrade(
            at(f0, off), at(f1, off), lambda xs, ys: ground.height(xs, ys), float(fence.get("height_m", 1.0)),
            _lin(fence.get("rail", (228, 222, 205))), _lin(fence.get("base", (170, 160, 140))),
            socle_h=0.3, post_every=3.5, gaps=gaps,
        )

    for cp in spec.get("canopies", []):
        # Teuladí: voladís de teula de `from` a `to`, a `height_m` sobre el terra (porta, tram de façana).
        t0, t1, d = float(cp["from"]), float(cp["to"]), float(cp.get("depth_m", 0.6))
        z = float(_wall_ground(ground, a, b, t0, t1).max()) + float(cp.get("height_m", 2.5))
        color = _lin(cp.get("color", (176, 100, 74)))
        details.append(_box_on_wall(*a, *b, t0, t1, z, z + 0.1, d, nx, ny, color))
        details.append(_box_on_wall(*a, *b, t0, t1, z - 0.12, z, 0.25, nx, ny, _lin(cp.get("under", (120, 104, 90)))))
        if cp.get("posts"):
            # Porxo de cotxe: pals a la vora de fora, a les puntes i cada ~3 m (`from`/`to` poden
            # sortir de la façana). Biga de vora per sota la coberta.
            pc = _lin(cp.get("post_color", IRON_COLOR))
            ps = float(cp.get("post_m", 0.1))
            span = (t1 - t0) * L
            n_posts = max(2, int(np.ceil(span / 3.2)) + 1)
            for k in range(n_posts):
                t = t0 + (t1 - t0) * k / (n_posts - 1)
                t = min(max(t, t0 + ps / 2 / L), t1 - ps / 2 / L)
                gz = float(_wall_ground(ground, a, b, t, t).min())
                details.append(_box_on_wall(*a, *b, t - ps / 2 / L, t + ps / 2 / L, gz - 0.1, z, d - 0.05, nx, ny, pc, d - 0.05 - ps))
            details.append(_box_on_wall(*a, *b, t0, t1, z - 0.15, z, d - 0.03, nx, ny, pc, d - 0.03 - ps))
    return solid, details


def join_footprint(fp: Polygon, other) -> Polygon:
    """Planta d'una part allargada fins a l'aresta més propera d'una altra part (`join`): el
    buit entre totes dues queda construït."""
    edges = []
    for g in getattr(other, "geoms", [other]):
        c = list(g.exterior.coords)
        edges += [LineString([a, b]) for a, b in zip(c[:-1], c[1:])]
    edge = min(edges, key=lambda ln: ln.distance(fp))
    out = unary_union([fp, edge]).convex_hull.difference(other)
    return max(getattr(out, "geoms", [out]), key=lambda g: g.area)


def _wall_face(a, b, face: Polygon, color, outward) -> "trimesh.Trimesh":
    """Paret vertical d'`a` a `b` amb la forma `face` (s al llarg del mur, z), amb forats."""
    import trimesh

    a, b = np.asarray(a, float), np.asarray(b, float)
    seg = max(float(np.hypot(*(b - a))), 1e-6)
    u = (b - a) / seg
    parts = []
    for piece in getattr(face, "geoms", [face]):
        if not isinstance(piece, Polygon) or piece.area < 1e-4:
            continue
        v2, f = trimesh.creation.triangulate_polygon(piece)
        xy = a + np.outer(v2[:, 0], u)
        parts.append(_vc(np.column_stack([xy[:, 0], v2[:, 1], -xy[:, 1]]), f, color))
    m = trimesh.util.concatenate(parts)
    if np.dot(m.face_normals.mean(axis=0), outward) < 0:
        _flip_faces(m)
    return m


def _loggia_region(ext: np.ndarray, poly: Polygon, loggias: list) -> Polygon:
    """Planta de les lògies: una franja de `depth_m` darrere de cada tram de façana. Dues lògies
    que es troben en un racó entrant s'allarguen fins a tancar-lo (terrassa en L)."""
    n_e = len(ext)
    edges = {i for i, _ in loggias}
    strips = []
    for i, lg in loggias:
        a, b = ext[i], ext[(i + 1) % n_e]
        L = float(np.hypot(*(b - a)))
        u = (b - a) / L
        n = np.array([u[1], -u[0]])  # normal exterior (anell antihorari)
        t0, t1, d = float(lg.get("from", 0.0)), float(lg.get("to", 1.0)), float(lg.get("depth_m", 1.2))
        s0, s1 = t0 * L, t1 * L
        if t1 >= 0.999 and (i + 1) % n_e in edges:
            s1 += d
        if t0 <= 0.001 and (i - 1) % n_e in edges:
            s0 -= d
        p0, p1 = a + u * s0, a + u * s1
        strips.append(Polygon([p0, p1, p1 - n * d, p0 - n * d]))
    region = unary_union(strips).intersection(poly)
    return max(getattr(region, "geoms", [region]), key=lambda g: g.area) if not region.is_empty else None


def _loggia_meshes(
    region: Polygon, poly: Polygon, loggias: list, ext: np.ndarray, spans: list, z_floor: float,
    z_parapet: float, z_ceiling: float, wall_color, wall_mat, ceiling_color, ground, style: WindowStyle,
    details: list, windows: list, taken: OpeningRegistry | None, level0: float,
) -> tuple[list, list]:
    """Terra, sostre, parets del fons i ampit de les lògies; obertures de la paret del fons.
    Torna (sòlids, detalls)."""
    import trimesh

    lg0 = loggias[0][1]
    floor_color = _lin(lg0.get("floor_color", (176, 150, 128)))
    cap_color = _lin(lg0.get("cap", (214, 206, 190)))
    solid, extra = [], []
    # Ampit: el mur de fora fins a `parapet_m`, amb el gruix cap a dins i una llosa a sobre.
    for a, b, t0, t1, nx, ny in spans:
        if z_parapet - z_floor < 0.1:
            continue  # sense ampit (porxo de planta baixa)
        par = _box_on_wall(*a, *b, t0, t1, z_floor - 0.02, z_parapet, -0.01, nx, ny, wall_color, -0.22, back=True)
        par.metadata["mat"] = wall_mat
        solid.append(par)
        extra.append(_box_on_wall(*a, *b, t0, t1, z_parapet, z_parapet + 0.06, 0.04, nx, ny, cap_color, -0.26, back=True))
    v2, f = trimesh.creation.triangulate_polygon(region)
    floor = _vc(np.column_stack([v2[:, 0], np.full(len(v2), z_floor), -v2[:, 1]]), f, floor_color)
    if floor.face_normals[:, 1].mean() < 0:
        _flip_faces(floor)
    ceiling = _vc(np.column_stack([v2[:, 0], np.full(len(v2), z_ceiling), -v2[:, 1]]), f, ceiling_color)
    if ceiling.face_normals[:, 1].mean() > 0:
        _flip_faces(ceiling)
    extra += [floor, ceiling]
    # Parets del fons i dels costats: la vora de la lògia que no és façana.
    inner = region.exterior.difference(poly.exterior.buffer(0.02))
    for line in getattr(inner, "geoms", [inner]):
        if not isinstance(line, LineString):
            continue
        pts = np.array(line.coords)
        for p, q in zip(pts[:-1], pts[1:]):
            L = float(np.hypot(*(q - p)))
            if L < 0.05:
                continue
            n = np.array([q[1] - p[1], -(q[0] - p[0])]) / L
            if not region.contains(Point((p + q) / 2 + n * 0.05)):
                n = -n
            m = _quad(_w(*p, z_floor), _w(*q, z_floor), _w(*q, z_ceiling), _w(*p, z_ceiling), wall_color, np.array([n[0], 0.0, -n[1]]))
            m.metadata["mat"] = wall_mat
            solid.append(m)
    # Obertures de la paret del fons, amb `t` sobre el tram `from`..`to` de la façana.
    for i, lg in loggias:
        if not lg.get("openings"):
            continue
        a, b = ext[i], ext[(i + 1) % len(ext)]
        L = float(np.hypot(*(b - a)))
        u = (b - a) / L
        n = np.array([u[1], -u[0]])
        t0, t1, d = float(lg.get("from", 0.0)), float(lg.get("to", 1.0)), float(lg.get("depth_m", 1.2))
        a2, b2 = a + u * t0 * L - n * d, a + u * t1 * L - n * d
        _spec_openings(lg["openings"], a2, b2, n[0], n[1], (t1 - t0) * L, ground, style, details, windows, taken, level0)
    # Pilars a la línia de façana (coberts oberts, porxos llargs): `posts` en dona el gruix, i n'hi
    # ha a les puntes i cada ~3 m.
    for i, lg in loggias:
        if not lg.get("posts"):
            continue
        a, b = ext[i], ext[(i + 1) % len(ext)]
        L = float(np.hypot(*(b - a)))
        u = (b - a) / L
        n = np.array([u[1], -u[0]])
        t0, t1 = float(lg.get("from", 0.0)), float(lg.get("to", 1.0))
        ps = float(lg["posts"]) if not isinstance(lg["posts"], bool) else 0.25
        k = max(2, int(np.ceil((t1 - t0) * L / 3.0)) + 1)
        pc = _lin(lg.get("post_color", lg.get("cap", (214, 206, 190))))
        for j in range(k):
            t = t0 + (t1 - t0) * j / (k - 1)
            t = min(max(t, t0 + ps / 2 / L), t1 - ps / 2 / L)
            post = _box_on_wall(*a, *b, t - ps / 2 / L, t + ps / 2 / L, z_floor - 0.1, z_ceiling, -0.02, n[0], n[1], pc, -0.02 - ps, back=True)
            post.metadata["mat"] = wall_mat
            solid.append(post)
    return solid, extra


# Una façana es tira enrere si la major part del tram és dins la calçada, de mitjana més
# d'això. Per sota, és el voral i es deixa (el mateix criteri que les tàpies, una mica més
# baix: un cos de casa dins el carril es veu, una tàpia al voral no).
HOUSE_ROAD_FRAC = 0.6
HOUSE_ROAD_MEAN_M = 0.75
HOUSE_ROAD_CLEAR_M = 0.2
_retract_count = 0


def _edge_deep_in_road(a: np.ndarray, b: np.ndarray, roads) -> bool:
    """La major part de l'aresta és dins la calçada, i no només un voral."""
    d = b - a
    if float(np.hypot(*d)) < 1.2:
        return False
    samples = [Point(*(a + d * t)) for t in np.linspace(0.08, 0.92, 9)]
    depths = [roads.boundary.distance(p) for p in samples if roads.covers(p)]
    if len(depths) / len(samples) < HOUSE_ROAD_FRAC:
        return False
    return float(np.mean(depths)) >= HOUSE_ROAD_MEAN_M


def _retract_from_road(poly: Polygon, roads) -> Polygon:
    """Retalla la part de la planta que entra a la calçada.

    El Cadastre de vegades deixa el mur un metre o dos dins del carrer de l'OSM i la casa
    queda ficada a la carretera. Si alguna façana hi és de debò, es talla el tros que
    trepitja l'asfalt (i un pam de marge) i la façana nova segueix la vora del carrer.
    Un solapament de voral es deixa. Si el retall es menja la casa, es deixa com era.
    """
    global _retract_count
    if roads is None or getattr(roads, "is_empty", True) or poly.is_empty or not poly.intersects(roads):
        return poly
    ring = [np.array(p, dtype=float) for p in list(poly.exterior.coords)[:-1]]
    if len(ring) < 3 or not any(
        _edge_deep_in_road(ring[i], ring[(i + 1) % len(ring)], roads) for i in range(len(ring))
    ):
        return poly
    rest = poly.difference(roads.buffer(HOUSE_ROAD_CLEAR_M, join_style=2))
    pieces = [g for g in getattr(rest, "geoms", [rest]) if isinstance(g, Polygon) and g.area > 4.0]
    if not pieces:
        return poly
    out = max(pieces, key=lambda g: g.area)
    if out.area < 0.55 * poly.area:
        return poly
    _retract_count += 1
    return out


def house_meshes(
    poly: Polygon, floors: int, ground, wall_color, facing_street, roads_u=None, seed: int = 0,
    taken: OpeningRegistry | None = None, spec: dict | None = None,
    roof_lin: tuple[int, int, int] | None = None,
) -> tuple[list, list, list, list]:
    """Retorna (parets, teulada, detalls de façana) per a una part d'edifici.
    `facing_street(ax, ay, bx, by, nx, ny)` diu si una aresta dóna al carrer.
    `spec`: fitxa de cases.yaml (teulada, obertures de la façana de la foto, extres)."""
    import trimesh

    spec = spec or {}
    roof_spec = spec.get("roof", {})
    lin = roof_lin if roof_lin is not None else FALLBACK_ROOF_LIN
    poly = _retract_from_road(poly, roads_u)
    poly = _ccw(poly.simplify(0.15))
    ext = np.array(poly.exterior.coords)[:-1]
    g = ground.height(ext[:, 0], ext[:, 1])
    base = float(g.min()) - 0.25
    eave = float(g.max()) + float(spec.get("eave_m", 0.3 + floors * FLOOR_H))
    facade_i = _facing_edge_index(ext, spec["facade"]) if "facade" in spec else -1
    ridge = None
    if facade_i >= 0 and roof_spec.get("ridge") in ("along", "across"):
        fa, fb = ext[facade_i], ext[(facade_i + 1) % len(ext)]
        ridge = (fb - fa) / max(float(np.hypot(*(fb - fa))), 1e-6)
        if roof_spec["ridge"] == "across":
            ridge = np.array([-ridge[1], ridge[0]])
    # `none`: ruïna o solar amb murets, sense teulada (parets fins a `eave_m`).
    flat = roof_spec.get("type") in ("flat", "none")
    pitch = 0.0 if flat else roof_spec.get("pitch_deg")
    roof = RoofFrame.for_polygon(poly, eave, pitch, roof_spec.get("type") == "hip", ridge)
    shed_i = _facing_edge_index(ext, roof_spec["toward"]) if "toward" in roof_spec else facade_i
    if roof_spec.get("type") == "shed" and shed_i >= 0:
        # Teulada d'una aigua: el ràfec a la façana de la fitxa (o a la que diu `toward`) i el
        # capdamunt a la paret del fons (coberts i garatges adossats). Un carener a la vora del
        # fons, amb tota la planta d'un costat.
        fa, fb = ext[shed_i], ext[(shed_i + 1) % len(ext)]
        fu = (fb - fa) / max(float(np.hypot(*(fb - fa))), 1e-6)
        fn = np.array([fu[1], -fu[0]])
        depth = max(float(-np.dot(p - fa, fn)) for p in ext)
        back = fa - fn * depth
        roof = RoofFrame(float(back[0]), float(back[1]), float(fn[0]), float(fn[1]), depth, eave,
                         float(np.tan(np.radians(roof_spec.get("pitch_deg", 12)))), 500.0, False)
    overhang = float(roof_spec.get("overhang_m", 0.0 if flat else 0.3))
    # Planta en L: un cos de teulada per ala, en lloc d'un de sol sobre el rectangle mínim.
    wings = (
        roof_wings(poly, eave, roof_spec.get("pitch_deg"), roof.hip, overhang, ridge, lin)
        if roof_spec.get("wings")
        else None
    )
    if roof_spec.get("wings") and wings is None:
        print("Village: teulada per ales sense cap vèrtex entrant; es fa d'una peça")
    roof_z = wings.z if wings else roof.z
    plinth = _lin(spec["plinth"]) if "plinth" in spec else PLINTH_COLOR
    wall_mat = spec.get("wall_material")
    clad = spec.get("cladding")
    # Els pisos es compten des del ràfec cap avall (planta baixa a g.max() + 0,3), perquè les
    # finestres de dalt quedin sempre per sota la teulada encara que la casa sigui en pendent.
    level0 = eave - floors * FLOOR_H

    # Afegim a l'anell els punts on el carener talla les arestes, perquè el capçal de les
    # parets segueixi exactament la teulada (triangle del frontó).
    frames = list(zip(wings.frames, wings.domains)) if wings else [(roof, None)]
    ring = []
    for i in range(len(ext)):
        a, b = ext[i], ext[(i + 1) % len(ext)]
        ring.append(a)
        cuts = []
        for f, dom in frames:
            da = (a[0] - f.cx) * f.nx + (a[1] - f.cy) * f.ny
            db = (b[0] - f.cx) * f.nx + (b[1] - f.cy) * f.ny
            if da * db < 0:
                t = da / (da - db)
                p = a + (b - a) * t
                if dom is None or dom.buffer(0.05).contains(Point(p)):
                    cuts.append((t, p))
        ring += [p for _, p in sorted(cuts, key=lambda c: c[0])]
    ring = np.array(ring)
    tops = roof_z(ring[:, 0], ring[:, 1])

    # Lògies (terrasses encastades a un pis, sota la teulada): el mur de fora es buida per
    # damunt de l'ampit i el pis queda enretirat `depth_m`.
    loggias = []
    if "loggia" in spec and facade_i >= 0:
        loggias.append((facade_i, spec["loggia"]))
    for fs in spec.get("facades", []):
        if "loggia" in fs:
            i = _facing_edge_index(ext, fs["facade"], int(fs.get("nth", 1)))
            if i >= 0:
                loggias.append((i, fs["loggia"]))
    lg_region = _loggia_region(ext, poly, loggias) if loggias else None
    if lg_region is not None:
        lg0 = loggias[0][1]
        lg_floor = level0 + int(lg0.get("floor", 1)) * FLOOR_H
        lg_parapet = lg_floor + float(lg0.get("parapet_m", 1.0))
        # Sostre a l'alçada del plafó del ràfec: la teulada fa de porxo.
        lg_ceiling = eave - roof.slope * overhang - 0.2 if roof.hip else eave - 0.15
        if int(lg0.get("floor", 1)) + 1 < floors:
            # Lògia d'una planta que no és l'última (porxo de planta baixa): sostre al forjat de sobre.
            lg_ceiling = min(lg_ceiling, lg_floor + FLOOR_H - 0.2)
    lg_spans = []

    rng = np.random.default_rng(seed & 0xFFFFFFFF)
    walls, details, windows = [], [], []
    plinth_top = base + 0.25 + float(spec.get("plinth_h", PLINTH_H))
    layers = [(plinth_top, plinth, None)]
    if clad:
        # Revestiment de la part baixa (pedra, maó) fins a `height_m` sobre el terra més alt. Una
        # llista són capes de baix a dalt: p. ex. sòcol de pedra i planta baixa arrebossada.
        clads = clad if isinstance(clad, list) else [clad]
        layers = [
            (float(g.max()) + float(c.get("height_m", 1.0)), _lin(c.get("color", (150, 120, 95))), c.get("material"))
            for c in clads
        ]
        plinth_top = layers[-1][0]
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        (ax, ay), (bx, by) = ring[i], ring[j]
        seg = max(1e-6, float(np.hypot(bx - ax, by - ay)))
        outward = np.array([(by - ay) / seg, 0.0, (bx - ax) / seg])  # (nx, 0, −ny) amb n = (dy, −dx)
        holes = []
        if lg_region is not None:
            hit = LineString([(ax, ay), (bx, by)]).intersection(lg_region.buffer(0.03, join_style=2))
            for piece in getattr(hit, "geoms", [hit]):
                if isinstance(piece, LineString) and piece.length > 0.1:
                    s = sorted(float(np.dot(np.array(c) - (ax, ay), (bx - ax, by - ay))) / seg for c in piece.coords)
                    # El marge de la cerca no ha d'obrir el mur més enllà de la lògia (sí fins a la cantonada);
                    # 1,5 cm menys, perquè el mur de fora tapi la vora de la paret del costat.
                    s0 = 0.0 if s[0] < 0.001 else s[0] + 0.045
                    s1 = seg if s[-1] > seg - 0.001 else s[-1] - 0.045
                    holes.append((s0, s1))
        # Capes de la part baixa; una lògia de planta baixa (porxo d'entrada) també les travessa.
        z0 = base
        for z1, color, mat in layers:
            if holes and lg_parapet < z1:
                lowf = Polygon([(0, z0), (seg, z0), (seg, z1), (0, z1)])
                for s0, s1 in holes:
                    lowf = lowf.difference(box(s0, lg_parapet, s1, lg_ceiling))
                if lowf.area < 1e-4:
                    z0 = z1
                    continue
                low = _wall_face((ax, ay), (bx, by), lowf, color, outward)
            else:
                low = _quad(_w(ax, ay, z0), _w(bx, by, z0), _w(bx, by, z1), _w(ax, ay, z1), color, outward)
            low.metadata["mat"] = mat
            walls.append(low)
            z0 = z1
        if holes:
            face = Polygon([(0, plinth_top), (seg, plinth_top), (seg, tops[j]), (0, tops[i])])
            for s0, s1 in holes:
                face = face.difference(box(s0, lg_parapet, s1, lg_ceiling))
                lg_spans.append(((ax, ay), (bx, by), s0 / seg, s1 / seg, (by - ay) / seg, -(bx - ax) / seg))
            up = _wall_face((ax, ay), (bx, by), face, wall_color, outward)
        else:
            up = _quad(_w(ax, ay, plinth_top), _w(bx, by, plinth_top), _w(bx, by, tops[j]), _w(ax, ay, tops[i]), wall_color, outward)
        up.metadata["mat"] = wall_mat
        walls.append(up)

    # Porta i finestra mínimes a la façana d'accés; més obertures a les altres façanes al carrer.
    style = _spec_style(spec) if spec else WindowStyle.pick(rng, floors)
    if lg_region is not None:
        solid, extra = _loggia_meshes(
            lg_region, poly, loggias, ext, lg_spans, lg_floor, lg_parapet, lg_ceiling, wall_color, wall_mat,
            _lin(roof_spec["fascia"]) if "fascia" in roof_spec else FRAME_COLOR,
            ground, style, details, windows, taken, level0,
        )
        walls += solid
        details += extra
    if "facade" in spec:
        primary_i = facade_i
    else:
        primary_i = _primary_street_edge_index(ext, facing_street, roads_u)
    primary_door: tuple[float, float] | None = None
    if primary_i >= 0:
        a, b = ext[primary_i], ext[(primary_i + 1) % len(ext)]
        length = float(np.hypot(*(b - a)))
        nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length
        if "openings" in spec:
            _spec_openings(spec["openings"], a, b, nx, ny, length, ground, style, details, windows, taken, level0)
        else:
            primary_door = _facade_door_window(
                a, b, nx, ny, length, floors, level0, ground, style, details, windows, taken
            )
        if spec:
            solid, extra = _spec_extras(spec, wings or roof, a, b, nx, ny, length, ground, plinth, level0)
            walls += solid
            details += extra

    # Altres façanes fotografiades de la fitxa (cases que donen a més d'un carrer o a una plaça):
    # cadascuna amb les seves obertures, balcons i extres.
    spec_edges = {primary_i} if "openings" in spec else set()
    for fs in spec.get("facades", []):
        i = _facing_edge_index(ext, fs["facade"], int(fs.get("nth", 1)))
        if i < 0 or i in spec_edges:
            print(f"Village: façana {fs['facade']} de la fitxa sense mur propi (repetida o massa curta)")
            continue
        spec_edges.add(i)
        a, b = ext[i], ext[(i + 1) % len(ext)]
        length = float(np.hypot(*(b - a)))
        nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length
        _spec_openings(fs.get("openings", []), a, b, nx, ny, length, ground, style, details, windows, taken, level0)
        solid, extra = _spec_extras(fs, wings or roof, a, b, nx, ny, length, ground, plinth, level0)
        walls += solid
        details += extra

    for i in range(len(ext)):
        a, b = ext[i], ext[(i + 1) % len(ext)]
        length = float(np.hypot(*(b - a)))
        if length < 2.4:
            continue
        nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length  # normal exterior (anell antihorari)
        if not facing_street(a[0], a[1], b[0], b[1], nx, ny) or i in spec_edges:
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
        rng, ext, primary_i, facing_street, floors, level0, ground, style, details, windows, taken, spec_edges
    )

    if flat and roof_spec.get("parapet_m"):
        # Terrat: ampit a les vores, menys on toca la part unida (`join`), que hi té la paret.
        ph = float(roof_spec["parapet_m"])
        cap = _lin(roof_spec.get("cap", (214, 206, 190)))
        shared = spec.get("_shared")
        for i in range(len(ext)):
            a, b = ext[i], ext[(i + 1) % len(ext)]
            length = float(np.hypot(*(b - a)))
            if length < 0.3 or (shared is not None and shared.distance(Point((a + b) / 2)) < 0.3):
                continue
            nx, ny = (b[1] - a[1]) / length, -(b[0] - a[0]) / length
            par = _box_on_wall(*a, *b, 0.0, 1.0, eave - 0.02, eave + ph, 0.0, nx, ny, wall_color, -0.2, back=True)
            par.metadata["mat"] = wall_mat
            walls.append(par)
            details.append(_box_on_wall(*a, *b, 0.0, 1.0, eave + ph, eave + ph + 0.06, 0.04, nx, ny, cap, -0.24, back=True))
    if wings:
        fascia = _lin(roof_spec["fascia"]) if "fascia" in roof_spec else FRAME_COLOR
        if overhang > 0.02 and roof.hip:
            trim = wings.eave_trim(poly, overhang, fascia)
        elif overhang > 0.02:
            trim = _slope_trim(wings.outer, wings.z, overhang, fascia)
        else:
            trim = []
        return walls, wings.meshes(), details + trim, windows
    if roof.hip:
        fascia = _lin(roof_spec["fascia"]) if "fascia" in roof_spec else FRAME_COLOR
        return walls, _hip_roof_meshes(roof, overhang, lin), details + _eave_trim(roof, overhang, fascia), windows

    if roof_spec.get("type") == "none":
        return walls, [], details, windows

    # Teulada: voladís de 0,3 m, partida pel carener; cada meitat és un pla.
    from shapely.ops import split

    roof_poly = poly.buffer(overhang, join_style=2) if overhang > 0 else poly
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
            _flip_faces(m)
        if flat and "floor_color" in roof_spec:
            # Terrat enrajolat: és un terra, no una teulada (sense textura de teula).
            m.visual.vertex_colors = np.tile([*_lin(roof_spec["floor_color"]), 255], (len(m.vertices), 1)).astype(np.uint8)
            details.append(m)
            continue
        # Fileres de teules al llarg del carener.
        m.visual.vertex_colors = np.tile(_roof_vertex_rgba(-roof.ny, roof.nx, lin), (len(m.vertices), 1)).astype(np.uint8)
        roof_meshes.append(m)
    if overhang > 0.02 and not flat and roof_meshes:
        fascia = _lin(roof_spec["fascia"]) if "fascia" in roof_spec else FRAME_COLOR
        details += _slope_trim(roof_poly, roof.z, overhang, fascia)
    return walls, roof_meshes, details, windows


# --- Tàpies --------------------------------------------------------------------------------

WALL_HEIGHT_M = 1.9
# Totxo (sRGB): tons molt clars i semblants entre trams. Les juntes clares les posa el joc.
TAPIA_COLORS = [(238, 228, 212), (232, 222, 206), (242, 234, 220), (228, 218, 202), (235, 226, 210)]
# Albardilla (remat de morter o de teula plana) d'alguns murs.
TAPIA_CAP_COLORS = [(196, 190, 178), (204, 198, 186), (188, 182, 172)]
# Llargada mínima per considerar un tram de tàpia (drop_lone_blocks).
TAPIA_BLOCK_M = 4.0
# Alçada d'una filada de totxo: els trencaments del mur van a esglaons d'aquesta mida.
BRICK_COURSE_M = 0.15
# Trams de malla sense fitxa: longitud irregular (evita el ritme visual d'un bloc fix cada 4 m).
TAPIA_SEG_M = (2.4, 5.8)
# Vores amb fitxa: un sol bloc fins a aquesta llargada; més llarg, es parteix en trams irregulars.
TAPIA_SPEC_MAX_M = 14.0


def _tapia_segment_points(line: LineString, rng, spec: dict | None) -> np.ndarray:
    """Punts al llarg del mur on es talla la malla (un segment entre cada parell consecutiu)."""
    if line.length < 0.05:
        return np.asarray(line.coords, dtype=float)

    def _along(ts: list[float]) -> np.ndarray:
        return np.array([line.interpolate(t).coords[0] for t in ts], dtype=float)

    if spec:
        if line.length <= TAPIA_SPEC_MAX_M:
            return np.asarray(line.coords, dtype=float)
        lo, hi = 9.0, TAPIA_SPEC_MAX_M
        ts = [0.0]
        s = 0.0
        while s < line.length - 0.05:
            s += min(float(rng.uniform(lo, hi)), line.length - s)
            ts.append(s)
        if ts[-1] < line.length - 1e-6:
            ts.append(line.length)
        return _along(ts)

    lo, hi = TAPIA_SEG_M
    ts = [0.0]
    s = 0.0
    while s < line.length - 0.05:
        s += min(float(rng.uniform(lo, hi)), line.length - s)
        ts.append(s)
    if ts[-1] < line.length - 1e-6:
        ts.append(line.length)
    return _along(ts)


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


def tapia_meshes(lines, ground, specs=None) -> tuple[list, list]:
    """Tàpies al llarg de les línies. Sense fitxa, cada mur té alçada, gruix i color a l'atzar,
    amb cantonades esbotzades. Amb fitxa (`specs[k]`), l'alçada, el color i el material són els
    de la foto. Torna (murs, detalls); els detalls no tenen col·lisió ni textura de totxo.
    El material queda a `metadata['wall_mat']`: brick, stone o block."""
    import trimesh
    from shapely.geometry.polygon import orient

    specs = list(specs) if specs is not None else [None] * len(lines)
    out, caps = [], []
    for k, line in enumerate(lines):
        if line.length < 1.0:
            continue
        spec = specs[k] if k < len(specs) else None
        # Llavor estable segons la posició del mur: el mateix mur surt igual a cada generació.
        x0, y0 = line.coords[0]
        rng = np.random.default_rng([int(abs(x0) * 100), int(abs(y0) * 100), k])
        if spec:
            color = tuple(int(c) for c in spec["color"])
            height = float(spec["height_m"])
            thick = float(spec.get("thick_m", 0.28))
            slope = 0.0
            cap = bool(spec.get("cap"))
            cap_color = tuple(int(c) for c in spec["cap"]) if cap else TAPIA_CAP_COLORS[0]
            broken_start = broken_end = False
            mat = str(spec.get("material", "brick"))
        else:
            color = TAPIA_COLORS[rng.integers(len(TAPIA_COLORS))]
            height = rng.uniform(1.45, 2.35)
            thick = float(rng.choice([0.24, 0.3, 0.3, 0.38]))
            slope = rng.uniform(-0.5, 0.5) / max(line.length, 4.0)
            cap = rng.random() < 0.45
            cap_color = TAPIA_CAP_COLORS[rng.integers(len(TAPIA_CAP_COLORS))]
            broken_start = rng.random() < 0.35
            broken_end = rng.random() < 0.35
            mat = "brick"
        total = line.length
        # Portals de la fitxa: tram (s0, s1) del mur, en metres des del començament de la línia.
        gates = []
        for gt in (spec or {}).get("gates", []):
            at = Point(gt["at"])
            # Només el tram on cau el portal (no el del costat, si la fitxa en té uns quants).
            if line.distance(at) < 1.0 and 0.0 < line.project(at) < line.length:
                sc, hw = line.project(at), float(gt.get("w", 1.8)) / 2
                gz = float(ground.height(np.array([at.x]), np.array([at.y]))[0])
                gates.append((sc - hw, sc + hw, gz + float(gt.get("h", 2.1)), gt))
        pts = _tapia_segment_points(line, rng, spec)
        n = len(pts) - 1
        step = 0.0
        s = 0.0
        for i, (a, b) in enumerate(zip(pts[:-1], pts[1:])):
            seg = float(np.hypot(*(b - a)))
            if seg < 0.2:
                s += seg
                continue
            # De tant en tant el mur fa un esglaó (un tram refet més alt o més baix).
            if not spec and i and rng.random() < 0.15:
                step = float(np.clip(step + rng.choice([-1, 1]) * rng.uniform(0.15, 0.4), -0.5, 0.5))
            ga, gb = ground.height(np.array([a[0], b[0]]), np.array([a[1], b[1]]))
            # El capdamunt segueix el terreny (alçada sobre el punt més alt de cada punta) i el pendent.
            ref = max(ga, gb)
            za = ref + height + step + slope * (s - total / 2) + (ga - ref) * 0.5
            zb = ref + height + step + slope * (s + seg - total / 2) + (gb - ref) * 0.5
            if spec:
                # Amb fitxa, el capdamunt segueix el terreny sense graons entre blocs (la teula ho delata).
                za, zb = ga + height, gb + height
            z_bot = min(ga, gb) - 0.2
            damage = {}
            if not spec and i == 0 and broken_start and seg > 1.2:
                damage["start"] = (rng.uniform(0.4, min(1.4, seg * 0.45)), rng.uniform(0.3, 0.9))
            if not spec and i == n - 1 and broken_end and seg > 1.2:
                damage["end"] = (rng.uniform(0.4, min(1.4, seg * 0.45)), rng.uniform(0.3, 0.9))
            if not spec and not damage and seg > 2.5 and rng.random() < 0.12:
                w = rng.uniform(0.7, min(1.8, seg * 0.4))
                damage["dip"] = (rng.uniform(0.3, 0.7) * seg, w, rng.uniform(0.25, 0.6))
            # Les puntes s'allarguen per tancar les juntes en angle, però no dins d'un tros esbotzat.
            e0 = 0.0 if "start" in damage else 0.15
            e1 = 0.0 if "end" in damage else 0.15
            if spec:
                # Una fitxa és una vora recta: les juntes de dins no fan angle i, solapades, parpellegen.
                e0, e1 = (0.15 if i == 0 else 0.0), (0.15 if i == n - 1 else 0.0)
            profile = _tapia_block(rng, seg, e0, e1, za, zb, z_bot, damage)
            # Trams sense portal (coordenades del bloc) i forat de cada portal al perfil.
            spans = [(-e0, seg + e1)]
            for g0, g1, gtop, _ in gates:
                u0, u1 = g0 - s, g1 - s
                if u1 <= -e0 or u0 >= seg + e1:
                    continue
                profile = profile.difference(box(u0, z_bot - 1.0, u1, gtop))
                spans = [p for a0, a1 in spans for p in ((a0, min(a1, u0)), (max(a0, u1), a1)) if p[1] - p[0] > 0.05]
            ang = np.arctan2(b[1] - a[1], b[0] - a[0])
            # Cada bloc, un pèl diferent de to (tongades de totxo, sol, humitat). La fitxa conserva el color.
            rgba = _srgb_to_linear(color, 1.0 if spec else rng.uniform(0.91, 1.09))
            for piece in getattr(profile, "geoms", [profile]):
                if not isinstance(piece, Polygon) or piece.area < 0.01:
                    continue
                m = trimesh.creation.extrude_polygon(orient(piece), height=thick)
                m.apply_translation([0, 0, -thick / 2])
                # Perfil: x al llarg del mur, y = alçada; al món la direcció local (cos, sin) és (x, −z).
                m.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 1, 0]))
                m.apply_translation([a[0], 0, -a[1]])
                m.visual.vertex_colors = np.tile(rgba, (len(m.vertices), 1)).astype(np.uint8)
                m.metadata["wall_mat"] = mat
                out.append(m)

            def top(u: float) -> float:
                return za + (zb - za) * (u / seg)

            if spec and spec.get("plinth"):
                # Sòcol (pedra) a les dues cares, fins a `height_m` sobre el terra.
                pl = spec["plinth"]
                ph = float(pl.get("height_m", 0.8))
                for u0, u1 in spans:
                    for d0 in (thick / 2, -thick / 2 - 0.03):
                        sb = _tapia_box(a, ang, u0, u1, z_bot, top(u0) - height + ph, d0, d0 + 0.03, _lin(pl.get("color", (176, 146, 104))),
                                        k=(zb - za) / seg, u_ref=u0)
                        sb.metadata["wall_mat"] = str(pl.get("material", "stone"))
                        out.append(sb)
            if spec and spec.get("tiles"):
                # Albardilla de teula: carener de teules àrabs al capdamunt.
                tl = spec["tiles"]
                for u0, u1 in spans:
                    caps.append(_tile_ridge(a, ang, u0, u1, top(u0), thick + 2 * float(tl.get("over_m", 0.1)),
                                            float(tl.get("height_m", 0.2)), _lin(tl.get("color", (176, 110, 82))), k=(zb - za) / seg))
            if spec and spec.get("rail_m"):
                # Reixa per damunt del mur: barrots i un travesser, sense col·lisió.
                rh = float(spec["rail_m"])
                rc = _srgb_to_linear(spec.get("rail", [36, 36, 38]))
                nbar = max(2, int(seg / 0.18))
                # Els portals no porten reixa: només els trams de mur (`spans`).
                for j in range(nbar):
                    u = (j + 0.5) / nbar
                    if not any(u0 <= u * seg <= u1 for u0, u1 in spans):
                        continue
                    p = a + (b - a) * u
                    zt = za + (zb - za) * u
                    bar = trimesh.creation.box(extents=[0.028, rh, 0.028])
                    bar.apply_translation([float(p[0]), zt + rh / 2, -float(p[1])])
                    bar.visual.vertex_colors = np.tile(rc, (len(bar.vertices), 1)).astype(np.uint8)
                    caps.append(bar)
                for u0, u1 in spans:
                    u0, u1 = max(u0, 0.0), min(u1, seg)
                    if u1 - u0 < 0.05:
                        continue
                    rail = _tapia_box(a, ang, u0, u1, top(u0) + rh - 0.0125, top(u0) + rh + 0.0125, -0.015, 0.015, rc[:3],
                                      k=(zb - za) / seg, u_ref=u0)
                    caps.append(rail)
            if cap and not damage:
                # Albardilla: llosa una mica més ampla que el mur, seguint el capdamunt.
                for u0, u1 in spans:
                    lip = Polygon([(u0, top(u0) - 0.04), (u1, top(u1) - 0.04), (u1, top(u1) + 0.06), (u0, top(u0) + 0.06)])
                    c = trimesh.creation.extrude_polygon(lip, height=thick + 0.08)
                    c.apply_translation([0, 0, -(thick + 0.08) / 2])
                    c.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 1, 0]))
                    c.apply_translation([a[0], 0, -a[1]])
                    c.visual.vertex_colors = np.tile(_srgb_to_linear(cap_color), (len(c.vertices), 1)).astype(np.uint8)
                    caps.append(c)
            s += seg
        if gates:
            a0, a1 = np.array(line.coords[0]), np.array(line.coords[-1])
            ang = np.arctan2(a1[1] - a0[1], a1[0] - a0[0])
            for g0, g1, gtop, gt in gates:
                out_g, caps_g = _gate_meshes(a0, ang, g0, g1, gtop, thick, gt, color, mat, spec)
                out += out_g
                caps += caps_g
        if spec and spec.get("pillars"):
            out_p, caps_p = _pillar_meshes(line, ground, spec["pillars"], gates, color, mat)
            out += out_p
            caps += caps_p
    return out, caps


def _pillar_meshes(line, ground, pl: dict, gates: list, wall_color, mat: str) -> tuple[list, list]:
    """Pilars d'una tàpia amb fitxa: als extrems del tram (`ends`) i als costats de cada portal
    (`gates`), de `w` d'amplada i `h` d'alçada sobre el terra, amb un capitell de pedra en punta.
    Torna (sòlids, detalls)."""
    import trimesh

    w, h = float(pl.get("w", 0.45)), float(pl.get("h", 2.0))
    color = _lin(pl.get("color", wall_color))
    cap = _lin(pl.get("cap", (196, 190, 178)))
    total = line.length
    at = []
    # Els blocs de les puntes s'allarguen 0,15 m (juntes): el pilar de la punta les tapa.
    lo, hi = w / 2 - 0.15, total - w / 2 + 0.15
    if pl.get("ends", True):
        at += [lo, hi]
    if pl.get("gates", True):
        for g0, g1, _, _ in gates:
            at += [g0 - w / 2, g1 + w / 2]
    at = sorted(min(max(s, lo), hi) for s in at)
    keep = []
    for s in at:
        if not keep or s - keep[-1] > w * 0.8:
            keep.append(s)
    solid, details = [], []
    for s in keep:
        # Direcció del mur en aquell punt; fora de la línia (puntes), la del tros de la punta.
        sc = min(max(s, 0.0), total)
        p0, p1 = line.interpolate(max(0.0, sc - 0.05)), line.interpolate(min(total, sc + 0.05))
        d = np.array(p1.coords[0]) - np.array(p0.coords[0])
        ang = float(np.arctan2(d[1], d[0]))
        p = Point(np.array(line.interpolate(sc).coords[0]) + np.array([np.cos(ang), np.sin(ang)]) * (s - sc))
        gz = float(ground.height(np.array([p.x]), np.array([p.y]))[0])
        a = np.array(p.coords[0]) - np.array([np.cos(ang), np.sin(ang)]) * (w / 2)
        shaft = _tapia_box(a, ang, 0.0, w, gz - 0.2, gz + h, -w / 2, w / 2, color)
        shaft.metadata["wall_mat"] = mat
        solid.append(shaft)
        details.append(_tapia_box(a, ang, -0.04, w + 0.04, gz + h, gz + h + 0.07, -w / 2 - 0.04, w / 2 + 0.04, cap))
        # Punta del capitell: piràmide de quatre cares.
        tip = trimesh.creation.cone(radius=(w + 0.08) / 2 * np.sqrt(2), height=float(pl.get("cap_h", 0.18)), sections=4)
        tip.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
        tip.apply_transform(trimesh.transformations.rotation_matrix(ang + np.pi / 4, [0, 1, 0]))
        tip.apply_translation([p.x, gz + h + 0.07, -p.y])
        tip.visual.vertex_colors = np.tile([*cap, 255], (len(tip.vertices), 1)).astype(np.uint8)
        details.append(tip)
    return solid, details


def _shear(k: float, u_ref: float) -> np.ndarray:
    """z += k·(u − u_ref) al marc del mur: el capdamunt segueix el pendent del bloc."""
    return np.array([[1, 0, 0, 0], [k, 1, 0, -k * u_ref], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=float)


def _tapia_box(a, ang: float, u0: float, u1: float, z0: float, z1: float, d0: float, d1: float, color,
               k: float = 0.0, u_ref: float = 0.0):
    """Caixa al marc d'un mur: u al llarg (des d'`a`, en direcció `ang`), z amunt, d de través.
    `k`: pendent (z puja k per metre de u, a partir d'`u_ref`)."""
    import trimesh

    m = trimesh.creation.box(extents=[u1 - u0, z1 - z0, d1 - d0])
    m.apply_translation([(u0 + u1) / 2, (z0 + z1) / 2, (d0 + d1) / 2])
    if k:
        m.apply_transform(_shear(k, u_ref))
    m.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 1, 0]))
    m.apply_translation([a[0], 0, -a[1]])
    m.visual.vertex_colors = np.tile([*color, 255], (len(m.vertices), 1)).astype(np.uint8)
    return m


def _tile_ridge(a, ang: float, u0: float, u1: float, z: float, width: float, height: float, color, k: float = 0.0):
    """Carener de teula (prisma triangular) de u0 a u1 al marc del mur, amb la base a `z` (a u0)
    i pendent `k`."""
    import trimesh

    tri = Polygon([(-width / 2, 0.0), (width / 2, 0.0), (0.0, height)])
    m = trimesh.creation.extrude_polygon(tri, height=u1 - u0)
    # (d, z, u) → (u, z, d): el prisma s'estira al llarg del mur.
    m.apply_transform(np.array([[0, 0, 1, u0], [0, 1, 0, z], [1, 0, 0, 0], [0, 0, 0, 1]], dtype=float))
    trimesh.repair.fix_normals(m)
    if k:
        m.apply_transform(_shear(k, u0))
    m.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 1, 0]))
    m.apply_translation([a[0], 0, -a[1]])
    m.visual.vertex_colors = np.tile([*color, 255], (len(m.vertices), 1)).astype(np.uint8)
    return m


def _gate_meshes(a, ang: float, g0: float, g1: float, gtop: float, thick: float, gt: dict, wall_color, mat: str, spec: dict):
    """Portal d'una tàpia amb fitxa: fulles de fusta al forat, llinda i teuladí de teula.
    Torna (sòlids, detalls)."""
    solid, details = [], []
    z0 = gtop - float(gt.get("h", 2.1))
    leaf = _lin(gt.get("color", (150, 100, 52)))
    dark = tuple(int(c * 0.55) for c in leaf)
    # Portal de reixa (`solid_m`): planxa plena fins a `solid_m` i barrots fins a dalt.
    solid_m = gt.get("solid_m")
    z_plate = z0 + float(solid_m) if solid_m is not None else gtop
    # Les fulles tanquen el pas: van amb el mur (col·lisió).
    door = _tapia_box(a, ang, g0, g1, z0, z_plate, -0.04, 0.04, leaf)
    # Fusta o planxa: superfície llisa (malla de bloc), no la textura de totxo del mur.
    door.metadata["wall_mat"] = "block"
    solid.append(door)
    # Junta entre fulles i travessers a totes dues cares.
    n = int(gt.get("leaves", 2))
    for k in range(1, n):
        u = g0 + (g1 - g0) * k / n
        for d0 in (0.04, -0.055):
            details.append(_tapia_box(a, ang, u - 0.02, u + 0.02, z0, gtop, d0, d0 + 0.015, dark))
    rails = (z0 + 0.25, gtop - 0.35) if solid_m is None else (z_plate - 0.06,)
    for zr in rails:
        for d0 in (0.04, -0.06):
            details.append(_tapia_box(a, ang, g0 + 0.04, g1 - 0.04, zr, zr + 0.1, d0, d0 + 0.02, dark))
    if solid_m is not None:
        # Barrots i travesser de dalt: detalls, sense col·lisió (la planxa ja tanca el pas).
        nb = max(2, int((g1 - g0) / 0.12))
        for j in range(nb):
            u = g0 + (g1 - g0) * (j + 0.5) / nb
            details.append(_tapia_box(a, ang, u - 0.012, u + 0.012, z_plate, gtop, -0.012, 0.012, leaf))
        details.append(_tapia_box(a, ang, g0, g1, gtop - 0.05, gtop, -0.025, 0.025, leaf))
        details.append(_tapia_box(a, ang, g0, g1, (z_plate + gtop) / 2 - 0.02, (z_plate + gtop) / 2 + 0.02, -0.02, 0.02, leaf))
    cp = gt.get("canopy")
    if cp:
        # Llinda de paret per damunt del portal i teuladí de teula que sobresurt pels dos costats.
        lift = float(cp.get("lift_m", 0.3))
        side = float(cp.get("side_m", 0.3))
        col = tuple(int(c) for c in wall_color)
        lintel = _tapia_box(a, ang, g0 - side, g1 + side, gtop - 0.02, gtop + lift, -thick / 2, thick / 2, _lin(col))
        lintel.metadata["wall_mat"] = mat
        solid.append(lintel)
        details.append(_tile_ridge(a, ang, g0 - side - 0.15, g1 + side + 0.15, gtop + lift, thick + 2 * float(cp.get("over_m", 0.25)),
                                   float(cp.get("height_m", 0.28)), _lin(cp.get("color", (176, 110, 82)))))
    return solid, details


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


FALLBACK_ROOF_LIN = _lin((186, 78, 54))


def roof_tint_from_ortho(ortho: Ortho, geom: Polygon) -> tuple[int, int, int]:
    """To mitjà de teula a l'ortofoto (lineal), sense projectar la imatge al joc."""
    if geom.is_empty or geom.area < 0.5:
        return FALLBACK_ROOF_LIN
    rgb, transform = ortho.window(geom.bounds, CLASS_RES_M)
    mask = _rasterize([geom], rgb.shape[:2], transform)
    if not mask.any():
        c = geom.representative_point()
        return _lin(ortho.color_at(c.x, c.y))
    rmask = roof_mask(rgb.astype(np.uint8))[mask]
    sel = rgb[mask]
    if rmask.any():
        sel = sel[rmask]
    med = np.median(sel, axis=0)
    return _lin(tuple(int(x) for x in med))


def _roof_vertex_rgba(_ux: float, _uy: float, rgb_lin: tuple[int, int, int]) -> list[int]:
    """RGB = to de teula (lineal). El carener el dedueix el joc de la normal; l'alfa ha de ser opac."""
    return [*rgb_lin, 255]


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
    # house_id (str) → referència cadastral; el mode DEV del joc el fa servir al hover.
    houses: dict[str, str]


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


def assign_house(
    meshes: list,
    house_ids,
    house_refs: dict[str, str],
    cadastral_ref: str | None,
) -> int:
    """Etiqueta les malles amb el següent house_id i, si hi ha ref cadastral, la desa al mapa."""
    house_id = next(house_ids)
    tag_house(meshes, house_id)
    if cadastral_ref:
        house_refs[str(house_id)] = str(cadastral_ref)
    return house_id


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

    global _retract_count
    _retract_count = 0
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
    # Fitxes amb `extra_roofs: false`: a les fotos, el pati no té coberts fora del Cadastre. Les
    # ombres i els arbres del pati enganyen la detecció; es treu el que hi hagi caigut.
    clean = [ref for ref, sp in load_house_specs(Path(__file__).with_name("cases.yaml")).items() if sp.get("extra_roofs") is False]
    if clean:
        clean_u = unary_union(list(parcels[parcels["nationalCadastralReference"].astype(str).isin(clean)].geometry))
        # També els que toquen la casa per fora de la parcel·la (jardí o placeta de davant).
        near_u = unary_union(list(parts[parts["building"].isin(clean)].geometry)).buffer(0.5)
        n_extra = len(extra)
        extra = [r for r in extra if r.intersection(clean_u).area < 0.5 * r.area and not r.intersects(near_u)]
        if n_extra > len(extra):
            print(f"Village: {n_extra - len(extra)} coberts detectats dins o a tocar de cases amb fitxa sense coberts, fora")
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
    # model propi): el mode dev del joc el fa servir per pintar-les de colors diferents i, amb
    # house_refs, per mostrar la referència cadastral al hover.
    house_ids = itertools.count(1)
    house_refs: dict[str, str] = {}
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
        st, rf, dt = church_meshes(footprint, ground, toward, roof_tint_from_ortho(ortho, footprint))
        assign_house(st + rf + dt, house_ids, house_refs, church_ref)
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
        st, rf, dt = hermitage_meshes(footprint, ground, roof_tint_from_ortho(ortho, footprint))
        assign_house(st + rf + dt, house_ids, house_refs, hermitage_ref)
        landmark_hulls.append(_occupied(st))
        church_stone += st
        roofs += rf
        details += dt
        print(f"Village: ermita de las Encinas ({hermitage_ref}) amb model propi")
    if landmark_hulls:
        # Els models propis surten de la planta cadastral (pòrtics, galeries): arbres i tàpies
        # han d'evitar tot el que ocupen, no només la planta. Una envolupant per edifici.
        buildings_u = unary_union([buildings_u, *[h.buffer(0.5) for h in landmark_hulls]])
    # Cases amb fitxa (cases.yaml): primer, perquè les seves obertures tinguin preferència.
    # `parts` com a llista: les parts s'uneixen en una sola casa (i les altres no es fan); com a
    # diccionari, cada part porta la seva fitxa, amb els camps comuns de l'edifici, i les parts
    # que no hi surten es fan com sempre.
    specs = load_house_specs(Path(__file__).with_name("cases.yaml"))
    spec_hulls, spec_parts = [], set()
    part_key = parts["localId"].astype(str).str.split("_").str[-1]
    for ref, spec in specs.items():
        rows = parts[parts["building"] == ref]
        sel = spec.get("parts")
        if isinstance(sel, dict):
            common = {k: v for k, v in spec.items() if k != "parts"}
            jobs = [(rows[part_key[rows.index] == k], {**common, **(v or {})}) for k, v in sel.items()]
        else:
            jobs = [(rows[part_key[rows.index].isin(sel)] if sel else rows, spec)]
            spec_parts.update(rows["localId"])
        for sub, sp in jobs:
            if not len(sub):
                print(f"Village: fitxa {ref} sense parts al Cadastre (o fora de la zona)")
                continue
            spec_parts.update(sub["localId"])
            footprint = unary_union(list(sub.geometry))
            footprint = max(getattr(footprint, "geoms", [footprint]), key=lambda g: g.area)
            if sp.get("footprint") == "rect":
                footprint = footprint.minimum_rotated_rectangle
            if sp.get("join"):
                # La part arriba fins a una altra de la mateixa casa (el Cadastre hi deixa un buit).
                other = unary_union(list(rows[part_key[rows.index].isin(sp["join"])].geometry))
                footprint, sp = join_footprint(footprint, other), {**sp, "_shared": other}
            n_floors = int(sp.get("floors", max(_floors(f) for f in sub["numberOfFloorsAboveGround"])))
            color = _lin(sp["wall"]) if "wall" in sp else WALL_PALETTE[0]
            w, r, d, win = house_meshes(
                footprint,
                n_floors,
                ground,
                color,
                facing_street,
                roads_u,
                zlib.crc32(ref.encode()),
                taken,
                sp,
                roof_tint_from_ortho(ortho, footprint),
            )
            assign_house(w + r + d + win, house_ids, house_refs, ref)
            spec_hulls.append(_occupied(w))
            walls += w
            roofs += r
            details += d
            window_panes += win
        # Volums que no surten al Cadastre (`extra_parts`): contorn UTM i la fitxa de la part.
        common = {k: v for k, v in spec.items() if k not in ("parts", "extra_parts")}
        for ep in spec.get("extra_parts", []):
            footprint = Polygon([(float(e) - ox, float(n) - oy) for e, n in ep["outline"]])
            sp = {**common, **{k: v for k, v in ep.items() if k != "outline"}}
            color = _lin(sp["wall"]) if "wall" in sp else WALL_PALETTE[0]
            w, r, d, win = house_meshes(
                footprint, int(sp.get("floors", 1)), ground, color, facing_street, roads_u,
                zlib.crc32(ref.encode()), taken, sp, roof_tint_from_ortho(ortho, footprint),
            )
            assign_house(w + r + d + win, house_ids, house_refs, ref)
            spec_hulls.append(_occupied(w))
            walls += w
            roofs += r
            details += d
            window_panes += win
    if specs:
        print(f"Village: {len(spec_hulls)} parts de casa amb fitxa")
    for _, row in parts.iterrows():
        if row["building"] in {church_ref, hermitage_ref} or row["localId"] in spec_parts:
            continue
        color = WALL_PALETTE[sum(ord(c) for c in row["building"]) % len(WALL_PALETTE)]
        # Llavor per edifici (totes les parts amb el mateix estil de finestra); la suma de
        # caràcters es repetia massa entre referències cadastrals.
        seed = zlib.crc32(str(row["building"]).encode())
        cadastral = str(row["building"])
        for poly in getattr(row.geometry, "geoms", [row.geometry]):
            if poly.area < 4:
                continue
            w, r, d, win = house_meshes(
                poly,
                _floors(row["numberOfFloorsAboveGround"]),
                ground,
                color,
                facing_street,
                roads_u,
                seed,
                taken,
                roof_lin=roof_tint_from_ortho(ortho, poly),
            )
            assign_house(w + r + d + win, house_ids, house_refs, cadastral)
            walls += w
            roofs += r
            details += d
            window_panes += win
    for k, rect in enumerate(extra):
        w, r, d, win = house_meshes(
            rect,
            1,
            ground,
            WALL_PALETTE[(k * 3 + 1) % len(WALL_PALETTE)],
            facing_street,
            roads_u,
            9000 + k,
            taken,
            roof_lin=roof_tint_from_ortho(ortho, rect),
        )
        # Coberts detectats a l'ortofoto: sense referència cadastral.
        assign_house(w + r + d + win, house_ids, house_refs, None)
        walls += w
        roofs += r
        details += d
        window_panes += win
    if _retract_count:
        print(f"Village: {_retract_count} façanes enretirades de la calçada")

    if spec_hulls:
        # Porxos, tanques i jardins de davant de les cases amb fitxa: sense arbres ni tàpies.
        buildings_u = unary_union([buildings_u, *spec_hulls])

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
        # No totes les vores entre cases tenen tàpia: només es posa on l'ortofoto en mostra l'ombra.
        from walls import WallDetector, detect_walls

        heights = [f * FLOOR_H + 1.5 for f in parts["numberOfFloorsAboveGround"]] + [FLOOR_H + 1.5] * len(extra)
        tapia_lines = detect_walls(tapia_lines, WallDetector(ortho, cls, part_polys + extra, heights))
        n_lines = len(tapia_lines)
        tapia_lines = drop_lone_blocks(tapia_lines)
        print(f"Village: {n_lines - len(tapia_lines)} tàpies soltes d'un sol bloc eliminades")
    # Fitxes de mur: llargada de la vora cadastral i alçada de la foto. Treuen la tàpia
    # genèrica del mateix tram, també si l'ortofoto no n'hi havia detectat cap.
    from walls import load_wall_specs, resolve_wall_specs

    spec_pairs = resolve_wall_specs(load_wall_specs(Path(__file__).with_name("walls.yaml")), parcels, roads_u, ox, oy)
    cut_specs: list[tuple] = []
    for ln, spec in spec_pairs:
        rest = ln.difference(buildings_u.buffer(0.2))
        for g in getattr(rest, "geoms", [rest]):
            if isinstance(g, LineString) and g.length > 0.8:
                cut_specs.append((g, spec))
    if cut_specs:
        ban = unary_union([ln.buffer(1.1) for ln, _ in cut_specs])
        kept = []
        for ln in tapia_lines:
            rest = ln.difference(ban)
            kept += [g for g in getattr(rest, "geoms", [rest]) if isinstance(g, LineString) and g.length > 1.0]
        print(f"Village: {len(cut_specs)} trams de tàpia amb fitxa ({sum(ln.length for ln, _ in cut_specs):.0f} m)")
        tapia_lines = kept
    tapias, tapia_caps = tapia_meshes(tapia_lines, ground)
    # `material: none`: a la foto no hi ha mur; la fitxa només treu la tàpia genèrica.
    built = [(ln, s) for ln, s in cut_specs if str(s.get("material")) != "none"]
    spec_lines = [ln for ln, _ in built]
    spec_meshes, spec_caps = tapia_meshes(spec_lines, ground, [s for _, s in built]) if spec_lines else ([], [])
    details += tapia_caps + spec_caps
    spec_brick = [m for m in spec_meshes if m.metadata.get("wall_mat") == "brick"]
    spec_stone = [m for m in spec_meshes if m.metadata.get("wall_mat") == "stone"]
    spec_block = [m for m in spec_meshes if m.metadata.get("wall_mat") == "block"]
    tapias = [*tapias, *spec_brick]

    # Arbres de la imatge (fora d'edificis i carrers) i plantes d'hort on hi ha verd.
    crowns = detect_trees(cls)
    cx = np.array([t.x for t in crowns])
    cy = np.array([t.y for t in crowns])
    keep = ~(shapely.contains_xy(buildings_u, cx, cy) | shapely.contains_xy(road_core, cx, cy) | ground.in_water(cx, cy)) if crowns else np.array([], bool)
    kept = [t for t, k in zip(crowns, keep) if k]
    n_before = len(kept)
    kept = thin_village_center(kept, named_streets_local(cfg, ox, oy))
    if len(kept) < n_before:
        print(f"Village: {n_before - len(kept)} arbres trets del centre; en queden {len(kept)}")
    cx = np.array([t.x for t in kept])
    cy = np.array([t.y for t in kept])
    heights = ground.height(cx, cy) if kept else []
    trees = []
    for t, y in zip(kept, heights):
        height = float(np.clip(1.6 + t.radius * 2.1, 3.0, 14.0))
        trees.append({"x": round(t.x, 2), "y": round(float(y), 2), "z": round(-t.y, 2), "r": round(t.radius, 2), "h": round(height, 2), "c": list(t.color)})
    plants = _hort_plants(hort_polys, cls, ground)

    meshes = []
    if church_stone:
        meshes.append(("building_church_stone", concat_tagged(church_stone)))
    # Parets per material: arrebossat (per defecte), i pedra o maó vist de les fitxes de casa.
    by_mat: dict[str | None, list] = {}
    for m in walls:
        by_mat.setdefault(m.metadata.get("mat"), []).append(m)
    for mat, ms in by_mat.items():
        meshes.append((f"building_houses_{mat}" if mat else "building_houses", concat_tagged(ms)))
    if tapias:
        meshes.append(("building_tapias", concat_tagged(tapias)))
    # El nom tria la textura: `tapia` és totxo, `stone` és pedra, i el bloc queda amb l'arrebossat.
    if spec_stone:
        meshes.append(("building_walls_stone", concat_tagged(spec_stone)))
    if spec_block:
        meshes.append(("building_walls_block", concat_tagged(spec_block)))
    if details:
        meshes.append(("prop_facades", concat_tagged(details)))
    if window_panes:
        meshes.append(("prop_windows", concat_tagged(window_panes)))
    if roofs:
        meshes.append(("roofs", concat_tagged(roofs)))
    counts = {k: sum(1 for p in parcel_info if p["type"] == k) for k in PARCEL_TYPES}
    print(
        f"Village: parcel·les {counts}, {len(tapia_lines)} trams de tàpia, {len(trees)} arbres, "
        f"{len(plants)} plantes d'hort, {len(house_refs)} cases amb ref cadastral"
    )
    return Village(zone, meshes, trees, plants, parcel_info, house_refs)


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
