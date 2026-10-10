# 0032941TM6503S — casa de maó vist amb balcó corregut (7742 ZA-P-2547, costat nord)

Fitxa: `tools/mapgen/cases.yaml` · tàpies: `tools/mapgen/walls.yaml` (`0032941-maó`,
`0032941-baix`) · dades i enllaços de Street View: `expedient.txt`.
Primera fitxa el 2026-10-08; anàlisi detallada (skill `casa-a-mida`) el 2026-10-09.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg` (des del SE; sencera, amb la finestreta del
  frontó oest).
- Street View, set. 2024 (només referència visual):
  - `streetview/2024-09_7742-ZA-P-2547_rumb10.jpg` (fov 90) i `…_rumb0.jpg`: façana S sencera.
    **Captura clau** per a les t.
  - `streetview/2024-09_7742-ZA-P-2547-est_rumb280.jpg`: frontó de l'est (teulada a dues aigües).
  - `streetview/2024-09_7742-ZA-P-2547_rumb330.jpg` i `…_7463-ZA-P-2547_rumb40.jpg`: la paret
    del carrer de bloc i maó buit (el tancament del cobert).
- Vista zenital: `satellit/google_satellit.jpg` i `ortofoto.png`.
- Correccions de l'usuari: cap encara.

## Volums

- **part2** (17,6 × 8,9 m, 2 plantes): maó vist taronja; teulada **a dues aigües** amb el carener
  paral·lel al carrer i frontó a l'est (la fitxa vella la feia a quatre aigües). Ràfec a ~5,9 m
  amb voladís gran (~0,9 m).
- **part1** (cobert de l'oest, 7 × 18 m): **obert cap al pati** (est), amb pilars i coberta de
  xapa vermella d'una aigua que baixa cap al pati; paret del fons de maó buit sobre bloc. La seva
  testera sud és la paret del carrer (~2,4 m). Modelat amb una `loggia` de planta baixa amb
  `posts`.

## Façanes

- **part2 S** (17,64 m). t per perspectiva a SV rumb 10: posició de la càmera trobada perquè les
  dues cantonades caiguin a 412 i 1140 px i la planta (2,9 m) faci 225 i 138 px a cada punta.
  - Planta baixa: garatge gris de 4 fulles amb marcs vermells a t 0,178 (4,6 × 2,6 m); finestra
    amb emmarcat de pedra a t 0,633 (1,2 × 1,1); porta blanca a t 0,924. Sòcol de pedra ~1,0 m.
    Un pegat d'arrebossat blanc (t ~0,46–0,59) no es modela.
  - Pis: finestra de fusta blanca sense persiana (t 0,145), finestres amb persiana a t 0,358 i
    0,611 (més ampla), balconera a t 0,761. Balcó corregut amb cantell de pedra i barana de ferro
    amb ornaments daurats (de −0,03 a 1,03, 1,2 m).
- **part2 E** (frontó, 8,9 m): finestra al pis (t ~0,6) i a baix (t ~0,72). Ajustades comparant la
  captura del joc amb SV rumb 280 des del mateix punt.
- **part2 O** (frontó, per sobre de la paret del carrer): finestreta al pis (foto del Cadastre).
- part2 N no es veu: finestres generades.

## Tàpies

- `0032941-maó`: paret del carrer, bloc fins a ~1,2 m i maó buit fins a ~2,4 m (abans 2,0).
- `0032941-baix`: muret de bloc d'~1,1 m amb malla verda davant la casa (sense canvis).

## Dubtes i decisions

- Les amplades d'obertura medides inclouen els emmarcats; s'han reduït ~20 %.
- El nombre i la posició dels pilars del cobert són aproximats (un cada ~3 m).
