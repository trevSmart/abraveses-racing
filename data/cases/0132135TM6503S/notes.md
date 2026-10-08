# 0132135TM6503S — casa de maó del fons i garatge del carrer (17)

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de Street View: `expedient.txt`.
Fitxa feta el 2026-10-08.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg`. Des del carrer, mirant al sud-oest: el garatge blanc amb el sòcol i el remat de maó a franges (aleshores amb porta grisa) i, al fons, la casa de dues plantes de maó amb teulada a quatre aigües, tres finestres a dalt amb persiana i una llosana blanca corrent.
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_7748-C-Santibanez_rumb207.jpg`: panell «7748 C. Santibáñez», viewpoint 41.9926958,-5.8971993, rumb 207. Garatge de cara (porta marró fosca, número 17).
  - `streetview/2024-09_7748-C-Santibanez_rumb222_zoom.jpg`: mateix panell, rumb 222, fov 35: els arbres tapen la casa del fons; la coberta del garatge és de fibrociment ondulat.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99248,-5.89733,92m/data=!3m1!1e3). Casa del fons a quatre aigües; garatge (part3) de coberta grisa i cobert blanc (part2) darrere.

## Façanes

- **part3, NE** (4,76 m, garatge al carrer): mur blanc trencat `[226, 218, 198]`, sòcol de maó a franges fins a ~1 m, porta de garatge d'una fulla de 2,3 × 2,55 m al mig (t 0,5). Alçada ~3,3 m (ampit).
- **part1, NE** (11 m, casa del fons, 2 plantes): maó `[190, 150, 112]`, teulada a quatre aigües amb ràfec blanc. De la foto del Cadastre: tres finestres a dalt (t 0,2 / 0,5 / 0,8, ~1,2 m) amb persiana baixada i llosana corrent; planta baixa amb porta al mig i dues finestres.
- part2: cobert blanc darrere el garatge, no es veu des del carrer.

## Dubtes i decisions

- La casa del fons només es veu a la foto del Cadastre, petita i darrere la reixa: les obertures de la planta baixa són aproximades.
- El sòcol i el remat del garatge són maó a franges vermelles i crema: es fa amb `cladding` de maó vermell; el remat de dalt no es modela.
