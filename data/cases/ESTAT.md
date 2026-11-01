# Estat de les cases del poble

Generat per `tools/mapgen/cases_status.py` el 2026-11-01; **no l'editis a mà**.
Les cases són les del joc (referències cadastrals de `web/public/village.json`). Per fer una
casa, vegeu la skill `casa-a-mida` (`.claude/skills/casa-a-mida/SKILL.md`).

## Recompte

| model | cases | % |
|---|---:|---:|
| **Genèric** (sense fitxa) | 271 | 64.5 % |
| **Propi bàsic** (fitxa sense anàlisi detallada, o model per script) | 7 | 1.7 % |
| **Propi refinat** (anàlisi detallada feta) | 142 | 33.8 % |
| Total al joc | 420 | 100 % |

L'evolució és a `data/cases/historial.csv` (una fila per dia).

## Detall

| | cases | % |
|---|---:|---:|
| **Total al joc** | 420 | 100 % |
| Amb model propi (fitxa o script) | 149 | 35.5 % |
| — amb anàlisi detallada feta | 142 | 33.8 % |
| — amb fitxa, pendents d'anàlisi detallada | 5 | 1.2 % |
| — model propi per script (església, ermita) | 2 | 0.5 % |
| Amb expedient però sense fitxa | 0 | 0.0 % |
| Genèriques, sense res | 271 | 64.5 % |
| **Pendents d'anàlisi detallada** (tot el que no és `detall` ni `propi`) | 276 | 65.7 % |

### Per ús (Cadastre)

| ús | total | detall | fitxa | propi | expedient | genèrica |
|---|---:|---:|---:|---:|---:|---:|
| habitatge | 334 | 127 | 2 | 0 | 0 | 205 |
| industrial | 48 | 11 | 2 | 0 | 0 | 35 |
| agrari | 23 | 0 | 0 | 0 | 0 | 23 |
| servei públic | 11 | 3 | 0 | 2 | 0 | 6 |
| comerç | 2 | 1 | 0 | 0 | 0 | 1 |
| — | 1 | 0 | 1 | 0 | 0 | 0 |
| oficines | 1 | 0 | 0 | 0 | 0 | 1 |

### Per carrer

| carrer (OSM) | total | detall | fitxa | propi | expedient | genèrica |
|---|---:|---:|---:|---:|---:|---:|
| (fora de carrer) | 54 | 3 | 2 | 1 | 0 | 48 |
| Calle Larga | 46 | 0 | 0 | 0 | 0 | 46 |
| Calle el Cristo | 45 | 45 | 0 | 0 | 0 | 0 |
| Calle Santiago | 45 | 30 | 2 | 0 | 0 | 13 |
| Calle Las Paneras | 36 | 0 | 0 | 0 | 0 | 36 |
| Calle Real | 34 | 0 | 0 | 0 | 0 | 34 |
| Calle Las Bodegas | 18 | 0 | 0 | 0 | 0 | 18 |
| Calle Santibáñez | 18 | 18 | 0 | 0 | 0 | 0 |
| Calle Calzada | 17 | 13 | 0 | 0 | 0 | 4 |
| Calle Callejina | 15 | 0 | 0 | 0 | 0 | 15 |
| Calle Álamo | 15 | 0 | 0 | 0 | 0 | 15 |
| Calle Viriato | 13 | 13 | 0 | 0 | 0 | 0 |
| Calle Taburete | 10 | 10 | 0 | 0 | 0 | 0 |
| Calle Valdelatorre | 9 | 0 | 0 | 0 | 0 | 9 |
| Calle de la Iglesia | 8 | 7 | 0 | 1 | 0 | 0 |
| Travesía Baja | 8 | 0 | 0 | 0 | 0 | 8 |
| Calle La Iglesia | 7 | 0 | 0 | 0 | 0 | 7 |
| Cuesta El Cepo | 6 | 0 | 0 | 0 | 0 | 6 |
| Calle Caño | 6 | 0 | 0 | 0 | 0 | 6 |
| Travesía Alta | 5 | 0 | 0 | 0 | 0 | 5 |
| Calle La Rinconada | 4 | 3 | 0 | 0 | 0 | 1 |
| — | 1 | 0 | 1 | 0 | 0 | 0 |

## Anàlisi detallada feta (142)

