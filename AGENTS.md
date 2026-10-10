# AGENTS.md — Abraveses Racing

Joc de conducció arcade (Three.js) pel poble real d'**Abraveses de Tera** (Micereces de Tera,
Zamora). El món surt de dades obertes: OpenStreetMap, MDT de l'IGN, ortofoto PNOA i Cadastre.

## Normes del projecte

- **Català** a comentaris, docstrings, missatges de consola i documentació. Els identificadors van
  en anglès. Segueix la densitat de comentaris del codi que tens al voltant.
- 1 unitat = 1 metre.
- Coordenades:
  - **UTM**: EPSG:25830 (ETRS89 / UTM 30N).
  - **Local** (pipeline): x = est, y = nord, relatives a `utm_origin(cfg)`.
  - **Món** (glTF / joc): `[x, alçada, -nord]` (vegeu `_w()` a `village.py`). Al joc, el
    *heading* 0 apunta al sud (+Z).
- **Colors de vèrtex**: el glTF els desa en espai **lineal**. Els colors sRGB (els de les fotos)
  es passen per `_lin()` / `_srgb_to_linear()`.
- **Materials del joc**: es trien pel nom de la malla, a `tintWorld()` de `web/src/main.ts`:
  - `building*` és sòlid i té col·lisió;
  - si el nom conté `tapia` o `brick`, fa servir la textura de maó; si conté `stone`, la de
    pedra; si no, la d'arrebossat;
  - `roof*` porta el color mitjà de teula de l'ortofoto al color de vèrtex (sense projectar la
    foto) i un detall de teula alineat segons la normal de cada vessant;
  - `prop*` són detalls sense col·lisió, i `prop_windows` és el vidre.
- Hi pot haver **altres agents treballant alhora** al mateix repo. Abans d'editar un fitxer,
  rellegeix-lo, i no revertis canvis que no siguin teus.
- No facis commits si no te'ls demanen.

## Ordres

```bash
source .venv/bin/activate                       # Python 3.9+ (tools/requirements.txt)
python tools/mapgen/build_world.py              # regenera web/public/world.glb (~2 min)
python tools/mapgen/build_world.py --all        # també torna a baixar OSM i DEM
python tools/mapgen/fetch_cadastre.py           # torna a baixar el Cadastre (data/raw/catastro)
python tools/mapgen/casa_info.py <ref>          # expedient d'una casa (vegeu més avall)
python tools/mapgen/preview_casa.py <ref>       # previsualitza una casa i les seves tàpies (tmp/)
python tools/mapgen/cases_status.py             # recompte de cases → data/cases/ESTAT.md
cd web && npm run dev                           # joc a http://localhost:5173
cd web && npm run build                         # tsc + vite build
```

`data/raw` i `data/processed` no són al repo. `web/public/world.glb` sí, perquè el joc el
necessita.

## Estructura

| Camí | Què hi ha |
|---|---|
| `tools/mapgen/config.yaml` | bbox, origen, zona de detall, camins de sortida |
| `tools/mapgen/build_world.py` | orquestra el món: terreny, carrers, aigua, poble i export a GLB |
| `tools/mapgen/village.py` | poble en 3D: cases (Cadastre), tàpies, arbres, parcel·les, fitxes de casa |
| `tools/mapgen/cases.yaml` | **fitxes de casa a mida**, per referència cadastral |
| `tools/mapgen/walls.yaml` | **fitxes de tàpia a mida**: llargada de la vora cadastral, alçada de la foto |
| `tools/mapgen/walls.py` | quines vores tenen tàpia segons l'ombra de l'ortofoto, i com es resolen les fitxes |
| `tools/mapgen/poles.yaml`, `poles.py` | **postes elèctrics** situats a Street View: pal de formigó (`building_poles`, amb col·lisió) i cables (`prop_wires`, sense) |
| `tools/mapgen/casa_info.py` | expedient d'una casa per preparar-ne la fitxa |
| `tools/mapgen/preview_casa.py`, `preview_casa.html` | previsualització d'una casa sobre terreny pla, amb les arestes i les vores de la parcel·la |
| `tools/mapgen/cases_status.py` | recompte: quines cases tenen model propi i anàlisi detallada (`data/cases/ESTAT.md`) |
| `.claude/skills/casa-a-mida/` | **skill** amb el procediment complet i les lliçons per fer l'anàlisi detallada d'una casa |
| `tools/mapgen/church.py`, `hermitage.py` | models propis de l'església i l'ermita |
| `web/src/main.ts` | joc: càrrega del món, materials, física, HUD, minimapa, mode dev |
| `docs/MAP_PIPELINE.md` | detall del pipeline de dades |

## Cases a mida: substituir les cases genèriques una per una

Per defecte, `village.py` construeix cada part cadastral (`BuildingPart`) amb un estil a l'atzar:
color de la paleta, finestres, porticons, teulada a dues aigües. Les cases que tenen fitxa a
`cases.yaml` es construeixen amb les dades reals. L'objectiu és anar posant fitxa a totes les
cases del poble, començant per la Calle Santibáñez.

