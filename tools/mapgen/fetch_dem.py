"""Fetch or clip DEM for the configured bbox."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.config import ensure_parent, load_config, utm_origin  # noqa: E402


def _copernicus_urls(lat: float, lon: float) -> list[str]:
    lat_int = int(np.floor(lat)) if lat >= 0 else int(np.ceil(lat) - 1)
    if lon >= 0:
        lon_tag = f"E{int(np.floor(lon)):03d}_00"
    else:
        # Tile W006 covers 6°W–5°W for lon ≈ -5.9
        lon_tag = f"W{int(np.ceil(abs(lon))):03d}_00"
    hemi = "N" if lat >= 0 else "S"
    # El COG és dins d'una carpeta amb el mateix nom, sense el .tif.
    folder = f"Copernicus_DSM_COG_10_{hemi}{abs(lat_int):02d}_00_{lon_tag}_DEM"
    name = f"{folder}.tif"
    return [
        f"https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/{folder}/{name}",
        f"https://copernicus-dem-30m.s3.amazonaws.com/{folder}/{name}",
    ]


def _write_synthetic_dem(cfg: dict, out_path: Path) -> Path:
    """DEM in UTM when remote tiles are unavailable (approx. hamlet altitude)."""
    from rasterio.transform import from_bounds

    ox, oy = utm_origin(cfg)
    half = float(cfg["terrain_size_m"]) / 2.0
    width, height = 512, 512
    base = 718.0
    xs = np.linspace(-half, half, width)
    ys = np.linspace(-half, half, height)
    gx, gy = np.meshgrid(xs, ys)
    # Gentle fictional relief so driving is not a perfect plane
    relief = 2.5 * np.sin(gx / 80.0) * np.cos(gy / 95.0)
    data = (base + relief).astype(np.float32)[np.newaxis, ...]
    transform = from_bounds(ox - half, oy - half, ox + half, oy + half, width, height)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        out_path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=1,
        dtype="float32",
        crs=f"EPSG:{cfg['utm_epsg']}",
        transform=transform,
    ) as dst:
        dst.write(data)
    print(f"WARNING: using synthetic UTM DEM (~{base} m) → {out_path}")
    return out_path


def _utm_bounds(cfg: dict) -> tuple[float, float, float, float]:
    """Envolupant UTM del bbox WGS84 (les quatre cantonades)."""
    bbox = cfg["bbox_wgs84"]
    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{cfg['utm_epsg']}", always_xy=True)
    xs: list[float] = []
    ys: list[float] = []
    for lon, lat in (
        (bbox["west"], bbox["south"]),
        (bbox["east"], bbox["south"]),
        (bbox["west"], bbox["north"]),
        (bbox["east"], bbox["north"]),
    ):
        x, y = transformer.transform(lon, lat)
        xs.append(x)
        ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def _next_lon_tile(lon: float) -> float:
    """Límit est de la tessel·la Copernicus d'1° que conté `lon`."""
    if lon >= 0:
        return float(np.floor(lon) + 1)
    return float(-(np.ceil(abs(lon)) - 1))


def _copernicus_tile_groups(bbox: dict) -> list[list[str]]:
    """Mirrors de cada tessel·la GLO-30 que talla el bbox."""
    groups: list[list[str]] = []
    seen: set[str] = set()
    lat = int(np.floor(bbox["south"]))
    lat_top = int(np.floor(bbox["north"]))
    while lat <= lat_top:
        lon = float(bbox["west"])
        while lon <= float(bbox["east"]) + 1e-9:
            urls = _copernicus_urls(lat + 0.5, lon)
            if urls[0] not in seen:
                seen.add(urls[0])
                groups.append(urls)
            lon = _next_lon_tile(lon) + 1e-6
        lat += 1
    return groups


