"""Recompte de les cases del poble: quines tenen model propi i de quines s'ha fet l'anàlisi detallada.

    python tools/mapgen/cases_status.py          # escriu data/cases/ESTAT.md i en treu el resum

L'univers són les cases del joc: les referències cadastrals de `web/public/village.json` (l'última
generació del món). Cada casa té un estat:

- `detall`: fitxa a cases.yaml amb `review: {level: full}` (anàlisi personalitzada completa: tots
  els volums, totes les façanes visibles, tàpies i expedient sencer; skill casa-a-mida).
- `fitxa`: fitxa a cases.yaml (model propi), feta abans del procediment complet o sense revisar.
- `propi`: model fet a mida per script (església, ermita).
- `expedient`: hi ha expedient a data/cases/<ref>/ però no fitxa (descartada o pendent; el motiu
  és al seu notes.md).
- `genèrica`: res; la casa surt amb l'estil a l'atzar de village.py.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.config import ROOT, load_config  # noqa: E402
from village import load_house_specs, read_cadastre  # noqa: E402

CASES_DIR = ROOT / "data" / "cases"
OUT = CASES_DIR / "ESTAT.md"
# Historial del recompte (una fila per dia): persisteix entre sessions i es puja al repo.
HISTORY = CASES_DIR / "historial.csv"
HISTORY_HEAD = "data,total,generic,propi_basic,propi_refinat\n"
USES = {
    "1_residential": "habitatge",
    "2_agriculture": "agrari",
    "3_industrial": "industrial",
    "4_1_office": "oficines",
    "4_2_retail": "comerç",
    "4_3_publicServices": "servei públic",
}
STATES = ["detall", "fitxa", "propi", "expedient", "genèrica"]
LABEL = {
    "detall": "anàlisi detallada feta",
    "fitxa": "model propi, pendent d'anàlisi detallada",
    "propi": "model propi per script",
    "expedient": "expedient sense fitxa",
    "genèrica": "genèrica (pendent)",
}


def expedient(ref: str) -> dict:
    """Què hi ha a l'expedient de la casa."""
    d = CASES_DIR / ref
    if not d.is_dir():
        return {}
    sv = d / "streetview"
    sat = d / "satellit"
    return {
        "expedient": (d / "expedient.txt").is_file(),
        "foto": (d / "cadastre_facana.jpg").is_file(),
        "notes": (d / "notes.md").is_file(),
        "sv": len(list(sv.glob("*.jpg")) + list(sv.glob("*.png"))) if sv.is_dir() else 0,
        "sat": bool(sat.is_dir() and any(sat.iterdir())),
        "joc": len(list(d.glob("joc_*.jpg")) + list(d.glob("joc_*.png"))),
    }


def missing(ex: dict) -> str:
    """El que falta a l'expedient perquè la fitxa es pugui donar per acabada."""
    if not ex:
        return "sense expedient"
    out = []
    if not ex["expedient"]:
        out.append("expedient.txt")
    if not ex["notes"]:
        out.append("notes.md")
    if ex["sv"] < 2:
        out.append(f"Street View ({ex['sv']})")
    if not ex["sat"]:
        out.append("satèl·lit")
    if not ex["joc"]:
        out.append("captures del joc")
    return ", ".join(out) or "—"