**Per a cada casa, segueix la skill `casa-a-mida`** (`.claude/skills/casa-a-mida/SKILL.md`): és
el procediment d'aquesta secció ampliat amb el que es va aprendre fent l'anàlisi detallada de
`0232302TM6503S`. Hi ha tota la parcel·la, no només la façana: volums, terrasses, pati, tàpies i
verificació al joc. Quan una casa està acabada, la fitxa porta `review: {level: full, date: …}`.
`python tools/mapgen/cases_status.py` en fa el recompte a `data/cases/ESTAT.md` (generat: no
l'editis a mà).

### Fonts i quin pes té cadascuna

1. **Cadastre (la base geomètrica i de dades).** Ja és a `data/raw/catastro`.
   - `BuildingPart`: planta exacta de cada part i **nombre de plantes**. Una casa sol tenir
     diverses parts: cos principal, annex, cobert, porxo.
   - `Building`: ús (`currentUse`), habitatges, superfície construïda (`value`, en m²), any de
     construcció (`beginning`), estat, i `documentLink`, que és la **foto de façana del
     Cadastre**.
   - Fes servir el Cadastre per a la planta, el nombre de plantes de cada part i les mides. Com
     més antiga és la casa, més probable és que sigui de tova o de pedra; a partir dels anys 70,
     sol ser de maó amb arrebossat.
   - Fes-la servir també per contrastar el que veus: si la foto mostra dues plantes on el
     Cadastre en diu una, pot ser que l'edifici s'hagi reformat o que t'hagis equivocat de
     casa. Comprova-ho abans de seguir.
2. **Foto de façana del Cadastre.** Tens l'URL a `documentLink`, i `casa_info.py` la baixa sola.
   És una foto de cara, d'estiu, i les dades del Cadastre es poden reutilitzar citant-ne la
   font. És la millor referència visual, encara que de vegades no hi és o el servei no respon.
   Torna-ho a provar.
3. **Google Street View.** Serveix per veure més angles, laterals, la data i les obertures
   tapades a la foto del Cadastre. **Només com a referència visual**: els termes de Google no
   permeten obres derivades, així que mai no se'n posen píxels al model (ni textures ni
   retalls). Mira-ho amb el navegador i anota'n el que veus a la fitxa.
4. **Vista de satèl·lit de Google Maps.** És una vista zenital de la casa, sovint més recent i
   més nítida que l'ortofoto PNOA. Serveix per veure la teulada i el seu carener, xemeneies,
   patis, tanques i què toca a cada façana. Té la mateixa restricció que Street View: només
   referència.
5. **Ortofoto PNOA** (`data/processed/ortho_master.jpg`, ~18 cm/px). Serveix per veure la forma
   de la teulada (a dues o a quatre aigües, on cau el carener), xemeneies, patis i què hi ha
   davant de la casa. Les teulades del joc ja agafen el color de l'ortofoto.

### Procediment per a cada casa

1. **Identifica la casa amb la referència cadastral (14 caràcters).**
   - L'usuari la pot treure del joc: amb el mode dev (**Maj+D**), en passar el ratolí per sobre
     d'una casa en surt la referència.
   - Les coordenades del HUD del joc (`E … · N …`) són les del **cotxe**, no les de la casa. Fes
     servir `casa_info.py --near E N` i comprova-ho igualment.
   - Les etiquetes del tipus «part1 f1» no són referències: diuen la part i el nombre de plantes.
2. **Fes-ne l'expedient:** `python tools/mapgen/casa_info.py <ref>`. Obtindràs:
   - les dades del `Building`;
   - per a cada part, les plantes, l'àrea i cada façana amb la seva orientació, la llargada i
     quina cantonada fa de `t = 0`. Les **mitgeres** (parets que toquen una altra part o un
     altre edifici) surten marcades;
   - un enllaç de Street View des del carrer, mirant cada façana de cara;
   - l'**expedient permanent** de la casa a `data/cases/<ref>/` (vegeu més avall).
3. **Fes les captures de Street View des de tots els angles necessaris i la vista zenital.**
   Totes van a l'expedient.
   - **Street View:** recorre **tots els carrers, places i camins que envolten la casa** i fes
     les captures necessàries per veure-la sencera des de fora:
     - almenys una captura de cara de **cada façana visible**;
     - captures de biaix des de les cantonades, perquè s'hi veuen dues façanes juntes, les
       teulades i els volums;
     - una de més lluny si la façana no hi cap sencera;
     - els detalls que no es distingeixin bé (portes, balcons, xemeneies).
   - `casa_info.py` dona un enllaç de Street View per a cada façana que té carrer al davant:
     obre'ls tots. Després, mou-te pel panell (fletxes, clic al carrer) cap a les cantonades i
     els altres carrers on doni la casa.
   - **Vista zenital:** fes una captura de la casa des de dalt a la vista de satèl·lit de Google
     Maps, amb el nord a dalt i prou zoom perquè la casa ocupi bona part de la imatge. Inclou-hi
     els carrers del voltant i les cases veïnes, que serveixen de referència. Compara-la amb
     `ortofoto.png` i amb les parts del Cadastre.
