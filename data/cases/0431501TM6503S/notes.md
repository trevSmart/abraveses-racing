# 0431501TM6503S — paller de tova a la cantonada del Cristo amb el camí de Micereces

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de
Street View: `expedient.txt`. Anàlisi detallada feta el 2026-10-09 amb la skill casa-a-mida.

Cadastre: 1900 · residencial · 173 m² · «declined» · part1, part2, part3.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg` (data no indicada).
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_29-Calle-El-Cristo_rumb220.jpg`: panell «29 Calle El Cristo», rumb 220.
  - `streetview/2024-09_7707-Calle-El-Cristo_rumb340.jpg`: panell «7707 Calle El Cristo», rumb 340.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99168,-5.89400,89m/data=!3m1!1e3) i `ortofoto.png`.
- Joc: `joc_SE.jpg`, `joc_SO.jpg` (després de regenerar el món).

## Volums

- **part2** (1 planta alta, ràfec a 4,0 m): el paller, a quatre aigües.
- **part3** (1 planta, 2,8 m): el cos del carrer amb el portal metàl·lic.
- **part1** (1 planta, 2,6 m): el cobert baix de la cantonada, d'una aigua.

## Façanes

- **NO, part2**: arrebossat `[222, 212, 186]`, sòcol de 0,6 m. Finestreta de 0,6 × 1,0 m amb emmarcat
  de maó, tapada, a t 0,5.
- **SO** i **NE, part2**: cegues. A la SO, la del panell «7707», hi ha un pedaç de maó a baix.
- **SE, part3** (C. el Cristo): portal metàl·lic gris de dues fulles (2,0 × 2,3 m) a t 0,6. Es veu
  a `2024-09_29-Calle-El-Cristo_rumb220.jpg`. La SO és cega.
- **part1**: cegues (SE, SO i NE).

## Dubtes i decisions

- part1 i part3 eren genèriques a la primera versió de la fitxa, i la captura del joc hi mostrava
  porta i finestres inventades al carrer. Les he afegit després de comparar la captura amb Street
  View. Les mides del portal surten d'una vista de biaix (±0,3 m).
- Entre part1 i part3 hi ha un tros de mur sense teulada (la vora SE de 3,9 m de la parcel·la),
  que es fa amb la tàpia generada.

## Correccions de l'usuari

- Cap, de moment.