def main() -> None:
    import geopandas as gpd
    from shapely.ops import unary_union

    cfg = load_config()
    village = ROOT / "web" / "public" / "village.json"
    if not village.is_file():
        sys.exit("Falta web/public/village.json: genera el món primer (build_world.py)")
    refs = sorted(set(json.loads(village.read_text(encoding="utf-8"))["houses"].values()))

    cad = Path(cfg["paths"]["cadastre_dir"])
    parts = read_cadastre(cad, "BuildingPart")
    parts["building"] = parts["localId"].astype(str).str.split("_part").str[0]
    parts = parts[parts["building"].isin(refs)]
    geom = {ref: unary_union(list(g.geometry)) for ref, g in parts.groupby("building")}
    n_parts = parts.groupby("building").size().to_dict()
    buildings = read_cadastre(cad, "Building").set_index("localId")

    # Carrer: el nom de la via de l'OSM més propera (fins a 40 m).
    osm = gpd.read_file(cfg["paths"]["osm_geojson"]).to_crs(epsg=int(cfg["utm_epsg"]))
    named = osm[osm["highway"].notna() & osm["name"].notna()]
    streets = {name: unary_union(list(g.geometry)) for name, g in named.groupby("name")}

    def street(ref: str) -> str:
        g = geom.get(ref)
        if g is None or not streets:
            return "—"
        name, dist = min(((n, s.distance(g)) for n, s in streets.items()), key=lambda x: x[1])
        return name if dist <= 40 else "(fora de carrer)"

    specs = load_house_specs(Path(__file__).with_name("cases.yaml"))
    vd = cfg.get("village_detail", {})
    landmarks = {str(vd.get("church_ref", "")), str(vd.get("hermitage_ref", ""))} - {""}

    rows = []
    for ref in refs:
        sp = specs.get(ref)
        ex = expedient(ref)
        review = (sp or {}).get("review") or {}
        if sp is not None and review.get("level") == "full":
            state = "detall"
        elif sp is not None:
            state = "fitxa"
        elif ref in landmarks:
            state = "propi"
        elif ex:
            state = "expedient"
        else:
            state = "genèrica"
        b = buildings.loc[ref] if ref in buildings.index else None
        use = USES.get(str(b["currentUse"]), str(b["currentUse"])) if b is not None else "—"
        year = str(b["beginning"])[:4] if b is not None else "—"
        area = int(float(b["value"])) if b is not None and str(b["value"]) not in ("nan", "None") else 0
        rows.append({
            "ref": ref, "state": state, "street": street(ref), "use": use, "year": year, "m2": area,
            "parts": n_parts.get(ref, 0), "ex": ex, "date": str(review.get("date", "")),
        })

    total = len(rows)
    count = Counter(r["state"] for r in rows)
    own = count["detall"] + count["fitxa"] + count["propi"]
    # Els tres grups del recompte: genèric (sense fitxa, tingui expedient o no), propi bàsic (fitxa
    # sense anàlisi detallada, o model per script) i propi refinat (anàlisi detallada feta).
    generic = count["genèrica"] + count["expedient"]
    basic = count["fitxa"] + count["propi"]
    refined = count["detall"]
    today = dt.date.today().isoformat()
    hist = HISTORY.read_text(encoding="utf-8").splitlines(keepends=True)[1:] if HISTORY.is_file() else []
    hist = [h for h in hist if not h.startswith(today + ",")] + [f"{today},{total},{generic},{basic},{refined}\n"]
    HISTORY.write_text(HISTORY_HEAD + "".join(sorted(hist)), encoding="utf-8")

    def pct(n: int) -> str:
        return f"{100 * n / total:.1f} %" if total else "—"

    lines = [
        "# Estat de les cases del poble",
        "",
        f"Generat per `tools/mapgen/cases_status.py` el {dt.date.today().isoformat()}; **no l'editis a mà**.",
        "Les cases són les del joc (referències cadastrals de `web/public/village.json`). Per fer una",
        "casa, vegeu la skill `casa-a-mida` (`.claude/skills/casa-a-mida/SKILL.md`).",
        "",
        "## Recompte",
        "",
        "| model | cases | % |",
        "|---|---:|---:|",
        f"| **Genèric** (sense fitxa) | {generic} | {pct(generic)} |",
        f"| **Propi bàsic** (fitxa sense anàlisi detallada, o model per script) | {basic} | {pct(basic)} |",
        f"| **Propi refinat** (anàlisi detallada feta) | {refined} | {pct(refined)} |",
        f"| Total al joc | {total} | 100 % |",
        "",
        "L'evolució és a `data/cases/historial.csv` (una fila per dia).",
        "",
        "## Detall",
        "",
        "| | cases | % |",
        "|---|---:|---:|",
        f"| **Total al joc** | {total} | 100 % |",
        f"| Amb model propi (fitxa o script) | {own} | {pct(own)} |",
        f"| — amb anàlisi detallada feta | {count['detall']} | {pct(count['detall'])} |",
        f"| — amb fitxa, pendents d'anàlisi detallada | {count['fitxa']} | {pct(count['fitxa'])} |",
        f"| — model propi per script (església, ermita) | {count['propi']} | {pct(count['propi'])} |",
        f"| Amb expedient però sense fitxa | {count['expedient']} | {pct(count['expedient'])} |",
        f"| Genèriques, sense res | {count['genèrica']} | {pct(count['genèrica'])} |",
        f"| **Pendents d'anàlisi detallada** (tot el que no és `detall` ni `propi`) | "
        f"{total - count['detall'] - count['propi']} | {pct(total - count['detall'] - count['propi'])} |",
        "",
    ]
    by_use = defaultdict(Counter)
    for r in rows:
        by_use[r["use"]][r["state"]] += 1
    lines += ["### Per ús (Cadastre)", "", "| ús | total | detall | fitxa | propi | expedient | genèrica |", "|---|---:|---:|---:|---:|---:|---:|"]
    for use, c in sorted(by_use.items(), key=lambda kv: -sum(kv[1].values())):
        lines.append(f"| {use} | {sum(c.values())} | " + " | ".join(str(c[s]) for s in STATES) + " |")
    by_street = defaultdict(Counter)
    for r in rows:
        by_street[r["street"]][r["state"]] += 1
    lines += ["", "### Per carrer", "", "| carrer (OSM) | total | detall | fitxa | propi | expedient | genèrica |", "|---|---:|---:|---:|---:|---:|---:|"]
    for st, c in sorted(by_street.items(), key=lambda kv: -sum(kv[1].values())):
        lines.append(f"| {st} | {sum(c.values())} | " + " | ".join(str(c[s]) for s in STATES) + " |")

    def table(title: str, sel: list, extra: bool) -> None:
        lines.extend(["", f"## {title} ({len(sel)})", ""])
        if not sel:
            lines.append("Cap.")
            return
        head = "| referència | carrer (OSM) | ús | any | m² | parts |"
        sep = "|---|---|---|---:|---:|---:|"
        if extra:
            head += " Street View | satèl·lit | joc | revisió | falta |"
            sep += "---:|:---:|---:|---|---|"
        lines.extend([head, sep])
        for r in sorted(sel, key=lambda r: (r["street"], r["ref"])):
            row = f"| `{r['ref']}` | {r['street']} | {r['use']} | {r['year']} | {r['m2']} | {r['parts']} |"
            if extra:
                ex = r["ex"]
                row += (f" {ex.get('sv', 0)} | {'sí' if ex.get('sat') else 'no'} | {ex.get('joc', 0)} |"
                        f" {r['date'] or '—'} | {missing(ex)} |")
            lines.append(row)

    table("Anàlisi detallada feta", [r for r in rows if r["state"] == "detall"], True)
    table("Model propi, pendents d'anàlisi detallada", [r for r in rows if r["state"] == "fitxa"], True)
    table("Model propi per script", [r for r in rows if r["state"] == "propi"], False)
    table("Expedient sense fitxa (motiu al notes.md)", [r for r in rows if r["state"] == "expedient"], True)
    table("Genèriques (pendents)", [r for r in rows if r["state"] == "genèrica"], False)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Cases al joc: {total} · genèric {generic} · propi bàsic {basic} · propi refinat {refined}")
    for s in STATES:
        print(f"  {LABEL[s]:<42} {count[s]:>4}  ({pct(count[s])})")
    print(f"  {'pendents d’anàlisi detallada':<42} {total - count['detall'] - count['propi']:>4}")
    print(f"→ {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
