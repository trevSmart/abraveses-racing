"""Shared config loading for mapgen scripts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = Path(__file__).resolve().parents[1] / "config.yaml"


def load_config() -> dict[str, Any]:
    with CONFIG_PATH.open(encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    for key, rel in cfg.get("paths", {}).items():
        cfg["paths"][key] = str(ROOT / rel)
    if cfg.get("mdt_local_path"):
        p = Path(cfg["mdt_local_path"])
        cfg["mdt_local_path"] = str(p if p.is_absolute() else ROOT / p)
    return cfg


def ensure_parent(path: str | Path) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def wgs84_to_utm(cfg: dict[str, Any], lon: float, lat: float) -> tuple[float, float]:
    from pyproj import Transformer

    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{cfg['utm_epsg']}", always_xy=True)
    x, y = transformer.transform(lon, lat)
    return x, y


def utm_origin(cfg: dict[str, Any]) -> tuple[float, float]:
    center = cfg["center_wgs84"]
    return wgs84_to_utm(cfg, center["lon"], center["lat"])
