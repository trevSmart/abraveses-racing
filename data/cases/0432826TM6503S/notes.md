# 0432826TM6503S — casa blanca amb rombes grisos i cossos de la C. el Cristo

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de
Street View: `expedient.txt`. Anàlisi detallada feta el 2026-10-09 amb la skill casa-a-mida.

Cadastre: 1900 · residencial · 293 m² · part1 2 pl., part3 2 pl., part2, part4, part5, part6.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg` (data no indicada).
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_10-Calle-El-Cristo_rumb060.jpg`: panell «10 Calle El Cristo», rumb 060.
  - `streetview/2024-09_10-Calle-El-Cristo_rumb340.jpg`: panell «10 Calle El Cristo», rumb 340.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99222,-5.89410,89m/data=!3m1!1e3) i `ortofoto.png`.
- Joc: `joc_O.jpg` (després de regenerar el món).

## Volums

- **part1** (2 plantes, ràfec a 5,6 m): la casa blanca, dues aigües.
- **part3** (2 plantes, 5,4 m): el capçal crema que es veu des del carrer del Cristo, amb el frontó
  al carrer (`ridge: across`).
- **part4** (1 planta, 2,3 m): cos baix d'una aigua al costat de part3.
- **part2**, **part5**, **part6**: cossos interiors, sense fitxa. part5 no es veu des del carrer:
  la tapa la casa 0432827.
- `extra_roofs: false`: l'ortofoto hi veia un cobert entre el carrer i part3 (el desplaçament de
  la perspectiva). A la foto, en aquest lloc hi ha un mur ocre i no hi ha cap edifici.

## Façanes

- **NE, part1**: blanca, sòcol gris de 0,9 m.
  - Planta baixa: finestres a t 0,25 i 0,72, porta blanca a t 0,45.
  - Pis: finestres a t 0,25 i 0,72, i un balconet (0,3 m) amb una porta-finestra a t 0,45.
- **O, part3**: crema `[232, 214, 176]`, una finestreta de 0,6 × 0,7 m al pis.
- **O, part4**: cega.

## Dubtes i decisions

- La foto del Cadastre és antiga i hi surten rombes grisos a la façana, que el model no fa (el
  color és llis).
- Davant de part3 la foto mostra un mur ocre més baix que el de 0432828. Cap vora cadastral hi
  passa, i no l'he posat a `walls.yaml`.
- Les captures de Street View són del mateix panell que les de 0432828 (també hi són).

## Correccions de l'usuari

- Cap, de moment.
