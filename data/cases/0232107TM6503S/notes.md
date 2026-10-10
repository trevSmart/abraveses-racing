# 0232107TM6503S — nau agrícola (model propi bàsic)

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de Street View: `expedient.txt`.
Fitxa feta el 2026-10-08.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg`. Ensenya una nau grisa amb portal gran, sòcol de pedra i la casa salmó de 0232108 al costat.
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_7728-ZA-P-2547_rumb20.jpg`: la nau grisa de la foto del Cadastre, a la C. Santibáñez, just a l'oest de 0232108.
  - `streetview/2024-09_18-C-Santibanez_rumb30.jpg` i `_rumb45.jpg`: part3, cos de tova arrebossat amb sòcol de pedra i una tàpia alta.
  - `streetview/2024-09_3-Rinconada_rumb286.jpg` i `2024-09_Rinconada-nord_rumb225.jpg`: tàpies i cossos de tova cap a la Rinconada.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99245,-5.89575,92m/data=!3m1!1e3). Només en surt la banda est.

## Façanes

- No s'ha fet fitxa.

## Dubtes i decisions

- **Per què no té fitxa:** la nau grisa de la foto del Cadastre cau entre part3 i 0232108, en un cobert de coberta grisa que no és dins de cap `BuildingPart` de 0232107 (a l'ortofoto queda fora de les vores grogues). Les parts cadastrals són cossos de tova mig enrunats, vistos només de biaix. Cal decidir abans com es modela la nau (com a coberta detectada o amb una part nova).

## Model propi bàsic (2026-10-09)

- **Model propi bàsic** (2026-10-09). part3 és el mur alt arrebossat (~3,2 m) amb sòcol de pedra i coberta grisa d'una aigua. part1 és el paller de tova amb frontó, i part2, el cos llarg del darrere amb color de tova.
- La nau grisa de la foto del Cadastre continua fora de les parts: queda com a cobert detectat.

## Anàlisi detallada (2026-10-09, skill casa-a-mida)

- **Anàlisi detallada** (2026-10-09). La façana del carrer té tres trams, d'oest a est:
  1. part3, el mur alt de tova;
  2. una tàpia alta arrebossada de ~3 m amb sòcol de pedra (`walls.yaml`, `0232107-carrer`);
  3. **la nau grisa**, que no surt al Cadastre i ara és un volum de la fitxa (`extra_parts`, nou). Fa uns 7,6 m de façana, amb un mur gris de ~3,5 m, un portal metàl·lic de 3,4 × 3,0 m i la teulada d'una aigua cap al pati.
- `extra_roofs: false` treu el cobert que l'ortofoto hi detectava.
- El contorn de la nau surt de l'ortofoto (amb la seva perspectiva) i de les vores de la parcel·la: és aproximat.

## Correccions de l'usuari

- Cap, de moment.
