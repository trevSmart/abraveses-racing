# 0431101TM6503S — casa groga llarga de la cantonada del Cristo i la C. Taburete

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de
Street View: `expedient.txt`. Anàlisi detallada feta el 2026-10-09 amb la skill casa-a-mida.

Cadastre: 1900 · residencial · 200 m² · part1 2 pl..

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg` (data no indicada).
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_1-C-Taburete_rumb190.jpg`: panell «1 C. Taburete», rumb 190.
  - `streetview/2024-09_29-ZA-P-2547_rumb092.jpg`: panell «29 ZA-P-2547», rumb 092.
  - `streetview/2024-09_C-Taburete-est_rumb195.jpg`: panell de la C. Taburete, tram est, rumb 195.
  - `streetview/2024-09_C-Taburete-est_rumb320.jpg`: panell de la C. Taburete, tram est, rumb 320.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99168,-5.89400,89m/data=!3m1!1e3) i `ortofoto.png`.
- Joc: `joc_N.jpg` (després de regenerar el món).

## Volums

- Una sola part de 2 plantes (ràfec a 5,9 m), quatre aigües amb cornisa de maó.

## Façanes

- **O** (capçal del Cristo): groc `[226, 206, 160]`, sòcol de pedra de 0,8 m, emmarcats rosats.
  - Planta baixa: finestra a t 0,3 i porta alta (`bottom_m` 0,9) amb cinc graons i barana a t 0,72.
  - Pis: dues portes de balcó a t 0,3 i 0,66, amb un balcó corregut de 0,8 m.
  La barana de l'escala és a la dreta (`step_rail: [right]`), com a
  `2024-09_29-ZA-P-2547_rumb092.jpg` (a la primera versió era a l'esquerra).
- **N** (C. Taburete): quatre finestres per planta a t 0,2, 0,4, 0,6 i 0,8, i una finestreta a la
  planta baixa a t 0,5.
- **E** (testera del carreró, `2024-09_C-Taburete-est_rumb320.jpg`): una finestra amb emmarcat
  rosat a cada planta, al mig (t 0,5). A la primera versió era genèrica.

## Dubtes i decisions

- La cinta de maó entre plantes no es fa: només el `fascia` del ràfec.

## Correccions de l'usuari

- Cap, de moment.
