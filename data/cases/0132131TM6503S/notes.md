# 0132131TM6503S — casa groga, retirada de la calçada

Fitxa: `tools/mapgen/cases.yaml` · dades i enllaços de Street View: `expedient.txt`.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg`. De cara, amb el mur de bloc i la
  vegetació al davant. És la referència de les obertures: des del carrer (set. 2024) la casa
  queda tapada.
- Ortofoto: `ortofoto.png`. part4 és el cos principal (~187 m²); la planta té graons, i la
  fitxa en fa el rectangle mínim (façana NE de 18,3 m).
- Vista zenital: `satellit/google_satellit.jpg`
  (https://www.google.com/maps/@41.992530,-5.897674,55m/data=!3m1!1e3). Casa retirada, teulada
  a quatre aigües i accés pel nord. No es veu des del carrer; el model no canvia.
- Street View: no se n'ha desat captura. Els enllaços de l'expedient cauen al carrer, al nord,
  i la vegetació no deixa veure la façana.

## Façanes

- **NE, part4** (rectangle, 18,3 m, 1 planta). Mirant-la, t = 0 és el cap sud-est.
  Arrebossat groc `[228, 186, 58]`, sòcol marró d'uns 0,95 m, teulada a quatre aigües.
  - Finestra a t 0,14 (darrere l'arbre de la foto).
  - Porta blanca a t 0,36.
  - Porta de garatge amb reixat a t 0,58 i una altra, més llisa, a t 0,84.
  - Xemeneies grogues als extrems del carener (t 0,10 i 0,78, uns 6,4 m endins).
- part2, part6 i els coberts petits es deixen genèrics: no surten a la foto de façana.

## Dubtes i decisions

- El groc i el marró són de la foto, pujats d'exposició (el blanc de referència cap a 225).
- El mur de bloc del carrer és la fitxa `0132131-carrer` de `walls.yaml`: totes les vores
  de la parcel·la que donen al carrer, 1,20 m (la porta de vianants de la foto en fa ~1,8 i
  el mur n'és uns dos terços). Bloc gris `[186, 178, 166]`, sense reixa.
