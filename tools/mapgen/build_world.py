"""Build terrain, roads, buildings and export world.glb + heightmap."""

from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
import shapely
import trimesh
from PIL import Image
from scipy import ndimage
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.config import ensure_parent, load_config, utm_origin, wgs84_to_utm  # noqa: E402


class DemSampler:
    """Interpolació bilineal del MDT (src.sample() és nearest i fa graons de 5 m)."""

    def __init__(self, dem_path: Path) -> None:
        with rasterio.open(dem_path) as src:
            data = src.read(1).astype(np.float64)
            self.inv = ~src.transform
        # El MDT reprojectat té cel·les a 0 sense marcar com a nodata.
        bad = ~np.isfinite(data) | (data <= 0)
        if bad.all():
            raise RuntimeError("DEM has no valid elevations")
        if bad.any():
            idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
            data = data[tuple(idx)]
        self.data = data

    def __call__(self, x: np.ndarray | float, y: np.ndarray | float) -> np.ndarray:
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        inv = self.inv
        col = inv.a * x + inv.b * y + inv.c
        row = inv.d * x + inv.e * y + inv.f
        coords = np.vstack([row.ravel() - 0.5, col.ravel() - 0.5])
        vals = ndimage.map_coordinates(self.data, coords, order=1, mode="nearest")
        return vals.reshape(x.shape)


