# 0132135TM6503S — finca del 17 C. Santibáñez: garatge al carrer i casa al fons

Fitxa: `tools/mapgen/cases.yaml` · tàpia: `tools/mapgen/walls.yaml` (`0132135-carrer`) · dades i
enllaços de Street View: `expedient.txt`.
Primera fitxa el 2026-10-08; anàlisi detallada (skill `casa-a-mida`) el 2026-10-09.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg` (estiu, anterior al 2024: el garatge tenia la
  porta grisa i el portal era gris). Des del carrer, mirant al SO; a través del portal es veu
  **sencera la façana NE de la casa del fons** (pis amb tres obertures i balcó).
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_7748-C-Santibanez_rumb207.jpg`: panell «7748 C. Santibáñez», viewpoint
    41.9926958,-5.8971993, rumb 207. El garatge de cara i la tàpia a banda i banda.
  - `streetview/2024-09_7748-C-Santibanez_rumb175.jpg`: mateix panell, rumb 175. Portals de l'est de
    biaix; la casa de maó amb balcó del fons és la **veïna de l'est** (15), no aquesta.
  - `streetview/2024-09_7748-C-Santibanez_rumb222_zoom.jpg`: mateix panell, rumb 222: arbres.
  - `streetview/2024-09_7748-C-Santibanez-est_rumb213.jpg`, `…_rumb214.jpg` i
    `…_rumb208_zoom.jpg`: panell «7748 C. Santibáñez» de l'est (panoid 0MV_X_kgWLkAiErpkPBB2Q,
    viewpoint 41.9926564,-5.8970877). **El panell clau**: per sobre del portal i entre la casa
    veïna i el pal, es veu la façana NE de la casa del fons, a ~50 m.
  - `streetview/2024-09_18-C-Santibanez_rumb221.jpg`: «18 C. Santibáñez», la casa veïna de l'est.
  - `streetview/2024-09_7748-C-Santibanez-oest_rumb178.jpg` i `…_19-C-Santibanez_rumb150.jpg`:
    des de l'oest la casa del fons no es veu (el cobert beix i el jardí del veí de l'oest).
  - `streetview/2024-09_7728-ZA-P-2547_rumb272.jpg`: el camí de l'est no té Street View; el panell
    salta a la carretera.
- Vista zenital: `satellit/google_satellit.jpg`
  (https://www.google.com/maps/@41.99248,-5.89733,92m/data=!3m1!1e3) i `ortofoto.png`. Casa del
  fons a quatre aigües; garatge de coberta grisa i cobert blanc darrere; la franja de terra entre
  totes dues, sense coberts.
- Correccions de l'usuari: cap encara.

## Volums

- **part3**, garatge del carrer (1 planta, 4,76 × 5,2 m): blanc, sòcol de maó a franges, coberta
  de fibrociment gairebé plana darrere l'ampit (~3,1 m). Lateral SE cec (es veu pel portal).
- **part2**, cobert blanc darrere el garatge (1 planta): no es veu; lateral SE cec.
- **part1**, casa del fons (2 plantes, 11 × 11 m), a ~45 m del carrer: teulada a quatre aigües
  amb ràfec blanc (~0,6 m), ràfec a ~5,9 m. Pis de **maó groguenc** amb franges verticals i un
  remat de maó vermell; **planta baixa arrebossada de gris** amb **sòcol de pedra** (~0,85 m).
  Totes les persianes baixades a les dues fotos (casa poc habitada?).
- Entre el carrer i la casa, la franja de terra de la finca; cap cobert (no cal `extra_roofs`).

## Façanes

Escala: 61–66 px/m a les dues fotos, confirmat amb la planta (2,9 m) i la llargada cadastral
(11 m). t = 0 a la cantonada E (esquerra mirant des del carrer).

- **part1, NE** (11,0 m). Del Cadastre (sencera) i de SV `…est_rumb208_zoom` (de t ≈ 0,28 fins
  a ~0,95; la resta la tapa la casa veïna o el pal):
  - Pis: porta balconera a t 0,2 (1,3 × 2,2 m) i a t 0,6 (1,4 × 2,2), finestra a t 0,83
    (1,3 × 1,45, ampit 0,8). Balcó corregut de t 0 a 0,79, 1,0 m, barana de ferro negra.
  - Planta baixa: porta de reixa blanca de dues fulles a t 0,42 (1,0 × 2,05, dos graons, ~0,3 m
    sobre el terra), finestra a t 0,615 (1,3 × 1,35, ampit 0,85), porta de reixa blanca a t 0,89
    (1,2 × 2,05). La finestra de t 0,18 és **suposada**: aquell tros queda tapat a totes dues
    fotos.
- **part3, NE** (4,76 m, garatge): porta d'una fulla, marró gairebé negra, de taulons verticals,
  2,45 × 2,55 m al mig (t 0,5). Número 17 i bústia a l'esquerra (no es modelen).
- Les altres façanes de part1 (SE, SO, NO) no es veuen des de cap carrer: finestres generades.

## Tàpies

`0132135-carrer`, a les dues vores del carrer, a banda i banda del garatge (12 m). Les dues vores
del Cadastre a l'est del garatge (3,56 m i el tros de 1,25 m) s'uneixen en un sol mur.

- Muret de maó a franges de ~0,85 m amb albardilla clara i reixa negra fins a ~1,85 m (a l'oest).
- Pilars de maó a franges de 0,45 m i ~2,0 m, amb capitell de pedra en punta: als extrems i a
  cada costat dels portals.
- A l'est, des del garatge: porta de vianants de reixa (0,9 × 1,9 m) i portal de reixa de dues
  fulles (2,3 × 1,9 m). Planxa plena fins a ~0,85 m i barrots al damunt.
- Alçades de SV rumb 207, amb la porta del garatge (2,55 m) de referència (~100 px/m al pla del
  garatge).

## Dubtes i decisions

- El maó a franges vermelles i crema es fa amb un color mitjà (`[207, 150, 120]`) i la textura de
  maó; les franges no es modelen. Tampoc les franges de maó vermell del pis de la casa del fons.
- Els portals tenen una ornamentació de volutes que es fa amb barrots rectes.
- Al darrere del portal hi ha una pèrgola metàl·lica amb parra (SV rumb 214): no es modela.
- La paret de pedra que va del portal cap al fons, a l'est, és de la casa veïna (15).
- El panell de l'est dona rumbs ~3° desplaçats respecte de la posició del panell: la t es va
  treure per proporcions (finestres i franges), no per rumbs.
