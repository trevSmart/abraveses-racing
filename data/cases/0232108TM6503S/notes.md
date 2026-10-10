# 0232108TM6503S — casa salmó de la cantonada amb la Rinconada (7727 ZA-P-2547)

Fitxa: `tools/mapgen/cases.yaml` · tàpies: `tools/mapgen/walls.yaml` (`0232108-carrer`,
`0232108-porta`, `0232108-tova`) · dades i enllaços de Street View: `expedient.txt`.
Primera fitxa feta el 2026-10-08 (només la façana del carrer). Anàlisi detallada feta el
2026-10-09 amb la skill casa-a-mida.

## Fonts consultades

- Foto de façana del Cadastre: `cadastre_facana.jpg`, des de la cantonada sud-est. Hi surten el
  garatge, el balcó de fusta damunt del garatge, la tàpia del pati i el portal de vianants.
- Street View, set. 2024 (només referència visual; cap píxel al model):
  - `streetview/2024-09_7727-ZA-P-2547_rumb9.jpg`, `_rumb10.jpg`: panell «7727 ZA-P-2547» (41.9924667,-5.8963505), façana S de cara. Quatre finestres amb tendal de ratlles i porticons, emmarcats d'aplacat gris i sòcol de pedra.
  - `streetview/2024-09_7727-ZA-P-2547_rumb50.jpg`: mateix panell, el garatge i la tàpia cap a la cantonada.
  - `streetview/2024-09_7726-C-Santibanez_rumb300.jpg`: panell «7726 C. Santibáñez» (41.9924735,-5.8962168). **La vista clau**: tàpia, portal de la cantonada, pis enretirat amb el balcó de fusta, finestres del costat del pati i tendal clar.
  - `streetview/2024-09_3-Rinconada-de-Santibanez_rumb235.jpg`, `_rumb284.jpg`, `_rumb320.jpg`: panell «3 Rinconada de Santibáñez» (41.9925449,-5.8962214). El portal de fusta amb teuladí, fanal i bústia, i la paret de tova cap al nord.
  - `streetview/2024-09_7728-ZA-P-2547_rumb60.jpg`: panell «7728 ZA-P-2547» (oest). La façana O queda darrere la paret alta de la casa veïna.
  - `streetview/2024-09_Rinconada-nord_rumb198.jpg`: panell de la Rinconada al nord (41.992684,-5.8962552). Només hi surt un paller de tova d'una altra finca; la façana N no es veu.
- Vista zenital: `satellit/google_satellit.jpg` (https://www.google.com/maps/@41.992537,-5.896378,45m/data=!3m1!1e3) i `ortofoto.png`.

## Volums

- **part1** (2 plantes, ràfec a ~6,0 m): la casa, amb planta en L. L'osca de la cantonada SE la
  ocupa el garatge. Teulada a quatre aigües per ales (`wings`) amb ràfec de bigues de fusta.
- **part2** (1 planta, ràfec a 2,6 m): el garatge, amb la teulada d'una aigua cap al carrer
  (`type: shed`, nou) i un voladís de teula de 0,35 m.
- **Pis enretirat damunt del garatge** (la façana S de l'osca, `nth: 2`): un finestral amb persiana
  de fusta i un balcó de 0,7 m amb barana de fusta (`rail`, `rail_bar_m`, nous).
- **Pati de l'est** (~5 × 7 m), dins de la parcel·la. No hi ha cap cobert del Cadastre; per damunt
  de la tàpia es veu el tendal clar de la casa.

## Façanes

- **S, part1** (6,94 m): salmó `[214, 156, 122]`, sòcol de pedra de 0,8 m. Finestres a t 0,22 i
  0,50, a les dues plantes. Totes tenen porticons de fusta tancats (`fill`) i tendal de ratlles
  marró i crema. El terç est és cec, amb el comptador.
- **S de l'osca, part1** (2,63 m, pis): finestral de 1,5 × 2,0 m amb persiana i balcó de fusta.
- **E, part1** (3,98 m, al pati):
  - a dalt, una finestra (t 0,3) i una finestreta (t 0,78) amb porticons;
  - a baix, una porta amb fanal i una finestra amb tendal clar. Darrere la tàpia no es veuen bé:
    les mides són suposades.
- **E de l'osca, O i N, part1**: cegues (la de l'osca dona damunt del garatge; O i N queden tapades
  per les cases veïnes).
- **S, part2** (2,52 m): porta seccional marró de 2,3 × 2,3 m. La E dona al pati, cega.

## Tàpies

- `0232108-carrer`: la vora S del pati (5,3 m). Arrebossat salmó clar, 2,0 m més la teula, amb un
  sòcol de pedra de 0,75 m.
- `0232108-porta`: el primer 1,5 m de la vora E, a la cantonada amb la Rinconada. Hi ha la porta
  de fusta (0,95 × 2,05 m) amb teuladí, i el mur és de 2,2 m.
- `0232108-tova`: la resta de la vora E (5,3 m). Paret vella de tova de ~2,4 m, amb el capdamunt
  esfondrat. A la foto continua cap al nord per la parcel·la veïna.

## Dubtes i decisions

- Al fons del pati es veu un volum crema amb teulada d'una aigua. Pot ser un cobert del pati o la
  casa veïna del nord, i no l'he modelat. Si és del pati, caldria afegir-lo.
- La fitxa vella hi tenia un balcó a la façana S i una porta a la façana E del garatge. No surten a
  cap foto i els he tret (la porta de fusta de la foto del Cadastre és la del portal del pati).
- La porta de vianants és en un xamfrà curt a la cantonada. El Cadastre no té xamfrà, i l'he posada
  a la punta sud de la vora E.

## Correccions de l'usuari

- Cap, de moment.