4. **Modela totes les façanes visibles, no només la principal.** Si la casa dona a més d'un
   carrer, a una plaça o a un camí (cantonades, cases aïllades), cada façana visible es modela
   amb les seves obertures reals (`facades` a la fitxa). Una façana que es veu des del carrer
   no pot quedar amb finestres inventades.
   - Només les façanes que no es veuen des de cap carrer (patis, mitgeres, darreres) es poden
     deixar amb les finestres generades.
5. **Assegura't que és la casa.**
   - A Street View, comprova l'adreça del panell i la brúixola: la punta vermella és el nord.
   - L'orientació de la façana ha de quadrar amb la que dona `casa_info.py`.
   - Si la casa de la foto no lliga amb la planta (amplada de la façana, nombre de plantes,
     teulada), **no és aquesta casa**. Busca-la abans de modelar res.
6. **Mesura cada façana.** Situa cada obertura com una fracció `t` de l'amplada del mur, de
   l'esquerra (0) a la dreta (1) mirant-lo des de fora.
   - Treu les mides en metres comparant amb la llargada cadastral de la façana i amb
     referències conegudes: una porta fa ~0,9 × 2,1 m i cada planta ~2,9 m.
   - Treu els colors de la foto i corregeix-ne l'exposició: un blanc de referència ha de quedar
     a ~225.
7. **Escriu la fitxa a `cases.yaml`** (copia l'estructura d'una casa semblant que ja hi sigui) i
   **completa l'expedient** de `data/cases/<ref>/`: desa-hi les captures i omple `notes.md`.
   Si a les fotos es veu un mur de parcel·la, fes-ne també la fitxa a `walls.yaml` (més avall).
8. **Previsualitza-la** abans de regenerar tot el món. Construeix només aquesta casa amb
   `house_meshes(…, spec=…)` sobre un terreny pla, exporta-la a GLB i mira-la al navegador, per
   exemple amb una pàgina Three.js a `tmp/` servida amb `python3 -m http.server`.
9. **Regenera el món** (`build_world.py`). El registre ha de dir `Village: N parts de casa amb
   fitxa`, sense avisos de «fitxa … sense parts».
10. **Verifica-la al joc** des de cada carrer on doni. A la consola del navegador:
   - `window.__dbg` dona `kart`, `state` i `placeCameraBehindKart`.
   - Posa el cotxe al carrer davant la casa, en coordenades locals: `x = E − origin_utm_x`,
     `z = −(N − origin_utm_y)`. L'origen és a `web/public/world_meta.json`.
   - Posa `state.heading` i `kart.rotation.y` (0 = sud, π = nord) i crida
     `placeCameraBehindKart()`.
   - Compara la captura amb la foto.

### Expedient de cada casa: tot es desa

Tot el que s'ha fet servir per fer la fitxa d'una casa s'ha de **deixar desat** a
`data/cases/<ref>/`, perquè es pugui revisar o refer en el futur sense tornar a buscar res.
Cap foto ni mesura no ha de quedar només a `tmp/`, a la conversa o en una carpeta temporal.

| Fitxer | Què hi va | Qui el fa |
|---|---|---|
| `expedient.txt` | sortida de `casa_info.py`: dades del Cadastre, façanes, enllaços de Street View | `casa_info.py` |
| `cadastre_facana.jpg` | foto de façana del Cadastre | `casa_info.py` (no la sobreescriu si el servei falla) |
| `ortofoto.png` | retall de l'ortofoto amb les parts en groc | `casa_info.py` |
| `streetview/` | **totes** les captures de Street View: almenys una de cara per a cada façana visible, més les de les cantonades i de tots els carrers del voltant | l'agent, en desar la captura |
| `satellit/` | vista zenital de la casa a la vista de satèl·lit de Google Maps, amb el nord a dalt (`google_satellit.jpg`) | l'agent |
| `notes.md` | fonts (data, adreça del panell, viewpoint i rumb de cada captura de Street View; enllaç de la vista de satèl·lit), mesures de cada façana, d'on surt cada valor, dubtes i decisions | l'agent (plantilla de `casa_info.py`) |
| captures del joc (opcional) | com ha quedat el model, des de cada carrer: `joc_<orientació>.jpg` | l'agent |

- Anomena les captures de Street View amb la data del panell, l'adreça i el rumb, per exemple
  `2024-09_7742-ZA-P-2547_rumb180.jpg`. Si l'eina del navegador les desa en una carpeta
  temporal, copia-les a `streetview/` abans d'acabar.
- Una fitxa no està acabada fins que l'expedient té les captures de **tots** els carrers del
  voltant i la vista zenital.
- `data/cases/*/streetview/` i `data/cases/*/satellit/` són al `.gitignore`: les captures de
  Google només es guarden en local com a referència i **no es publiquen**. La resta de
  l'expedient sí que va al repo.
- Si refàs o corregeixes una fitxa, actualitza'n també `notes.md`.

### Format de `cases.yaml`

