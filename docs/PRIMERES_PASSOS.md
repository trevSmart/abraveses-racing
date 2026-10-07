# Primers passos (zero experiència amb Unity)

Guia per instal·lar Unity i obrir **Abraveses Racing** al teu Mac. No cal saber programar.

## Què has fet bé ja

- Unity Hub instal·lat
- Compte creat (Sign in with Apple)
- El mapa del poble ja està generat dins `unity/AbravesesRacing/Assets/World/` (carreteres + relleu)

## Per què el Hub s’obria i es tancava sol

Des d’aquest projecte s’havien provat comandes **automàtiques** del Hub (`--headless`). A macOS sovint **obren la finestra del Hub un moment i la tanquen**. No és el que faràs tu manualment.

**A partir d’ara:** només fes servir el **Unity Hub que tu obres** (icona a Aplicacions). No cal tornar a executar scripts d’instal·lació del Hub des del terminal.

---

## Pas 1 — Alliberar espai al disc (obligatori ara)

La captura mostra **Insufficient space**: cal ~**16,8 GB** i en tens ~**16,6 GB**. Et falten uns **300 MB** (millor **1–2 GB** de marge).

Idees segures (triar algunes):

1. **Paperera buida** (clic dret → Buida la paperera).
2. **Neteja Homebrew** (ja s’ha pogut fer des del repo):  
   `brew cleanup -s`
3. **Descàrregues grans** a `~/Downloads` que ja no necessitis (instal·ladors `.dmg`, vídeos vells).
4. **macOS**: ⚙️ General → Emmagatzematge → recomanacions (esborrar arxius grans).
5. Si tens **Xcode** i no el fas servir: simuladors antics ocupen molts GB (opcional, només si saps que no els uses).

Torna al Hub → **Get set up** → comprova que desapareix l’avís groc **Insufficient space**.

---

## Pas 2 — Instal·lar l’editor Unity (des del Hub)

1. Obre **Unity Hub** (no el tanquis mentre instal·la).
2. Pestanya **Get set up** (o **Installs** → **Install Editor**).
3. Instal·la la versió que proposa el Hub (**Unity 6**, p.ex. **6000.6.4f1**, **Silicon**).
4. Als mòduls addicionals, per aquest joc **n’hi ha prou amb el mínim**:
   - ✅ **Unity Editor**
   - ❌ Android / iOS / WebGL / Documentació local — desmarca’ls si vols estalviar espai i temps.
5. Clic **Install** i espera (pot trigar 20–40 min segons la connexió). No tanquis el Hub.

Quan acabi, a **Installs** hauries de veure l’editor en llista.

---

## Pas 3 — Obrir el projecte del poble

1. Unity Hub → pestanya **Projects**.
2. **Open** / **Add project from disk**.
3. Navega fins a aquesta carpeta (copia el camí sencer):

   `/Users/marcpla/Documents/Projectes/abraveses-racing/unity/AbravesesRacing`

4. Selecciona la carpeta **AbravesesRacing** (no la carpeta `abraveses-racing` de dalt).
5. Si demana versió d’editor, tria **6000.6.4f1** (o la que hagis instal·lat).

S’obrirà l’editor Unity (finestra gran). La **primera vegada** pot trigar uns minuts (“importing packages / importing assets”).

---

## Pas 3b — URP (motor gràfic modern)

El projecte usa **Universal Render Pipeline** (no el Built-in deprecated).

1. Espera que Unity acabi de descarregar paquets (**URP**).
2. Si el Hub encara avisa “Built-In deprecated”, al menú: **Abraveses → Setup URP (render pipeline)**.  
   (També es pot configurar sol la primera vegada que obres l’editor.)
3. Tanca i torna a obrir el projecte si el Hub no actualitza l’avís immediatament.

---

## Pas 4 — Crear l’escena de joc (només la primera vegada)

Dins l’editor Unity (finestra del projecte, no el Hub):

1. Barra de menú superior → **Abraveses** → **Setup Main Scene**.
2. Hauria de sortir un missatge que l’escena s’ha guardat a `Assets/Scenes/Main.unity`.

Si no veus el menú **Abraveses**, espera que acabi la barra de progrés de baix (compilació de scripts).

---

## Pas 5 — Jugar

1. Prem **Play** ▶ (triangle centrat a dalt).  
   **No cal** escena guardada: si l’escena està buida (`Untitled`), el joc es munta sol en entrar a Play.
2. Assegura’t que la pestanya **Game** (centre) està seleccionada, no només Scene.
3. Controls:
   - **W** accelerar · **S** enrere · **A / D** girar · **Espai** fre · **R** tornar al spawn

Per sortir del mode joc, torna a prémer **Play** ▶.

---

## Problemes freqüents

| Problema | Què fer |
|----------|---------|
| Insufficient space | Pas 1, després reinstal·lar |
| Hub es tanca sol des del terminal | Normal amb comandes automàtiques; ignora-ho i usa només el Hub manual |
| “No world mesh” | Des del repo: `source .venv/bin/activate` i `python tools/mapgen/build_world.py --all` |
| Projecte demana altra versió Unity | Instal·la la versió que demana o deixa que el Hub faci upgrade del projecte |

---

## Resum en 4 clics després d’instal·lar

**Hub → Projects → Open → AbravesesRacing → Unity: Abraveses → Setup Main Scene → Play ▶**

Més detall tècnic del mapa: [MAP_PIPELINE.md](MAP_PIPELINE.md).
