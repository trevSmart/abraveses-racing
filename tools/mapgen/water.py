"""Rius, rierols i sèquies: llit excavat al MDT i làmina d'aigua (xarxa hidrogràfica de l'IGN)."""

from __future__ import annotations

from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import shapely
import trimesh
from scipy import ndimage
from shapely.geometry import LineString, box

# Mostreig de l'eix (m) i suavitzat del nivell de referència al llarg del curs (mostres).
STEP_M = 2.0
SMOOTH_SAMPLES = 6.0
# El fons de l'aigua es busca a ±SEEK_M de l'eix: el traçat de l'IGN pot anar desplaçat uns metres
# de la vall que recull el MDT.
SEEK_M = 3.0
# Aigua avall el nivell només baixa, però mai més de MAX_CUT_M per sota del terreny suavitzat
# (si no, un tram mal traçat que puja un turó faria una trinxera).
MAX_CUT_M = 0.6
# Fora del talús el tall continua pujant amb aquest pendent fins a trobar el terreny, i a partir
# de FADE_M[0] m de la vora es fon cap al MDT original (en FADE_M[1] ja no toca res).
OUT_SLOPE = 1.0
FADE_M = (3.0, 5.0)
# Si el DEM puja més de TUNNEL_COVER_M per damunt del grau ideal i el tram fa ≥ TUNNEL_MIN_M,
# l'aigua passa sota el turó (sense trinxera) i es posen boques de formigó als extrems.
TUNNEL_COVER_M = 2.0
TUNNEL_MIN_M = 8.0
# Al pas del túnel l'aigua és un filet (~3 cm) sobre un llit de còdols.
TUNNEL_WATER_M = 0.03
# Collar de la boca: gruix axial, volada lateral i lliure per damunt de la làmina.
PORTAL_DEPTH_M = 0.45
PORTAL_LIP_M = 0.35
PORTAL_HEAD_M = 0.55
PORTAL_RGB = (168, 166, 158)
COBBLE_RGB = (
    (118, 112, 102),
    (138, 130, 118),
    (98, 94, 88),
    (152, 145, 132),
    (108, 104, 96),
    (128, 120, 108),
)


@dataclass
class Section:
    bed_m: float
    bank_m: float
    depth_m: float
    water_frac: float

    @property
    def water_half_m(self) -> float:
        # Una mica més ample que la línia d'aigua teòrica: la vora queda enterrada al talús i no
        # es veu cap tall encara que la malla del terreny sigui grollera.
        return self.bed_m / 2 + self.bank_m * 0.85


def _smoothstep(u: np.ndarray) -> np.ndarray:
    return u * u * (3 - 2 * u)


def tunnel_mask(
    smooth: np.ndarray,
    step_m: float = STEP_M,
    cover_m: float = TUNNEL_COVER_M,
    min_m: float = TUNNEL_MIN_M,
    expand_cover_m: float = MAX_CUT_M,
) -> np.ndarray:
    """Marca trams on el terreny cobreix el grau ideal (≥ `cover_m`) en un tram ≥ `min_m`.

    `smooth` ha d'estar orientat aigües avall (cota no creixent en mitjana).
    Un cop detectat el crest, s'expandeix mentre la coberta superi `expand_cover_m`
    perquè els vessants no obrin trinxera amb el límit MAX_CUT.
    """
    s = np.asarray(smooth, dtype=np.float64)
    ideal = np.minimum.accumulate(s)
    cover = s - ideal
    deep = cover >= cover_m
    out = np.zeros(s.shape, dtype=bool)
    if not np.any(deep):
        return out
    # Etiqueta runs contigues i queda només les prou llargues; després expandeix als vessants.
    padded = np.concatenate([[False], deep, [False]])
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    for a, b in edges.reshape(-1, 2):
        if (b - a) * step_m < min_m:
            continue
        lo, hi = int(a), int(b)
        while lo > 0 and cover[lo - 1] > expand_cover_m:
            lo -= 1
        while hi < cover.size and cover[hi] > expand_cover_m:
            hi += 1
        out[lo:hi] = True
    return out