```yaml
<referència cadastral>:
  photo: "font i data de les fotos (només referència)"
  facade: S                  # orientació (N, NE, E, SE, S, SO, O, "NO"): NO va entre cometes (és un booleà YAML)
  footprint: rect            # opcional: rectangle mínim en lloc de la planta amb graons
  extra_roofs: false         # opcional: el pati no té coberts fora del Cadastre (treu els de l'ortofoto)
  extra_parts:               # opcional: volums que no surten al Cadastre (contorn UTM + fitxa de part)
    - {outline: [[E, N], [E, N], [E, N], [E, N]], floors: 1, eave_m: 2.8, facade: S, roof: {...}, openings: [...]}
  review: {level: full, date: "2026-10-08"}   # anàlisi detallada acabada (skill casa-a-mida)
  # Opcional. Llista: les parts s'uneixen en una sola casa (i les altres no es fan).
  # Diccionari: cada part porta la seva fitxa, amb els camps comuns d'aquí dalt, i les parts que
  # no hi surten es fan com sempre.
  parts:
    part2:
      floors: 2              # per defecte, el del Cadastre
      eave_m: 6.0            # alçada del ràfec sobre el terra (per defecte 0,3 + plantes × 2,9)
      wall: [178, 98, 72]    # sRGB
      wall_material: brick   # opcional: brick | stone (per defecte, arrebossat)
      plinth: [176, 150, 108]
      plinth_h: 0.35
      cladding: {material: stone, color: [168, 124, 92], height_m: 1.1}  # revestiment de baix
      # o capes de baix a dalt: [{material: stone, height_m: 0.85, …}, {color: […], height_m: 2.95}]
      roof: {type: hip | gable, ridge: along | across, pitch_deg: 20, overhang_m: 0.9, fascia: [r, g, b], wings: true}
      # o d'una aigua: {type: shed, pitch_deg: 8, toward: E}   (ràfec a la façana `toward`, per defecte `facade`)
      # o terrat: {type: flat, parapet_m: 1.0, cap: [r, g, b], floor_color: [r, g, b]}
      # o ruïna / solar amb murets: {type: none}   (parets fins a `eave_m`, sense teulada)
      join: [part2]          # opcional: la part arriba fins a una altra (omple el buit del Cadastre)
      windows: {frame: [r, g, b], frame_w: 0.14, roller: [r, g, b]}      # estil de tota la casa
      openings:              # només a la façana `facade`; [] = cap obertura
        - {kind: window, t: 0.3, w: 1.2, h: 1.3, sill_m: 1.0, roller: 0.4, floor: 0, fill: [r, g, b]}
        - {kind: window, t: 0.4, w: 0.9, h: 1.0, sill_m: 1.1, awning: {depth_m: 0.7, color: [r, g, b], stripe: [r, g, b]}}
        - {kind: door, t: 0.6, w: 0.95, h: 2.2, bottom_m: 0.7, color: [r, g, b],
           steps: 4, step_color: [r, g, b], step_rail: [right], sidelight: left, lamp: true}
        - {kind: garage, t: 0.2, w: 4.6, h: 2.6, color: [r, g, b], frame: [r, g, b], leaves: 4, glass_top_m: 0.4}
      balconies: [{floor: 1, from: 0.0, to: 1.0, depth_m: 1.2, slab: [r, g, b], edge: [r, g, b],
                   rail: [r, g, b], rail_bar_m: 0.06}]   # barana: per defecte de ferro; de fusta amb color i barrots gruixuts
      facades:               # les altres façanes vistes des d'un carrer, cadascuna amb el seu `t`
        - facade: E
          nth: 2             # opcional: la segona façana més ben orientada cap a E (plantes en L)
          openings: [...]    # mateix format que a dalt; [] = mur cec
          balconies: [...]   # també chimneys, terrace, fence i loggia, relatius a aquesta façana
          loggia: {from: 0.0, to: 0.8, depth_m: 1.2, floor: 1, parapet_m: 1.0, cap: [r, g, b],
                   floor_color: [r, g, b], openings: [...]}   # terrassa encastada sota el ràfec
      chimneys: [{t: 0.4, depth_m: 2.5, size_m: 0.6, above_m: 1.0, color: [r, g, b], cap: [r, g, b]}]
      terrace: {from: 0.47, to: 0.97, depth_m: 2.2, height_m: 0.36, floor: [r, g, b], steps: [0.56, 0.7], rail: [r, g, b]}
      fence: {offset_m: 3.6, from: -0.12, to: 1.18, height_m: 1.0, gate: [0.56, 0.67], rail: [r, g, b], base: [r, g, b]}
      canopies: [{from: 0.3, to: 0.43, height_m: 2.45, depth_m: 0.6, color: [r, g, b]}]  # teuladí
```

- A la planta baixa, les alçades (`sill_m`, `bottom_m`) es compten des del terra davant de
  l'obertura. Als pisos (`floor: 1…`), es compten des del forjat.
- `roller` és la fracció abaixada de la persiana enrotllable. `fill` tapa el vidre (finestra tapiada).
  `awning` és un tendal a dalt de la finestra; `stripe` hi alterna franges.
- `ridge: along` vol dir carener paral·lel a la façana (el ràfec dona al carrer); `across`, que
  és perpendicular (frontó al carrer).
- Les façanes que no són ni `facade` ni a `facades` (patis, darreres que no es veuen) es fan amb finestres generades amb l'estil de
  `windows`.
