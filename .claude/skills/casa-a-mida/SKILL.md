---
name: casa-a-mida
description: Anàlisi personalitzada i model a mida d'una casa d'Abraveses (fitxa a cases.yaml, tàpies a walls.yaml, expedient a data/cases/<ref>/). Fes-la servir quan l'usuari demani modelar, revisar, refer o corregir una casa del poble, quan doni una referència cadastral de 14 caràcters o una captura del joc d'una casa, o quan pregunti quines cases falten.
---

# Casa a mida: anàlisi personalitzada d'una casa del poble

Aquest és el procediment complet per passar una casa de genèrica (o amb una fitxa feta a mitges)
a **anàlisi detallada** (`review: {level: full}`). Surt de la primera casa que es va fer així,
`0232302TM6503S` (12 C. Santibáñez). Les normes generals, el format de `cases.yaml` i `walls.yaml`
i les ordres són a `AGENTS.md`: llegeix-lo abans de començar. Les fórmules i les receptes
(coordenades, Street View, càmera del joc) són a [referencia.md](referencia.md).

## Què vol dir «anàlisi detallada»

La primera versió de la casa de mostra només modelava la façana del carrer a partir de la foto
del Cadastre i d'una captura de Street View. L'usuari la va trobar «que no s'assembla res». Hi
faltaven:

- la tàpia del pati, amb el portal;
- la terrassa en L del pis de dalt;
- la teulada en L;
- el garatge amb terrat.

A més, al pati hi havia un cobert que no existeix. **La casa és tota la parcel·la**, no la façana:

1. **Tots els volums**: cada part del Cadastre tal com és de debò. Compta les plantes, el ràfec i
   la forma de la teulada. Mira si està unida a una altra part, si té terrasses o terrats, i quins
   coberts sobren o falten.
2. **Totes les façanes que es veuen** des de qualsevol carrer, plaça o camí, també per damunt de
   les tàpies. Hi han d'anar les obertures reals, no les generades.
3. **Les tàpies de la parcel·la**: alçada, material, sòcol, albardilla i portals.
4. **Res inventat que es vegi**: ni coberts fantasma de l'ortofoto ni finestres generades en
   façanes visibles.
5. **L'expedient complet** i el model **verificat al joc** des de cada carrer.
6. **L'usuari ha validat els volums.** Ell coneix el poble: les correccions més importants de la
   casa de mostra les va fer ell mirant una previsualització.

## Procediment

Ves marcant els passos. Cada fase acaba amb una comprovació. No passis a la següent fins que
la comprovació surti bé.

### 0. Situa't

- Mira l'estat amb `python tools/mapgen/cases_status.py`. Escriu `data/cases/ESTAT.md` i et diu si
  la casa és genèrica, si té fitxa o si ja té l'anàlisi detallada.
- Si ja té fitxa, llegeix-la a `cases.yaml`, i també el seu `notes.md` i les fitxes de `walls.yaml`
  de la mateixa parcel·la. Hi pot haver feina aprofitable i errors coneguts.
- Hi pot haver altres agents treballant alhora. Rellegeix cada fitxer just abans d'editar-lo, i
  no revertis canvis que no siguin teus.

### 1. Identifica la casa i totes les seves parts

- Treu-ne l'expedient amb `python tools/mapgen/casa_info.py <ref>` (o `--near E N`). Et dona les
  parts, les façanes amb la cantonada de t = 0, les mitgeres i els enllaços de Street View, i
  crea `data/cases/<ref>/`.
- Al **mode dev del joc** (Maj+D), cada color és un model diferent (un house_id), i n'hi ha un per
  part cadastral. El que surt en passar el ratolí és la referència. **Un bloc dins de la parcel·la
  que no té referència és un cobert detectat a l'ortofoto**, no una part del Cadastre. A la casa de
  mostra, el «bloc verd» del pati era un d'aquests, i era fals.
- Fes `python tools/mapgen/preview_casa.py <ref>` des del principi. Treu les **arestes finals de
  cada part** (orientació, `nth`, llargada i t = 0 en UTM) i **les vores de la parcel·la**. Són les
  dades per escriure la fitxa i la tàpia.