def water_ref_profile(smooth: np.ndarray, tunnel: np.ndarray, max_cut_m: float = MAX_CUT_M) -> np.ndarray:
    """Nivell de vora del llit: sota túnel segueix el grau ideal; altrament no talla > max_cut."""
    s = np.asarray(smooth, dtype=np.float64)
    ideal = np.minimum.accumulate(s)
    open_ref = np.maximum(ideal, s - max_cut_m)
    return np.where(tunnel, ideal, open_ref)


class Waterways:
    def __init__(self, gdf: gpd.GeoDataFrame, dem, origin: tuple[float, float], half: float, cfg: dict) -> None:
        """`gdf` en coordenades locals (origen `origin` en UTM, al centre del terreny); `dem` en UTM."""
        table = cfg.get("waterways", {})
        self.half = half
        # (pts, ref, section, kind, downhill, tunnel_mask)
        self.lines: list[tuple[np.ndarray, np.ndarray, Section, str, bool, np.ndarray]] = []
        clip = box(-half - 20, -half - 20, half + 20, half + 20)
        seg_rows = []
        n_tunnel = 0
        for _, row in gdf.iterrows():
            spec = table.get(row.get("kind"))
            if not spec or row.geometry is None:
                continue
            sec = Section(**{k: float(v) for k, v in spec.items()})
            geom = row.geometry.intersection(clip)
            for line in getattr(geom, "geoms", [geom]):
                if not isinstance(line, LineString) or line.length < STEP_M:
                    continue
                pts, ref, downhill, tun = self._profile(line, dem, origin)
                self.lines.append((pts, ref, sec, str(row.get("kind")), downhill, tun))
                seg_rows.append((pts, ref, sec, tun))
                if tun.any():
                    n_tunnel += 1

        if not seg_rows:
            self.tree = None
            self.reach = 0.0
            return
        p0 = np.concatenate([p[:-1] for p, _, _, _ in seg_rows])
        p1 = np.concatenate([p[1:] for p, _, _, _ in seg_rows])
        r0 = np.concatenate([r[:-1] for _, r, _, _ in seg_rows])
        r1 = np.concatenate([r[1:] for _, r, _, _ in seg_rows])
        t0 = np.concatenate([t[:-1] for _, _, _, t in seg_rows]).astype(np.float64)
        t1 = np.concatenate([t[1:] for _, _, _, t in seg_rows]).astype(np.float64)
        n = np.array([len(p) - 1 for p, _, _, _ in seg_rows])
        sec_cols = {
            k: np.repeat([getattr(s, k) for _, _, s, _ in seg_rows], n)
            for k in ("bed_m", "bank_m", "depth_m", "water_frac")
        }
        self.p0, self.p1, self.r0, self.r1 = p0, p1, r0, r1
        self.t0, self.t1 = t0, t1
        self.half_bed = sec_cols["bed_m"] / 2
        self.bank = sec_cols["bank_m"]
        self.depth = sec_cols["depth_m"]
        self.water_frac = sec_cols["water_frac"]
        self.water_half = np.repeat([s.water_half_m for _, _, s, _ in seg_rows], n)
        self.reach = float((self.half_bed + self.bank).max() + FADE_M[1])
        self.tree = shapely.STRtree(shapely.linestrings(np.stack([p0, p1], axis=1)))
        kinds = {}
        for _, _, _, kind, _, _ in self.lines:
            kinds[kind] = kinds.get(kind, 0) + 1
        tun_msg = f", {n_tunnel} amb túnel" if n_tunnel else ""
        print(f"Water: {len(self.lines)} cursos {kinds}, {len(p0)} trams{tun_msg}")

    @staticmethod
    def _profile(
        line: LineString, dem, origin: tuple[float, float]
    ) -> tuple[np.ndarray, np.ndarray, bool, np.ndarray]:
        """Eix densificat, nivell de referència, sentit i màscara de túnel."""
        d = np.append(np.arange(0.0, line.length, STEP_M), line.length)
        pts = np.array([line.interpolate(float(s)).coords[0] for s in d])
        tangent = np.gradient(pts, axis=0)
        tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
        normal = np.column_stack([-tangent[:, 1], tangent[:, 0]])
        offsets = np.linspace(-SEEK_M, SEEK_M, 5)
        ox, oy = origin
        z = np.min(
            [dem(ox + pts[:, 0] + normal[:, 0] * o, oy + pts[:, 1] + normal[:, 1] * o) for o in offsets],
            axis=0,
        )
        z = np.asarray(z, dtype=np.float64)
        if np.isnan(z).any():
            # Interpola forats del MDT perquè el suavitzat i el grau ideal no es trenquin.
            good = np.isfinite(z)
            if good.any():
                idx = np.arange(z.size)
                z = np.interp(idx, idx[good], z[good])
            else:
                z = np.zeros_like(z)
        smooth = ndimage.gaussian_filter1d(z, SMOOTH_SAMPLES, mode="nearest")
        # L'IGN no sempre digitalitza en el sentit del corrent: aigües amunt és l'extrem més alt.
        downhill = bool(smooth[0] >= smooth[-1])
        s = smooth if downhill else smooth[::-1]
        tun_down = tunnel_mask(s, step_m=STEP_M)
        ref_down = water_ref_profile(s, tun_down)
        if downhill:
            return pts, ref_down, True, tun_down
        return pts, ref_down[::-1], False, tun_down[::-1]

    def _pairs(self, xs: np.ndarray, ys: np.ndarray):
        """Parelles (punt, tram) a menys de `reach`, amb distància, nivell i factor de túnel."""
        pts = shapely.points(xs, ys)
        pi, si = self.tree.query(pts, predicate="dwithin", distance=self.reach)
        a, b = self.p0[si], self.p1[si]
        ab = b - a
        ap = np.column_stack([xs[pi], ys[pi]]) - a
        t = np.clip((ap * ab).sum(axis=1) / np.maximum((ab * ab).sum(axis=1), 1e-9), 0.0, 1.0)
        dist = np.linalg.norm(ap - ab * t[:, None], axis=1)
        ref = self.r0[si] + (self.r1[si] - self.r0[si]) * t
        tun = self.t0[si] + (self.t1[si] - self.t0[si]) * t
        return pi, si, dist, ref, tun

    def carve(self, xs: np.ndarray, ys: np.ndarray, dem_abs: np.ndarray) -> np.ndarray:
        """Quant s'ha d'enfonsar el MDT (≤ 0) a cada punt per fer-hi el llit."""
        xs = np.asarray(xs, dtype=np.float64).ravel()
        ys = np.asarray(ys, dtype=np.float64).ravel()
        out = np.zeros(xs.size)
        if self.tree is None or xs.size == 0:
            return out
        pi, si, dist, ref, tun = self._pairs(xs, ys)
        if pi.size == 0:
            return out
        # Un punt pot caure a l'abast de diversos trams: només el més proper compta
        # (si no, un tram obert del vessant excavaria el crest del túnel).
        order = np.argsort(dist)
        pi, si, dist, ref, tun = pi[order], si[order], dist[order], ref[order], tun[order]
        _, first = np.unique(pi, return_index=True)
        pi, si, dist, ref, tun = pi[first], si[first], dist[first], ref[first], tun[first]
        # Sota el turó no s'obre trinxera: l'aigua hi passa en túnel.
        open_ch = tun < 0.5
        if not np.any(open_ch):
            return out
        pi, si, dist, ref = pi[open_ch], si[open_ch], dist[open_ch], ref[open_ch]
        half_bed, bank = self.half_bed[si], self.bank[si]
        edge = half_bed + bank
        s = _smoothstep(np.clip((dist - half_bed) / np.maximum(bank, 1e-9), 0.0, 1.0))
        cut = ref - self.depth[si] * (1 - s) + np.maximum(dist - edge, 0.0) * OUT_SLOPE
        fade = np.clip((edge + FADE_M[1] - dist) / (FADE_M[1] - FADE_M[0]), 0.0, 1.0)
        delta = np.minimum(cut - np.asarray(dem_abs, dtype=np.float64).ravel()[pi], 0.0) * fade
        out[pi] = delta
        return out

    def surface_y(self, ground, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        """Alçada local (Y) de la làmina; nan fora del llit excavat."""
        shape = np.asarray(xs).shape
        xs = np.asarray(xs, dtype=np.float64).ravel()
        ys = np.asarray(ys, dtype=np.float64).ravel()
        out = np.full(xs.size, np.nan)
        if self.tree is None or xs.size == 0:
            return out.reshape(shape)
        pi, si, dist, ref, tun = self._pairs(xs, ys)
        if pi.size == 0:
            return out.reshape(shape)
        edge = self.half_bed[si] + self.bank[si]
        # Inclou una corona per evitar triangles del terreny per sobre de la làmina.
        in_ch = dist <= edge + FADE_M[1]
        if not np.any(in_ch):
            return out.reshape(shape)
        px = xs[pi[in_ch]]
        py = ys[pi[in_ch]]
        si_in = si[in_ch]
        tun_in = tun[in_ch]
        col = self.depth[si_in] * self.water_frac[si_in]
        bed_open = np.asarray(ground.height(px, py, raised=True), dtype=np.float64)
        # En túnel: llit al grau hidràulic i només un filet d'aigua (~3 cm).
        z_min = float(ground.z_min)
        bed_tun = ref[in_ch] - z_min
        bed = np.where(tun_in >= 0.5, bed_tun, bed_open)
        water_h = np.where(tun_in >= 0.5, TUNNEL_WATER_M, col + 0.06)
        out[pi[in_ch]] = bed + water_h
        return out.reshape(shape)

    def water_distance(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        """Distància (m) a la vora de la làmina d'aigua; negativa a dins."""
        xs = np.asarray(xs, dtype=np.float64).ravel()
        ys = np.asarray(ys, dtype=np.float64).ravel()
        out = np.full(xs.size, np.inf)
        if self.tree is None or xs.size == 0:
            return out
        pi, si, dist, _, _ = self._pairs(xs, ys)
        np.minimum.at(out, pi, dist - self.water_half[si])
        return out

    @staticmethod
    def _vertex_colors(flow_x: np.ndarray, flow_z: np.ndarray, depth_b: int, n: int) -> np.ndarray:
        colors = np.empty((2 * n, 4), dtype=np.uint8)
        for i in range(n):
            enc = (
                int(np.clip(flow_x[i] * 0.5 + 0.5, 0.0, 1.0) * 255),
                int(np.clip(flow_z[i] * 0.5 + 0.5, 0.0, 1.0) * 255),
                depth_b,
            )
            colors[2 * i] = (*enc, 255)
            colors[2 * i + 1] = (*enc, 0)
        return colors

    @staticmethod
    def _portal_mesh(
        center: np.ndarray,
        tangent: np.ndarray,
        normal: np.ndarray,
        half_w: float,
        y_water: float,
        water_h: float,
        outward: float,
    ) -> trimesh.Trimesh:
        """Collar rectangular de formigó a la boca del túnel (eix local: tangent, normal, up)."""
        t = tangent / max(float(np.linalg.norm(tangent)), 1e-9)
        n = normal / max(float(np.linalg.norm(normal)), 1e-9)
        # Orientació: la cara exterior mira cap a `outward` (±1 al llarg de t).
        t = t * outward
        half_w = half_w + PORTAL_LIP_M
        y0 = y_water - water_h - PORTAL_LIP_M
        y1 = y_water + PORTAL_HEAD_M
        # Profunditat del collar cap a dins del túnel (−t) i una mica cap enfora.
        d0, d1 = -PORTAL_DEPTH_M * 0.25, PORTAL_DEPTH_M
        # Forat interior (una mica més estret que el collar exterior).
        inner_w = half_w - PORTAL_LIP_M
        inner_y0 = y_water - water_h
        inner_y1 = y_water + PORTAL_HEAD_M * 0.35

        def corner(side: float, y: float, depth: float) -> list[float]:
            p = center + n * side + t * depth
            return [float(p[0]), float(y), float(-p[1])]

        # 8 vèrtexs del bloc exterior + 8 del forat; cares del marc (sense tapar el pas).
        ov = [
            corner(-half_w, y0, d0),
            corner(half_w, y0, d0),
            corner(half_w, y1, d0),
            corner(-half_w, y1, d0),
            corner(-half_w, y0, d1),
            corner(half_w, y0, d1),
            corner(half_w, y1, d1),
            corner(-half_w, y1, d1),
        ]
        iv = [
            corner(-inner_w, inner_y0, d0),
            corner(inner_w, inner_y0, d0),
            corner(inner_w, inner_y1, d0),
            corner(-inner_w, inner_y1, d0),
            corner(-inner_w, inner_y0, d1),
            corner(inner_w, inner_y0, d1),
            corner(inner_w, inner_y1, d1),
            corner(-inner_w, inner_y1, d1),
        ]
        verts = ov + iv
        # Índexs: exterior 0..7, interior 8..15.
        faces: list[list[int]] = []
        # Cara exterior (anell): connecta exterior amb forat a d0.
        faces += [[0, 1, 9], [0, 9, 8], [1, 2, 10], [1, 10, 9], [2, 3, 11], [2, 11, 10], [3, 0, 8], [3, 8, 11]]
        # Cara interior (anell) a d1.
        faces += [[4, 12, 13], [4, 13, 5], [5, 13, 14], [5, 14, 6], [6, 14, 15], [6, 15, 7], [7, 15, 12], [7, 12, 4]]
        # Costats exteriors del bloc.
        faces += [[0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]]
        # Parets del forat (mirant cap al pas).
        faces += [[8, 9, 13], [8, 13, 12], [9, 10, 14], [9, 14, 13], [10, 11, 15], [10, 15, 14], [11, 8, 12], [11, 12, 15]]
        mesh = trimesh.Trimesh(vertices=np.asarray(verts, dtype=np.float64), faces=np.asarray(faces, dtype=np.int64), process=False)
        mesh.visual.vertex_colors = np.tile([*PORTAL_RGB, 255], (len(verts), 1)).astype(np.uint8)
        return mesh

    @staticmethod
    def _cobble_bed(
        pts: np.ndarray,
        tun: np.ndarray,
        tangent: np.ndarray,
        normal: np.ndarray,
        half_w: float,
        bed_y: np.ndarray,
        seed: int = 0,
    ) -> trimesh.Trimesh | None:
        """Còdols irregulars escampats pel llit del túnel (alguns sobresurten del filet d'aigua)."""
        idx = np.flatnonzero(tun)
        if idx.size < 2:
            return None
        rng = np.random.default_rng(seed)
        unit = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
        parts: list[trimesh.Trimesh] = []
        # Densitat: ~4 còdols/m al llarg × 3 de banda ≈ llit pedregós.
        along = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(pts[idx], axis=0), axis=1))])
        length = float(along[-1]) if along.size else 0.0
        if length < 0.5:
            return None
        n_stations = max(int(length / 0.38), 2)
        for s in np.linspace(0.0, length, n_stations):
            j = int(np.searchsorted(along, s, side="right") - 1)
            j = int(np.clip(j, 0, idx.size - 1))
            i = int(idx[j])
            t = tangent[i] / max(float(np.linalg.norm(tangent[i])), 1e-9)
            n = normal[i] / max(float(np.linalg.norm(normal[i])), 1e-9)
            # Desplaçament fi al llarg de l'eix entre mostres.
            frac = 0.0 if j + 1 >= idx.size or along[j + 1] <= along[j] else (s - along[j]) / (along[j + 1] - along[j])
            i2 = int(idx[min(j + 1, idx.size - 1)])
            p = pts[i] * (1 - frac) + pts[i2] * frac
            yb = float(bed_y[i] * (1 - frac) + bed_y[i2] * frac)
            for _ in range(int(rng.integers(2, 5))):
                across = float(rng.uniform(-half_w * 0.92, half_w * 0.92))
                along_j = float(rng.uniform(-0.12, 0.12))
                rx = float(rng.uniform(0.035, 0.11))
                rz = float(rng.uniform(0.035, 0.11))
                ry = float(rng.uniform(0.02, 0.055))  # una mica aplatats
                center = p + n * across + t * along_j
                rock = unit.copy()
                rock.apply_scale([rx, ry, rz])
                # Orientació aleatòria lleu.
                rock.apply_transform(
                    trimesh.transformations.rotation_matrix(
                        float(rng.uniform(0, 2 * np.pi)), [0, 1, 0]
                    )
                )
                rock.apply_translation([float(center[0]), yb + ry * 0.55, float(-center[1])])
                rgb = COBBLE_RGB[int(rng.integers(0, len(COBBLE_RGB)))]
                # Variació tonal per còdol.
                jitter = int(rng.integers(-12, 13))
                rgb = tuple(int(np.clip(c + jitter, 40, 200)) for c in rgb)
                rock.visual.vertex_colors = np.tile([*rgb, 255], (len(rock.vertices), 1)).astype(np.uint8)
                parts.append(rock)
        if not parts:
            return None
        out = trimesh.util.concatenate(parts)
        out.remove_unreferenced_vertices()
        return out

    def mesh(
        self, ground, z_min: float, keep_off_road_m: float = 0.35
    ) -> tuple[trimesh.Trimesh | None, trimesh.Trimesh | None, trimesh.Trimesh | None]:
        """Superfície d'aigua, volum i boques de túnel (prop). Sota els camins es talla la làmina."""
        parts: list[trimesh.Trimesh] = []
        vol_parts: list[trimesh.Trimesh] = []
        portal_parts: list[trimesh.Trimesh] = []
        for pts, ref, sec, _, downhill, tun in self.lines:
            sign = 1.0 if downhill else -1.0
            tangent = np.gradient(pts, axis=0)
            tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
            flow_x = sign * tangent[:, 0]
            flow_z = -sign * tangent[:, 1]
            flow_len = np.maximum(np.hypot(flow_x, flow_z), 1e-9)
            flow_x /= flow_len
            flow_z /= flow_len
            normal = np.column_stack([-tangent[:, 1], tangent[:, 0]])
            left = pts + normal * sec.water_half_m
            right = pts - normal * sec.water_half_m
            water_h_open = sec.depth_m * sec.water_frac
            water_h = np.where(tun, TUNNEL_WATER_M, water_h_open)
            bed_open = np.asarray(ground.height(pts[:, 0], pts[:, 1], raised=True), dtype=np.float64)
            bed_tun = ref - z_min
            bed = np.where(tun, bed_tun, bed_open)
            level = bed + water_h + np.where(tun, 0.0, 0.06)
            # Profunditat codificada al color: al túnel gairebé transparent/ràpida.
            depth_b = np.clip(water_h / 2.0, 0.02, 1.0)
            depth_b_u8 = (depth_b * 255).astype(np.uint8)
            # Fora del terreny no hi ha llit: la cinta quedaria penjant a la vora del mapa.
            inside = (np.abs(left) <= self.half).all(axis=1) & (np.abs(right) <= self.half).all(axis=1)
            # En túnel l'aigua continua sota el turó encara que el "camí" hi passi a sobre.
            off_road = ground.road_distance(pts[:, 0], pts[:, 1]) > keep_off_road_m
            ok = inside & (off_road | tun)
            n = len(pts)
            verts = np.empty((2 * n, 3))
            verts[0::2] = np.column_stack([left[:, 0], level, -left[:, 1]])
            verts[1::2] = np.column_stack([right[:, 0], level, -right[:, 1]])
            seg = np.nonzero(ok[:-1] & ok[1:])[0]
            if seg.size == 0:
                continue
            a, b, c, d = 2 * seg, 2 * seg + 1, 2 * seg + 2, 2 * seg + 3
            faces = np.concatenate([np.column_stack([a, b, c]), np.column_stack([b, d, c])])
            mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
            if mesh.face_normals[:, 1].mean() < 0:
                mesh.invert()
            colors = np.empty((2 * n, 4), dtype=np.uint8)
            for i in range(n):
                enc = (
                    int(np.clip(flow_x[i] * 0.5 + 0.5, 0.0, 1.0) * 255),
                    int(np.clip(flow_z[i] * 0.5 + 0.5, 0.0, 1.0) * 255),
                    int(depth_b_u8[i]),
                )
                colors[2 * i] = (*enc, 255)
                colors[2 * i + 1] = (*enc, 0)
            mesh.visual.vertex_colors = colors
            parts.append(mesh)

            vol_verts: list[list[float]] = []
            vol_faces: list[list[int]] = []
            vol_colors: list[list[int]] = []

            def enc_flow(ii: int, bank: int) -> list[int]:
                return [
                    int(np.clip(flow_x[ii] * 0.5 + 0.5, 0.0, 1.0) * 255),
                    int(np.clip(flow_z[ii] * 0.5 + 0.5, 0.0, 1.0) * 255),
                    int(depth_b_u8[ii]),
                    bank,
                ]

            def push_quad(
                a: np.ndarray,
                b: np.ndarray,
                ya: float,
                yb: float,
                ha: float,
                hb: float,
                ia: int,
                ib: int,
                bank_a: int,
                bank_b: int,
            ) -> None:
                base = len(vol_verts)
                vol_verts.extend(
                    [
                        [float(a[0]), ya, float(-a[1])],
                        [float(b[0]), yb, float(-b[1])],
                        [float(b[0]), yb - hb, float(-b[1])],
                        [float(a[0]), ya - ha, float(-a[1])],
                    ]
                )
                vol_faces.append([base, base + 1, base + 2])
                vol_faces.append([base, base + 2, base + 3])
                for bank, ii in zip((bank_a, bank_b, bank_b, bank_a), (ia, ib, ib, ia)):
                    vol_colors.append(enc_flow(ii, bank))

            for i in seg:
                ha, hb = float(water_h[i]), float(water_h[i + 1])
                push_quad(left[i], left[i + 1], float(level[i]), float(level[i + 1]), ha, hb, i, i + 1, 255, 255)
                push_quad(right[i + 1], right[i], float(level[i + 1]), float(level[i]), hb, ha, i + 1, i, 0, 0)
                base = len(vol_verts)
                lb = [
                    [float(left[i, 0]), float(level[i] - ha), float(-left[i, 1])],
                    [float(right[i, 0]), float(level[i] - ha), float(-right[i, 1])],
                    [float(right[i + 1, 0]), float(level[i + 1] - hb), float(-right[i + 1, 1])],
                    [float(left[i + 1, 0]), float(level[i + 1] - hb), float(-left[i + 1, 1])],
                ]
                vol_verts.extend(lb)
                vol_faces.append([base, base + 1, base + 2])
                vol_faces.append([base, base + 2, base + 3])
                for bank in (128, 128, 128, 128):
                    vol_colors.append(enc_flow(i, bank))

            if vol_faces:
                vol = trimesh.Trimesh(
                    vertices=np.asarray(vol_verts, dtype=np.float64),
                    faces=np.asarray(vol_faces, dtype=np.int64),
                    process=False,
                )
                vol.visual.vertex_colors = np.asarray(vol_colors, dtype=np.uint8)
                vol_parts.append(vol)

            # Boques als canvis open↔tunnel.
            for i in range(n - 1):
                if bool(tun[i]) == bool(tun[i + 1]):
                    continue
                # Índex de la boca: el primer/últim punt del tram túnel.
                mouth = i + 1 if tun[i + 1] else i
                # Cap a fora del túnel: del crest cap a la vall oberta.
                outward = -1.0 if tun[i + 1] else 1.0
                portal_parts.append(
                    self._portal_mesh(
                        pts[mouth],
                        tangent[mouth],
                        normal[mouth],
                        sec.water_half_m,
                        float(level[mouth]),
                        float(water_h[mouth]),
                        outward,
                    )
                )

            cobbles = self._cobble_bed(
                pts,
                tun & ok,
                tangent,
                normal,
                sec.water_half_m,
                bed,
                seed=int(abs(pts[0, 0]) * 10) % 10_000,
            )
            if cobbles is not None:
                portal_parts.append(cobbles)

        def _merge(parts_list: list[trimesh.Trimesh]) -> trimesh.Trimesh | None:
            if not parts_list:
                return None
            out = trimesh.util.concatenate(parts_list)
            out.remove_unreferenced_vertices()
            return out

        return _merge(parts), _merge(vol_parts), _merge(portal_parts)
