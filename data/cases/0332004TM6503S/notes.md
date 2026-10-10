# 0332004TM6503S — casa de tova en ruïna (model propi bàsic)

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de Street View: `expedient.txt`.
Fitxa feta el 2026-10-08.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg`. Casa de tova d'una planta amb porta i finestretes, a la cantonada amb la Calle Viriato.
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_7-ZA-P-2547_rumb70.jpg`: al 2024 queda el sòcol de pedra amb bloc al damunt i, darrere, parets de tova a mig enrunar.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99215,-5.89456,92m/data=!3m1!1e3). 

## Façanes

- No s'ha fet fitxa.

## Dubtes i decisions

- **Per què no té fitxa:** el Cadastre en diu `declined` i la foto de façana és d'abans. Ara és un pati amb mur i ruïnes: caldria fer el mur (`walls.yaml`) i treure la casa, i això no ho permeten les fitxes de casa.

## Model propi bàsic (2026-10-09)

- **Model propi bàsic** (2026-10-09). part1 són murs de 1,9 m de pedra i tova, sense teulada (`roof: {type: none}`). part2 és el cobert baix amb porta de fusta.
- Ja no cal treure la casa: el model és la ruïna.

## Anàlisi detallada (2026-10-09, skill casa-a-mida)

- **Anàlisi detallada** (2026-10-09). Fonts noves: `streetview/2024-09_5-ZA-P-2547_rumb330.jpg` i `_rumb40.jpg` (panell «5 ZA-P-2547», 41.9923287,-5.8952535), i `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99245,-5.89515,60m/data=!3m1!1e3).
- La casa (part1) és una ruïna de murs baixos de pedra i bloc (`type: none`, 1,9 m). El paller de tova amb frontó que es veu darrere és de la casa veïna 0332703.
- **Tàpies noves**:
  - `0332004-oest`: mur de pedra (0,9 m) amb bloc fins a 1,7 m, a les vores de l'oest;
  - `0332004-caseta`: caseta de tova emblanquinada d'uns 2,3 m al carrer, amb porta de fusta. El sostre de fibrociment, esfondrat, no es modela.

## Correccions de l'usuari

- Cap, de moment.
