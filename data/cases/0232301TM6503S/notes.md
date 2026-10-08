# 0232301TM6503S — casa emblanquinada (7725 C. Santibáñez)

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de Street View: `expedient.txt`.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg`. Façana sud, de cara: arrebossat clar,
  sòcol fosc, dues finestres de dalt tapiades amb maó, porta de fusta i finestres baixes amb
  porticó. Els cartells no es modelen.
- Street View, set. 2024, panell «7725 C. Santibáñez», rumb 0°:
  `streetview/2024-09_7725-C-Santibanez_rumb0.jpg`. El panorama és arran del mur oest de la
  façana i el mostra més tacat; no s'hi arriben a veure les obertures del centre.
- Ortofoto: un sol cos rectangular. L'oest és mitgera amb 0232303.
- Vista zenital: `satellit/google_satellit.jpg` (la mateixa enquadrada que 0232303,
  https://www.google.com/maps/@41.992540,-5.896080,40m/data=!3m1!1e3). Carener est-oest,
  vessant al carrer: coincideix amb la fitxa.

## Façanes

- **S** (9,3 m, 2 plantes). Mur `[214, 206, 192]`, sòcol d'1,05 m, carener paral·lel al carrer.
  t = 0 a l'oest (cantonada amb la nau gris).
  - Planta baixa: finestra a t 0,34, porta a t 0,60, finestra estreta a t 0,84.
  - Pis: obertures tapiades a t 0,32 i 0,82 (`fill` color maó).
- **E** (8,8 m) i **N** (9,6 m): donen a carrer o a un pas i no s'han vist. Murs cecs.

## Dubtes i decisions

- Es modelen les obertures de la foto del Cadastre. El Street View de 2024, massa a prop del
  mur, sembla un arrebossat continu; si en una passada més enrere no hi ha finestres, caldrà
  buidar `openings`.
