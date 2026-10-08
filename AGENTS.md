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
  - `roof*` porta l'ortofoto projectada amb un detall de teula alineat pel color de vèrtex;
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
| `tools/mapgen/casa_info.py` | expedient d'una casa per preparar-ne la fitxa |
| `tools/mapgen/church.py`, `hermitage.py` | models propis de l'església i l'ermita |
| `web/src/main.ts` | joc: càrrega del món, materials, física, HUD, minimapa, mode dev |
| `docs/MAP_PIPELINE.md` | detall del pipeline de dades |

## Cases a mida: substituir les cases genèriques una per una

Per defecte, `village.py` construeix cada part cadastral (`BuildingPart`) amb un estil a l'atzar:
color de la paleta, finestres, porticons, teulada a dues aigües. Les cases que tenen fitxa a
`cases.yaml` es construeixen amb les dades reals. L'objectiu és anar posant fitxa a totes les
cases del poble, començant per la Calle Santibáñez.

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
      roof: {type: hip | gable, ridge: along | across, pitch_deg: 20, overhang_m: 0.9, fascia: [r, g, b]}
      windows: {frame: [r, g, b], frame_w: 0.14, roller: [r, g, b]}      # estil de tota la casa
      openings:              # només a la façana `facade`; [] = cap obertura
        - {kind: window, t: 0.3, w: 1.2, h: 1.3, sill_m: 1.0, roller: 0.4, floor: 0, fill: [r, g, b]}
        - {kind: window, t: 0.4, w: 0.9, h: 1.0, sill_m: 1.1, awning: {depth_m: 0.7, color: [r, g, b], stripe: [r, g, b]}}
        - {kind: door, t: 0.6, w: 0.95, h: 2.2, bottom_m: 0.7, color: [r, g, b],
           steps: 4, step_color: [r, g, b], step_rail: [right], sidelight: left, lamp: true}
        - {kind: garage, t: 0.2, w: 4.6, h: 2.6, color: [r, g, b], frame: [r, g, b], leaves: 4, glass_top_m: 0.4}
      balconies: [{floor: 1, from: 0.0, to: 1.0, depth_m: 1.2, slab: [r, g, b], edge: [r, g, b]}]
      facades:               # les altres façanes vistes des d'un carrer, cadascuna amb el seu `t`
        - facade: E
          openings: [...]    # mateix format que a dalt; [] = mur cec
          balconies: [...]   # també chimneys, terrace i fence, relatius a aquesta façana
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
  `to`, a `height_m` sobre el terra. No tenen col·lisió.
- `fence` és una barana lligada a una façana. El mur de la parcel·la (llargada i alçada
  pròpies, sovint d'una altra parcel·la) va a `walls.yaml`, no a la fitxa de la casa.

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
3. **L'alçada es mesura a la foto**, comparant amb una referència: una porta fa ~2,1 m i una
   planta ~2,9 m. Anota el valor i d'on surt a `notes.md` de la casa de l'expedient, i a
   `photo` de la fitxa.
4. **Material i color de la foto.** `brick` (totxo), `stone` (pedra) o `block` (formigó, sense
   junta de totxo). `cap` és l'albardilla; `rail_m` és una reixa per damunt del mur, sense
   col·lisió. Els pilars i les portes tancades no es modelen a part: el mur és continu.
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
  photo: "d'on surt l'alçada"
```

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

### Estat

Cases amb fitxa (vegeu `cases.yaml`):

Les fitxes fetes abans de les normes de l'expedient (captures de tots els carrers del voltant i
vista zenital) s'han de completar quan es revisin. Cal mirar-ne l'expedient a `data/cases/<ref>/`.

- `002000300TM55D`: casa d'una planta, 390 m a l'oest de l'entrada.
- `0032901TM6503S`, `0032941TM6503S` i `0132102TM6503S`: entrada per la Calle Santibáñez.
- `0132131TM6503S`: casa groga retirada, amb la foto del Cadastre (el carrer no la veu).
- `0132103TM6503S`: casa de maó de dues plantes, al nord de la calçada.
- `0232108TM6503S`: cantonada salmó amb tendals (7727).
- `0232303TM6503S`: nau gris de la Rinconada.
- `0232301TM6503S`: casa emblanquinada del 1900 (7725), finestres de dalt tapiades.
- `0132135TM6503S`: casa de maó del fons i garatge del 17 amb maó a franges.
- `0232302TM6503S`: casa crema amb sòcol de pedra (12).
- `0332501TM6503S`: casa rosa amb teuladí corregut i garatge (13).
- `0332704TM6503S`: casa vella emblanquinada amb dues xemeneies (11).
- `0332502TM6503S`: casa de maó i cobert blanc (9).
- `0332503TM6503S`: casa blanca amb balcó i portal de fusta (7 ZA-P-2547).
- `0332504TM6503S`: casa crema retirada darrere el jardí (4).
- `0332003TM6503S`: casa estreta de maó amb portal blau (4 ZA-P-2547).
- `0332002TM6503S`: casa blanca amb sòcol ocre i garatge.
- `0332505TM6503S`: casa groga amb emmarcats ocre i garatge gris.

Tàpies amb fitxa (vegeu `walls.yaml`):

- `0132131-carrer`: mur de bloc d'1,20 m a tot el carrer de la casa groga.
- `0132103-carrer`: mur de pedra d'1,05 m amb reixa, davant la casa de maó.
- `0132102-oest`: mur baix de formigó de 6 m, al sud del garatge.
- `0332504-carrer`: mur de pedra d'1,0 m amb reixa verda, davant la casa crema.

Pendent: `0232107TM6503S` (nau). La nau grisa de la seva foto del Cadastre no cau dins de cap de
les seves parts cadastrals: vegeu-ne `notes.md` abans de fer-ne la fitxa.

Següent, carrer Santibáñez endins: `0332507TM6503S`, `0332506TM6503S` i la Calle el Cristo
(`0332001TM6503S`).

## Atribucions

Ortofoto © IGN (CC BY 4.0) · © col·laboradors d'OpenStreetMap · Edificis, parcel·les i fotos de
façana © Dirección General del Catastro. Vegeu `docs/ATTRIBUTION.md`.
