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
4. **Ortofoto PNOA** (`data/processed/ortho_master.jpg`, ~18 cm/px). Serveix per veure la forma
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
   - `tmp/cases/<ref>/cadastre_facana.jpg` i `tmp/cases/<ref>/ortofoto.png` (parts en groc).
3. **Mira les fotos i assegura't que és la casa.**
   - A Street View, comprova l'adreça del panell i la brúixola: la punta vermella és el nord.
   - L'orientació de la façana ha de quadrar amb la que dona `casa_info.py`.
   - Si la casa de la foto no lliga amb la planta (amplada de la façana, nombre de plantes,
     teulada), **no és aquesta casa**. Busca-la abans de modelar res.
4. **Mesura la façana.** Situa cada obertura com una fracció `t` de l'amplada del mur, de
   l'esquerra (0) a la dreta (1) mirant-lo des de fora.
   - Treu les mides en metres comparant amb la llargada cadastral de la façana i amb
     referències conegudes: una porta fa ~0,9 × 2,1 m i cada planta ~2,9 m.
   - Treu els colors de la foto i corregeix-ne l'exposició: un blanc de referència ha de quedar
     a ~225.
5. **Escriu la fitxa a `cases.yaml`.** Copia l'estructura d'una casa semblant que ja hi sigui.
6. **Previsualitza-la** abans de regenerar tot el món. Construeix només aquesta casa amb
   `house_meshes(…, spec=…)` sobre un terreny pla, exporta-la a GLB i mira-la al navegador, per
   exemple amb una pàgina Three.js a `tmp/` servida amb `python3 -m http.server`.
7. **Regenera el món** (`build_world.py`). El registre ha de dir `Village: N parts de casa amb
   fitxa`, sense avisos de «fitxa … sense parts».
8. **Verifica-la al joc.** A la consola del navegador:
   - `window.__dbg` dona `kart`, `state` i `placeCameraBehindKart`.
   - Posa el cotxe al carrer davant la casa, en coordenades locals: `x = E − origin_utm_x`,
     `z = −(N − origin_utm_y)`. L'origen és a `web/public/world_meta.json`.
   - Posa `state.heading` i `kart.rotation.y` (0 = sud, π = nord) i crida
     `placeCameraBehindKart()`.
   - Compara la captura amb la foto.

### Format de `cases.yaml`

```yaml
<referència cadastral>:
  photo: "font i data de les fotos (només referència)"
  facade: S                  # orientació de la façana modelada (N, NE, E, SE, S, SO, O, NO)
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
        - {kind: window, t: 0.3, w: 1.2, h: 1.3, sill_m: 1.0, roller: 0.4, floor: 0}
        - {kind: door, t: 0.6, w: 0.95, h: 2.2, bottom_m: 0.7, color: [r, g, b],
           steps: 4, step_color: [r, g, b], step_rail: [right], sidelight: left, lamp: true}
        - {kind: garage, t: 0.2, w: 4.6, h: 2.6, color: [r, g, b], frame: [r, g, b], leaves: 4, glass_top_m: 0.4}
      balconies: [{floor: 1, from: 0.0, to: 1.0, depth_m: 1.2, slab: [r, g, b], edge: [r, g, b]}]
      chimneys: [{t: 0.4, depth_m: 2.5, size_m: 0.6, above_m: 1.0, color: [r, g, b], cap: [r, g, b]}]
      terrace: {from: 0.47, to: 0.97, depth_m: 2.2, height_m: 0.36, floor: [r, g, b], steps: [0.56, 0.7], rail: [r, g, b]}
      fence: {offset_m: 3.6, from: -0.12, to: 1.18, height_m: 1.0, gate: [0.56, 0.67], rail: [r, g, b], base: [r, g, b]}
```

- A la planta baixa, les alçades (`sill_m`, `bottom_m`) es compten des del terra davant de
  l'obertura. Als pisos (`floor: 1…`), es compten des del forjat.
- `roller` és la fracció abaixada de la persiana enrotllable.
- `ridge: along` vol dir carener paral·lel a la façana (el ràfec dona al carrer); `across`, que
  és perpendicular (frontó al carrer).
- Les altres façanes, que no surten a les fotos, es fan amb finestres generades amb l'estil de
  `windows`.
- Si cal un element nou (porxo amb columnes, galeria, porta corredissa…), afegeix-lo a
  `village.py` de manera genèrica, perquè serveixi per a altres cases, i documenta'l aquí.

### Errors que ja s'han comès

- Modelar la casa d'una foto en un lloc equivocat. Una foto que s'havia passat com «la primera
  casa entrant pel carrer Santibáñez» era en realitat d'una casa 390 m a l'oest
  (`002000300TM55D`). Compara sempre l'orientació, l'amplada de la façana i les plantes amb el
  Cadastre.
- L'ortofoto té perspectiva: les teulades surten desplaçades uns metres respecte de la planta.
  No en dedueixis distàncies fines, com la del jardí al carrer.
- La parcel·la cadastral d'una casa pot coincidir exactament amb la planta. En aquest cas, el
  jardí i la tanca són d'una altra parcel·la (rústica), i cal posar-los a la fitxa (`fence`,
  `terrace`).

### Estat

Cases amb fitxa (vegeu `cases.yaml`):

- `002000300TM55D`: casa d'una planta, 390 m a l'oest de l'entrada.
- `0032901TM6503S`, `0032941TM6503S` i `0132102TM6503S`: entrada per la Calle Santibáñez.

Pendents a l'entrada: `0132131TM6503S`, que des del carrer queda tapada per la vegetació; caldrà
fer-la amb la foto del Cadastre i l'ortofoto. Després, seguir carrer Santibáñez endins.

## Atribucions

Ortofoto © IGN (CC BY 4.0) · © col·laboradors d'OpenStreetMap · Edificis, parcel·les i fotos de
façana © Dirección General del Catastro. Vegeu `docs/ATTRIBUTION.md`.