- Si cal un element nou (porxo amb columnes, galeria, porta corredissa…), afegeix-lo a
  `village.py` de manera genèrica, perquè serveixi per a altres cases, i documenta'l aquí.
- `canopies` són teuladins: un voladís de teula sobre una porta o un tram de façana, de `from` a
  `to`, a `height_m` sobre el terra. No tenen col·lisió. Amb `posts: true` són un porxo de
  cotxe: pals a la vora de fora (`post_color`, `post_m`) i `from`/`to` poden sortir de la façana
  (p. ex. `from: -0.9` s'allarga més enllà de la cantonada de t = 0).
- `fence` és una barana lligada a una façana. El mur de la parcel·la (llargada i alçada
  pròpies, sovint d'una altra parcel·la) va a `walls.yaml`, no a la fitxa de la casa.
- `wings: true` fa la teulada d'una planta en L per ales, amb aiguafons al racó, en lloc d'una
  sola teulada sobre el rectangle mínim (que tapa el pati del racó). Amb `ridge`, el cos
  principal porta el carener en aquesta direcció.
- `type: shed` és una teulada d'una aigua (garatges i coberts adossats): el ràfec a la façana de
  la fitxa, o a la que diu `toward`, i el capdamunt a la paret del fons.
- `loggia` amb `floor: 0` i `parapet_m: 0` és un porxo d'entrada encastat a la planta baixa: el
  forat també travessa el sòcol. Amb `posts` (gruix en m; `post_color`) hi posa pilars a la línia
  de façana cada ~3 m: així es fa un cobert obert per un costat.
- `loggia` és una terrassa encastada a un pis (`floor`): el mur es buida per damunt de l'ampit
  (`parapet_m`), el pis queda enretirat `depth_m` i el sostre és a l'altura del plafó del ràfec,
  de manera que la teulada fa de porxo. Les obertures van a la paret del fons, amb `t` sobre el tram
  `from`..`to`. Dues lògies que es troben en un racó entrant tanquen la terrassa en L. Totes les
  lògies d'una part són a la mateixa planta.
- `join: [part2]`: el Cadastre de vegades deixa un buit entre dues parts que a la foto estan
  unides. La part s'allarga fins a l'aresta més propera de l'altra.
- `type: flat` és un terrat: coberta plana a `eave_m`, amb ampit (`parapet_m`) a les vores que
  no toquen la part unida. Amb `floor_color`, és un terra enrajolat i no porta textura de teula.
- `extra_parts`: una nau o un cobert que es veu a les fotos però no és cap `BuildingPart`. El
  contorn és en UTM (de les vores de la parcel·la i l'ortofoto) i porta la mateixa fitxa que una
  part. Fes-lo servir amb `extra_roofs: false` perquè no surti dues vegades.
- `extra_roofs: false`: l'ortofoto de vegades veu un cobert al pati (ombres de la tàpia, arbres).
  Si a les fotos no n'hi ha cap, es treuen els coberts detectats dins de la parcel·la i els que
  toquen les parts de la casa (a menys de 0,5 m), encara que siguin fora de la parcel·la: la
  perspectiva de l'ortofoto desplaça les teulades cap a la placeta o el carrer del davant.
- `cladding` com a llista: capes de la part baixa, cadascuna fins al seu `height_m` sobre el
  terra (p. ex. sòcol de pedra i tota la planta baixa arrebossada, amb el pis de maó a `wall`).

### Tàpies amb fitxa (`walls.yaml`)

Les tàpies van a **fitxes separades** de les cases. Un mur és una vora de parcel·la: té la
seva llargada (la del Cadastre) i sovint no és davant d'una sola façana, ni de la mateixa
parcel·la que la casa. `fence`, a la fitxa de la casa, continua sent només la barana lligada
a una façana.

Sense fitxa, `walls.py` posa tàpia on l'ortofoto en mostra l'ombra, amb una alçada a l'atzar
(entre 1,45 i 2,35 m). Amb fitxa, el tram del mateix lloc es treu i es fa el mur real.

**Com es fa cada mur**

1. **Identifica la parcel·la**, no la casa. A l'expedient, les coordenades de les façanes són
   UTM. La parcel·la del mur pot ser la de la casa o una de rústica del jardí: comprova quina
   vora cau on es veu el mur a la foto i a l'ortofoto.
2. **La llargada és la vora cadastral.** No es mesura a la foto. Si el mur ocupa tota la vora
   que dona al carrer, `along: street`. Si només n'és un tros, `near` (un punt UTM sobre el
   mur) i `length_m` (metres, centrats en aquest punt).
   `near` també pot ser una llista de punts (una vora per punt), per quan `along: street` agafa
   vores d'un altre camí que no es veuen. Les vores triades que van seguides i gairebé alineades
   (el Cadastre de vegades parteix una façana en dos trams) s'uneixen en un sol mur.
3. **L'alçada es mesura a la foto**, comparant amb una referència: una porta fa ~2,1 m i una
   planta ~2,9 m. Anota el valor i d'on surt a `notes.md` de la casa de l'expedient, i a
   `photo` de la fitxa.
4. **Material i color de la foto.** `brick` (totxo), `stone` (pedra) o `block` (formigó, sense
   junta de totxo), o `none` si a la foto no n'hi ha (només treu la tàpia generada). `cap` és l'albardilla; `rail_m` és una reixa per damunt del mur, sense
   col·lisió. `plinth` és un sòcol (pedra) a les dues cares i `tiles`, una albardilla de teula
   àrab. Els portals van a `gates`, amb el punt UTM del centre (`near`), les fulles i un teuladí
   opcional (`canopy`); amb `solid_m`, són de reixa (planxa plena fins a `solid_m` i barrots).
   També hi van les portes de vianants. `pillars` posa pilars (amb capitell en punta) als
   extrems de cada tram i a banda i banda de cada portal.
5. **Regenera el món.** El registre ha de dir `Tàpies: fitxa <id>, N m` sense l'avís «no
   encaixa amb cap vora». Al joc, el totxo és la malla `building_tapias`, la pedra
   `building_walls_stone` i el bloc `building_walls_block`.

```yaml
<id>:
  parcel: "<referència de la parcel·la>"
  along: street          # totes les vores d'aquesta parcel·la que donen a un carrer
  # o bé un sol tram: `near` és un punt UTM (EPSG:25830) sobre el mur
  near: [260010.0, 4653010.0]
  length_m: 6.0          # opcional; si no hi és, tota la vora
  height_m: 1.2
  thick_m: 0.28
  material: block        # brick (totxo) | stone (pedra) | block (formigó, sense junta)
  color: [186, 178, 166] # sRGB
  cap: [146, 124, 98]    # opcional: albardilla
  rail_m: 0.6            # opcional: reixa per damunt del mur (sense col·lisió)
  rail: [32, 32, 34]
  plinth: {material: stone, color: [176, 146, 104], height_m: 0.8}  # opcional: sòcol
  tiles: {color: [176, 112, 84], height_m: 0.22, over_m: 0.1}       # opcional: albardilla de teula
  gates:                 # opcional: portals (forat al mur, fulles amb col·lisió)
    - {near: [260124.9, 4652999.45], w: 1.8, h: 2.05, color: [r, g, b], leaves: 2,
       canopy: {color: [r, g, b], lift_m: 0.3, side_m: 0.25, over_m: 0.25, height_m: 0.3}}
    - {near: [E, N], w: 0.9, h: 1.9, color: [r, g, b], leaves: 1, solid_m: 0.85}   # de reixa
  pillars: {w: 0.45, h: 2.0, color: [r, g, b], cap: [r, g, b]}   # opcional (ends, gates: true)
  photo: "d'on surt l'alçada"
```

### Recorregut de tàpies d'un carrer

Per revisar tots els murs d'un carrer alhora: `python tmp/ruta_tapies.py 20` dona una parada cada
20 m (UTM, lat/lon i rumb), i a cada parada es posa el cotxe al joc (`window.__dbg`, vegeu el pas 10)
i el panorama de Street View al mateix punt i rumb. Les captures i la taula de murs van a
`data/carrers/<carrer>/` (les de Street View, a `streetview/`, fora del git).

### Errors que ja s'han comès

- Modelar la casa d'una foto en un lloc equivocat. Una foto que s'havia passat com «la primera
  casa entrant pel carrer Santibáñez» era en realitat d'una casa 390 m a l'oest
  (`002000300TM55D`). Compara sempre l'orientació, l'amplada de la façana i les plantes amb el
  Cadastre.
- L'ortofoto té perspectiva: les teulades surten desplaçades uns metres respecte de la planta.
  No en dedueixis distàncies fines, com la del jardí al carrer.
- La parcel·la cadastral d'una casa pot coincidir exactament amb la planta. En aquest cas, el
  jardí i el mur són d'una altra parcel·la, i el mur va a `walls.yaml` (la barana lligada a
  una façana continua a `fence`).
- Fer la fitxa només de la façana del carrer. A `0232302TM6503S` hi faltaven la tàpia amb el
  portal, la terrassa en L, la teulada en L i el garatge amb terrat, i al pati hi havia un cobert
  fals de l'ortofoto. Les lliçons són a la skill `casa-a-mida`.

### Estat

**Recompte de models (persisteix entre sessions).** Cada casa del joc és en un d'aquests tres grups:

- **genèric**: no té fitxa;
- **propi bàsic**: té fitxa (o model per script), però no anàlisi detallada;
- **propi refinat**: la fitxa porta `review: {level: full}`.

Executa `python tools/mapgen/cases_status.py` a l'inici de cada sessió i després de cada tanda de
cases. El script:

- regenera `data/cases/ESTAT.md`, amb el recompte i les llistes per carrer;
- afegeix o actualitza la fila del dia a `data/cases/historial.csv`.

Tots dos fitxers van al repo. No els editis a mà. Abans d'informar de quantes cases hi ha de cada
grup, torna a executar el script: hi pot haver altres agents fent-ne.

Cases amb fitxa (vegeu `cases.yaml`):

Les fitxes fetes abans de les normes de l'expedient (captures de tots els carrers del voltant i
vista zenital) s'han de completar quan es revisin. Cal mirar-ne l'expedient a `data/cases/<ref>/`.

