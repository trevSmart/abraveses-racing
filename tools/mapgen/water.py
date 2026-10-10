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
# Túnel de volta: murs verticals + semicercle fins gairebé tocar el terreny del turó.
TUNNEL_THICK_M = 0.38
TUNNEL_HEAD_DEPTH_M = 0.55
TUNNEL_ARCH_SEGS = 12
TUNNEL_CEILING_CLEAR_M = 0.12
TUNNEL_CAP_WING_M = 2.4
# Sota aquesta coberta de terreny (m) no s'excava el MDT (evita el «forat» al turó).
TUNNEL_NO_CARVE_COVER_M = 1.1
TUNNEL_RGB = (156, 148, 136)
TUNNEL_FILL_RGB = (88, 112, 74)
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
        # (pts, ref, section, kind, downhill, tunnel_mask, dem_smooth_abs)
        self.lines: list[tuple[np.ndarray, np.ndarray, Section, str, bool, np.ndarray, np.ndarray]] = []
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
                pts, ref, downhill, tun, dem_s = self._profile(line, dem, origin)
                self.lines.append((pts, ref, sec, str(row.get("kind")), downhill, tun, dem_s))
                seg_rows.append((pts, ref, sec, tun, dem_s))
                if tun.any():
                    n_tunnel += 1

        if not seg_rows:
            self.tree = None
            self.reach = 0.0
            return
        p0 = np.concatenate([p[:-1] for p, _, _, _, _ in seg_rows])
        p1 = np.concatenate([p[1:] for p, _, _, _, _ in seg_rows])
        r0 = np.concatenate([r[:-1] for _, r, _, _, _ in seg_rows])
        r1 = np.concatenate([r[1:] for _, r, _, _, _ in seg_rows])
        t0 = np.concatenate([t[:-1] for _, _, _, t, _ in seg_rows]).astype(np.float64)
        t1 = np.concatenate([t[1:] for _, _, _, t, _ in seg_rows]).astype(np.float64)
        cov0 = np.concatenate([(d[:-1] - r[:-1]) for _, r, _, _, d in seg_rows])
        cov1 = np.concatenate([(d[1:] - r[1:]) for _, r, _, _, d in seg_rows])
        n = np.array([len(p) - 1 for p, _, _, _, _ in seg_rows])
        sec_cols = {
            k: np.repeat([getattr(s, k) for _, _, s, _, _ in seg_rows], n)
            for k in ("bed_m", "bank_m", "depth_m", "water_frac")
        }
        self.p0, self.p1, self.r0, self.r1 = p0, p1, r0, r1
        self.t0, self.t1 = t0, t1
        self.cov0, self.cov1 = cov0, cov1
        self.half_bed = sec_cols["bed_m"] / 2
        self.bank = sec_cols["bank_m"]
        self.depth = sec_cols["depth_m"]
        self.water_frac = sec_cols["water_frac"]
        self.water_half = np.repeat([s.water_half_m for _, _, s, _, _ in seg_rows], n)
        self.reach = float((self.half_bed + self.bank).max() + FADE_M[1])
        self.tree = shapely.STRtree(shapely.linestrings(np.stack([p0, p1], axis=1)))
        kinds = {}
        for _, _, _, kind, _, _, _ in self.lines:
            kinds[kind] = kinds.get(kind, 0) + 1
        tun_msg = f", {n_tunnel} amb túnel" if n_tunnel else ""
        print(f"Water: {len(self.lines)} cursos {kinds}, {len(p0)} trams{tun_msg}")

    @staticmethod
    def _profile(
        line: LineString, dem, origin: tuple[float, float]
    ) -> tuple[np.ndarray, np.ndarray, bool, np.ndarray, np.ndarray]:
        """Eix densificat, nivell de referència, sentit, màscara de túnel i DEM suavitzat (abs)."""
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
            return pts, ref_down, True, tun_down, smooth
        return pts, ref_down[::-1], False, tun_down[::-1], smooth[::-1]

    @staticmethod
    def _vault_wall_h(half_w: float, head_m: float) -> float:
        """Alçada de mur recte abans de la volta per omplir `head_m` fins a la clau."""
        head_m = max(head_m, half_w + 0.25)
        return max(head_m - half_w, 0.2)

    def _pairs(self, xs: np.ndarray, ys: np.ndarray):
        """Parelles (punt, tram) a menys de `reach`, amb distància, nivell, túnel i coberta."""
        pts = shapely.points(xs, ys)
        pi, si = self.tree.query(pts, predicate="dwithin", distance=self.reach)
        a, b = self.p0[si], self.p1[si]
        ab = b - a
        ap = np.column_stack([xs[pi], ys[pi]]) - a
        t = np.clip((ap * ab).sum(axis=1) / np.maximum((ab * ab).sum(axis=1), 1e-9), 0.0, 1.0)
        dist = np.linalg.norm(ap - ab * t[:, None], axis=1)
        ref = self.r0[si] + (self.r1[si] - self.r0[si]) * t
        tun = self.t0[si] + (self.t1[si] - self.t0[si]) * t
        cover = self.cov0[si] + (self.cov1[si] - self.cov0[si]) * t
        return pi, si, dist, ref, tun, cover

    def carve(self, xs: np.ndarray, ys: np.ndarray, dem_abs: np.ndarray) -> np.ndarray:
        """Quant s'ha d'enfonsar el MDT (≤ 0) a cada punt per fer-hi el llit."""
        xs = np.asarray(xs, dtype=np.float64).ravel()
        ys = np.asarray(ys, dtype=np.float64).ravel()
        out = np.zeros(xs.size)
        if self.tree is None or xs.size == 0:
            return out
        pi, si, dist, ref, tun, cover = self._pairs(xs, ys)
        if pi.size == 0:
            return out
        # Un punt pot caure a l'abast de diversos trams: només el més proper compta
        # (si no, un tram obert del vessant excavaria el crest del túnel).
        order = np.argsort(dist)
        pi, si, dist, ref, tun, cover = pi[order], si[order], dist[order], ref[order], tun[order], cover[order]
        _, first = np.unique(pi, return_index=True)
        pi, si, dist, ref, tun, cover = pi[first], si[first], dist[first], ref[first], tun[first], cover[first]
        # Sota el turó (o amb molta coberta) no s'excava: el relleu queda sòlid.
        open_ch = (tun < 0.5) & (cover < TUNNEL_NO_CARVE_COVER_M)
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
        pi, si, dist, ref, tun, _ = self._pairs(xs, ys)
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
        pi, si, dist, _, _, _ = self._pairs(xs, ys)
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
    def _vault_ring(half_w: float, wall_h: float, y0: float, n_arc: int = TUNNEL_ARCH_SEGS) -> np.ndarray:
        """Perfil (across, y): mur esquerre, volta semicircular, mur dret (obert pel terra)."""
        pts = [(-half_w, y0), (-half_w, y0 + wall_h)]
        for k in range(1, n_arc):
            ang = np.pi - k * np.pi / n_arc
            pts.append((half_w * np.cos(ang), y0 + wall_h + half_w * np.sin(ang)))
        pts.append((half_w, y0 + wall_h))
        pts.append((half_w, y0))
        return np.asarray(pts, dtype=np.float64)

    @staticmethod
    def _place_frame(
        center: np.ndarray,
        tangent: np.ndarray,
        normal: np.ndarray,
        y0: float,
        local_xy: np.ndarray,
        along: float = 0.0,
    ) -> np.ndarray:
        """(across, y_rel) → món (x, y, z=-nord)."""
        t = tangent / max(float(np.linalg.norm(tangent)), 1e-9)
        n = normal / max(float(np.linalg.norm(normal)), 1e-9)
        c = center + t * along
        out = np.empty((len(local_xy), 3))
        for i, (across, y) in enumerate(local_xy):
            p = c + n * across
            out[i] = (p[0], y0 + y, -p[1])
        return out

    @staticmethod
    def _tunnel_headwall(
        center: np.ndarray,
        tangent: np.ndarray,
        normal: np.ndarray,
        y0: float,
        half_w: float,
        head_rel: float,
        outward: float,
    ) -> trimesh.Trimesh:
        """Mur de boca: rectangle amb forat de murs rectes + volta rodona."""
        from shapely.geometry import Polygon

        thick = TUNNEL_THICK_M
        wall_h = Waterways._vault_wall_h(half_w, head_rel)
        opening = Waterways._vault_ring(half_w, wall_h, 0.0)
        # Tanca el forat pel terra (CCW del forat = horari respecte el rectangle → forat).
        hole = np.vstack([opening, [half_w, 0.0], [-half_w, 0.0]])
        crown = wall_h + half_w + thick * 0.6
        wing = half_w + thick + 0.4
        rect = [(-wing, -0.1), (wing, -0.1), (wing, crown), (-wing, crown)]
        poly = Polygon(rect, [hole[::-1].tolist()])
        if not poly.is_valid or poly.area < 1e-3:
            poly = Polygon(rect)
        # Extrusió local en +Z; després mapeja X→across, Y→up, Z→along (cap a fora).
        slab = trimesh.creation.extrude_polygon(poly, TUNNEL_HEAD_DEPTH_M)
        t = tangent / max(float(np.linalg.norm(tangent)), 1e-9)
        n = normal / max(float(np.linalg.norm(normal)), 1e-9)
        # La cara z=0 del slab queda a la boca; z>0 cap a dins del mur (cap enfora del tub).
        out_dir = t * outward
        # Origen: lleugerament cap a fora del primer anell del tub.
        origin = center + out_dir * 0.05
        # Transforma vèrtexs locals (x,y,z) → origin + n*x + up*y + out_dir*z
        loc = np.asarray(slab.vertices, dtype=np.float64)
        world = np.column_stack(
            [
                origin[0] + n[0] * loc[:, 0] + out_dir[0] * loc[:, 2],
                y0 + loc[:, 1],
                -origin[1] - n[1] * loc[:, 0] - out_dir[1] * loc[:, 2],
            ]
        )
        slab.vertices = world
        slab.visual.vertex_colors = np.tile([*TUNNEL_RGB, 255], (len(world), 1)).astype(np.uint8)
        return slab

    @staticmethod
    def _tunnel_backfill(
        pts: np.ndarray,
        idx: np.ndarray,
        tangent: np.ndarray,
        normal: np.ndarray,
        bed_y: np.ndarray,
        dem_y: np.ndarray,
        half_w: float,
    ) -> trimesh.Trimesh | None:
        """Terra sòlida entre la volta exterior i la superfície del turó (tapa el buit)."""
        thick = TUNNEL_THICK_M
        verts: list[list[float]] = []
        faces: list[list[int]] = []

        def outer_local(i: int) -> np.ndarray:
            head = float(dem_y[i] - bed_y[i] - TUNNEL_CEILING_CLEAR_M)
            wh = Waterways._vault_wall_h(half_w, head)
            return Waterways._vault_ring(half_w + thick, wh, -0.05)

        def place(i: int, ring: np.ndarray) -> np.ndarray:
            return Waterways._place_frame(pts[i], tangent[i], normal[i], float(bed_y[i]), ring)

        wing = half_w + TUNNEL_CAP_WING_M
        for i in idx:
            ii = int(i)
            ring = outer_local(ii)
            cap_y = float(dem_y[ii] - bed_y[ii]) - 0.08
            cap_l = Waterways._place_frame(
                pts[ii], tangent[ii], normal[ii], float(bed_y[ii]), np.array([(-wing, cap_y), (wing, cap_y)])
            )
            ring_w = place(ii, ring)
            base_r = len(verts)
            verts.extend(ring_w.tolist())
            cl, cr = len(verts), len(verts) + 1
            verts.extend(cap_l.tolist())
            for k in range(len(ring) - 1):
                faces.append([cl, base_r + k, base_r + k + 1])
            faces.append([cr, base_r + len(ring) - 1, base_r])

        if not faces:
            return None
        mesh = trimesh.Trimesh(
            vertices=np.asarray(verts, dtype=np.float64),
            faces=np.asarray(faces, dtype=np.int64),
            process=False,
        )
        mesh.visual.vertex_colors = np.tile([*TUNNEL_FILL_RGB, 255], (len(mesh.vertices), 1)).astype(np.uint8)
        return mesh

    @staticmethod
    def _tunnel_structure(
        pts: np.ndarray,
        tun: np.ndarray,
        tangent: np.ndarray,
        normal: np.ndarray,
        bed_y: np.ndarray,
        dem_abs: np.ndarray,
        z_min: float,
        half_w: float,
    ) -> tuple[trimesh.Trimesh | None, trimesh.Trimesh | None]:
        """Pedra (interior + parament) i farciment de terra fins al terreny."""
        idx = np.flatnonzero(tun)
        if idx.size < 2:
            return None, None
        dem_y = dem_abs - z_min
        head_rel = dem_y - bed_y - TUNNEL_CEILING_CLEAR_M
        thick = TUNNEL_THICK_M
        verts: list[list[float]] = []
        faces: list[list[int]] = []

        def inner_local(i: int) -> np.ndarray:
            wh = Waterways._vault_wall_h(half_w, float(head_rel[i]))
            return Waterways._vault_ring(half_w, wh, 0.0)

        def outer_local(i: int) -> np.ndarray:
            wh = Waterways._vault_wall_h(half_w, float(head_rel[i]))
            return Waterways._vault_ring(half_w + thick, wh, -0.05)

        def place(i: int, ring: np.ndarray) -> np.ndarray:
            return Waterways._place_frame(pts[i], tangent[i], normal[i], float(bed_y[i]), ring)

        def add_strip(ra: np.ndarray, rb: np.ndarray, flip: bool) -> None:
            base = len(verts)
            verts.extend(ra.tolist())
            verts.extend(rb.tolist())
            m = len(ra)
            for k in range(m - 1):
                i0, i1 = base + k, base + k + 1
                j0, j1 = base + m + k, base + m + k + 1
                if flip:
                    faces.append([i0, j0, j1])
                    faces.append([i0, j1, i1])
                else:
                    faces.append([i0, i1, j1])
                    faces.append([i0, j1, j0])

        for a, b in zip(idx[:-1], idx[1:]):
            ia, ib = int(a), int(b)
            inner_a, inner_b = place(ia, inner_local(ia)), place(ib, inner_local(ib))
            outer_a, outer_b = place(ia, outer_local(ia)), place(ib, outer_local(ib))
            add_strip(inner_a, inner_b, flip=True)
            add_strip(outer_b, outer_a, flip=False)
            for ring_in, ring_out in ((inner_a, outer_a), (inner_b, outer_b)):
                for k in range(len(ring_in) - 1):
                    base = len(verts)
                    verts.extend(
                        [
                            ring_in[k].tolist(),
                            ring_in[k + 1].tolist(),
                            ring_out[k + 1].tolist(),
                            ring_out[k].tolist(),
                        ]
                    )
                    faces.append([base, base + 1, base + 2])
                    faces.append([base, base + 2, base + 3])

        stone: trimesh.Trimesh | None = None
        if faces:
            stone = trimesh.Trimesh(
                vertices=np.asarray(verts, dtype=np.float64),
                faces=np.asarray(faces, dtype=np.int64),
                process=False,
            )
            stone.visual.vertex_colors = np.tile([*TUNNEL_RGB, 255], (len(stone.vertices), 1)).astype(np.uint8)

        fill = Waterways._tunnel_backfill(pts, idx, tangent, normal, bed_y, dem_y, half_w)

        headwalls: list[trimesh.Trimesh] = []
        for mi, outward in ((int(idx[0]), -1.0), (int(idx[-1]), 1.0)):
            headwalls.append(
                Waterways._tunnel_headwall(
                    pts[mi],
                    tangent[mi],
                    normal[mi],
                    float(bed_y[mi]),
                    half_w,
                    float(head_rel[mi]),
                    outward,
                )
            )
        if stone is not None:
            stone = trimesh.util.concatenate([stone, *headwalls])
            stone.remove_unreferenced_vertices()
        elif headwalls:
            stone = trimesh.util.concatenate(headwalls)

        return stone, fill

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
    ) -> tuple[
        trimesh.Trimesh | None,
        trimesh.Trimesh | None,
        trimesh.Trimesh | None,
        trimesh.Trimesh | None,
        trimesh.Trimesh | None,
    ]:
        """Superfície, volum, pedra del túnel, farciment del turó i còdols."""
        parts: list[trimesh.Trimesh] = []
        vol_parts: list[trimesh.Trimesh] = []
        tunnel_parts: list[trimesh.Trimesh] = []
        fill_parts: list[trimesh.Trimesh] = []
        cobble_parts: list[trimesh.Trimesh] = []
        for pts, ref, sec, _, downhill, tun, dem_s in self.lines:
            sign = 1.0 if downhill else -1.0
            tangent = np.gradient(pts, axis=0)
            tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
            flow_x = sign * tangent[:, 0]
            flow_z = -sign * tangent[:, 1]
            flow_len = np.maximum(np.hypot(flow_x, flow_z), 1e-9)
            flow_x /= flow_len
            flow_z /= flow_len
            normal = np.column_stack([-tangent[:, 1], tangent[:, 0]])
            tunnel_half = max(0.85, sec.bed_m * 0.5 + 0.35)
            half_w = np.where(tun, tunnel_half * 0.92, sec.water_half_m)
            left = pts + normal * half_w[:, None]
            right = pts - normal * half_w[:, None]
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
                in_tunnel = bool(tun[i] and tun[i + 1])
                if not in_tunnel:
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

            if tun.any():
                stone, fill = self._tunnel_structure(
                    pts, tun & ok, tangent, normal, bed, dem_s, z_min, float(tunnel_half)
                )
                if stone is not None:
                    tunnel_parts.append(stone)
                if fill is not None:
                    fill_parts.append(fill)
                cobbles = self._cobble_bed(
                    pts,
                    tun & ok,
                    tangent,
                    normal,
                    tunnel_half * 0.92,
                    bed,
                    seed=int(abs(pts[0, 0]) * 10) % 10_000,
                )
                if cobbles is not None:
                    cobble_parts.append(cobbles)

        def _merge(parts_list: list[trimesh.Trimesh]) -> trimesh.Trimesh | None:
            if not parts_list:
                return None
            out = trimesh.util.concatenate(parts_list)
            out.remove_unreferenced_vertices()
            return out

        return (
            _merge(parts),
            _merge(vol_parts),
            _merge(tunnel_parts),
            _merge(fill_parts),
            _merge(cobble_parts),
        )
