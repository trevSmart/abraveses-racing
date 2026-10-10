# Recorregut de tàpies de la Calle Santibáñez

Fet el 2026-10-08. El cotxe del joc i el panorama de Street View es posen al mateix punt i amb el
mateix rumb, de l'oest a l'est (`tmp/ruta_tapies.py` dona les parades). Captures:

- `streetview/pNN*.jpg`: Street View, set. 2024 (només referència; fora del git).
- `joc/pNN_<E>_rumb<R>.jpg`: el joc abans de les fitxes; `joc/pNN_despres.jpg`, després.

Les fitxes són a `tools/mapgen/walls.yaml`. La llargada és la vora cadastral i l'alçada surt de
comparar amb una porta (~2,1 m) o amb la vorera.

| Parada | Panell | Costat | Què hi ha | Fitxa |
|---|---|---|---|---|
| p01 | 7463 ZA-P-2547 | sud | bloc ~1,05 m, gira al camí de l'oest | `santibanez-sud-entrada(-2, -3)` |
| p02 | 7463 ZA-P-2547 | nord | muret de bloc ~0,8 m davant l'hort | `0032940-carrer` |
| p03 | 7742 ZA-P-2547 | nord | bloc i maó ~2,0 m, porta, bloc 1,1 m amb malla verda | `0032941-maó`, `0032941-baix` |
| p04 | 7742 C. Santibáñez | nord | muret de bloc ~0,8 m amb porteta verda | `0032942-carrer` |
| p04-p06 | | sud | bloc ~1,2 m amb reixa/malla verda (casa groga) | `0132131-carrer` (+ `rail_m`) |
| p05 | 7736 ZA-P-2547 | nord | muret de bloc ~0,8 m | `0032944-carrer` |
| p05-p07 | 7748 / 18 C. Santibáñez | nord | bloc ~1,0 m llarg davant el camp | `0132946-carrer`, `0132948-carrer` |
| p07 | 18 C. Santibáñez | sud | bloc ~1,0 m amb pilars i porta | `0132130-carrer` |
| p08 | 7728 ZA-P-2547 | sud | bloc ~1,1 m davant el blat de moro | `0132129-carrer`, `0331128-carrer` |
| p10 | 7725 C. Santibáñez | sud | bloc ~1,1 m amb portes de reixa verda | `0331124…0331127-carrer` |

## Sense fitxa i per què

- Nord, de E 260090 a E 260240: les façanes de les cases donen directament al carrer; els murs
  que hi ha ja eren fitxes (`0332504-carrer`, `0332001-carrer`).
- `0332006` i `0332005` (p09): garatges amb porta al carrer, no tàpies.
- `0332004` (p09): sòcol de pedra ~0,9 m i bloc al damunt fins a ~1,5 m, però la parcel·la encara
  té la casa en ruïna del Cadastre i el mur hi quedaria tallat. Pendent.

## Dubtes

- Al joc, alguns murs queden 2-3 m més enrere de la vorera que a la foto: segueixen la vora
  cadastral, i el carrer del joc és més estret que el real.
- `0132129` i `0331128` comparteixen un camí al sud; aquelles vores no es veuen des del carrer i
  no tenen mur a la fitxa (`near` només amb la vora del carrer).
- El camp del sud (`0331128` a `0331124`) té la vora nord dins la calçada de l'OSM, i el mur
  quedava al mig de la carretera. `resolve_wall_specs` l'enretira cap al camp fins a deixar-la.