- `002000300TM55D`: casa d'una planta, 390 m a l'oest de l'entrada.
- `0032901TM6503S`, `0032941TM6503S` i `0132102TM6503S`: entrada per la Calle Santibáñez (casa A
  de pedra, casa de maó amb balcó i cobert obert, casa B granat amb l'annex d'una aigua).
- `0132131TM6503S`: casa groga retirada, amb la foto del Cadastre (el carrer no la veu).
- `0132103TM6503S`: casa de maó del 15 (costat sud), dos cossos, porxo de cotxe vermell.
- `0232108TM6503S`: cantonada salmó amb tendals (7727), garatge d'una aigua amb balcó de fusta al damunt i pati amb portal.
- `0232303TM6503S`: casa gris d'una planta de la cantonada de la Rinconada, quatre aigües i porxo d'entrada.
- `0232301TM6503S`: bloc ocre nou amb garatge (7725); la casa de la foto del Cadastre ja no hi és.
- `0132135TM6503S`: finca del 17: garatge amb maó a franges i casa del fons (maó groc, balcó, baixos grisos).
- `0232302TM6503S`: casa crema en L (12): terrassa en L amb porxo i garatge amb terrat al pati.
- `0332501TM6503S`: casa rosa amb teuladí corregut i garatge (13).
- `0332704TM6503S`: casa vella emblanquinada amb xemeneies i porta al racó del pati de davant (11).
- `0332502TM6503S`: casa de maó i cobert blanc (9).
- `0332503TM6503S`: casa blanca amb balcó i portal de fusta (7 ZA-P-2547).
- `0332504TM6503S`: casa crema retirada darrere el jardí (4), cos baix d'una aigua i portals a la tanca.
- `0332003TM6503S`: casa estreta de maó amb portal blau (4 ZA-P-2547).
- `0332002TM6503S`: casa blanca amb sòcol ocre i garatge.
- `0332505TM6503S`: casa groga amb emmarcats ocre i garatge gris.
- `0332506TM6503S`: magatzem emblanquinat amb portal blau (1).
- `0332507TM6503S`: cobert blanc amb terrat a la cruïlla.
- `0332508TM6503S`: casa crema de la placeta del Cristo i garatge groc.
- `0432827TM6503S`: casa rosa amb la xemeneia vermella a la façana.
- `0432601TM6503S`: centre mèdic i velatori; la torre del rellotge és una `chimneys` grossa.
- `0332001TM6503S`: casa de maó amb balcó darrere el jardí de la cruïlla.
- `0431701TM6503S` i `0431702TM6503S`: primeres cases de la Calle el Cristo.
- `002000100TM55D` i `002000200TM55D`: casa vella i nau de l'entrada oest.
- Refinades el 2026-10-09 (segona tanda de la cruïlla i la C. el Cristo): `0332506`, `0332507`
  (terrat amb ampit de maó), `0332508`, `0332001`, `0332004` (ruïna amb murets i caseta),
  `0432601` (barana del centre mèdic), `0432827`, `0431701`, `0431702` i `0232107` (nau grisa
  com a `extra_parts`).