class Ground:
    """Alçada local del terreny: MDT + elevació fora dels camins (els carrers queden en una pista enfonsada)."""

    def __init__(
        self,
        dem: DemSampler,
        ox: float,
        oy: float,
        z_min: float,
        road_polys: list[Polygon],
        cfg: dict,
    ) -> None:
        self.dem = dem
        self.ox = ox
        self.oy = oy
        self.z_min = z_min
        self.road_polys = road_polys
        self.tree = shapely.STRtree(road_polys) if road_polys else None
        self.raise_m = float(cfg.get("offroad_raise_m", 0.5))
        self.margin_m = float(cfg.get("offroad_margin_m", 0.8))
        self.ramp_m = float(cfg.get("offroad_ramp_m", 1.2))

    def road_distance(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        xs = np.asarray(xs, dtype=np.float64)
        ys = np.asarray(ys, dtype=np.float64)
        dist = np.full(xs.size, np.inf)
        if self.tree is None:
            return dist.reshape(xs.shape)
        pts = shapely.points(xs.ravel(), ys.ravel())
        idx, d = self.tree.query_nearest(pts, return_distance=True, all_matches=False)
        dist[idx[0]] = d
        return dist.reshape(xs.shape)

    def offroad_raise(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        # Sota la carretera el terreny baixa una mica perquè no faci z-fighting amb la calçada.
        t = np.clip((self.road_distance(xs, ys) - self.margin_m) / self.ramp_m, 0.0, 1.0)
        return -0.08 + (self.raise_m + 0.08) * t

    def height(self, xs: np.ndarray | float, ys: np.ndarray | float, raised: bool = True) -> np.ndarray:
        xs = np.asarray(xs, dtype=np.float64)
        ys = np.asarray(ys, dtype=np.float64)
        h = self.dem(self.ox + xs, self.oy + ys) - self.z_min
        if raised:
            h = h + self.offroad_raise(xs, ys)
        return h


def _sanitize_vertices(mesh: trimesh.Trimesh) -> None:
    v = mesh.vertices
    ok = np.isfinite(v).all(axis=1)
    if ok.all():
        return
    fill = float(np.nanmin(v[np.isfinite(v)])) if np.any(np.isfinite(v)) else 0.0
    bad = ~ok
    v[bad] = fill
    mesh.vertices = v


def _grid(size: float, res: int) -> tuple[np.ndarray, np.ndarray]:
    half = size / 2.0
    lin = np.linspace(-half, half, res)
    return np.meshgrid(lin, lin)


def _build_heightmap(cfg: dict, dem: DemSampler) -> dict:
    ox, oy = utm_origin(cfg)
    size = float(cfg["terrain_size_m"])
    res = int(cfg["terrain_resolution"])
    gx, gy = _grid(size, res)
    elev = dem(ox + gx, oy + gy)
    z_min = float(elev.min())
    z_max = float(elev.max())
    z_range = max(z_max - z_min, 1.0)
    norm = (elev - z_min) / z_range
    img16 = (norm * 65535.0).astype(np.uint16)
    height_path = ensure_parent(cfg["paths"]["heightmap_png"])
    Image.fromarray(img16).save(height_path)

    meta = {
        "utm_epsg": cfg["utm_epsg"],
        "origin_utm_x": ox,
        "origin_utm_y": oy,
        "size_m": size,
        "resolution": res,
        "elevation_min_m": z_min,
        "elevation_max_m": z_max,
        "elevation_range_m": z_range,
    }
    meta_path = ensure_parent(cfg["paths"]["world_meta_json"])
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    assets_dir = Path(cfg["paths"]["world_glb"]).parent
    assets_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(height_path, assets_dir / "heightmap.png")
    shutil.copy(meta_path, assets_dir / "world_meta.json")
    print(f"Heightmap → {height_path}")
    return meta


def _terrain_mesh(ground: Ground, meta: dict, res: int) -> trimesh.Trimesh:
    gx, gy = _grid(float(meta["size_m"]), res)
    z = ground.height(gx, gy)
    vertices = np.column_stack([gx.ravel(), z.ravel(), -gy.ravel()])
    j, i = np.meshgrid(np.arange(res - 1), np.arange(res - 1), indexing="ij")
    a = (j * res + i).ravel()
    b = a + 1
    c = a + res
    d = c + 1
    # Ordre antihorari vist des de dalt (+Y) un cop invertit l'eix Z.
    faces = np.concatenate([np.column_stack([a, b, c]), np.column_stack([b, d, c])])
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh.visual.face_colors = [255, 255, 255, 255]
    return mesh


def _terrain_tiles(ground: Ground, meta: dict, res: int, tiles: int) -> list[tuple[str, trimesh.Trimesh]]:
    """Terreny partit en tiles×tiles trossos perquè el joc en pugui descartar els que queden
    fora de càmera. Les normals es calculen sobre la malla sencera: sense costures de llum."""
    full = _terrain_mesh(ground, meta, res)
    _sanitize_vertices(full)
    normals = full.vertex_normals
    verts = full.vertices
    cells = res - 1
    bounds = np.linspace(0, cells, tiles + 1).round().astype(int)
    out = []
    for tj in range(tiles):
        for ti in range(tiles):
            i0, i1 = bounds[ti], bounds[ti + 1]
            j0, j1 = bounds[tj], bounds[tj + 1]
            cols = np.arange(i0, i1 + 1)
            rows = np.arange(j0, j1 + 1)
            idx = (rows[:, None] * res + cols[None, :]).ravel()
            w = len(cols)
            jj, ii = np.meshgrid(np.arange(len(rows) - 1), np.arange(w - 1), indexing="ij")
            a = (jj * w + ii).ravel()
            b, c = a + 1, a + w
            d = c + 1
            faces = np.concatenate([np.column_stack([a, b, c]), np.column_stack([b, d, c])])
            tile = trimesh.Trimesh(vertices=verts[idx], faces=faces, process=False)
            tile.vertex_normals = normals[idx]
            out.append((f"terrain_{ti}_{tj}", tile))
    return out


def _apply_terrain_uv(mesh: trimesh.Trimesh, meta: dict) -> None:
    """UVs + tiny placeholder — real satellite stays at web/public/terrain.jpg."""
    half = float(meta["size_m"]) / 2.0
    v = mesh.vertices
    u = np.clip((v[:, 0] + half) / meta["size_m"], 0.0, 1.0)
    vv = np.clip((-v[:, 2] + half) / meta["size_m"], 0.0, 1.0)
    placeholder = Image.new("RGB", (4, 4), (240, 240, 235))
    mesh.visual = trimesh.visual.TextureVisuals(
        uv=np.column_stack([u, vv]),
        image=placeholder,
    )


def _is_green_row(row: dict) -> bool:
    landuse = row.get("landuse")
    leisure = row.get("leisure")
    natural = row.get("natural")
    if landuse in {"grass", "meadow", "forest", "orchard", "vineyard", "farmland"}:
        return True
    if leisure in {"park", "garden", "pitch", "playground", "recreation_ground"}:
        return True
    if natural in {"wood", "scrub", "grassland", "tree_row"}:
        return True
    return False


def _green_meshes(gdf: gpd.GeoDataFrame, ground: Ground, exclude=None) -> list[trimesh.Trimesh]:
    meshes: list[trimesh.Trimesh] = []
    # Les lloses verdes no poden tapar la calçada: hi retallem els camins i el talús,
    # i la zona de detall del poble, que ja té parcel·les i arbres reals.
    cutout = unary_union(ground.road_polys).buffer(ground.margin_m) if ground.road_polys else None
    if exclude is not None:
        cutout = exclude if cutout is None else cutout.union(exclude)
    for _, row in gdf.iterrows():
        if not _is_green_row(row.to_dict()):
            continue
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        if cutout is not None:
            geom = geom.difference(cutout)
        for poly in _iter_polygons(geom):
            if poly.area < 8.0:
                continue
            base_local = float(ground.height(poly.centroid.x, poly.centroid.y)) + 0.05
            mesh = _shapely_to_y_up_mesh(poly, height=0.18, base_y=base_local)
            if not mesh:
                continue
            tag = row.get("leisure") or row.get("landuse") or row.get("natural") or "green"
            if tag in {"forest", "wood", "scrub"} or row.get("landuse") == "forest":
                color = [72, 168, 88, 255]
            elif tag in {"pitch", "playground"}:
                color = [92, 178, 98, 255]
            else:
                color = [98, 192, 78, 255]
            mesh.visual.face_colors = color
            meshes.append(mesh)
    return meshes


def _cartoon_building_colors(mesh: trimesh.Trimesh, height: float, base_y: float, seed: float) -> None:
    wall_palette = [(248, 238, 224), (235, 225, 208), (252, 244, 232), (228, 218, 200)]
    roof_palette = [(204, 96, 68), (186, 78, 54), (168, 62, 48), (220, 118, 82)]
    wi = int(abs(seed * 991.0)) % len(wall_palette)
    ri = int(abs(seed * 577.0)) % len(roof_palette)
    wall = wall_palette[wi]
    roof = roof_palette[ri]
    v = mesh.vertices
    fc = np.zeros((len(mesh.faces), 4), dtype=np.uint8)
    for i, face in enumerate(mesh.faces):
        cy = float(v[face, 1].mean())
        rel = (cy - base_y) / max(height, 0.5)
        if rel > 0.78:
            fc[i] = (*roof, 255)
        elif rel > 0.06:
            fc[i] = (*wall, 255)
        else:
            fc[i] = (int(wall[0] * 0.82), int(wall[1] * 0.82), int(wall[2] * 0.82), 255)
    mesh.visual.face_colors = fc


def _scatter_trees(gdf: gpd.GeoDataFrame, cfg: dict, ground: Ground, exclude=None) -> list[list[float]]:
    rng = random.Random(42)
    polys: list[Polygon] = []
    for _, row in gdf.iterrows():
        if not _is_green_row(row.to_dict()):
            continue
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        if isinstance(geom, Polygon):
            polys.append(geom)
        else:
            polys.extend(g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon))
    if not polys:
        return []

    trees: list[list[float]] = []
    max_trees = int(cfg.get("tree_max_count", 650))
    for poly in polys:
        if poly.area < 12.0:
            continue
        minx, miny, maxx, maxy = poly.bounds
        density = 28.0 if poly.area > 400 else 40.0
        target = min(int(poly.area / density), 48)
        placed = 0
        attempts = 0
        while placed < target and attempts < target * 12 and len(trees) < max_trees:
            attempts += 1
            px = rng.uniform(minx, maxx)
            py = rng.uniform(miny, maxy)
            if not poly.contains(Point(px, py)):
                continue
            # Cap arbre enmig de la calçada ni a la zona de detall (hi ha els arbres reals).
            if float(ground.road_distance(np.array([px]), np.array([py]))[0]) < 1.5:
                continue
            if exclude is not None and exclude.contains(Point(px, py)):
                continue
            y = float(ground.height(px, py)) + 0.05
            scale = rng.uniform(0.75, 1.35)
            trees.append([float(px), y, float(-py), scale])
            placed += 1
    return trees


def _write_trees(cfg: dict, trees: list[list[float]]) -> None:
    path = ensure_parent(cfg["paths"]["trees_json"])
    with path.open("w", encoding="utf-8") as f:
        json.dump({"trees": trees}, f)
    print(f"Trees → {path} ({len(trees)} instances)")


def _write_streets(cfg: dict, gdf: gpd.GeoDataFrame) -> None:
    """Polilínies en coordenades locals (x, z): `streets` (amb nom, per al minimapa i el rètol)
    i `roads` (totes les vies, per al graf de l'autopilot; comparteixen vèrtexs a les cruïlles)."""
    streets: list[dict] = []
    roads: list[list[list[float]]] = []
    if "highway" in gdf.columns:
        for _, row in gdf[gdf["highway"].notna()].iterrows():
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue
            lines = [geom] if isinstance(geom, LineString) else list(getattr(geom, "geoms", []))
            name = row.get("name")
            for line in lines:
                if not isinstance(line, LineString) or line.length < 0.5:
                    continue
                points = [[round(x, 2), round(-y, 2)] for x, y in line.coords]
                roads.append(points)
                if isinstance(name, str) and name and line.length >= 10.0:
                    streets.append({"name": name, "points": points})
    path = ensure_parent(cfg["paths"].get("streets_json", "web/public/streets.json"))
    with path.open("w", encoding="utf-8") as f:
        json.dump({"streets": streets, "roads": roads}, f, ensure_ascii=False)
    print(f"Streets → {path} ({len(streets)} named, {len(roads)} road polylines)")


def _road_width(cfg: dict, props: dict) -> float:
    hw = props.get("highway", "default")
    table = cfg.get("road_width_by_highway", {})
    return float(table.get(hw, table.get("default", 5.5)))


def _building_height(cfg: dict, props: dict) -> float:
    if "height" in props:
        try:
            return float(str(props["height"]).replace("m", "").strip())
        except ValueError:
            pass
    levels = props.get("building:levels")
    if levels:
        try:
            return float(levels) * float(cfg.get("building_level_height_m", 3.0))
        except ValueError:
            pass
    return float(cfg.get("building_default_height_m", 6.0))


def _local_geom(gdf: gpd.GeoDataFrame, ox: float, oy: float) -> gpd.GeoDataFrame:
    gdf = gdf.to_crs(epsg=25830).copy()
    gdf["geometry"] = gdf.geometry.apply(lambda g: affinity.translate(g, xoff=-ox, yoff=-oy))
    return gdf


def _shapely_to_y_up_mesh(poly: Polygon, height: float, base_y: float) -> trimesh.Trimesh | None:
    if poly.is_empty:
        return None
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty:
        return None

    def to_footprint_2d(p: Polygon) -> Polygon:
        ext = [(x, -y) for x, y in p.exterior.coords]
        holes = [[(x, -y) for x, y in ring.coords] for ring in p.interiors]
        return Polygon(ext, holes)

    poly2d = to_footprint_2d(poly)
    mesh = trimesh.creation.extrude_polygon(poly2d, height=height)
    v = mesh.vertices
    mesh.vertices = np.column_stack([v[:, 0], v[:, 2] + base_y, v[:, 1]])
    return mesh


def _road_polygons(gdf: gpd.GeoDataFrame, cfg: dict) -> list[Polygon]:
    if "highway" not in gdf.columns:
        return []
    polys: list[Polygon] = []
    for _, row in gdf[gdf["highway"].notna()].iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        lines = [geom] if isinstance(geom, LineString) else list(getattr(geom, "geoms", []))
        width = _road_width(cfg, row.to_dict())
        for line in lines:
            if not isinstance(line, LineString) or line.length < 1.0:
                continue
            buffered = line.buffer(width / 2.0)
            polys.extend(p for p in getattr(buffered, "geoms", [buffered]) if not p.is_empty)
    return polys


def _iter_polygons(geom) -> list[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    out: list[Polygon] = []
    for g in getattr(geom, "geoms", []):
        out.extend(_iter_polygons(g))
    return out


def _road_meshes(ground: Ground, meta: dict, tile_m: float = 100.0) -> list[tuple[str, trimesh.Trimesh]]:
    """Calçada enganxada al relleu, partida en rajoles perquè el raycast descarti per bounding sphere."""
    if not ground.road_polys:
        return []
    union = unary_union(ground.road_polys)
    half = float(meta["size_m"]) / 2.0
    edges = np.arange(-half, half, tile_m)
    out: list[tuple[str, trimesh.Trimesh]] = []
    for ti, tx in enumerate(edges):
        for tj, ty in enumerate(edges):
            piece = union.intersection(box(tx, ty, min(tx + tile_m, half), min(ty + tile_m, half)))
            parts: list[trimesh.Trimesh] = []
            for poly in _iter_polygons(piece):
                if poly.area < 0.5:
                    continue
                # Vores densificades: els triangles creuen la calçada i segueixen el relleu
                # sense omplir l'interior de vèrtexs.
                v2, f = trimesh.creation.triangulate_polygon(shapely.segmentize(poly, 2.5))
                v3 = np.column_stack([v2, np.zeros(len(v2))])
                v3, f = trimesh.remesh.subdivide_to_size(v3, f, max_edge=10.0)
                h = ground.height(v3[:, 0], v3[:, 1], raised=False) + 0.03
                verts = np.column_stack([v3[:, 0], h, -v3[:, 1]])
                mesh = trimesh.Trimesh(vertices=verts, faces=f, process=False)
                if mesh.face_normals[:, 1].mean() < 0:
                    mesh.invert()
                parts.append(mesh)
            if parts:
                mesh = trimesh.util.concatenate(parts)
                mesh.visual.face_colors = [70, 70, 75, 255]
                out.append((f"road_{ti}_{tj}", mesh))
    return out


def _building_meshes(gdf: gpd.GeoDataFrame, cfg: dict, ground: Ground) -> list[trimesh.Trimesh]:
    if "building" not in gdf.columns:
        return []
    bldg = gdf[gdf["building"].notna()]
    meshes: list[trimesh.Trimesh] = []
    for _, row in bldg.iterrows():
        props = {k: v for k, v in row.items() if k != "geometry" and isinstance(v, (str, int, float))}
        height = _building_height(cfg, props)
        geom = row.geometry
        geoms = [geom] if isinstance(geom, Polygon) else list(getattr(geom, "geoms", []))
        for poly in geoms:
            if not isinstance(poly, Polygon):
                continue
            base_local = float(ground.height(poly.centroid.x, poly.centroid.y))
            mesh = _shapely_to_y_up_mesh(poly, height=height, base_y=base_local)
            if mesh:
                seed = poly.centroid.x * 0.017 + poly.centroid.y * 0.023
                _cartoon_building_colors(mesh, height, base_local, seed)
                meshes.append(mesh)
    return meshes


def _write_spawn(cfg: dict, meta: dict, ground: Ground) -> None:
    spawn = cfg["spawn_wgs84"]
    sx, sy = wgs84_to_utm(cfg, spawn["lon"], spawn["lat"])
    lx = sx - meta["origin_utm_x"]
    ly = sy - meta["origin_utm_y"]
    local = {
        "position": {
            "x": lx,
            "y": float(ground.height(lx, ly, raised=False)) + 1.0,
            "z": -ly,
        },
        "rotation_y_deg": float(spawn.get("heading_deg", 0)),
    }
    path = ensure_parent(cfg["paths"]["spawn_json"])
    with path.open("w", encoding="utf-8") as f:
        json.dump(local, f, indent=2)
    print(f"Spawn → {path}")


def _build_village(cfg: dict, ground: Ground, ox: float, oy: float):
    """Cases, tàpies, arbres i horts reals als carrers de detall (Cadastre + ortofoto)."""
    from village import Ortho, build_village

    cad = Path(cfg["paths"].get("cadastre_dir", ""))
    ortho_path = Path(cfg["paths"]["ortho_jpg"])
    if not cfg.get("village_detail") or not (cad / "BuildingPart.gml").is_file() or not ortho_path.is_file():
        print("Village: sense dades del Cadastre o ortofoto; executa fetch_cadastre.py i fetch_ortho.py")
        return None
    ortho = Ortho.load(ortho_path, float(cfg["terrain_size_m"]))
    village = build_village(cfg, ground, ortho, ground.road_polys, ox, oy)
    path = ensure_parent(cfg["paths"]["village_json"])
    with path.open("w", encoding="utf-8") as f:
        json.dump({"trees": village.trees, "plants": village.plants, "parcels": village.parcels}, f)
    print(f"Village → {path}")
    return village


def build_world(use_blender: bool = False) -> Path:
    cfg = load_config()
    dem_path = Path(cfg["paths"]["dem_tif"])
    osm_path = Path(cfg["paths"]["osm_geojson"])
    if not dem_path.is_file():
        raise FileNotFoundError(f"Missing DEM: {dem_path}. Run fetch_dem.py first.")
    if not osm_path.is_file():
        raise FileNotFoundError(f"Missing OSM: {osm_path}. Run fetch_osm.py first.")

    dem = DemSampler(dem_path)
    meta = _build_heightmap(cfg, dem)
    ox, oy = meta["origin_utm_x"], meta["origin_utm_y"]

    gdf = gpd.read_file(osm_path)
    gdf = _local_geom(gdf, ox, oy)
    # Retalla l'OSM al quadrat del terreny: fora del DEM l'altura és nodata i
    # els camps de conreu poden fer quilòmetres.
    half = float(meta["size_m"]) / 2.0
    gdf = gpd.clip(gdf, box(-half, -half, half, half))

    ground = Ground(dem, ox, oy, meta["elevation_min_m"], _road_polygons(gdf, cfg), cfg)

    mesh_res = int(cfg.get("terrain_mesh_resolution", cfg["terrain_resolution"]))
    # Les UV del terreny les calcula el joc (projecció planar de l'ortofoto).
    terrain_tiles = _terrain_tiles(ground, meta, mesh_res, int(cfg.get("terrain_tiles", 8)))

    _write_streets(cfg, gdf)
    village = _build_village(cfg, ground, ox, oy)
    zone = village.zone if village else None
    road_parts = _road_meshes(ground, meta)
    green_parts = _green_meshes(gdf, ground, exclude=zone)
    building_parts = _building_meshes(gdf if zone is None else gdf[~gdf.intersects(zone)], cfg, ground)
    _write_trees(cfg, _scatter_trees(gdf, cfg, ground, exclude=zone))

    scene = trimesh.Scene()
    for name, tile in terrain_tiles:
        scene.add_geometry(tile, geom_name=name)
    if green_parts:
        greens = trimesh.util.concatenate(green_parts)
        _sanitize_vertices(greens)
        greens.fix_normals()
        scene.add_geometry(greens, geom_name="greens")
    for name, mesh in road_parts:
        scene.add_geometry(mesh, geom_name=name)
    for name, mesh in village.meshes if village else []:
        scene.add_geometry(mesh, geom_name=name)
    if building_parts:
        buildings = trimesh.util.concatenate(building_parts)
        _sanitize_vertices(buildings)
        buildings.fix_normals()
        scene.add_geometry(buildings, geom_name="buildings")

    out_glb = ensure_parent(cfg["paths"]["world_glb"])
    scene.export(out_glb, include_normals=True)
    total_verts = sum(
        len(g.vertices) for g in scene.geometry.values() if hasattr(g, "vertices")
    )
    print(
        f"Exported {out_glb} ({total_verts} verts, terrain {mesh_res}² en {len(terrain_tiles)} trossos, "
        f"{len(road_parts)} road tiles, greens, buildings)"
    )

    out_obj = cfg["paths"].get("world_obj")
    if out_obj:
        merged = trimesh.util.concatenate(list(scene.geometry.values()))
        out_obj_path = ensure_parent(out_obj)
        plain = trimesh.Trimesh(vertices=merged.vertices, faces=merged.faces, process=False)
        plain.fix_normals()
        plain.export(out_obj_path, include_normals=True)
        print(f"Exported {out_obj_path}")

    _write_spawn(cfg, meta, ground)

    if use_blender:
        script = Path(__file__).parent / "blender_export_world.py"
        subprocess.run(
            ["blender", "--background", "--python", str(script), "--", str(out_glb)],
            check=False,
        )
    return out_glb


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="Run fetch_osm, fetch_dem, then build")
    parser.add_argument("--blender", action="store_true", help="Re-open glb in Blender (optional)")
    args = parser.parse_args()
    if args.all:
        from fetch_cadastre import fetch_cadastre  # noqa: WPS433
        from fetch_dem import fetch_dem  # noqa: WPS433
        from fetch_ortho import fetch_ortho  # noqa: WPS433
        from fetch_osm import fetch_osm  # noqa: WPS433

        fetch_osm()
        fetch_dem()
        fetch_ortho()
        fetch_cadastre()
    build_world(use_blender=args.blender)


if __name__ == "__main__":
    main()
