# 0432822TM6503S — casa de maó amb balconets a la placeta del Cristo

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de
Street View: `expedient.txt`. Anàlisi detallada feta el 2026-10-09 amb la skill casa-a-mida.

Cadastre: 1900 · residencial · 272 m² · part1 2 pl., part2 1 pl..

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg` (data no indicada).
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_18-Calle-El-Cristo_rumb070.jpg`: panell «18 Calle El Cristo», rumb 070.
  - `streetview/2024-09_placeta-Calle-El-Cristo_rumb040.jpg`: panell de la placeta de la C. el Cristo, rumb 040.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99222,-5.89410,89m/data=!3m1!1e3) i `ortofoto.png`.
- Joc: `joc_O.jpg`, `joc_placeta.jpg` (després de regenerar el món).

## Volums

- **part1** (2 plantes, ràfec a 5,6 m): casa de maó amb cantoneres de pedra, dues aigües.
- **part2** (1 planta, 3,2 m): cos blanc amb porta de garatge.
- `extra_roofs: false`: l'ortofoto hi veia coberts a la placeta. El filtre ara també treu els
  coberts detectats que toquen les parts de la casa (n'ha tret 6).

## Façanes

- **O, part1** (placeta): maó `[168, 96, 72]`, sòcol de pedra de 0,5 m, persianes blanques.
  - Planta baixa: finestres a t 0,2 i 0,8, porta blanca a t 0,5.
  - Pis: tres portes-finestra (ampit 0,5 m) a t 0,2, 0,5 i 0,8, cadascuna amb un balconet de 0,3 m.
- **S, part2**: blanc. Porta de garatge de fusta (2,6 × 2,4 m) a t 0,5.

## Dubtes i decisions

- Els balconets bombats de ferro de la foto es fan amb una llosa plana i la barana recta.
- Les cantoneres de pedra no es fan.

## Correccions de l'usuari

- Cap, de moment.
