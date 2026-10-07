# Regenerar el món (Abraveses de Tera)

## Requisits

- Python 3.11+ amb dependències (`pip install -r tools/requirements.txt`)
- Connexió a internet (OSM Overpass + DEM Copernicus)
- Opcional: Blender al PATH per re-export

## Configuració

Edita [`tools/mapgen/config.yaml`](../tools/mapgen/config.yaml):

- `bbox`: rectangle WGS84 (south, west, north, east)
- `spawn`: punt de spawn en WGS84
- `utm_epsg`: 25830 (ETRS89 / UTM 29N)

Descarrega el GeoTIFF MDT05 (fulla **307**, `PNOA_MDT05_ETRS89_HU29_0307_LID.tif`) i col·loca’l a:

`data/raw/PNOA_MDT05_ETRS89_HU29_0307_LID.tif`

Després defineix `mdt_local_path` a [`tools/mapgen/config.yaml`](../tools/mapgen/config.yaml) (ja apuntat per defecte si el fitxer hi és).

## Passos

Des de l’arrel del repositori:

```bash
source .venv/bin/activate
python tools/mapgen/fetch_osm.py
python tools/mapgen/fetch_dem.py
python tools/mapgen/fetch_ortho.py
python tools/mapgen/fetch_cadastre.py
python tools/mapgen/build_world.py
```

### Poble en 3D (zona de detall)

`village_detail` a `config.yaml` defineix els carrers (ara `Calle Santibáñez`) i l'amplada de la franja.
`fetch_cadastre.py` baixa del Cadastre els edificis, les parts d'edifici (amb plantes) i les parcel·les;
`build_world.py` hi genera cases amb teulada a dues aigües texturada amb l'ortofoto, façanes amb
finestres i porta cap al carrer, tàpies, i analitza l'ortofoto per classificar cada parcel·la
(pati, jardí, hort, arbrat, prat, erm), detectar copes d'arbre i coberts que no surten al Cadastre.
Els arbres i les plantes d'hort van a `web/public/village.json`.

O tot d’un cop:

```bash
python tools/mapgen/build_world.py --all
```

## Sortides

| Fitxer | Descripció |
|--------|------------|
| `data/raw/osm_abraveses.geojson` | Vies i edificis OSM |
| `data/raw/dem_clip.tif` | DEM retallat al bbox |
| `data/processed/heightmap.png` | Relleu normalitzat (16-bit) |
| `data/processed/world_meta.json` | Origen UTM, mides, cota mín/màx |
| `web/public/world.glb` | Terreny + carreteres + edificis (joc web Three.js) |
| `web/public/world.obj` | Export opcional (debug; `data/processed/world.obj`) |
| `web/public/spawn.json` | Posició i rotació de spawn en metres locals |
| `web/public/world_meta.json` | Metadades del terreny (còpia) |
| `web/public/heightmap.png` | Heightmap (còpia) |

## Validació

1. Obre `world.glb` a Blender o https://gltf-viewer.donmccurdy.com/
2. Compara amb [OpenStreetMap](https://www.openstreetmap.org/#map=17/41.9930/-5.8950) al nucli del poble.

## Convenció d’escala

**1 unitat Unity = 1 metre.** L’origen local del món és el centre del bbox en UTM.
