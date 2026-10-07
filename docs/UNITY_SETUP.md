# Unity — Abraveses Racing

> **Si no has fet servir Unity mai**, comença per **[PRIMERES_PASSOS.md](PRIMERES_PASSOS.md)** (instal·lació, espai al disc, obrir projecte, Play).

Joc de conducció arcade pel nucli d’**Abraveses de Tera**, amb carrers i relleu des d’OpenStreetMap + DEM.

**Convenció:** 1 unitat Unity = 1 metre.

## Regenerar el mapa (opcional)

Des de l’arrel del repositori:

```bash
source .venv/bin/activate
python tools/mapgen/build_world.py --all
```

Vegeu [MAP_PIPELINE.md](MAP_PIPELINE.md).

## Controls

| Tecla | Acció |
|-------|--------|
| W / ↑ | Accelerar |
| S / ↓ | Enrere |
| A / D o ← / → | Girar |
| Espai | Fre |
| R | Tornar al spawn |

## Atribucions

[ATTRIBUTION.md](ATTRIBUTION.md)
