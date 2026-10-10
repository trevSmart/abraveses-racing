# Referència: fórmules, receptes i limitacions

## Coordenades

| Sistema | Què és | On surt |
|---|---|---|
| UTM (EPSG:25830) | E, N en metres | `casa_info.py`, `preview_casa.py`, fitxes de `walls.yaml` (`near`) |
| Local del pipeline | x = E − origen_x, y = N − origen_y | `village.py` (origen: `world_meta.json`) |
| Món del joc / glTF | `[x, alçada, −y]` | Three.js, `window.__dbg` |
| Previsualització | com el món, però amb l'origen al centre de la casa i el terra a 0 | `preview_casa.py` (dona l'URL ja convertit) |
| Lat/lon | per a Street View i Google Maps | `casa_info.py` (viewpoints); `pyproj` si cal |

De UTM a lat/lon:

```python
from pyproj import Transformer
to_wgs = Transformer.from_crs("EPSG:25830", "EPSG:4326", always_xy=True)
lon, lat = to_wgs.transform(E, N)
```

## De UTM a t i fondària

Una façana va de `a` (t = 0, l'esquerra mirant-la des de fora) a `b`. `preview_casa.py` treu
totes dues cantonades en UTM. Per a un punt `p` (una xemeneia o un portal vist a la vista zenital):

```
L = |b − a|,  u = (b − a) / L,  n = (u_y, −u_x)       # n: normal cap a fora (anell antihorari)
t       = (p − a) · u / L
fondària = −(p − a) · n                               # metres cap a dins (`depth_m` de les xemeneies)
```

I a la inversa: el punt a `s` metres de la cantonada `a`, sobre la vora, és `a + u·s`. Així es
treu el `near` d'un portal: el centre és a `s = distància del pilar + w/2`.

## T per perspectiva

Per a una façana vista de biaix (sense regla de tres):

1. Mira a la foto les x de les dues cantonades (xA, xB) i l'alçada en px d'una planta a cada punta
   (hA, hB). La relació de distàncies càmera–cantonada és hA/hB.
2. Busca (E, N) de la càmera en una graella al voltant del carrer: amb un FOV horitzontal conegut
   (`75y` → 75°, `90y` → 90°), el rumb que posa A a xA, i l'error |x(B) − xB| +
   k·|dist(B)/dist(A) − hA/hB|. Queda't el mínim.
3. Projecta x(t) per a t de 0 a 1 i inverteix-la per a cada vora d'obertura.

```python
fpx = 756 / tan(radians(fov / 2))          # captura de 1512 px d'amplada
x(p) = 756 + fpx * tan(radians(rumb(càmera → p) − rumb_centre))
```

## Mesurar a les fotos

- **Píxels per metre al mateix pla.** Pren una referència d'aquell pla:
  - porta: 2,1 m d'alt, 0,8–0,95 m d'ample;
  - porta de garatge: ~2,4 m;
  - planta: 2,9 m;
  - ràfec de casa de dues plantes: ~5,9 m.
  Llavors `mida = píxels / (píxels_referència / metres_referència)`.
- **Proporció dins d'un mateix element.** Si l'element és de cara, l'amplada és
  `alçada · (px_ample / px_alt)`. Així es va treure el portal de 1,8 × 2,05 m.
- **Biaix.** Una façana vista de biaix s'escurça. Mesura-hi només alçades, o fes servir una vista
  de cara. En una vista de biaix, el tram a prop de la càmera surt més gran que el del fons.
- **Tàpies.** L'alçada del mur (`height_m`) va fins a sota l'albardilla. La teula (`tiles`) hi
  afegeix ~0,2 m.
- **Colors.** Treu-los de la zona il·luminada, amb l'exposició corregida: un blanc de referència
  ha de quedar a ~225. A la fitxa van en sRGB.

## Street View

Amb Claude in Chrome. Carrega les eines amb un sol ToolSearch i fes servir `browser_batch` per
encadenar «navega, espera i captura».

- **Obrir un panell amb rumb, inclinació i camp de visió:**
  `https://www.google.com/maps/@LAT,LON,3a,FOVy,RUMBh,INCLt/data=!3m4!1e1!3m2!1s<PANOID>!2e0`
  - `RUMB`: 0 = nord, 90 = est.
  - `INCL`: 90 és horitzontal i més de 90 mira amunt; 95–100 va bé per veure teulades i ampits
    per damunt d'una tàpia.
  - `FOV`: 60–90.
  - El `PANOID` surt a l'URL després de navegar (`!1s<panoid>!2e0`). Sense panoid
    (`/data=!3m2!1e1!3m0`), s'obre el panell més proper al punt.
- **Espera ~5 s** després de navegar. Si no, la imatge encara surt borrosa.
- **Gira tot el panell.** Amb el mateix panoid i rumbs cada 30–45°, fes les captures que serveixin.
  La captura del panell del veí és tan important com la de la casa.
- **Desar:** fes `screenshot` amb `save_to_disk: true`, que et dona un camí temporal. Copia'l a
  `data/cases/<ref>/streetview/AAAA-MM_<adreça del panell>_rumbNNN.jpg`, amb la data i l'adreça
  que surten al quadre del panell.
  - Amb chrome-devtools és més ràpid: `take_screenshot` amb `filePath` desa la captura
    directament a `streetview/`. La desa en `.jpeg`: canvia-li l'extensió a `.jpg`.
  - El títol de la pàgina (`evaluate_script` amb `document.title`) dona l'adreça del panell.
- **Una sola vista de satèl·lit a ~90 m** cobreix unes quantes cases veïnes: aprofita-la per a
  totes.
- **Vista zenital:** `https://www.google.com/maps/@LAT,LON,90m/data=!3m1!1e3`, amb el nord a
  dalt. Desa-la a `satellit/google_satellit.jpg`.
- Res d'això no surt del repo ni entra al model.

## Previsualització

```bash
python tools/mapgen/preview_casa.py <ref> --cam E N 1.7 --target E N 3.5
cd tmp && python3 -m http.server 8765        # si encara no hi és
# obre l'URL que ha escrit el script
```

- Treu les arestes finals de cada part i les vores de la parcel·la. Comprova-hi el `nth` i la
  cantonada de t = 0 de cada façana de la fitxa.
- La càmera d'una vista de Street View és el viewpoint del panell (passat a UTM), a 1,7 m.
- Les tàpies que surten són les de `walls.yaml` amb `parcel` igual a la referència. Les d'una
  altra parcel·la (el jardí, un hort) no hi surten.

## Joc

- Arrenca'l amb `cd web && npm run dev` (http://localhost:5173) i espera uns 10 s que carregui el
  món.
- Enganxa [joc_camera.js](joc_camera.js) a la consola (o al `javascript_tool`).
  - `__view(E, N, h, tE, tN, th)` fixa la càmera; `__free()` la deixa anar.
  - `__go(E, N, rumb)` porta el cotxe i torna l'alçada del terra en aquell punt (per calcular `h`).
- Rumb del HUD = 180° − heading. `__go` ja fa la conversió.
- Mode dev amb Maj+D: en passar el ratolí surt la referència de cada model.
- Per comparar amb un panell sense que hi surti el cotxe ni la càmera quedi enganxada a la
  façana:

  ```js
  window.__v = (a, back = 3) => {          // a = [nom, E, N, E_mira, N_mira]
    const y = __go(a[1], a[2], 0);          // alçada del terra en aquell punt
    __go(260400, 4653200, 0);               // el cotxe, lluny
    const dx = a[3] - a[1], dy = a[4] - a[2], L = Math.hypot(dx, dy);
    return __view(a[1] - dx / L * back, a[2] - dy / L * back, y + 1.8, a[3], a[4], y + 2.6);
  };
  ```

  El punt de mira és a uns 6–9 m del panell en la direcció del rumb de la captura.

## Registre de `build_world.py`

| Línia | Què vol dir |
|---|---|
| `Village: N parts de casa amb fitxa` | N ha de pujar si has afegit parts |
| `Tàpies: fitxa <id>, N m` | la tàpia ha trobat la vora; els metres han de quadrar amb la parcel·la |
| `… no encaixa amb cap vora` | el `near` és a més de 4 m de cap vora: revisa'l |
| `fitxa … sense parts` | la referència o la part no hi és (o és fora de la zona) |
| `façana X de la fitxa sense mur propi` | dues entrades de `facades` agafen la mateixa aresta: cal `nth` |
| `teulada per ales sense cap vèrtex entrant` | `wings` en una planta que no és en L |
| `N coberts detectats dins o a tocar de cases amb fitxa sense coberts, fora` | `extra_roofs: false` ha fet efecte |

## Limitacions conegudes

Si una casa en necessita més, amplia el codi de manera genèrica i documenta-ho a `AGENTS.md`.

- `wings` només parteix per **un** vèrtex entrant: L sí, T i U no.
- Totes les `loggia` d'una part són a la mateixa planta i comparteixen l'ampit (el de la primera).
- El material de les parets és per part: no es pot fer una façana de maó i una altra d'arrebossat
  dins de la mateixa part (`0332002`, `0332502`).
- `join` fa l'envolupant convexa de la part i l'aresta més propera de l'altra. Amb formes
  complicades pot omplir massa.
- El terrat (`type: flat`) no té voladís, i l'ampit va a totes les vores menys les que toquen la
  part unida.
- Les obertures de la planta baixa d'una façana de pati amagada darrere una tàpia són suposades:
  digues-ho a `notes.md`.
- `gates` posa fulles llises amb travessers. No modela claus, reixes ni portes petites de reixa.
- `preview_casa.py` no fa servir el terreny real: les cases en pendent poden quedar diferents al
  joc.
