# 0132103TM6503S — casa de maó, nord de la calçada

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de Street View: `expedient.txt`.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg`. Dues plantes de maó, entrada al centre
  amb graons, persiana blanca al pis esquerre. El cotxe i els arbres tapen la planta baixa
  i el cos dret.
- Ortofoto: `ortofoto.png`. part1 és el cos llarg (façana NO de 13,4 m, la que mira al carrer);
  part2 és la crugia del costat sud-est.
- Vista zenital: `satellit/google_satellit.jpg`
  (https://www.google.com/maps/@41.992466,-5.897143,48m/data=!3m1!1e3). Els cossos són
  perpendiculars al carrer; des de la calçada es veu el tester nord.
- Street View set. 2024: l'enllaç del nord cau lluny i no s'ha desat captura útil.

## Façanes

- **NO, part1** (13,4 m, 2 plantes). Maó `[168, 88, 62]`, carener paral·lel a la façana.
  - Planta baixa: finestra amb persiana quasi tancada a t 0,22; porta de fusta a t 0,50 amb
    5 graons.
  - Pis: finestra a t 0,22 (persiana a 0,4) i una altra a t 0,72, la que queda a la dreta
    de l'entrada.
- **N, part1** (5,9 m): testera al carrer, no surt a la foto. Mur cec.
- **part2**: mateix maó, dues plantes. La façana SE (12,2 m) dona a un carrer del darrere i
  no s'ha vist: mur cec, per no inventar finestres.

## Dubtes i decisions

- La planta baixa esquerra es dedueix del plafó de fusta que es veu sota la finestra del pis.
- El cos dret de la foto pot ser part2; sense veure-li les obertures no se n'hi han posat.
- El mur de pedra del carrer és la fitxa `0132103-carrer` de `walls.yaml`: la vora de
  parcel·la que dona al carrer (13,2 m), 1,05 m de pedra i reixa de 0,60 m al damunt
  (el conjunt arriba on arriben els pilars de la foto, ~1,65 m).