- Desconfia del Cadastre com a retrat de la casa. Serveix per a la planta i les mides, però:
  - **dues parts separades per un buit poden estar unides** a la realitat. A la casa de mostra hi
    havia un garatge a ~3,5 m de l'ala, i en realitat s'hi tocaven (`join`);
  - **una part pot tenir planta en L** i, per tant, dues façanes cap al mateix costat (`nth`). Amb
    una sola teulada sobre el rectangle mínim, el pati del racó queda tapat (`wings: true`);
  - una part d'«1 planta» pot ser un garatge amb un **terrat transitable** (`type: flat`);
  - la foto del Cadastre només ensenya una cantonada.

### 2. Recull totes les vistes

Fes servir Claude in Chrome. Com es fa cada cosa (format dels URL, panoid, rumb, inclinació,
espera, desar) és a [referencia.md](referencia.md#street-view).

- **Recorre tots els panells de Street View dels carrers que envolten la parcel·la**, d'un extrem a
  l'altre i també davant de les cases veïnes. A cada panell, gira la vista tota la volta.
  - **El panell clau de la casa de mostra no era el de la seva adreça**: era el «14
    C. Santibáñez», el de la casa del costat. Només des d'allà es veien el pati, la terrassa i el
    garatge per damunt de la tàpia.
  - Els enllaços de `casa_info.py` són per façana i van al panell més proper. Si una façana no té
    carrer al davant, l'enllaç acaba al mateix carrer de sempre. Això vol dir que aquella façana no
    es veu, no que la vista que surt sigui seva.
- Mira **per damunt de les tàpies**: hi surten terrasses, ampits, xemeneies i el volum dels
  coberts del pati.
- Fes **la vista zenital** de satèl·lit, amb el nord a dalt. Compara-la amb `ortofoto.png` per
  veure la forma de la teulada (L, quatre aigües, carener), els terrats i els patis.
- **Desa cada captura bona de seguida** a `streetview/`. Fes servir `save_to_disk` i copia-la amb
  el nom `AAAA-MM_<adreça>_rumbNNN.jpg`. No la deixis per al final: les captures temporals es
  perden.
- **Decideix de qui és cada cosa** abans de modelar-la. Per damunt del portal de la casa de mostra
  es veia una paret alta, i era de la casa veïna (`0232301`). Mira on cau a la planta, amb el rumb
  del panell i les vores de la parcel·la.
- Les fotos de Google són **només referència** (cap píxel al model) i no es publiquen
  (`streetview/` i `satellit/` són al `.gitignore`).

### 3. Llegeix la casa: volums i lògica d'ús

Abans de mesurar res, escriu a `notes.md` (secció «Volums») com és la casa sencera:

- Fes una llista de les parts: quines són habitatge, garatge, cobert o nau. Mira si estan unides,
  quantes plantes tenen i quina teulada (dues aigües, quatre, en L, terrat).
- Fes servir la **lògica d'ús**:
  - un portal gran a la tàpia vol dir que hi entra un vehicle; busca'n el garatge, sovint en línia
    amb el portal (a la casa de mostra la porta del garatge era just davant);
  - una porta al pis de dalt que dona a fora vol dir que hi ha una terrassa o un balcó;
  - un ampit més baix al costat d'una ala vol dir que hi ha un terrat.
- **Lògia o balcó?** Si l'ampit és a pla amb el pilar de la cantonada i el ràfec el cobreix, la
  terrassa està encastada dins de la planta (`loggia`). Si l'ampit sobresurt de la façana, és un
  balcó (`balconies`).
- **Ensenya els volums a l'usuari aviat**: una captura de la previsualització amb una línia per
  part. Les seves correccions valen més que qualsevol mesura.

### 4. Mesura

- **Escala**: compara amb una referència que estigui **a la mateixa profunditat**.
  - Una porta fa ~2,1 m, una porta de garatge ~2,4 m i cada planta ~2,9 m.
  - Calcula els píxels per metre amb la referència i aplica'ls només al que tingui al mateix pla.
  - En vistes de biaix, el que és a prop surt més gran: no barregis plans.
- **Llargades**: surten del Cadastre (la llargada de la façana i la vora de la parcel·la). No les
  mesuris a la foto.
- **Posició de les obertures**: fes-la servir com a fracció t de la façana.
  - **t = 0 és l'esquerra mirant la façana des de fora.** En una façana que mira a l'oest,
    l'esquerra és el nord.
  - `preview_casa.py` et dona la cantonada de t = 0 de cada aresta.
- **Xemeneies, portals, punts UTM**: passa'ls a t i fondària amb les fórmules de
  [referencia.md](referencia.md#de-utm-a-t-i-fondària).
- **Colors**: treu-los de la foto, amb l'exposició corregida (un blanc de referència ha de quedar a
  ~225).
- **Escriu d'on surt cada mesura** a `notes.md`. Si és una estimació (la fondària d'una lògia vista
  de biaix, les obertures de baix amagades darrere la tàpia), digues-ho.

