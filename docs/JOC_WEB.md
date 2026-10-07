# Joc web — Abraveses Racing

Versió **navegador** del poble: sense Unity Hub, sense instal·lador de 17 GB.

## Requisits

- **Node.js 20+** (`node -v`)
- Python 3.11+ només per **generar** el mapa (una vegada o quan canviïs `config.yaml`)

## Passos

### 1. Generar el món

Des de l’arrel del repo:

```bash
source .venv/bin/activate   # si encara no existeix: python3 -m venv .venv && pip install -r tools/requirements.txt
python tools/mapgen/build_world.py --all
```

Comprova que existeixen:

- `web/public/world.glb`
- `web/public/spawn.json`

### 2. Arrancar el joc

```bash
cd web
npm install
npm run dev
```

Obre l’URL que mostra Vite (normalment http://localhost:5173).

### 3. Controls

| Tecla | Acció |
|-------|--------|
| W / ↑ | Accelerar |
| S / ↓ | Enrere |
| A / D | Girar |
| Espai | Fre |
| R | Tornar al spawn |

## Com funciona

- **Three.js** carrega `world.glb` (terreny + carreteres + edificis).
- El kart usa **raycast** contra el món per seguir el relleu (sense motor de física pesat).
- El spawn ve de `spawn.json` (mateixes coordenades que el pipeline mapgen).

## Publicar en línia (opcional)

```bash
cd web && npm run build
```

La carpeta `web/dist/` es pot desplegar a qualsevol hosting estàtic (Netlify, GitHub Pages, Cloudflare Pages, etc.).

## Unity

Si tenies el projecte Unity obert, pots ignorar-lo; el manteniment del joc és aquest flux web.