- Refinades el 2026-10-09 (tercera tanda: C. el Cristo cap al sud, C. Taburete i la placeta del
  Cristo):
  - C. el Cristo: `0431703` (groc amb emmarcats de maó), `0431704` (blanca amb terrat i botiga),
    `0431705` (maó, persianes verdes, pati amb portal), `0432828` (crema i salmó, pati amb el mur
    ocre alt), `0432826` (blanca i capçal crema), `0431001` (rosa de 1973), `0431706` (tova amb
    porticons blaus) i `0431501` (paller de la cantonada del camí).
  - C. Taburete: `0432829` (cobert de bloc amb portal de fusta), `0431101` (groga llarga amb
    balcó corregut), `0432830` (paret de tova i caseta blanca) i `0432839` (garatge de maó).
  - Placeta: `0432824` (portal de fusta), `0432822` (maó amb balconets) i `0432821` (terrassa
    corrida).
  - `0432825` s'ha deixat fora: el Cadastre en diu «declined», però a la foto és una casa de maó
    reformada. Cal mirar-la a part.

Tàpies amb fitxa (vegeu `walls.yaml`):

- `0132131-carrer`: mur de bloc d'1,20 m a tot el carrer de la casa groga.
- `0132103-carrer`: muret de pedra de 0,9 m amb reixa, pilars i dos portals de reixa (15).
- `0132103-oest`: mur de pedra d'1,3 m del carrer a la casa, pel costat oest (15).
- `0132102-oest`: mur granat de 2,3 m a continuació de l'annex de la casa B.
- `0032901-est`: paret alta de bloc gris al costat est de la casa A.
- `0332504-carrer`: mur de pedra d'1,0 m amb reixa verda, davant la casa crema.
- `0332001-carrer`: mur de bloc d'1,35 m al sud i l'est del jardí de la cruïlla.
- `0332001-davant`: sòcol de maó amb reixa davant de la casa de la cruïlla (C. el Cristo).
- `0332004-oest`, `0332004-caseta`: mur de pedra i bloc i caseta de tova amb porta de la ruïna.
- `0232107-carrer`: tàpia alta arrebossada entre la part3 i la nau grisa (18).
- `0232302-carrer`: tàpia crema de 2,0 m amb sòcol de pedra, teula i portal de fusta (12).
- `0132135-carrer`: muret de maó a franges amb reixa, pilars i portals de reixa (17).
- `0232108-carrer`, `0232108-porta`, `0232108-tova`: pati de la cantonada de la Rinconada (salmó, portal de vianants i tova).
- `0332501-carrer`: mur emblanquinat de ~3 m del pati de l'est (13).
- `0332704-davant`, `0332704-est`: murs blancs del pati de davant i de l'extrem est (11).
- `0332502-portal`: tàpia blanca amb portal de reixa negre (9).
- `0431705-carrer`: mur de maó de 2,8 m amb portal gris de garatge (18 ZA-P-2547).
- `0432828-pati`: mur de bloc ocre de 3,6 m amb remat vermell al voltant del pati (C. el Cristo).
- Calle Santibáñez, tàpies de banda i banda: 17 fitxes més del recorregut de Street View (vegeu
  `data/carrers/santibanez/notes.md`).

