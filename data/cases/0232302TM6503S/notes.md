# 0232302TM6503S — casa crema en L amb pati, terrassa i garatge (12 C. Santibáñez)

Fitxa: `tools/mapgen/cases.yaml` · tàpia: `tools/mapgen/walls.yaml` (`0232302-carrer`) ·
dades i enllaços de Street View: `expedient.txt`.
Fitxa feta el 2026-10-08; refeta el mateix dia (la primera versió només modelava la façana del
carrer i deixava la resta de la casa genèrica).

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg`. Cantonada sud-est: façana sud amb porta de fusta i finestra enreixada, ràfec ample, xemeneia al fons; a la dreta el passatge est.
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_12-C-Santibanez_rumb15.jpg`: panell «12 C. Santibáñez», viewpoint 41.9924458,-5.8958315, rumb 15. Façana sud de cara; a l'esquerra, la tàpia i el porxo de la terrassa.
  - `streetview/2024-09_12-C-Santibanez_rumb330.jpg`: mateix panell, rumb 330. Tàpia de cara a l'oest fins al portal.
  - `streetview/2024-09_13-C-Santibanez_rumb320.jpg`: panell «13 C. Santibáñez», viewpoint 41.9924314,-5.8957127, rumb 320. Cantonada SE: teulada a quatre aigües i xemeneia.
  - `streetview/2024-09_14-C-Santibanez_rumb28.jpg`, `_rumb60.jpg`: panell «14 C. Santibáñez», viewpoint 41.9924561,-5.8959525 (l'enllaç el va passar l'usuari). Per damunt de la tàpia: la terrassa en L del pis de dalt, amb ampit, sota el ràfec.
  - `streetview/2024-09_14-C-Santibanez_rumb345.jpg`, `_rumb15.jpg`: mateix panell. El portal de fusta de dues fulles amb teuladí i, per damunt, l'ampit del terrat del garatge, més baix que el de la terrassa de l'ala.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.99245,-5.89575,92m/data=!3m1!1e3) i `ortofoto.png`.
- Correccions de l'usuari, des del joc: la part1 (el garatge) està unida a la casa i a dalt és un terrat; té una porta de garatge en línia amb el portal de la tàpia.

## Volums

- **part2** (2 plantes, ràfec a ~5,9 m): planta en L. El cos del carrer (5,2 m de façana sud) i l'ala oest, enretirada ~5,5 m darrere el pati. Teulada a quatre aigües per ales (`wings`): carener N-S al cos del carrer i ala E-O, amb aiguafons al racó.
- **Terrassa del pis de dalt** (`loggia`): en L, al racó del pati. Ocupa tota la façana sud de l'ala (t 0,06–1) i el costat oest del cos del carrer fins a ~1 m de la cantonada (t 0–0,82). Fondària 1,2 m (estimada), ampit d'1,0 m, i el ràfec de 0,8 m fa de porxo. Al fons, finestres amb persiana i una porta amb fanal.
- **part1** (1 planta): garatge del pati. Al Cadastre queda separat de l'ala per un buit de ~3,5 m; a la realitat hi està unit (`join: [part2]`). Terrat a 3,0 m (l'altura del pis de dalt), amb ampit d'1,0 m. Porta de garatge de dues fulles a la façana SO, davant del portal.

## Façanes

- **S** (part2, 5,2 m): crema `[222, 212, 192]`, aplacat de pedra fins a 0,85 m. Porta de fusta a t 0,22 (0,9 × 2,1 m), finestra enreixada a t 0,74 (0,75 × 1,1, ampit 1,0), finestra de dalt a t 0,47 amb persiana gairebé baixada. Mides comparant amb la porta.
- **E** (10,5 m, al passatge): finestreta enreixada a la cantonada del carrer (t 0,12) i una finestra de dalt (t 0,45), de la foto del Cadastre.
- **Façanes del pati** (S de l'ala, `nth: 2`; O del cos del carrer): la planta baixa queda darrere la tàpia i no es veu; les obertures de baix són suposades.

## Tàpia del pati (`walls.yaml`, `0232302-carrer`)

- Tota la vora de la parcel·la al carrer (11 m), de la casa veïna `0232301` fins a la cantonada de la casa.
- Mur de 2,0 m (la porta de la casa, de 2,1 m, en dona l'escala) més l'albardilla de teula (~0,22 m). Arrebossat crema, sòcol de pedra de ~0,8 m.
- Portal de fusta de dues fulles a la punta oest, d'uns 1,8 × 2,05 m, amb llinda i teuladí de teula per damunt (`gates`).

## Dubtes i decisions

- La fondària de la terrassa (1,2 m) i on s'acaba al costat oest del cos del carrer són estimacions fetes a partir de les fotos de biaix.
- L'ortofoto detectava un cobert dins del pati (l'ombra de la tàpia i un arbret). La fitxa porta `extra_roofs: false` perquè no surti.
- La paret alta amb el capdamunt inclinat que es veu per damunt del portal és de la casa veïna (`0232301`), no d'aquesta.