| referència | carrer (OSM) | ús | any | m² | parts | Street View | satèl·lit | joc | revisió | falta |
|---|---|---|---:|---:|---:|---:|:---:|---:|---|---|
| `002000100TM55D` | (fora de carrer) | habitatge | 1900 | 298 | 2 | 1 | sí | 0 | 2026-10-09 | Street View (1), captures del joc |
| `002000200TM55D` | (fora de carrer) | industrial | 1973 | 471 | 2 | 1 | sí | 0 | 2026-10-09 | Street View (1), captures del joc |
| `002000300TM55D` | (fora de carrer) | habitatge | 1985 | 205 | 3 | 2 | sí | 0 | 2026-10-09 | captures del joc |
| `0232101TM6503S` | Calle Calzada | habitatge | 1900 | 202 | 3 | 2 | no | 0 | 2026-10-09 | satèl·lit, captures del joc |
| `0232102TM6503S` | Calle Calzada | habitatge | 1900 | 234 | 3 | 0 | no | 1 | 2026-10-09 | Street View (0), satèl·lit |
| `0232106TM6503S` | Calle Calzada | habitatge | 1900 | 345 | 3 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0232109TM6503S` | Calle Calzada | habitatge | 1986 | 190 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0232110TM6503S` | Calle Calzada | habitatge | 2014 | 433 | 3 | 3 | sí | 1 | 2026-10-10 | — |
| `0232111TM6503S` | Calle Calzada | habitatge | 1900 | 208 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0233401TM6503S` | Calle Calzada | habitatge | 1980 | 250 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0233402TM6503S` | Calle Calzada | habitatge | 1900 | 204 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0233403TM6503S` | Calle Calzada | habitatge | 1900 | 148 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0233404TM6503S` | Calle Calzada | habitatge | 1900 | 294 | 3 | 2 | sí | 1 | 2026-10-10 | — |
| `0233405TM6503S` | Calle Calzada | habitatge | 1900 | 257 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0233701TM6503S` | Calle Calzada | habitatge | 1975 | 381 | 4 | 2 | sí | 1 | 2026-10-10 | — |
| `0233702TM6503S` | Calle Calzada | habitatge | 1900 | 55 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0232104TM6503S` | Calle La Rinconada | habitatge | 1998 | 304 | 1 | 0 | no | 1 | 2026-10-09 | Street View (0), satèl·lit |
| `0232107TM6503S` | Calle La Rinconada | industrial | 1900 | 505 | 3 | 5 | sí | 1 | 2026-10-09 | — |
| `0232303TM6503S` | Calle La Rinconada | habitatge | 2014 | 124 | 1 | 4 | sí | 2 | 2026-10-09 | — |
| `0333207TM6503S` | Calle Santiago | habitatge | 2003 | 310 | 3 | 3 | sí | 1 | 2026-10-10 | — |
| `0333208TM6503S` | Calle Santiago | habitatge | 1900 | 263 | 2 | 3 | sí | 1 | 2026-10-10 | — |
| `0333212TM6503S` | Calle Santiago | habitatge | 1900 | 27 | 1 | 3 | sí | 1 | 2026-10-10 | — |
| `0333214TM6503S` | Calle Santiago | habitatge | 1900 | 210 | 2 | 3 | sí | 1 | 2026-10-10 | — |
| `0333216TM6503S` | Calle Santiago | habitatge | 1900 | 192 | 4 | 3 | sí | 1 | 2026-10-10 | — |
| `0333217TM6503S` | Calle Santiago | habitatge | 2000 | 96 | 1 | 4 | sí | 1 | 2026-10-10 | — |
| `0333218TM6503S` | Calle Santiago | habitatge | 1942 | 76 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0333219TM6503S` | Calle Santiago | habitatge | 1942 | 62 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0333221TM6503S` | Calle Santiago | habitatge | 1900 | 252 | 3 | 2 | sí | 1 | 2026-10-10 | — |
| `0333223TM6503S` | Calle Santiago | habitatge | 1900 | 212 | 4 | 2 | sí | 1 | 2026-10-10 | — |
| `0333224TM6503S` | Calle Santiago | habitatge | 1900 | 339 | 4 | 2 | sí | 1 | 2026-10-10 | — |
| `0333603TM6503S` | Calle Santiago | habitatge | 1990 | 104 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0333605TM6503S` | Calle Santiago | habitatge | 1900 | 331 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0333606TM6503S` | Calle Santiago | habitatge | 1900 | 182 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0333607TM6503S` | Calle Santiago | habitatge | 1900 | 187 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0334208TM6503S` | Calle Santiago | habitatge | 1976 | 264 | 3 | 3 | sí | 1 | 2026-10-10 | — |
| `0334209TM6503S` | Calle Santiago | servei públic | 2007 | 218 | 1 | 4 | sí | 1 | 2026-10-10 | — |
| `0334210TM6503S` | Calle Santiago | servei públic | 1965 | 122 | 1 | 3 | sí | 1 | 2026-10-10 | — |
| `0334211TM6503S` | Calle Santiago | industrial | 1965 | 148 | 1 | 3 | sí | 1 | 2026-10-10 | — |
| `0334603TM6503S` | Calle Santiago | habitatge | 1981 | 248 | 3 | 2 | sí | 1 | 2026-10-10 | — |
| `0432383TM6503S` | Calle Santiago | habitatge | 2010 | 35 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0432801TM6503S` | Calle Santiago | habitatge | 1944 | 25 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0432802TM6503S` | Calle Santiago | habitatge | 2010 | 23 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0432803TM6503S` | Calle Santiago | habitatge | 1900 | 293 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0432804TM6503S` | Calle Santiago | habitatge | 1900 | 206 | 3 | 2 | sí | 1 | 2026-10-10 | — |
| `0432805TM6503S` | Calle Santiago | habitatge | 1942 | 271 | 3 | 2 | sí | 1 | 2026-10-10 | — |
| `0432806TM6503S` | Calle Santiago | habitatge | 1900 | 118 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0432807TM6503S` | Calle Santiago | industrial | 1970 | 20 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0432809TM6503S` | Calle Santiago | habitatge | 1968 | 241 | 3 | 2 | sí | 1 | 2026-10-10 | — |
| `49130A50107682` | Calle Santiago | habitatge | 2009 | 46 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0032901TM6503S` | Calle Santibáñez | habitatge | 1985 | 364 | 3 | 5 | sí | 1 | 2026-10-09 | — |
| `0032941TM6503S` | Calle Santibáñez | habitatge | 1994 | 439 | 2 | 5 | sí | 3 | 2026-10-09 | — |
| `0132102TM6503S` | Calle Santibáñez | habitatge | 1965 | 211 | 2 | 5 | sí | 2 | 2026-10-09 | — |
| `0132103TM6503S` | Calle Santibáñez | habitatge | 1995 | 180 | 2 | 6 | sí | 3 | 2026-10-09 | — |
| `0132131TM6503S` | Calle Santibáñez | habitatge | 2007 | 327 | 6 | 0 | sí | 1 | 2026-10-09 | Street View (0) |
| `0132135TM6503S` | Calle Santibáñez | habitatge | 1985 | 285 | 3 | 10 | sí | 3 | 2026-10-09 | — |
| `0232108TM6503S` | Calle Santibáñez | habitatge | 1935 | 142 | 2 | 9 | sí | 3 | 2026-10-09 | — |
| `0232301TM6503S` | Calle Santibáñez | habitatge | 1900 | 160 | 1 | 4 | sí | 1 | 2026-10-09 | — |
| `0331111TM6503S` | Calle Santibáñez | industrial | 1950 | 104 | 1 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0332002TM6503S` | Calle Santibáñez | habitatge | 1900 | 280 | 4 | 4 | sí | 1 | 2026-10-09 | — |
| `0332003TM6503S` | Calle Santibáñez | habitatge | 1978 | 78 | 1 | 3 | sí | 1 | 2026-10-09 | — |
| `0332501TM6503S` | Calle Santibáñez | habitatge | 1900 | 420 | 4 | 5 | sí | 1 | 2026-10-09 | — |
| `0332502TM6503S` | Calle Santibáñez | habitatge | 1918 | 186 | 2 | 5 | sí | 1 | 2026-10-09 | — |
| `0332503TM6503S` | Calle Santibáñez | habitatge | 1967 | 394 | 2 | 4 | sí | 1 | 2026-10-09 | — |
| `0332504TM6503S` | Calle Santibáñez | habitatge | 1968 | 285 | 2 | 4 | sí | 1 | 2026-10-09 | — |
| `0332505TM6503S` | Calle Santibáñez | habitatge | 1900 | 257 | 3 | 3 | sí | 1 | 2026-10-09 | — |
| `0332506TM6503S` | Calle Santibáñez | industrial | 1970 | 59 | 1 | 5 | sí | 1 | 2026-10-09 | — |
| `0332507TM6503S` | Calle Santibáñez | habitatge | 1941 | 164 | 2 | 5 | sí | 1 | 2026-10-09 | — |
| `0431001TM6503S` | Calle Taburete | habitatge | 1973 | 165 | 2 | 4 | sí | 2 | 2026-10-09 | — |
| `0431101TM6503S` | Calle Taburete | habitatge | 1900 | 200 | 1 | 4 | sí | 3 | 2026-10-09 | — |
| `0432823TM6503S` | Calle Taburete | habitatge | 1900 | 263 | 4 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0432828TM6503S` | Calle Taburete | habitatge | 1900 | 198 | 3 | 3 | sí | 1 | 2026-10-09 | — |
| `0432829TM6503S` | Calle Taburete | habitatge | 1900 | 122 | 2 | 2 | sí | 1 | 2026-10-09 | — |
| `0432830TM6503S` | Calle Taburete | habitatge | 1900 | 222 | 3 | 3 | sí | 1 | 2026-10-09 | — |
| `0432831TM6503S` | Calle Taburete | habitatge | 1900 | 92 | 1 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0432832TM6503S` | Calle Taburete | habitatge | 2005 | 172 | 3 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0432833TM6503S` | Calle Taburete | habitatge | 1900 | 124 | 3 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0432839TM6503S` | Calle Taburete | industrial | 1995 | 81 | 1 | 2 | sí | 1 | 2026-10-09 | — |
| `0332004TM6503S` | Calle Viriato | habitatge | 1900 | 71 | 2 | 3 | sí | 1 | 2026-10-09 | — |
| `0332007TM6503S` | Calle Viriato | habitatge | 1900 | 169 | 2 | 2 | sí | 2 | 2026-10-10 | — |
| `0332703TM6503S` | Calle Viriato | habitatge | 1900 | 183 | 3 | 1 | no | 0 | 2026-10-09 | Street View (1), satèl·lit, captures del joc |
| `0333608TM6503S` | Calle Viriato | habitatge | 1900 | 457 | 3 | 3 | sí | 1 | 2026-10-10 | — |
| `0333609TM6503S` | Calle Viriato | habitatge | 1900 | 162 | 2 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0432811TM6503S` | Calle Viriato | habitatge | 1966 | 201 | 2 | 2 | sí | 1 | 2026-10-10 | — |
| `0432812TM6503S` | Calle Viriato | habitatge | 1965 | 37 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0432813TM6503S` | Calle Viriato | habitatge | 1977 | 303 | 3 | 2 | sí | 1 | 2026-10-10 | — |
| `0432814TM6503S` | Calle Viriato | habitatge | 1984 | 409 | 3 | 2 | sí | 1 | 2026-10-10 | — |
| `0432815TM6503S` | Calle Viriato | habitatge | 1900 | 270 | 5 | 2 | sí | 1 | 2026-10-10 | — |
| `0432816TM6503S` | Calle Viriato | habitatge | 1900 | 21 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0432817TM6503S` | Calle Viriato | habitatge | 1900 | 488 | 3 | 2 | sí | 1 | 2026-10-10 | — |
| `0432818TM6503S` | Calle Viriato | habitatge | 1998 | 180 | 1 | 2 | sí | 1 | 2026-10-10 | — |
| `0232103TM6503S` | Calle de la Iglesia | habitatge | 1900 | 19 | 1 | 0 | no | 1 | 2026-10-09 | Street View (0), satèl·lit |
| `0232302TM6503S` | Calle de la Iglesia | habitatge | 1963 | 188 | 2 | 7 | sí | 2 | 2026-10-08 | — |
| `0332704TM6503S` | Calle de la Iglesia | habitatge | 1900 | 230 | 3 | 6 | sí | 1 | 2026-10-09 | — |
| `0333601TM6503S` | Calle de la Iglesia | habitatge | 1943 | 162 | 2 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0333602TM6503S` | Calle de la Iglesia | habitatge | 1900 | 388 | 4 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0333610TM6503S` | Calle de la Iglesia | habitatge | 1900 | 274 | 2 | 1 | no | 1 | 2026-10-09 | Street View (1), satèl·lit |
| `0333611TM6503S` | Calle de la Iglesia | habitatge | 1900 | 346 | 5 | 2 | no | 0 | 2026-10-09 | satèl·lit, captures del joc |
| `0331103TM6503S` | Calle el Cristo | habitatge | 1992 | 100 | 2 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0332001TM6503S` | Calle el Cristo | habitatge | 1900 | 384 | 4 | 5 | sí | 2 | 2026-10-09 | — |
| `0332508TM6503S` | Calle el Cristo | habitatge | 1900 | 290 | 2 | 3 | sí | 1 | 2026-10-09 | — |
| `0429498TM6502N` | Calle el Cristo | habitatge | 2005 | 281 | 6 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0431501TM6503S` | Calle el Cristo | habitatge | 1900 | 173 | 3 | 2 | sí | 2 | 2026-10-09 | — |
| `0431701TM6503S` | Calle el Cristo | habitatge | 1995 | 102 | 2 | 2 | sí | 1 | 2026-10-09 | — |
| `0431702TM6503S` | Calle el Cristo | habitatge | 1939 | 367 | 3 | 3 | sí | 1 | 2026-10-09 | — |
| `0431703TM6503S` | Calle el Cristo | habitatge | 1900 | 344 | 3 | 2 | sí | 1 | 2026-10-09 | — |
| `0431704TM6503S` | Calle el Cristo | habitatge | 1900 | 226 | 2 | 2 | sí | 1 | 2026-10-09 | — |
| `0431705TM6503S` | Calle el Cristo | habitatge | 1995 | 146 | 2 | 4 | sí | 1 | 2026-10-09 | — |
| `0431706TM6503S` | Calle el Cristo | habitatge | 1900 | 269 | 3 | 2 | sí | 1 | 2026-10-09 | — |
| `0432384TM6503S` | Calle el Cristo | habitatge | 2026 | 165 | 2 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0432601TM6503S` | Calle el Cristo | servei públic | 1978 | 82 | 1 | 4 | sí | 1 | 2026-10-09 | — |
| `0432819TM6503S` | Calle el Cristo | comerç | 1933 | 93 | 1 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0432821TM6503S` | Calle el Cristo | habitatge | 1973 | 437 | 3 | 2 | sí | 1 | 2026-10-09 | — |
| `0432822TM6503S` | Calle el Cristo | habitatge | 1900 | 272 | 2 | 2 | sí | 2 | 2026-10-09 | — |
| `0432824TM6503S` | Calle el Cristo | habitatge | 1900 | 337 | 2 | 2 | sí | 2 | 2026-10-09 | — |
| `0432825TM6503S` | Calle el Cristo | habitatge | 1900 | 162 | 3 | 2 | sí | 0 | 2026-10-09 | captures del joc |
| `0432826TM6503S` | Calle el Cristo | habitatge | 1900 | 293 | 6 | 2 | sí | 1 | 2026-10-09 | — |
| `0432827TM6503S` | Calle el Cristo | habitatge | 1900 | 127 | 2 | 4 | sí | 1 | 2026-10-09 | — |
| `0432835TM6503S` | Calle el Cristo | habitatge | 2002 | 138 | 3 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0432836TM6503S` | Calle el Cristo | industrial | 2000 | 77 | 1 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0432837TM6503S` | Calle el Cristo | industrial | 1900 | 113 | 2 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0530101TM6503S` | Calle el Cristo | habitatge | 1900 | 505 | 4 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530102TM6503S` | Calle el Cristo | habitatge | 1900 | 285 | 3 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530103TM6503S` | Calle el Cristo | habitatge | 1997 | 337 | 4 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530104TM6503S` | Calle el Cristo | industrial | 1999 | 140 | 3 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530106TM6503S` | Calle el Cristo | habitatge | 1983 | 250 | 1 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530107TM6503S` | Calle el Cristo | industrial | 1975 | 65 | 1 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530108TM6503S` | Calle el Cristo | habitatge | 1900 | 400 | 2 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530111TM6503S` | Calle el Cristo | habitatge | 1900 | 494 | 3 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530112TM6503S` | Calle el Cristo | habitatge | 1980 | 746 | 5 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530501TM6503S` | Calle el Cristo | habitatge | 1900 | 378 | 4 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530503TM6503S` | Calle el Cristo | habitatge | 2005 | 105 | 1 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0530504TM6502N` | Calle el Cristo | habitatge | 1900 | 465 | 4 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0530506TM6502N` | Calle el Cristo | habitatge | 1971 | 468 | 4 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0530507TM6503S` | Calle el Cristo | habitatge | 1920 | 252 | 3 | 0 | sí | 0 | 2026-10-09 | Street View (0), captures del joc |
| `0531965TM6503S` | Calle el Cristo | habitatge | 2022 | 136 | 4 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0531998TM6503S` | Calle el Cristo | habitatge | 2016 | 183 | 4 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0630501TM6502N` | Calle el Cristo | habitatge | 1900 | 460 | 1 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0630502TM6502N` | Calle el Cristo | habitatge | 1979 | 90 | 2 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0630504TM6502N` | Calle el Cristo | habitatge | 1900 | 202 | 4 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0630505TM6502N` | Calle el Cristo | habitatge | 1900 | 219 | 4 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0630506TM6502N` | Calle el Cristo | habitatge | 2003 | 164 | 3 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `49130A50100371` | Calle el Cristo | habitatge | 2005 | 506 | 4 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |

## Model propi, pendents d'anàlisi detallada (5)

| referència | carrer (OSM) | ús | any | m² | parts | Street View | satèl·lit | joc | revisió | falta |
|---|---|---|---:|---:|---:|---:|:---:|---:|---|---|
| `002100500TM65C` | (fora de carrer) | industrial | 1986 | 43 | 1 | 0 | no | 0 | — | expedient.txt, Street View (0), satèl·lit, captures del joc |
| `0432842TM6503S` | (fora de carrer) | habitatge | 2014 | 139 | 4 | 0 | no | 0 | — | expedient.txt, Street View (0), satèl·lit, captures del joc |
| `0333206TM6503S` | Calle Santiago | habitatge | 1900 | 192 | 1 | 0 | no | 0 | — | expedient.txt, Street View (0), satèl·lit, captures del joc |
| `0334204TM6503S` | Calle Santiago | industrial | 1985 | 135 | 2 | 0 | no | 0 | — | expedient.txt, Street View (0), satèl·lit, captures del joc |
| `0132947TM6503S` | — | — | — | 0 | 0 | 0 | no | 0 | — | expedient.txt, Street View (0), satèl·lit, captures del joc |

## Model propi per script (2)

| referència | carrer (OSM) | ús | any | m² | parts |
|---|---|---|---:|---:|---:|
| `000100400TM65A` | (fora de carrer) | servei públic | 1900 | 588 | 1 |
| `0333803TM6503S` | Calle de la Iglesia | servei públic | 1900 | 353 | 1 |

## Expedient sense fitxa (motiu al notes.md) (0)

Cap.

## Genèriques (pendents) (271)

| referència | carrer (OSM) | ús | any | m² | parts |
|---|---|---|---:|---:|---:|
| `000100100TM65A` | (fora de carrer) | habitatge | 1985 | 175 | 1 |
| `000100300TM65C` | (fora de carrer) | habitatge | 1964 | 380 | 2 |
| `000100400TM65C` | (fora de carrer) | habitatge | 1980 | 396 | 3 |
| `000500200TM55D` | (fora de carrer) | habitatge | 1980 | 317 | 1 |
| `000500300TM55D` | (fora de carrer) | habitatge | 1980 | 90 | 1 |
| `000500500TM55D` | (fora de carrer) | industrial | 1900 | 65 | 1 |
| `000500600TM55D` | (fora de carrer) | habitatge | 1991 | 243 | 1 |
| `001100100TM65C` | (fora de carrer) | habitatge | 1900 | 521 | 4 |
| `001600100TM65C` | (fora de carrer) | habitatge | 1900 | 54 | 1 |
| `001600200TM65C` | (fora de carrer) | industrial | 1978 | 57 | 2 |
| `001600400TM65C` | (fora de carrer) | servei públic | 1900 | 56 | 1 |
| `002000500TM55D` | (fora de carrer) | habitatge | 1981 | 152 | 3 |
| `002100200TM65C` | (fora de carrer) | industrial | 1980 | 31 | 1 |
| `002100300TM65C` | (fora de carrer) | industrial | 1980 | 31 | 1 |
| `002100400TM65C` | (fora de carrer) | habitatge | 1900 | 82 | 2 |
| `002500200TM55F` | (fora de carrer) | habitatge | 1980 | 78 | 1 |
| `49130A50100077` | (fora de carrer) | habitatge | 2000 | 155 | 2 |
| `49130A50100381` | (fora de carrer) | agrari | 1970 | 299 | 1 |
| `49130A50100388` | (fora de carrer) | agrari | 2000 | 54 | 2 |
| `49130A50100411` | (fora de carrer) | agrari | 2000 | 47 | 1 |
| `49130A50108447` | (fora de carrer) | industrial | 2015 | 702 | 1 |
| `49130A80105026` | (fora de carrer) | habitatge | 1980 | 24 | 1 |
| `49130A80105176` | (fora de carrer) | agrari | 2000 | 98 | 1 |
| `49130A80105178` | (fora de carrer) | agrari | 1990 | 1776 | 2 |
| `49130A80105179` | (fora de carrer) | agrari | 1975 | 240 | 2 |
| `49130A80105295` | (fora de carrer) | industrial | 1985 | 140 | 1 |
| `49228A01200078` | (fora de carrer) | agrari | 1980 | 44 | 1 |
| `49228A01200081` | (fora de carrer) | habitatge | 2022 | 186 | 3 |
| `49228A01200084` | (fora de carrer) | habitatge | 1990 | 32 | 1 |
| `49228A01200086` | (fora de carrer) | habitatge | 1996 | 221 | 5 |
| `49228A01200089` | (fora de carrer) | industrial | 1984 | 481 | 2 |
| `49228A01200092` | (fora de carrer) | agrari | 2002 | 64 | 1 |
| `49228A01200332` | (fora de carrer) | agrari | 1978 | 85 | 2 |
| `49228A01200387` | (fora de carrer) | comerç | 1997 | 1428 | 7 |
| `49228A01200430` | (fora de carrer) | agrari | 2005 | 253 | 2 |
| `49228A01200575` | (fora de carrer) | agrari | 2010 | 226 | 1 |
| `49228A01200603` | (fora de carrer) | agrari | 1973 | 77 | 1 |
| `49228A01200604` | (fora de carrer) | agrari | 1995 | 739 | 2 |
| `49228A01200615` | (fora de carrer) | agrari | 1960 | 20 | 1 |
| `49228A01200626` | (fora de carrer) | agrari | 2004 | 2176 | 1 |
| `49228A01200627` | (fora de carrer) | agrari | 2010 | 1177 | 3 |
| `49228A01200750` | (fora de carrer) | agrari | 2005 | 21 | 1 |
| `49228A01200754` | (fora de carrer) | industrial | 1992 | 63 | 1 |
| `49228A01209038` | (fora de carrer) | agrari | 2005 | 48 | 2 |
| `49228A01400317` | (fora de carrer) | agrari | 1900 | 1272 | 6 |
| `9449201TM5594N` | (fora de carrer) | habitatge | 1994 | 38 | 1 |
| `9649003TM5594N` | (fora de carrer) | habitatge | 1932 | 363 | 2 |
| `9649004TM5594N` | (fora de carrer) | habitatge | 1960 | 640 | 5 |
| `000100500TM65C` | Calle Callejina | habitatge | 1985 | 100 | 2 |
| `000100600TM65C` | Calle Callejina | habitatge | 1985 | 345 | 4 |
| `000100700TM65C` | Calle Callejina | habitatge | 1988 | 74 | 1 |
| `000100800TM65C` | Calle Callejina | habitatge | 1989 | 202 | 2 |
| `000100900TM65C` | Calle Callejina | habitatge | 1988 | 71 | 1 |
| `000101100TM65C` | Calle Callejina | habitatge | 1980 | 154 | 1 |
| `000101200TM65C` | Calle Callejina | habitatge | 1984 | 221 | 3 |
| `000101300TM65C` | Calle Callejina | habitatge | 1996 | 167 | 1 |
| `000101400TM65C` | Calle Callejina | habitatge | 1900 | 199 | 3 |
| `000102100TM65C` | Calle Callejina | habitatge | 1903 | 231 | 4 |
| `49228A01400304` | Calle Callejina | habitatge | 1903 | 411 | 4 |
| `49228A01400333` | Calle Callejina | habitatge | 1992 | 119 | 1 |
| `9848202TM5594N` | Calle Callejina | habitatge | 2020 | 286 | 5 |
| `9848203TM5594N` | Calle Callejina | habitatge | 2020 | 275 | 4 |
| `9948801TM5594N` | Calle Callejina | habitatge | 1970 | 238 | 3 |
| `0233149TM6503S` | Calle Calzada | habitatge | 2021 | 165 | 3 |
| `0333801TM6503S` | Calle Calzada | habitatge | 1993 | 308 | 4 |
| `0334601TM6503S` | Calle Calzada | habitatge | 1980 | 555 | 4 |
| `0334602TM6503S` | Calle Calzada | habitatge | 1900 | 58 | 1 |
| `49228A01200544` | Calle Caño | industrial | 1989 | 617 | 3 |
| `49228A01200752` | Calle Caño | industrial | 1980 | 1023 | 2 |
| `9949701TM5594N` | Calle Caño | habitatge | 1920 | 212 | 2 |
| `9949702TM5594N` | Calle Caño | habitatge | 1920 | 212 | 3 |
| `9949801TM5594N` | Calle Caño | habitatge | 1969 | 725 | 4 |
| `9949802TM5594N` | Calle Caño | habitatge | 1987 | 188 | 3 |
| `9748401TM5594N` | Calle La Iglesia | habitatge | 1900 | 450 | 4 |
| `9748402TM5594N` | Calle La Iglesia | habitatge | 1900 | 292 | 3 |
| `9748403TM5594N` | Calle La Iglesia | habitatge | 1998 | 278 | 1 |
| `9748404TM5594N` | Calle La Iglesia | industrial | 1973 | 330 | 2 |
| `9847801TM5594N` | Calle La Iglesia | habitatge | 1900 | 405 | 4 |
| `9848702TM5594N` | Calle La Iglesia | servei públic | 1900 | 302 | 2 |
| `9848703TM5594N` | Calle La Iglesia | habitatge | 1910 | 164 | 3 |
| `0232105TM6503S` | Calle La Rinconada | habitatge | 1986 | 100 | 2 |
| `49228A01200083` | Calle Larga | habitatge | 1968 | 558 | 2 |
| `49228A01200762` | Calle Larga | habitatge | 1985 | 157 | 3 |
| `9548401TM5594N` | Calle Larga | habitatge | 1980 | 218 | 1 |
| `9548402TM5594N` | Calle Larga | habitatge | 1900 | 403 | 6 |
| `9548403TM5594N` | Calle Larga | habitatge | 1900 | 491 | 6 |
| `9548405TM5594N` | Calle Larga | habitatge | 1995 | 120 | 1 |
| `9548406TM5594N` | Calle Larga | habitatge | 2014 | 92 | 1 |
| `9548408TM5594N` | Calle Larga | industrial | 1900 | 28 | 1 |
| `9548409TM5594N` | Calle Larga | industrial | 1900 | 75 | 2 |
| `9548410TM5594N` | Calle Larga | habitatge | 1971 | 355 | 5 |
| `9548411TM5594N` | Calle Larga | industrial | 1968 | 68 | 3 |
| `9548412TM5594N` | Calle Larga | habitatge | 1900 | 141 | 3 |
| `9548413TM5594N` | Calle Larga | habitatge | 1978 | 144 | 2 |
| `9548414TM5594N` | Calle Larga | habitatge | 1980 | 284 | 1 |
| `9548415TM5594N` | Calle Larga | habitatge | 1927 | 183 | 3 |
| `9548416TM5594N` | Calle Larga | industrial | 1900 | 144 | 3 |
| `9548417TM5594N` | Calle Larga | industrial | 1900 | 24 | 1 |
| `9548418TM5594N` | Calle Larga | habitatge | 1993 | 21 | 1 |
| `9548419TM5594N` | Calle Larga | habitatge | 1978 | 181 | 2 |
| `9548421TM5594N` | Calle Larga | habitatge | 1980 | 233 | 1 |
| `9549501TM5594N` | Calle Larga | habitatge | 1900 | 284 | 4 |
| `9549503TM5594N` | Calle Larga | habitatge | 1970 | 208 | 3 |
| `9549504TM5594N` | Calle Larga | habitatge | 1900 | 180 | 4 |
| `9549505TM5594N` | Calle Larga | habitatge | 1930 | 313 | 4 |
| `9549510TM5594N` | Calle Larga | habitatge | 1900 | 426 | 3 |
| `9549511TM5594N` | Calle Larga | industrial | 1900 | 36 | 1 |
| `9549512TM5594N` | Calle Larga | habitatge | 1950 | 144 | 2 |
| `9549513TM5594N` | Calle Larga | habitatge | 1900 | 123 | 2 |
| `9549701TM5594N` | Calle Larga | habitatge | 1970 | 248 | 3 |
| `9549702TM5594N` | Calle Larga | habitatge | 1930 | 183 | 2 |
| `9648017TM5594N` | Calle Larga | habitatge | 1900 | 52 | 1 |
| `9648018TM5594N` | Calle Larga | industrial | 1900 | 147 | 2 |
| `9648019TM5594N` | Calle Larga | habitatge | 1920 | 390 | 2 |
| `9648022TM5594N` | Calle Larga | habitatge | 1900 | 199 | 5 |
| `9648023TM5594N` | Calle Larga | habitatge | 1950 | 238 | 3 |
| `9648024TM5594N` | Calle Larga | habitatge | 2015 | 226 | 2 |
| `9648026TM5594N` | Calle Larga | habitatge | 1920 | 44 | 1 |
| `9747010TM5594N` | Calle Larga | habitatge | 1980 | 382 | 4 |
| `9747601TM5594N` | Calle Larga | habitatge | 1900 | 365 | 4 |
| `9747602TM5594N` | Calle Larga | habitatge | 1900 | 241 | 2 |
| `9747603TM5594N` | Calle Larga | habitatge | 1900 | 267 | 2 |
| `9747605TM5594N` | Calle Larga | habitatge | 1900 | 282 | 2 |
| `9747606TM5594N` | Calle Larga | habitatge | 1996 | 192 | 1 |
| `9747607TM5594N` | Calle Larga | habitatge | 1900 | 162 | 2 |
| `9747608TM5594N` | Calle Larga | habitatge | 1995 | 269 | 4 |
| `9747609TM5594N` | Calle Larga | habitatge | 1920 | 166 | 2 |
| `000501400TM55D` | Calle Las Bodegas | habitatge | 1982 | 6 | 1 |
| `000501500TM55D` | Calle Las Bodegas | habitatge | 1950 | 97 | 2 |
| `49228A01200755` | Calle Las Bodegas | agrari | 2000 | 84 | 1 |
| `9649005TM5594N` | Calle Las Bodegas | habitatge | 2004 | 5 | 1 |
| `9649006TM5594N` | Calle Las Bodegas | industrial | 2004 | 87 | 1 |
| `9649008TM5594N` | Calle Las Bodegas | industrial | 1950 | 53 | 2 |
| `9649009TM5594N` | Calle Las Bodegas | industrial | 1950 | 48 | 1 |
| `9748815TM5594N` | Calle Las Bodegas | habitatge | 1900 | 519 | 5 |
| `9749001TM5594N` | Calle Las Bodegas | habitatge | 1988 | 285 | 1 |
| `9749002TM5594N` | Calle Las Bodegas | habitatge | 1900 | 39 | 1 |
| `9749003TM5594N` | Calle Las Bodegas | habitatge | 2003 | 67 | 1 |
| `9749101TM5594N` | Calle Las Bodegas | habitatge | 1998 | 20 | 1 |
| `9749201TM5594N` | Calle Las Bodegas | habitatge | 2000 | 16 | 1 |
| `9749301TM5594N` | Calle Las Bodegas | oficines | 1968 | 41 | 1 |
| `9749302TM5594N` | Calle Las Bodegas | industrial | 1900 | 19 | 1 |
| `9849002TM5594N` | Calle Las Bodegas | industrial | 1986 | 68 | 1 |
| `9849008TM5594N` | Calle Las Bodegas | habitatge | 2003 | 258 | 2 |
| `9849010TM5594N` | Calle Las Bodegas | habitatge | 1900 | 289 | 3 |
| `49228A01400235` | Calle Las Paneras | habitatge | 2020 | 360 | 9 |
| `49228A01400277` | Calle Las Paneras | servei públic | 2002 | 298 | 2 |
| `9549001TM5594N` | Calle Las Paneras | habitatge | 1986 | 466 | 5 |
| `9549002TM5594N` | Calle Las Paneras | habitatge | 2006 | 66 | 1 |
| `9549003TM5594N` | Calle Las Paneras | habitatge | 1960 | 125 | 1 |
| `9549502TM5594N` | Calle Las Paneras | habitatge | 1991 | 340 | 1 |
| `9549507TM5594N` | Calle Las Paneras | habitatge | 1983 | 144 | 1 |
| `9549508TM5594N` | Calle Las Paneras | habitatge | 1983 | 134 | 2 |
| `9648004TM5594N` | Calle Las Paneras | habitatge | 1976 | 411 | 2 |
| `9648007TM5594N` | Calle Las Paneras | habitatge | 1998 | 257 | 2 |
| `9648008TM5594N` | Calle Las Paneras | habitatge | 1980 | 225 | 2 |
| `9648009TM5594N` | Calle Las Paneras | habitatge | 1998 | 198 | 2 |
| `9648011TM5594N` | Calle Las Paneras | habitatge | 1979 | 120 | 1 |
| `9648012TM5594N` | Calle Las Paneras | habitatge | 1999 | 122 | 1 |
| `9648013TM5594N` | Calle Las Paneras | habitatge | 1920 | 617 | 2 |
| `9648030TM5594N` | Calle Las Paneras | habitatge | 1930 | 72 | 1 |
| `9747001TM5594N` | Calle Las Paneras | habitatge | 1940 | 348 | 4 |
| `9747002TM5594N` | Calle Las Paneras | industrial | 1900 | 27 | 1 |
| `9747003TM5594N` | Calle Las Paneras | habitatge | 1900 | 197 | 2 |
| `9748303TM5594N` | Calle Las Paneras | habitatge | 1957 | 301 | 4 |
| `9748405TM5594N` | Calle Las Paneras | habitatge | 1900 | 458 | 5 |
| `9748406TM5594N` | Calle Las Paneras | industrial | 1900 | 15 | 1 |
| `9748407TM5594N` | Calle Las Paneras | habitatge | 1998 | 178 | 1 |
| `9748802TM5594N` | Calle Las Paneras | habitatge | 1960 | 223 | 3 |
| `9748803TM5594N` | Calle Las Paneras | habitatge | 1960 | 74 | 1 |
| `9748804TM5594N` | Calle Las Paneras | habitatge | 1978 | 196 | 2 |
| `9748806TM5594N` | Calle Las Paneras | habitatge | 1950 | 296 | 3 |
| `9748807TM5594N` | Calle Las Paneras | habitatge | 1948 | 256 | 2 |
| `9748808TM5594N` | Calle Las Paneras | habitatge | 1948 | 208 | 3 |
| `9748809TM5594N` | Calle Las Paneras | habitatge | 1900 | 361 | 3 |
| `9748810TM5594N` | Calle Las Paneras | habitatge | 1985 | 254 | 3 |
| `9748811TM5594N` | Calle Las Paneras | habitatge | 1900 | 253 | 3 |
| `9748812TM5594N` | Calle Las Paneras | habitatge | 1900 | 149 | 3 |
| `9748813TM5594N` | Calle Las Paneras | habitatge | 1900 | 301 | 5 |
| `9748814TM5594N` | Calle Las Paneras | habitatge | 1957 | 263 | 6 |
| `9748816TM5594N` | Calle Las Paneras | habitatge | 1975 | 56 | 1 |
| `000101700TM65C` | Calle Real | habitatge | 2025 | 184 | 3 |
| `000101900TM65C` | Calle Real | habitatge | 1925 | 292 | 3 |
| `000102000TM65C` | Calle Real | habitatge | 1930 | 324 | 4 |
| `000102200TM65C` | Calle Real | habitatge | 1968 | 44 | 1 |
| `000102300TM65C` | Calle Real | habitatge | 1985 | 479 | 2 |
| `000102400TM65C` | Calle Real | habitatge | 1996 | 226 | 1 |
| `000102500TM65C` | Calle Real | habitatge | 1900 | 230 | 1 |
| `000102700TM65C` | Calle Real | habitatge | 1900 | 287 | 4 |
| `000102800TM65C` | Calle Real | habitatge | 2005 | 358 | 3 |
| `000502300TM55D` | Calle Real | habitatge | 1900 | 275 | 2 |
| `000502400TM55D` | Calle Real | habitatge | 1968 | 87 | 2 |
| `000502500TM55D` | Calle Real | habitatge | 1985 | 93 | 1 |
| `000502600TM55D` | Calle Real | habitatge | 1987 | 149 | 1 |
| `000502700TM55D` | Calle Real | habitatge | 1973 | 170 | 1 |
| `000502800TM55D` | Calle Real | habitatge | 1975 | 82 | 1 |
| `000502900TM55D` | Calle Real | habitatge | 1984 | 208 | 2 |
| `000503100TM55D` | Calle Real | habitatge | 1986 | 103 | 2 |
| `000503200TM55D` | Calle Real | habitatge | 1974 | 310 | 3 |
| `49228A01200569` | Calle Real | habitatge | 1972 | 1526 | 2 |
| `49228A01400195` | Calle Real | habitatge | 2019 | 237 | 8 |
| `49228A01400222` | Calle Real | habitatge | 1990 | 183 | 3 |
| `49228A01400234` | Calle Real | habitatge | 2000 | 338 | 4 |
| `49228A01400244` | Calle Real | habitatge | 2009 | 144 | 2 |
| `49228A01400246` | Calle Real | habitatge | 2024 | 169 | 5 |
| `49228A01400265` | Calle Real | habitatge | 1958 | 78 | 1 |
| `49228A01400266` | Calle Real | habitatge | 1900 | 400 | 3 |
| `49228A01400268` | Calle Real | industrial | 2023 | 109 | 2 |
| `49228A01400269` | Calle Real | habitatge | 2014 | 133 | 1 |
| `49228A01400311` | Calle Real | habitatge | 2008 | 70 | 1 |
| `49228A01400312` | Calle Real | habitatge | 2014 | 214 | 2 |
| `49228A01400331` | Calle Real | servei públic | 1900 | 111 | 1 |
| `9747610TM5594N` | Calle Real | habitatge | 1983 | 346 | 4 |
| `9747611TM5594N` | Calle Real | habitatge | 1962 | 233 | 2 |
| `9747612TM5594N` | Calle Real | habitatge | 1973 | 90 | 1 |
| `0333202TM6503S` | Calle Santiago | habitatge | 1900 | 258 | 2 |
| `0333204TM6503S` | Calle Santiago | habitatge | 1982 | 440 | 3 |
| `0333205TM6503S` | Calle Santiago | habitatge | 1900 | 300 | 3 |
| `0333209TM6503S` | Calle Santiago | habitatge | 1900 | 413 | 4 |
| `0333210TM6503S` | Calle Santiago | habitatge | 1900 | 128 | 1 |
| `0333211TM6503S` | Calle Santiago | habitatge | 1987 | 490 | 2 |
| `0333225TM6503S` | Calle Santiago | habitatge | 2008 | 174 | 1 |
| `0334201TM6503N` | Calle Santiago | habitatge | 1985 | 851 | 1 |
| `0334202TM6503S` | Calle Santiago | industrial | 1900 | 204 | 1 |
| `0334203TM6503S` | Calle Santiago | industrial | 1900 | 184 | 2 |
| `0334205TM6503S` | Calle Santiago | habitatge | 1900 | 318 | 4 |
| `0334206TM6503S` | Calle Santiago | habitatge | 1900 | 236 | 2 |
| `0334207TM6503S` | Calle Santiago | habitatge | 1978 | 255 | 3 |
| `000500100TM55D` | Calle Valdelatorre | habitatge | 2002 | 39 | 1 |
| `000500400TM55D` | Calle Valdelatorre | habitatge | 2002 | 36 | 1 |
| `000500800TM55D` | Calle Valdelatorre | habitatge | 1980 | 216 | 2 |
| `49228A01200427` | Calle Valdelatorre | habitatge | 1980 | 71 | 2 |
| `9749601TM5594N` | Calle Valdelatorre | habitatge | 1920 | 290 | 4 |
| `9749602TM5594N` | Calle Valdelatorre | habitatge | 1920 | 141 | 1 |
| `9749603TM5594N` | Calle Valdelatorre | habitatge | 1920 | 129 | 1 |
| `9849301TM5594N` | Calle Valdelatorre | industrial | 1986 | 49 | 2 |
| `9849303TM5594N` | Calle Valdelatorre | habitatge | 1975 | 208 | 1 |
| `9748301TM5594N` | Calle Álamo | habitatge | 1963 | 238 | 3 |
| `9748302TM5594N` | Calle Álamo | habitatge | 1996 | 280 | 4 |
| `9748304TM5594N` | Calle Álamo | habitatge | 1980 | 325 | 6 |
| `9748305TM5594N` | Calle Álamo | industrial | 1967 | 253 | 5 |
| `9748306TM5594N` | Calle Álamo | habitatge | 1958 | 274 | 2 |
| `9748310TM5594N` | Calle Álamo | habitatge | 1980 | 208 | 2 |
| `9748312TM5594N` | Calle Álamo | habitatge | 1980 | 296 | 4 |
| `9748313TM5594N` | Calle Álamo | habitatge | 2008 | 324 | 3 |
| `9748408TM5594N` | Calle Álamo | habitatge | 1950 | 144 | 1 |
| `9748409TM5594N` | Calle Álamo | industrial | 1900 | 142 | 2 |
| `9748410TM5594N` | Calle Álamo | habitatge | 1900 | 104 | 2 |
| `9748411TM5594N` | Calle Álamo | habitatge | 1994 | 76 | 2 |
| `9848701TM5594N` | Calle Álamo | habitatge | 2000 | 84 | 2 |
| `9848704TM5594N` | Calle Álamo | habitatge | 1980 | 374 | 6 |
| `9848705TM5594N` | Calle Álamo | habitatge | 1900 | 171 | 5 |
| `000500900TM55D` | Cuesta El Cepo | habitatge | 1986 | 44 | 2 |
| `49228A01200435` | Cuesta El Cepo | agrari | 1985 | 885 | 4 |
| `49228A01200539` | Cuesta El Cepo | agrari | 2010 | 279 | 1 |
| `49228A01200759` | Cuesta El Cepo | habitatge | 1985 | 77 | 2 |
| `49228A01200760` | Cuesta El Cepo | agrari | 1984 | 436 | 2 |
| `9849302TM5594N` | Cuesta El Cepo | habitatge | 1955 | 466 | 4 |
| `9549506TM5594N` | Travesía Alta | habitatge | 1900 | 484 | 4 |
| `9549509TM5594N` | Travesía Alta | habitatge | 1975 | 120 | 1 |
| `9648001TM5594N` | Travesía Alta | habitatge | 1900 | 198 | 1 |
| `9648002TM5594N` | Travesía Alta | habitatge | 1965 | 248 | 5 |
| `9648003TM5594N` | Travesía Alta | industrial | 1900 | 124 | 2 |
| `9648014TM5594N` | Travesía Baja | habitatge | 1900 | 333 | 4 |
| `9648015TM5594N` | Travesía Baja | habitatge | 1900 | 262 | 2 |
| `9747006TM5594N` | Travesía Baja | servei públic | 1900 | 220 | 1 |
| `9747007TM5594N` | Travesía Baja | servei públic | 1983 | 41 | 1 |
| `9747008TM5594N` | Travesía Baja | industrial | 1900 | 157 | 3 |
| `9747009TM5594N` | Travesía Baja | industrial | 1900 | 163 | 3 |
| `9747011TM5594N` | Travesía Baja | habitatge | 1900 | 318 | 2 |
| `9747012TM5594N` | Travesía Baja | industrial | 1900 | 353 | 5 |