def _reproject_into(src: rasterio.DatasetReader, dest: np.ndarray, transform, crs: CRS) -> None:
    """Reprojecta la banda 1 sobre `dest` (NaN fora de la font). No pisa cotes ja vàlides."""
    tmp = np.full(dest.shape, np.nan, dtype=np.float32)
    reproject(
        source=rasterio.band(src, 1),
        destination=tmp,
        src_transform=src.transform,
        src_crs=src.crs,
        src_nodata=src.nodata,
        dst_transform=transform,
        dst_crs=crs,
        dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )
    hole = ~np.isfinite(dest) & np.isfinite(tmp) & (tmp > 0)
    dest[hole] = tmp[hole]


def _fill_copernicus(cfg: dict, dest: np.ndarray, transform, crs: CRS) -> None:
    """On el MDT05 no arriba (la fulla 307 s'acaba abans del cementiri), Copernicus GLO-30.

    El biaix és la mediana de la diferència al tros on tots dos tenen cota, perquè els dos
    models no comparteixen geoide i un esglaó es veuria al camp.
    """
    if np.isfinite(dest).all():
        return
    cop = np.full(dest.shape, np.nan, dtype=np.float32)
    opened = False
    for urls in _copernicus_tile_groups(cfg["bbox_wgs84"]):
        src = None
        for url in urls:
            try:
                print(f"Trying Copernicus DEM: {url}")
                src = rasterio.open(url)
                break
            except Exception as exc:  # noqa: BLE001
                print(f"  failed: {exc}")
        if src is None:
            continue
        with src:
            _reproject_into(src, cop, transform, crs)
        opened = True
    if not opened or not np.isfinite(cop).any():
        raise RuntimeError("Could not open Copernicus DEM")
    both = np.isfinite(dest) & np.isfinite(cop)
    bias = float(np.median(dest[both] - cop[both])) if both.any() else 0.0
    hole = ~np.isfinite(dest) & np.isfinite(cop)
    dest[hole] = cop[hole] + np.float32(bias)
    print(f"DEM: {int(hole.sum())} cel·les fora del MDT05, Copernicus amb biaix {bias:+.2f} m")


def fetch_dem() -> Path:
    cfg = load_config()
    utm_epsg = int(cfg["utm_epsg"])
    crs = CRS.from_epsg(utm_epsg)
    minx, miny, maxx, maxy = _utm_bounds(cfg)
    res_m = 5.0
    width = int(np.ceil((maxx - minx) / res_m))
    height = int(np.ceil((maxy - miny) / res_m))
    transform = from_origin(minx, maxy, res_m, res_m)
    dest = np.full((height, width), np.nan, dtype=np.float32)
    out_path = ensure_parent(cfg["paths"]["dem_tif"])

    local = cfg.get("mdt_local_path")
    if local and Path(local).is_file():
        print(f"Using local MDT: {local}")
        with rasterio.open(local) as src:
            _reproject_into(src, dest, transform, crs)
    else:
        print("Sense MDT local")

    try:
        _fill_copernicus(cfg, dest, transform, crs)
    except RuntimeError as exc:
        if not np.isfinite(dest).any():
            print(f"  {exc}")
            return _write_synthetic_dem(cfg, out_path)
        print(f"  {exc}; es deixen els forats del MDT")

    missing = float((~np.isfinite(dest)).mean())
    if missing > 0.001:
        if not np.isfinite(dest).any():
            return _write_synthetic_dem(cfg, out_path)
        raise RuntimeError(f"DEM incomplet: {missing:.1%} del bbox sense cota")

    # Un forat mínim (vora del reprojectat) s'omple amb el veí: el sampler del món ja ho fa,
    # però el GeoTIFF es desa sense NaN.
    bad = ~np.isfinite(dest)
    if bad.any():
        from scipy import ndimage

        idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
        dest = dest[tuple(idx)]

    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": "float32",
        "crs": crs,
        "transform": transform,
    }
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(dest.astype(np.float32), 1)
    print(f"Saved DEM → {out_path} ({width}×{height}, {res_m:.0f} m)")
    return out_path


if __name__ == "__main__":
    fetch_dem()
