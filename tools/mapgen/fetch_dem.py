"""Fetch or clip DEM for the configured bbox."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.io import MemoryFile
from rasterio.mask import mask
from rasterio.warp import calculate_default_transform, reproject, Resampling, transform_geom
from shapely.geometry import box, mapping

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
    name = f"Copernicus_DSM_COG_10_{hemi}{abs(lat_int):02d}_00_{lon_tag}_DEM.tif"
    return [
        f"https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/{name}",
        f"https://storage.googleapis.com/copernicus-dem-30m/{name}",
        f"https://copernicus-dem-30m.s3.amazonaws.com/{name}",
    ]


def _open_dem_source(cfg: dict) -> rasterio.DatasetReader:
    local = cfg.get("mdt_local_path")
    if local and Path(local).is_file():
        print(f"Using local MDT: {local}")
        return rasterio.open(local)

    center = cfg["center_wgs84"]
    last_err: Exception | None = None
    for url in _copernicus_urls(center["lat"], center["lon"]):
        try:
            print(f"Trying Copernicus DEM: {url}")
            return rasterio.open(url)
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            print(f"  failed: {exc}")
    raise RuntimeError("Could not open Copernicus DEM") from last_err


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


def fetch_dem() -> Path:
    cfg = load_config()
    bbox = cfg["bbox_wgs84"]
    geom = box(bbox["west"], bbox["south"], bbox["east"], bbox["north"])
    utm_epsg = cfg["utm_epsg"]
    out_path = ensure_parent(cfg["paths"]["dem_tif"])

    try:
        src_ctx = _open_dem_source(cfg)
    except RuntimeError:
        return _write_synthetic_dem(cfg, out_path)

    with src_ctx as src:
        src_crs = src.crs or CRS.from_epsg(4326)
        geom_wgs84 = mapping(geom)
        if src_crs.to_epsg() != 4326:
            geom_mask = transform_geom("EPSG:4326", src_crs, geom_wgs84)
        else:
            geom_mask = geom_wgs84
        cropped, crop_transform = mask(src, [geom_mask], crop=True, nodata=np.nan)
        if src_crs.to_epsg() != utm_epsg:
            height, width = cropped.shape[1], cropped.shape[2]
            dst_transform, dst_w, dst_h = calculate_default_transform(
                src_crs,
                CRS.from_epsg(utm_epsg),
                width,
                height,
                *rasterio.transform.array_bounds(height, width, crop_transform),
            )
            reprojected = np.empty((cropped.shape[0], dst_h, dst_w), dtype=np.float32)
            reproject(
                source=cropped,
                destination=reprojected,
                src_transform=crop_transform,
                src_crs=src_crs,
                dst_transform=dst_transform,
                dst_crs=CRS.from_epsg(utm_epsg),
                resampling=Resampling.bilinear,
            )
            out_data = reprojected
            out_transform = dst_transform
            out_crs = CRS.from_epsg(utm_epsg)
        else:
            out_data = cropped
            out_transform = crop_transform
            out_crs = src_crs

    out_path = ensure_parent(cfg["paths"]["dem_tif"])
    profile = {
        "driver": "GTiff",
        "height": out_data.shape[1],
        "width": out_data.shape[2],
        "count": out_data.shape[0],
        "dtype": "float32",
        "crs": out_crs,
        "transform": out_transform,
        "nodata": np.nan,
    }
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(out_data.astype(np.float32))
    print(f"Saved DEM → {out_path}")
    return out_path


if __name__ == "__main__":
    fetch_dem()
