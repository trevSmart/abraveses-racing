# 0431706TM6503S — casa vella de tova emblanquinada amb porticons blaus (C. el Cristo sud)

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de
Street View: `expedient.txt`. Anàlisi detallada feta el 2026-10-09 amb la skill casa-a-mida.

Cadastre: 1900 · residencial · 269 m² · «declined» · part1, part2, part3.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg` (data no indicada).
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_18-Calle-El-Cristo_rumb151.jpg`: panell «18 Calle El Cristo», rumb 151.
  - `streetview/2024-09_7707-Calle-El-Cristo_rumb340.jpg`: panell «7707 Calle El Cristo», rumb 340.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99168,-5.89400,89m/data=!3m1!1e3) i `ortofoto.png`.
- Joc: `joc_E.jpg` (després de regenerar el món).

## Volums

- **part3** (2 plantes, ràfec a 4,2 m): el capçal del carrer, amb el frontó al carrer.
- **part2** (1 planta, 2,8 m): cos baix del costat.
- **part1** (1 planta, 2,8 m): cos del darrere.

## Façanes

- **NE, part3**: emblanquinat `[226, 218, 196]`, sòcol de 0,6 m. Una finestra a cada planta a
  t 0,55, tapades amb porticons blaus (`fill`).
- **NE, part3, `nth: 2`**: porta blava a t 0,5.
- **N, part2**: cega.

## Dubtes i decisions

- No és clar quina de les dues façanes NE de part3 té la porta blava: n'he triat la segona
  (`nth: 2`).
- El Cadastre diu que l'edifici està en mal estat («declined») i té 0 habitatges: la foto ho
  confirma.

## Correccions de l'usuari

- Cap, de moment.