- `0530101-reixa`, `0530106-tanca`, `0530103-balustres`, `0530501-bloc`, `0530112-portal`:
  tancaments del tram sud de la C. el Cristo (reixa del 26, tanca de Casa Gracia, balustres,
  mur de bloc i portal de planxa).

Refinades el 2026-10-09 (quarta tanda: les fitxes que quedaven a mig fer, i el tram sud de la
C. el Cristo):

- Entrada oest: `002000100TM55D`, `002000200TM55D` i `002000300TM55D`.
- C. Santibáñez: `0132131TM6503S` (casa groga retirada).
- C. de la Iglesia i la cantonada amb la C. Calzada: `0232104TM6503S`, `0232103TM6503S`,
  `0232102TM6503S`, `0232101TM6503S`, `0333609TM6503S`, `0333610TM6503S` i `0333611TM6503S`.
  El tram sud de la Iglesia no té Street View: la fitxa surt de la foto del Cadastre.
- C. Viriato: `0332703TM6503S` (sense Street View).
- C. el Cristo, del 24 cap al sud-est: `0530102TM6503S` (salmó del 24), `0530101TM6503S` (maó
  del 26), `0530103TM6503S` (blanca de tres plantes), `0530104TM6503S` (nau miniplant),
  `0530106TM6503S` (Casa Gracia), `0530107TM6503S` (magatzem gris), `0530108TM6503S` (arcs),
  `0530111TM6503S` (blanca amb sòcol vermell), `0530112TM6503S` (groga), `0530501TM6503S`
  (frontó beix), `0530503TM6503S` (portal blau) i `0530507TM6503S` (blanca amb garatge de fusta).
- Placeta: `0432825TM6503S`. El Cadastre la marca declined; al Street View del 2024 és la casa
  emblanquinada amb el cos de tova i els portals de fusta.

Refinades el 2026-10-09 (cinquena tanda: el que quedava de la C. el Cristo, i les últimes de
Taburete, la Iglesia i Santibáñez):

- C. el Cristo, cap al sud-est: `0530504TM6502N` (beix i nau blanca), `0530506TM6502N` (pedra i
  balcó), `0630501TM6502N` (crema llarga), `0630502TM6502N` (mur de formigó), `0630504TM6502N`
  (portal blau), `0630505TM6502N` (mur blanc), `0630506TM6502N` (casa rosa), `0429498TM6502N`
  (torre de maó), `0331103TM6503S` (bungalou), `49130A50100371` (ocre amb frontó),
  `0531965TM6503S` (nova, porxo) i `0531998TM6503S` (ocre de 2016).
- Entre la placeta i Taburete: `0432823TM6503S` (portals), `0432831TM6503S` (crema, declined al
  Cadastre), `0432832TM6503S` (salmó), `0432833TM6503S` (portal verd), `0432835TM6503S` (tova),
  `0432836TM6503S` (mur de bloc) i `0432837TM6503S` (arc de reixa).
- Bar: `0432819TM6503S` (Llamas). Nau nova: `0432384TM6503S`.
- C. Santiago / Iglesia: `0333601TM6503S` (blanca) i `0333602TM6503S` (rosa).
- Nau de bloc: `0331111TM6503S`. C. Calzada: `0232106TM6503S` (portal de fusta i balcó).

- `0331103-tanca`, `0432832-carrer`, `0432836-mur`, `0432833-mur`, `0432837-mur`, `0531998-portal`:
  tancaments d'aquesta tanda (gelosia del bungalou, mur de la casa salmó, portal verd, mur groc,
  mur de l'arc i portal de la casa de 2016).

La C. Santibáñez ja té model propi a totes les cases. Les genèriques que queden són a `ESTAT.md`.

## Atribucions

Ortofoto © IGN (CC BY 4.0) · © col·laboradors d'OpenStreetMap · Edificis, parcel·les i fotos de
façana © Dirección General del Catastro. Vegeu `docs/ATTRIBUTION.md`.
