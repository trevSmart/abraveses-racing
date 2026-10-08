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


class Waterways:
    def __init__(self, gdf: gpd.GeoDataFrame, dem, origin: tuple[float, float], half: float, cfg: dict) -> None:
        """`gdf` en coordenades locals (origen `origin` en UTM, al centre del terreny); `dem` en UTM."""
        table = cfg.get("waterways", {})
        self.half = half
        self.lines: list[tuple[np.ndarray, np.ndarray, Section, str, bool]] = []
        clip = box(-half - 20, -half - 20, half + 20, half + 20)
        seg_rows = []
        for _, row in gdf.iterrows():
            spec = table.get(row.get("kind"))
            if not spec or row.geometry is None:
                continue
            sec = Section(**{k: float(v) for k, v in spec.items()})
            geom = row.geometry.intersection(clip)
            for line in getattr(geom, "geoms", [geom]):
                if not isinstance(line, LineString) or line.length < STEP_M:
                    continue
                pts, ref, downhill = self._profile(line, dem, origin)
                self.lines.append((pts, ref, sec, str(row.get("kind")), downhill))
                seg_rows.append((pts, ref, sec))

        if not seg_rows:
            self.tree = None
            self.reach = 0.0
            return
        p0 = np.concatenate([p[:-1] for p, _, _ in seg_rows])
        p1 = np.concatenate([p[1:] for p, _, _ in seg_rows])
        r0 = np.concatenate([r[:-1] for _, r, _ in seg_rows])
        r1 = np.concatenate([r[1:] for _, r, _ in seg_rows])
        n = np.array([len(p) - 1 for p, _, _ in seg_rows])
        sec_cols = {
            k: np.repeat([getattr(s, k) for _, _, s in seg_rows], n)
            for k in ("bed_m", "bank_m", "depth_m", "water_frac")
        }
        self.p0, self.p1, self.r0, self.r1 = p0, p1, r0, r1
        self.half_bed = sec_cols["bed_m"] / 2
        self.bank = sec_cols["bank_m"]
        self.depth = sec_cols["depth_m"]
        self.water_frac = sec_cols["water_frac"]
        self.water_half = np.repeat([s.water_half_m for _, _, s in seg_rows], n)
        self.reach = float((self.half_bed + self.bank).max() + FADE_M[1])
        self.tree = shapely.STRtree(shapely.linestrings(np.stack([p0, p1], axis=1)))
        kinds = {}
        for _, _, _, kind, _ in self.lines:
            kinds[kind] = kinds.get(kind, 0) + 1
        print(f"Water: {len(self.lines)} cursos {kinds}, {len(p0)} trams")

    @staticmethod
    def _profile(line: LineString, dem, origin: tuple[float, float]) -> tuple[np.ndarray, np.ndarray, bool]:
        """Eix densificat i nivell de referència (cota absoluta de la vora del llit) a cada punt."""
        d = np.append(np.arange(0.0, line.length, STEP_M), line.length)
        pts = np.array([line.interpolate(float(s)).coords[0] for s in d])
        tangent = np.gradient(pts, axis=0)
        tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
        normal = np.column_stack([-tangent[:, 1], tangent[:, 0]])
        offsets = np.linspace(-SEEK_M, SEEK_M, 5)
        ox, oy = origin
        z = np.min([dem(ox + pts[:, 0] + normal[:, 0] * o, oy + pts[:, 1] + normal[:, 1] * o) for o in offsets], axis=0)
        smooth = ndimage.gaussian_filter1d(z, SMOOTH_SAMPLES, mode="nearest")
        # L'IGN no sempre digitalitza en el sentit del corrent: aigües amunt és l'extrem més alt.
        downhill = smooth[0] >= smooth[-1]
        s = smooth if downhill else smooth[::-1]
        ref = np.maximum(np.minimum.accumulate(s), s - MAX_CUT_M)
        return pts, (ref if downhill else ref[::-1]), downhill

    def _pairs(self, xs: np.ndarray, ys: np.ndarray):
        """Parelles (punt, tram) a menys de `reach`, amb la distància i el nivell projectat."""
        pts = shapely.points(xs, ys)
        pi, si = self.tree.query(pts, predicate="dwithin", distance=self.reach)
        a, b = self.p0[si], self.p1[si]
        ab = b - a
        ap = np.column_stack([xs[pi], ys[pi]]) - a
        t = np.clip((ap * ab).sum(axis=1) / np.maximum((ab * ab).sum(axis=1), 1e-9), 0.0, 1.0)
        dist = np.linalg.norm(ap - ab * t[:, None], axis=1)
        ref = self.r0[si] + (self.r1[si] - self.r0[si]) * t
        return pi, si, dist, ref

    def carve(self, xs: np.ndarray, ys: np.ndarray, dem_abs: np.ndarray) -> np.ndarray:
        """Quant s'ha d'enfonsar el MDT (≤ 0) a cada punt per fer-hi el llit."""
        xs = np.asarray(xs, dtype=np.float64).ravel()
        ys = np.asarray(ys, dtype=np.float64).ravel()
        out = np.zeros(xs.size)
        if self.tree is None or xs.size == 0:
            return out
        pi, si, dist, ref = self._pairs(xs, ys)
        if pi.size == 0:
            return out
        half_bed, bank = self.half_bed[si], self.bank[si]
        edge = half_bed + bank
        s = _smoothstep(np.clip((dist - half_bed) / bank, 0.0, 1.0))
        cut = ref - self.depth[si] * (1 - s) + np.maximum(dist - edge, 0.0) * OUT_SLOPE
        fade = np.clip((edge + FADE_M[1] - dist) / (FADE_M[1] - FADE_M[0]), 0.0, 1.0)
        delta = np.minimum(cut - np.asarray(dem_abs, dtype=np.float64).ravel()[pi], 0.0) * fade
        np.minimum.at(out, pi, delta)
        return out

    def surface_y(self, ground, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        """Alçada local (Y) de la làmina; nan fora del llit excavat."""
        shape = np.asarray(xs).shape
        xs = np.asarray(xs, dtype=np.float64).ravel()
        ys = np.asarray(ys, dtype=np.float64).ravel()
        out = np.full(xs.size, np.nan)
        if self.tree is None or xs.size == 0:
            return out.reshape(shape)
        pi, si, dist, _ = self._pairs(xs, ys)
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
        bed = np.asarray(ground.height(px, py, raised=True), dtype=np.float64)
        col = self.depth[si_in] * self.water_frac[si_in]
        out[pi[in_ch]] = bed + col + 0.06
        return out.reshape(shape)

    def water_distance(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        """Distància (m) a la vora de la làmina d'aigua; negativa a dins."""
        xs = np.asarray(xs, dtype=np.float64).ravel()
        ys = np.asarray(ys, dtype=np.float64).ravel()
        out = np.full(xs.size, np.inf)
        if self.tree is None or xs.size == 0:
            return out
        pi, si, dist, _ = self._pairs(xs, ys)
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

    def mesh(self, ground, z_min: float, keep_off_road_m: float = 0.35) -> tuple[trimesh.Trimesh | None, trimesh.Trimesh | None]:
        """Superfície de l'aigua i parets/fons del volum (sota la làmina). Sota els camins es talla."""
        parts: list[trimesh.Trimesh] = []
        vol_parts: list[trimesh.Trimesh] = []
        for pts, ref, sec, _, downhill in self.lines:
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
            water_h = sec.depth_m * sec.water_frac
            # Superfície a l'alçada del llit excavat (mateix càlcul que el MDT del joc) + columna d'aigua.
            bed = np.asarray(ground.height(pts[:, 0], pts[:, 1], raised=True), dtype=np.float64)
            level = bed + water_h + 0.06
            depth_b = int(np.clip(water_h / 2.0, 0.08, 1.0) * 255)
            # Fora del terreny no hi ha llit: la cinta quedaria penjant a la vora del mapa.
            inside = (np.abs(left) <= self.half).all(axis=1) & (np.abs(right) <= self.half).all(axis=1)
            ok = inside & (ground.road_distance(pts[:, 0], pts[:, 1]) > keep_off_road_m)
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
            mesh.visual.vertex_colors = self._vertex_colors(flow_x, flow_z, depth_b, n)
            parts.append(mesh)

            vol_verts: list[list[float]] = []
            vol_faces: list[list[int]] = []
            vol_colors: list[list[int]] = []

            def enc_flow(ii: int, bank: int) -> list[int]:
                return [
                    int(np.clip(flow_x[ii] * 0.5 + 0.5, 0.0, 1.0) * 255),
                    int(np.clip(flow_z[ii] * 0.5 + 0.5, 0.0, 1.0) * 255),
                    depth_b,
                    bank,
                ]

            def push_quad(
                a: np.ndarray,
                b: np.ndarray,
                ya: float,
                yb: float,
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
                        [float(b[0]), yb - water_h, float(-b[1])],
                        [float(a[0]), ya - water_h, float(-a[1])],
                    ]
                )
                vol_faces.append([base, base + 1, base + 2])
                vol_faces.append([base, base + 2, base + 3])
                for bank, ii in zip((bank_a, bank_b, bank_b, bank_a), (ia, ib, ib, ia)):
                    vol_colors.append(enc_flow(ii, bank))

            for i in seg:
                push_quad(left[i], left[i + 1], float(level[i]), float(level[i + 1]), i, i + 1, 255, 255)
                push_quad(right[i + 1], right[i], float(level[i + 1]), float(level[i]), i + 1, i, 0, 0)
                base = len(vol_verts)
                lb = [
                    [float(left[i, 0]), float(level[i] - water_h), float(-left[i, 1])],
                    [float(right[i, 0]), float(level[i] - water_h), float(-right[i, 1])],
                    [float(right[i + 1, 0]), float(level[i + 1] - water_h), float(-right[i + 1, 1])],
                    [float(left[i + 1, 0]), float(level[i + 1] - water_h), float(-left[i + 1, 1])],
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

        def _merge(parts_list: list[trimesh.Trimesh]) -> trimesh.Trimesh | None:
            if not parts_list:
                return None
            out = trimesh.util.concatenate(parts_list)
            out.remove_unreferenced_vertices()
            return out

        return _merge(parts), _merge(vol_parts)
