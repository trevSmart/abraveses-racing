# Attribucions i llicències de dades

## OpenStreetMap

© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.  
Dades del mapa disponibles sota la [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/).

## Ortofoto (textura del terreny)

- **Preferit:** PNOA Máxima Actualidad — «PNOA cedido por © [Instituto Geográfico Nacional](https://www.ign.es/)», llicència [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ([scne.es](https://www.scne.es/)). Descarregat via WMS `https://www.ign.es/wms-inspire/pnoa-ma` en EPSG:25830.
- **Fallback:** Esri World Imagery (© Esri, Maxar i col·laboradors), només per a ús de desenvolupament / educatiu.

## Cadastre (cases i parcel·les de la zona de detall)

Edificis (`BuildingPart`, amb nombre de plantes) i parcel·les cadastrals — © [Dirección General del Catastro](https://www.catastro.hacienda.gob.es/), serveis INSPIRE (`ovc.catastro.meh.es/INSPIRE`). Ús lliure citant la font.

## Model digital del terreny

- **Preferit:** MDT05 — © [Instituto Geográfico Nacional (IGN) / CNIG](https://www.ign.es/), descàrrega via [Centro de Descargas CNIG](https://centrodedescargas.cnig.es/). Consulta les condicions d’ús del producte al portal d’IGN.
- **Fallback automàtic del pipeline:** DEM sintètic en UTM (~718 m + relleu suau) si Copernicus no es pot descarregar; preferible col·locar un GeoTIFF **MDT05** local a `config.yaml` → `mdt_local_path`.

## Motor de joc

[Unity](https://unity.com/) — consulta les condicions de llicència del teu pla Unity.

## Codi d’aquest repositori

Codi del joc i scripts del pipeline: MIT (vegeu `LICENSE` si s’afegeix).
