# Abraveses Racing

Conducció arcade pel nucli d’**Abraveses de Tera** (Micereces de Tera, Zamora), generat des d’OpenStreetMap + elevació (IGN / Copernicus).

**Convenció:** 1 unitat = 1 metre.

## Jugar (web — recomanat)

```bash
# 1) Generar mapa (primera vegada o si canvia el bbox)
python3 -m venv .venv && source .venv/bin/activate
pip install -r tools/requirements.txt
python tools/mapgen/build_world.py --all

# 2) Servidor local
cd web && npm install && npm run dev
```

S’obrirà el navegador a `http://localhost:5173`. Controls: **W/A/S/D**, **Espai**, **R**.

Guia: [docs/JOC_WEB.md](docs/JOC_WEB.md).

## Unity (opcional)

El directori `unity/AbravesesRacing` queda com prova antiga; el flux mantingut és el **joc web**.

## Regenerar el mapa

```bash
source .venv/bin/activate
python tools/mapgen/build_world.py --all
```

Sortida principal: `web/public/world.glb` + `web/public/spawn.json`.

Detalls: [docs/MAP_PIPELINE.md](docs/MAP_PIPELINE.md).

## Atribucions

[docs/ATTRIBUTION.md](docs/ATTRIBUTION.md)

## Estructura

```
web/              Joc Three.js (Vite)
web/public/       world.glb, spawn.json (generats)
tools/mapgen/     Pipeline OSM + DEM
unity/            (legacy, opcional)
docs/
```
