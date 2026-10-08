"""Tàpies reals: quines vores de parcel·la tenen mur segons l'ortofoto.

Una tàpia de ~2 m es veu a l'ortofoto (~18 cm/px) com una línia clara (el capdamunt) seguida
d'una franja fosca (la seva ombra) cap al costat contrari al sol. Per a cada vora candidata es
mira el perfil de lluminositat perpendicular cada mig metre i es busca aquesta parella. El
Cadastre pot anar desplaçat fins a ~2 m del mur real, així que la cerca admet un marge.

Hi ha mostres que no es poden jutjar (desconegudes): vores gairebé paral·leles al sol (el mur no
fa ombra de costat), dins l'ombra d'una casa o sota un arbre. Un tros desconegut entre dos trossos
amb mur s'omple; si tota la vora és desconeguda, es manté el mur (com abans d'aquesta anàlisi).
"""

from __future__ import annotations

import numpy as np
import shapely
from scipy import ndimage
from shapely import affinity
from shapely.geometry import LineString, Point
from shapely.ops import substring, unary_union

from village import FLOOR_H, Classification, Ortho, _rasterize

# Llargada de l'ombra per metre d'alçada (sol de l'ortofoto PNOA, migdia d'estiu).
SHADOW_PER_M = 0.65
# Separació entre mostres al llarg de la vora (m).
STEP_M = 0.5
# On pot començar l'ombra respecte de la línia del Cadastre (m, + = cap a on cau l'ombra).
SEARCH_M = (-2.0, 2.5)
# Amplada admesa de la franja d'ombra d'una tàpia (m).
SHADOW_WIDTH_M = (0.2, 2.6)
# Per sota d'aquest cosinus entre la normal de la vora i l'ombra, el mur gairebé no en fa.
MIN_SHADOW_COS = 0.2
# Forats sense mur que es tapen entre dos trossos amb mur, i tros de mur mínim (m).
GAP_M = 1.5
MIN_RUN_M = 2.0
# Una vora es parteix en trams rectes on gira més d'aquests graus.
SPLIT_DEG = 25.0


def shadow_direction(cls: Classification, buildings: list) -> np.ndarray:
    """Direcció (x est, y nord) cap a on cauen les ombres: la banda de les cases més fosca."""
    lum = cls.rgb.mean(axis=2)
    union = unary_union(buildings)
    best = (np.inf, 0.0)
    for az in np.radians(np.arange(0, 360, 10)):
        d = np.array([np.sin(az), np.cos(az)])
        band = unary_union([affinity.translate(g, *(d * 1.0)) for g in buildings]).difference(union)
        mask = _rasterize([band], lum.shape, cls.transform)
        if mask.any():
            best = min(best, (float(lum[mask].mean()), az))
    az = best[1]
    print(f"Tàpies: les ombres cauen cap als {np.degrees(az):.0f}° (0 = nord)")
    return np.array([np.sin(az), np.cos(az)])


def _straight_pieces(line: LineString) -> list[LineString]:
    """Trams rectes de la vora: cada costat del Cadastre té el seu desplaçament."""
    pts = np.array(line.coords)
    if len(pts) < 3:
        return [line]
    d = np.diff(pts, axis=0)
    ang = np.arctan2(d[:, 1], d[:, 0])
    turn = np.abs((np.diff(ang) + np.pi) % (2 * np.pi) - np.pi)
    cuts = [0, *(np.flatnonzero(turn > np.radians(SPLIT_DEG)) + 1), len(pts) - 1]
    return [LineString(pts[a : b + 1]) for a, b in zip(cuts[:-1], cuts[1:]) if b > a]


