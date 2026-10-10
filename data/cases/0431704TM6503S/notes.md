# 0431704TM6503S — casa blanca amb terrat i botiga «Frigo» (16 C. el Cristo)

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de
Street View: `expedient.txt`. Anàlisi detallada feta el 2026-10-09 amb la skill casa-a-mida.

Cadastre: 1900 · residencial · 226 m² · part1 i part2 de 3 plantes.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg` (data no indicada).
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_18-Calle-El-Cristo_rumb250.jpg`: panell «18 Calle El Cristo», rumb 250.
  - `streetview/2024-09_18-Calle-El-Cristo_rumb320.jpg`: panell «18 Calle El Cristo», rumb 320.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99168,-5.89400,89m/data=!3m1!1e3) i `ortofoto.png`.
- Joc: `joc_NE.jpg` (després de regenerar el món).

## Volums

- **part1** i **part2**: dues plantes i terrat (`type: flat`) amb ampit de 0,25 m. El Cadastre
  hi compta 3 plantes: la tercera és la caseta de l'escala del terrat, feta amb una `chimneys`
  grossa (1,6 m) a t 0,08.

## Façanes

- **NE, part1** (al carrer): blanc `[236, 236, 232]`. Planta baixa enrajolada en dues capes
  (`cladding`): gris fosc fins a 0,9 m i gris clar fins a 3,0 m.
  - Planta baixa: finestra a t 0,2, porta gris fosc a t 0,38, garatge crema amb marc vermellós
    (1,6 m, porta de la botiga) a t 0,6, i porta de reixa gris (1,2 m) a t 0,84.
  - Pis: finestres a t 0,2, 0,45 i un finestral de 1,2 × 1,6 m a t 0,84.
  - Barana del terrat feta amb un balcó de 0,1 m a la planta 2.
- **S, part2**: cega (mitgera amb el pati veí).

## Dubtes i decisions

- La barana del terrat és de ferro a la foto. El model només en fa la llosa: el balcó no té
  `rail` perquè no surti per fora.
- La porta de reixa de la botiga es fa com un `garage` d'una fulla: no hi ha cap porta de reixa
  per a cases.

## Correccions de l'usuari

- Cap, de moment.