### 5. Escriu la fitxa i les tàpies

- Escriu `cases.yaml` amb el format d'`AGENTS.md`. El que ja hi ha per a plantes en L i patis:

  | Què veus | Què hi poses |
  |---|---|
  | Planta en L | `roof: {..., wings: true}` (i `ridge` per al cos principal) |
  | Dues façanes cap a la mateixa orientació | `facades: - facade: S` amb `nth: 2` |
  | Terrassa encastada al pis, sota el ràfec | `loggia` dins de la façana (`from`, `to`, `depth_m`, `floor`, `parapet_m`, obertures del fons) |
  | Terrassa en L al racó | dues `loggia` (una a cada façana del racó) que arribin a la cantonada (`to: 1.0` / `from: 0.0`) |
  | Part separada al Cadastre però unida a la foto | `join: [partN]` |
  | Terrat transitable | `roof: {type: flat, parapet_m, cap, floor_color}` |
  | Cobert de l'ortofoto que no existeix | `extra_roofs: false` |
  | Nau o cobert que es veu però no és al Cadastre | `extra_parts` (contorn UTM) amb `extra_roofs: false` |
  | Ruïna o solar amb murets | `roof: {type: none}` amb `eave_m` = alçada dels murs |
  | Garatge o cobert adossat amb una sola aigua | `roof: {type: shed, toward: …}` |
  | Porxo d'entrada encastat a la planta baixa | `loggia` amb `floor: 0`, `parapet_m: 0` i la porta a `openings` |
  | Balcó amb barana de fusta | `balconies` amb `rail` i `rail_bar_m: 0.06` |
  | La casa de la foto del Cadastre ja no existeix | modela el Street View (el més recent) i explica-ho a `notes.md` |
  | Façana del pati que no es veu | `openings` suposades, i digues-ho a `notes.md` |

- Fes **les tàpies a `walls.yaml`**, no a la casa.
  - La llargada és la vora de la parcel·la. Fes servir `near`, amb un punt UTM sobre la vora que
    et dona `preview_casa.py`.
  - L'alçada del mur es compta sense l'albardilla.
  - Hi pots posar `plinth` (sòcol), `tiles` (teula) i `gates` (portals amb el `near` al centre).