class WallDetector:
    def __init__(self, ortho: Ortho, cls: Classification, buildings: list, heights: list[float]):
        self.ortho = ortho
        self.cls = cls
        self.sd = shadow_direction(cls, buildings)
        # Ombra de cada edifici: s'hi barreja la del mur i no es pot jutjar.
        self.building_shadow = unary_union([
            unary_union([g, affinity.translate(g, *(self.sd * SHADOW_PER_M * h))]).convex_hull
            for g, h in zip(buildings, heights)
        ])

    def _profiles(self, pts, tan, nrm, s):
        """Perfils RGB perpendiculars (N×S), mitjana de 5 línies en ±0,4 m al llarg de la vora."""
        o = self.ortho
        along = np.linspace(-0.4, 0.4, 5)
        xs = pts[:, 0, None, None] + nrm[:, 0, None, None] * s[None, :, None] + tan[:, 0, None, None] * along
        ys = pts[:, 1, None, None] + nrm[:, 1, None, None] * s[None, :, None] + tan[:, 1, None, None] * along
        col, row = o.to_px(xs, ys)
        c0, r0 = max(0, int(col.min()) - 2), max(0, int(row.min()) - 2)
        crop = o.rgb[r0 : int(row.max()) + 3, c0 : int(col.max()) + 3]
        coords = [row - r0 - 0.5, col - c0 - 0.5]
        return [ndimage.map_coordinates(crop[..., c], coords, order=1, mode="nearest").mean(axis=2) for c in range(3)]

    def evidence(self, line: LineString) -> np.ndarray:
        """Per mostra cada STEP_M: 1 mur, 0 sense mur, -1 desconegut."""
        px = self.ortho.px_m
        n = int(line.length / STEP_M)
        if n < 1:
            return np.zeros(0, int)
        ts = (np.arange(n) + 0.5) * line.length / n
        pts = np.array([line.interpolate(t).coords[0] for t in ts])
        p1 = np.array([line.interpolate(max(0.0, t - 0.2)).coords[0] for t in ts])
        p2 = np.array([line.interpolate(min(line.length, t + 0.2)).coords[0] for t in ts])
        tan = p2 - p1
        tan /= np.linalg.norm(tan, axis=1, keepdims=True) + 1e-9
        nrm = np.stack([-tan[:, 1], tan[:, 0]], axis=1)
        cosv = nrm @ self.sd
        nrm *= np.where(cosv < 0, -1.0, 1.0)[:, None]  # la normal apunta cap a l'ombra
        s = np.arange(SEARCH_M[0] - 1.0, SEARCH_M[1] + 3.0, px)
        r, g, b = self._profiles(pts, tan, nrm, s)
        lum = (r + g + b) / 3
        exg = (2 * g - r - b) / (r + g + b + 1e-3)

        win = int(round(2.5 / px))
        top_win = int(round(0.7 / px))
        lo, hi = np.searchsorted(s, SEARCH_M[0]), np.searchsorted(s, SEARCH_M[1] + 2.0)
        ev = np.zeros(n, int)
        starts = np.full(n, np.nan)
        for i, p in enumerate(lum):
            seg = p[lo:hi]
            mins = [lo + k for k in range(1, len(seg) - 1) if seg[k] <= seg[k - 1] and seg[k] <= seg[k + 1]]
            # Les tres valls més fosques: la de l'ombra del mur sol ser-ne una.
            for j in sorted(mins, key=lambda k: p[k])[:3]:
                left = p[max(0, j - win) : j + 1].max()
                right = p[j : j + win + 1].max()
                floor = min(left, right)
                if p[j] > 0.6 * floor or floor - p[j] < 35:
                    continue
                half = p[j] + 0.5 * (floor - p[j])
                a = j
                while a > 0 and p[a - 1] < half:
                    a -= 1
                e = j
                while e < len(p) - 1 and p[e + 1] < half:
                    e += 1
                width = s[e] - s[a] + px
                # Capdamunt del mur just abans de l'ombra: clar i gens verd. Les fileres de conreu
                # i les copes també fan valls fosques, però amb vegetació al costat del sol.
                k0 = max(0, a - top_win)
                top = k0 + int(np.argmax(p[k0 : a + 1]))
                wall_top = p[top] >= 0.85 * left and exg[i, top] < 0.04
                if SEARCH_M[0] <= s[a] <= SEARCH_M[1] and SHADOW_WIDTH_M[0] <= width <= SHADOW_WIDTH_M[1] and wall_top:
                    ev[i] = 1
                    starts[i] = s[a]
                    break
        # Un mateix tram recte té un sol desplaçament respecte del Cadastre: fora les ombres soltes.
        d = float(np.nanmedian(starts)) if np.isfinite(starts).any() else 0.0
        ev[np.isfinite(starts) & (np.abs(starts - d) > 0.6)] = 0

        sx, sy = pts[:, 0] + nrm[:, 0] * (d + 0.4), pts[:, 1] + nrm[:, 1] * (d + 0.4)
        x0, y0, res = self.cls.transform
        col = ((sx - x0) / res).astype(int).clip(0, self.cls.tree_mask.shape[1] - 1)
        row = ((y0 - sy) / res).astype(int).clip(0, self.cls.tree_mask.shape[0] - 1)
        blind = (np.abs(cosv) < MIN_SHADOW_COS) | shapely.contains_xy(self.building_shadow, sx, sy) | self.cls.tree_mask[row, col]
        ev[(ev == 0) & blind] = -1
        return ev

    def walled(self, line: LineString) -> list[LineString]:
        """Trossos de la vora on hi ha tàpia."""
        out = []
        for piece in _straight_pieces(line):
            ev = self.evidence(piece)
            if len(ev) == 0:
                continue
            if np.all(ev == -1):
                out.append(piece)
                continue
            step = piece.length / len(ev)
            keep = _runs(ev, step)
            edges = np.flatnonzero(np.diff(np.concatenate([[0], keep.astype(int), [0]])))
            for a, b in zip(edges[::2], edges[1::2]):
                # Un tros que arriba a la punta de la vora s'hi allarga del tot (tanca les cantonades).
                t0 = 0.0 if a == 0 else a * step
                t1 = piece.length if b == len(ev) else b * step
                out.append(substring(piece, t0, t1))
        return [ln for ln in out if isinstance(ln, LineString) and ln.length > 0.5]


