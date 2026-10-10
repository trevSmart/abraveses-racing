# 0332504TM6503S — casa crema retirada darrere el jardí (4 C. Santibáñez)

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de Street View: `expedient.txt`.
Fitxa feta el 2026-10-08.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg`. Des de l'est: mur de pedra amb reixa verda i pilars amb remat groc, la casa crema al fons.
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_4-C-Santibanez_rumb205.jpg`: panell «4 C. Santibáñez», viewpoint 41.9922816,-5.8950141, rumb 205: tota la façana i el mur.
  - `streetview/2024-09_4-C-Santibanez_rumb180.jpg`: (de 0332505) mur i porta de vianants.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.9923,-5.8952,92m/data=!3m1!1e3). Teulada a dues aigües; jardí entre la casa i el carrer.

## Façanes

- **part2, N** (14 m, 2 plantes baixes, ràfec ~5,4 m amb cabirons de fusta, t = 0 a l'est): crema `[230, 214, 170]`. Planta baixa: finestres a t 0,15 / 0,52 / 0,71 / 0,88, porta a t 0,365 amb teuladí. Pis: dues finestretes de golfa (0,55 m d'alt) a t 0,365 i 0,78. Escala 53 px/m sobre la captura.
- **Mur del carrer** (`walls.yaml`, `0332504-carrer`): pedra d'1,0 m (la porta de vianants en fa ~1,9) i reixa verda fins a ~1,85 m. Llargada: vores de la parcel·la al carrer (23 m).

## Dubtes i decisions

- part1 (cos baix a l'oest, al carrer) com sempre: només es veu de biaix.

## Anàlisi detallada (2026-10-09, skill casa-a-mida)

- Fonts noves: `streetview/2024-09_4-C-Santibanez_rumb210.jpg` (la casa i la tanca) i `2024-09_5-ZA-P-2547_rumb180.jpg` (el cos baix de l'oest).
- **Nou, part1** (cos baix de l'oest, al carrer):
  - emblanquinat amb sòcol de pedra i una finestreta verda;
  - teulada d'una aigua que baixa cap a l'est (`type: shed` amb `toward: E`, nou);
  - ràfec a 2,4 m, que puja fins a la casa del costat.
- **Tàpia** `0332504-carrer`, ara amb els dos portals:
  - porta de vianants verda (1,0 × 1,9 m), davant de la porta de casa;
  - portal gris de dues fulles (2,8 × 1,9 m), a l'oest.
  La reixa ja no passa per damunt dels portals.

## Correccions de l'usuari

- Cap, de moment.