- **Si cal un element nou**, posa'l a `village.py` (o a `walls.py`) de manera genèrica i que es
  pugui activar des de la fitxa, sense canviar les cases que no el fan servir. Documenta'l a
  `AGENTS.md`. Mira les limitacions conegudes a [referencia.md](referencia.md#limitacions-conegudes).

### 6. Previsualitza i itera

- `python tools/mapgen/preview_casa.py <ref> --cam E N h --target E N h` construeix la casa i
  les seves tàpies en uns segons.
  - Obre l'URL que et dona, amb `python3 -m http.server 8765` dins de `tmp/`.
  - Posa la càmera als mateixos punts que els panells de Street View, a 1,7 m.
- Compara cada vista amb la seva captura. Itera aquí, no amb el món sencer.
- Busca els defectes típics:
  - escletxes entre parets, normalment d'un marge de tall mal ajustat;
  - cares solapades al mateix pla, que parpellegen;
  - teulades que tapen patis;
  - parets d'una part dins d'una altra;
  - albardilles amb graons.
- **Ensenya la previsualització a l'usuari** (una captura) abans de regenerar el món.

### 7. Regenera i verifica al joc

- Regenera amb `python tools/mapgen/build_world.py > tmp/build_world_<ref>.log 2>&1`, que tarda
  uns 2–3 minuts. Al registre hi ha de ser:
  - `Village: N parts de casa amb fitxa`;
  - `Tàpies: fitxa <id>, N m`;
  - cap línia «sense parts», «sense mur propi», «no encaixa», «ales sense», ni cap `Traceback`.
- Al joc (`http://localhost:5173`), **no et refiïs de la càmera de seguiment**: als carrers
  estrets queda dins de les cases. Fes servir la càmera fixa de [joc_camera.js](joc_camera.js),
  amb `__view(E, N, h, tE, tN, th)` als mateixos punts que els panells.
- Fes almenys una captura des de cada carrer on doni la casa i desa-la com a
  `data/cases/<ref>/joc_<orientació>.jpg`.

### 8. Tanca la casa

- Completa `notes.md`, amb aquestes seccions:
  - **Fonts**: totes les captures, amb el panell, el viewpoint i el rumb;
  - **Volums**;
  - **Façanes**;
  - **Tàpies**;
  - **Dubtes i decisions**;
  - **Correccions de l'usuari**.
- Afegeix a la fitxa `review: {level: full, date: "AAAA-MM-DD"}`.
- Executa `python tools/mapgen/cases_status.py`. La casa ha de sortir a «Anàlisi detallada feta»
  amb la columna «falta» buida (—).
- Actualitza la llista de cases i tàpies amb fitxa d'`AGENTS.md` («Estat»).
- Tanca les pestanyes del navegador que hagis obert. No facis commits si no te'ls demanen.

## Lliçons apreses (casa 0232302TM6503S)

1. **Una foto i una façana no són una casa.** La foto del Cadastre ensenya una cantonada, i la
   casa és tota la parcel·la. Fins que no s'han vist el pati i els volums de darrere, la fitxa no
   està feta.
2. **El panell bo pot ser el del veí.** Recorre el carrer passat els límits de la parcel·la i gira
   cada panell tota la volta.
3. **El Cadastre parteix i separa coses que són juntes.** Una part separada per un buit pot estar
   unida (`join`), i una L té dues façanes cap al mateix costat (`nth`).
4. **La teulada d'una L no és un rectangle.** Amb un sol rectangle mínim, el racó del pati queda
   cobert. Fes servir `wings: true`.
5. **L'ortofoto s'inventa coberts als patis**, per les ombres de les tàpies i els arbrets. Si un
   bloc no té referència al mode dev, és sospitós (`extra_roofs: false`). També en fa davant de
   les façanes, a la placeta o al carrer, perquè la perspectiva hi desplaça la teulada de la
   mateixa casa (`0432822`, `0432826`). `extra_roofs: false` treu també els que toquen la casa.
6. **Pensa com qui hi viu.** Portal gran vol dir garatge en línia; porta al pis de dalt vol dir
   terrassa; ampit baix al costat d'una ala vol dir terrat.
7. **Encastada o volada?** L'ampit a pla amb el pilar vol dir lògia; l'ampit que sobresurt vol dir
   balcó.
8. **Assigna cada element a la seva casa.** La paret alta per damunt del portal era de la casa del
   costat.
9. **La tàpia també és la casa**: és el que es veu primer des del carrer. Mesura'n l'alçada amb la
   porta de la casa. La teula hi afegeix ~0,2 m, i el portal fa ~1,8 × 2,05 m (dues fulles).
10. **L'usuari coneix el poble.** Ensenya-li els volums aviat. Una captura amb línies o creus és la
    manera més ràpida de rebre'n correccions.
11. **Itera a la previsualització, no al món.** Una regeneració triga 2–3 minuts, i una
    previsualització, segons.
12. **Al joc, càmera fixa.** La càmera de seguiment acaba dins de les cases. El rumb del HUD és
    180° − h: per mirar al nord, h = π.
13. **Els detalls que delaten**: escletxes de 3 cm on s'acaba un forat, cares solapades que
    parpellegen i albardilles amb graons cada bloc. Mira-ho de prop abans de donar-ho per bo.
14. **Fitxers compartits.** Si edites un fitxer amb un script de Python, l'eina Edit avisarà que
    ha canviat. Rellegeix-lo i comprova amb `git diff` que el canvi és teu i no d'un altre agent.
15. **La foto del Cadastre pot ser antiga.** A `0232301` la casa emblanquinada de la foto s'havia
    enderrocat i ara hi ha un bloc nou amb garatge. Compara sempre amb el Street View del 2024.
16. **Al joc, aparta el cotxe i fes recular la càmera.** Els panells de Street View són a 3–4 m de
    la façana; al joc la mateixa posició queda massa a prop o dins d'un mur. Recula 2–4 m en la
    direcció de la vista (vegeu `__v` a [referencia.md](referencia.md#joc)).
17. **Les fitxes velles s'han de llegir amb desconfiança.** A `0232108` tenia un balcó i una porta
    que no existeixen, i a `0332704` la porta era a l'altre extrem. Torna-ho a comprovar tot.
18. **Els noms de carrer no coincideixen.** L'OSM (que fa servir `ESTAT.md`) i Google poden donar
    noms diferents per al mateix tram: aquesta casa és «Calle de la Iglesia» a l'OSM i «12
    C. Santibáñez» a Street View. A `notes.md`, fes servir l'adreça del panell.
19. **Una casa al fons de la finca es busca de biaix, per sobre del portal.** A `0132135` la casa
    és a ~50 m del carrer i el garatge la tapa des del davant. Calcula'n el rumb des de panells
    de banda i banda (tots dos costats del carrer, i els camins del darrere si n'hi ha) i
    amplia (`15y`–`25y`). Va sortir per sobre del portal, des del panell de l'est.
20. **La foto del Cadastre pot ser l'única vista sencera.** A `0132135`, Street View només
    ensenyava mitja façana. La foto del Cadastre, retallada i ampliada (PIL, ×5), en donava
    sencera la composició. Encaixa-les per elements comuns (finestres, franges) abans de mesurar.
21. **No et refiïs del rumb de l'URL per mesurar.** Entre dues captures del mateix panell, el rumb
    es va desplaçar ~3°. Situa les obertures per proporcions (alçada de planta, finestres
    conegudes) i amb la llargada cadastral, no per angles.
22. **Les finques llargues tenen tres capes**: la tàpia del carrer (pilars, portals), els coberts
    del carrer i la casa del fons. Cadascuna es veu des d'un panell diferent. Els laterals que es
    veuen a través del portal també s'han de fer (sovint cecs: `facades` amb `openings: []`).
23. **Les t d'una façana de biaix surten per perspectiva, no per regla de tres.** Ni la posició del
    panell ni el rumb de l'URL són fiables (a `0032941` el panell era a 7 m de la façana i la càmera
    real a 14). Busca la posició de la càmera que posa les dues cantonades on surten a la foto i
    fa que l'alçada de planta a cada punta quadri, i projecta-hi la façana (recepta a
    [referencia.md](referencia.md#t-per-perspectiva)). Les amplades medides inclouen els emmarcats.
24. **Al joc, l'alçada de la càmera és la del terra d'aquell punt.** `__go(E, N, …)` torna el terra
    del lloc: crida-la al punt de la càmera abans de `__view`. Amb el terra d'un altre lloc la
    càmera queda soterrada i les tàpies semblen de 3 m. I no posis la càmera dins d'un pati veí.
25. **Revisa també les fitxes velles «bones».** A les quatre cases de l'entrada oest hi havia una
    teulada a quatre aigües que era a dues, un annex a dues aigües que era d'una, un garatge a
    l'altra punta de la paret, un cobert tancat que és obert i un mur de formigó que era d'una
    altra parcel·la.
26. **Cada part que es veu des del carrer necessita fitxa**, encara que sigui un cobert. Una part
    sense fitxa porta porta i finestres genèriques, i a la captura del joc es nota de seguida
    (`0431501`). Compara cada captura del joc amb Street View abans de donar la casa per acabada.

## Ordre de feina suggerit

Mira `data/cases/ESTAT.md`. Primer, les cases **amb fitxa pendents d'anàlisi detallada** de la
Calle Santibáñez: ja tenen expedient i és qüestió d'ampliar-lo. Després, la Calle el Cristo, i
finalment la resta per carrers. Fes una casa sencera cada vegada (fases 0–8), i agrupa en una
sola regeneració les cases veïnes que comparteixin carrer.