def _runs(ev: np.ndarray, step: float) -> np.ndarray:
    """Mostres amb mur: tapa forats curts i desconeguts que toquen un mur, i treu trossos curts."""
    keep = ev == 1
    idx = np.flatnonzero(keep)
    for a, b in zip(idx[:-1], idx[1:]):
        if (b - a - 1) * step <= GAP_M or np.all(ev[a + 1 : b] == -1):
            keep[a:b] = True
    # Desconegut a les puntes (ombra de la casa on arriba el mur): continua el mur veí.
    if idx.size:
        k = idx[0]
        while k > 0 and ev[k - 1] == -1:
            k -= 1
            keep[k] = True
        k = idx[-1]
        while k < len(ev) - 1 and ev[k + 1] == -1:
            k += 1
            keep[k] = True
    edges = np.flatnonzero(np.diff(np.concatenate([[0], keep.astype(int), [0]])))
    for a, b in zip(edges[::2], edges[1::2]):
        if (b - a) * step < MIN_RUN_M:
            keep[a:b] = False
    return keep


def detect_walls(lines: list[LineString], detector: WallDetector) -> list[LineString]:
    out = []
    for ln in lines:
        out += detector.walled(ln)
    before, after = sum(ln.length for ln in lines), sum(ln.length for ln in out)
    print(f"Tàpies: {after:.0f} m amb mur a l'ortofoto de {before:.0f} m de vores candidates")
    return out


def load_wall_specs(path) -> dict:
    """Fitxes de tàpia (`walls.yaml`); buit si no hi ha fitxer."""
    import yaml

    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as f:
        return {str(k): v for k, v in (yaml.safe_load(f) or {}).items()}


def _edges(geom) -> list[LineString]:
    polys = list(getattr(geom, "geoms", [geom]))
    out = []
    for poly in polys:
        if not hasattr(poly, "exterior"):
            continue
        coords = list(poly.exterior.coords)
        for a, b in zip(coords[:-1], coords[1:]):
            ln = LineString([a, b])
            if ln.length >= 2.5:
                out.append(ln)
    return out


def _inward(line: LineString, poly) -> np.ndarray:
    """Normal (x, y) que entra a la parcel·la des del centre de la vora."""
    a, b = np.array(line.coords[0]), np.array(line.coords[-1])
    d = b - a
    left = np.array([-d[1], d[0]]) / (np.hypot(*d) + 1e-9)
    mid = (a + b) / 2
    return left if poly.buffer(0.05).contains(Point(mid + left * 0.5)) else -left


def _parcel_geom(parcels, ref: str):
    rows = parcels[parcels["nationalCadastralReference"].astype(str) == ref]
    if rows.empty:
        print(f"Tàpies: la fitxa cita la parcel·la {ref}, que no és al Cadastre")
        return None
    return rows.geometry.unary_union


def resolve_wall_specs(specs: dict, parcels, roads, ox: float, oy: float) -> list[tuple[LineString, dict]]:
    """Línies locals de cada fitxa, amb la cara de fora sobre la vora cadastral.

    `along: street` agafa les vores de la parcel·la que surten a un carrer. `near` (UTM) en
    tria una, i `length_m` en retalla un tram centrat en el punt.
    """
    jobs = []
    for key, spec in specs.items():
        poly = _parcel_geom(parcels, str(spec.get("parcel", "")))
        if poly is None:
            continue
        edges = _edges(poly)
        chosen: list[LineString] = []
        if spec.get("along") == "street":
            for edge in edges:
                a, b = np.array(edge.coords[0]), np.array(edge.coords[-1])
                mid = (a + b) / 2
                n = -_inward(edge, poly)  # cap a fora
                if LineString([mid + n * 0.4, mid + n * 6.0]).intersects(roads):
                    chosen.append(edge)
            if not chosen:
                print(f"Tàpies: {key} no té cap vora de carrer")
        else:
            e, n = spec["near"]
            pt = Point(float(e) - ox, float(n) - oy)
            edge = min(edges, key=lambda ln: ln.distance(pt), default=None)
            if edge is None or edge.distance(pt) > 4.0:
                print(f"Tàpies: {key} no encaixa amb cap vora (a menys de 4 m de near)")
                continue
            if spec.get("length_m"):
                half = float(spec["length_m"]) / 2
                at = edge.project(pt)
                edge = substring(edge, max(0.0, at - half), min(edge.length, at + half))
            chosen.append(edge)
        for edge in chosen:
            if edge.length < 0.8:
                continue
            n = _inward(edge, poly)
            half = float(spec.get("thick_m", 0.28)) / 2
            # La cara exterior queda sobre la línia del Cadastre; el gruix entra a la parcel·la.
            jobs.append((affinity.translate(edge, xoff=n[0] * half, yoff=n[1] * half), spec))
        if chosen:
            print(f"Tàpies: fitxa {key}, {sum(e.length for e in chosen):.0f} m")
    return jobs
