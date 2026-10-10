# Estat de les cases del poble

Generat per `tools/mapgen/cases_status.py` el 2026-10-10; **no l'editis a mà**.
Les cases són les del joc (referències cadastrals de `web/public/village.json`). Per fer una
casa, vegeu la skill `casa-a-mida` (`.claude/skills/casa-a-mida/SKILL.md`).

## Recompte

| model | cases | % |
|---|---:|---:|
| **Genèric** (sense fitxa) | 90 | 48.9 % |
| **Propi bàsic** (fitxa sense anàlisi detallada, o model per script) | 2 | 1.1 % |
| **Propi refinat** (anàlisi detallada feta) | 92 | 50.0 % |
| Total al joc | 184 | 100 % |

L'evolució és a `data/cases/historial.csv` (una fila per dia).

## Detall

| | cases | % |
|---|---:|---:|
| **Total al joc** | 184 | 100 % |
| Amb model propi (fitxa o script) | 94 | 51.1 % |
| — amb anàlisi detallada feta | 92 | 50.0 % |
| — amb fitxa, pendents d'anàlisi detallada | 0 | 0.0 % |
| — model propi per script (església, ermita) | 2 | 1.1 % |
| Amb expedient però sense fitxa | 0 | 0.0 % |
| Genèriques, sense res | 90 | 48.9 % |
| **Pendents d'anàlisi detallada** (tot el que no és `detall` ni `propi`) | 90 | 48.9 % |

### Per ús (Cadastre)

| ús | total | detall | fitxa | propi | expedient | genèrica |
|---|---:|---:|---:|---:|---:|---:|
| habitatge | 152 | 81 | 0 | 0 | 0 | 71 |
| industrial | 20 | 9 | 0 | 0 | 0 | 11 |
| servei públic | 6 | 1 | 0 | 2 | 0 | 3 |
| agrari | 5 | 0 | 0 | 0 | 0 | 5 |
| comerç | 1 | 1 | 0 | 0 | 0 | 0 |

### Per carrer

| carrer (OSM) | total | detall | fitxa | propi | expedient | genèrica |
|---|---:|---:|---:|---:|---:|---:|
| Calle el Cristo | 45 | 45 | 0 | 0 | 0 | 0 |
| Calle Santiago | 45 | 0 | 0 | 0 | 0 | 45 |
| (fora de carrer) | 24 | 3 | 0 | 1 | 0 | 20 |
| Calle Santibáñez | 18 | 18 | 0 | 0 | 0 | 0 |
| Calle Calzada | 17 | 3 | 0 | 0 | 0 | 14 |
| Calle Viriato | 13 | 3 | 0 | 0 | 0 | 10 |
| Calle Taburete | 10 | 10 | 0 | 0 | 0 | 0 |
| Calle de la Iglesia | 8 | 7 | 0 | 1 | 0 | 0 |
| Calle La Rinconada | 4 | 3 | 0 | 0 | 0 | 1 |

## Anàlisi detallada feta (92)

| referència | carrer (OSM) | ús | any | m² | parts | Street View | satèl·lit | joc | revisió | falta |
|---|---|---|---:|---:|---:|---:|:---:|---:|---|---|
| `002000100TM55D` | (fora de carrer) | habitatge | 1900 | 298 | 2 | 1 | sí | 0 | 2026-10-09 | Street View (1), captures del joc |
| `002000200TM55D` | (fora de carrer) | industrial | 1973 | 471 | 2 | 1 | sí | 0 | 2026-10-09 | Street View (1), captures del joc |
| `002000300TM55D` | (fora de carrer) | habitatge | 1985 | 205 | 3 | 2 | sí | 0 | 2026-10-09 | captures del joc |
| `0232101TM6503S` | Calle Calzada | habitatge | 1900 | 202 | 3 | 2 | no | 0 | 2026-10-09 | satèl·lit, captures del joc |
| `0232102TM6503S` | Calle Calzada | habitatge | 1900 | 234 | 3 | 0 | no | 1 | 2026-10-09 | Street View (0), satèl·lit |
| `0232106TM6503S` | Calle Calzada | habitatge | 1900 | 345 | 3 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
| `0232104TM6503S` | Calle La Rinconada | habitatge | 1998 | 304 | 1 | 0 | no | 1 | 2026-10-09 | Street View (0), satèl·lit |
| `0232107TM6503S` | Calle La Rinconada | industrial | 1900 | 505 | 3 | 5 | sí | 1 | 2026-10-09 | — |
| `0232303TM6503S` | Calle La Rinconada | habitatge | 2014 | 124 | 1 | 4 | sí | 2 | 2026-10-09 | — |
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
| `0332703TM6503S` | Calle Viriato | habitatge | 1900 | 183 | 3 | 1 | no | 0 | 2026-10-09 | Street View (1), satèl·lit, captures del joc |
| `0333609TM6503S` | Calle Viriato | habitatge | 1900 | 162 | 2 | 0 | no | 0 | 2026-10-09 | Street View (0), satèl·lit, captures del joc |
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

## Model propi, pendents d'anàlisi detallada (0)

Cap.

## Model propi per script (2)

| referència | carrer (OSM) | ús | any | m² | parts |
|---|---|---|---:|---:|---:|
| `000100400TM65A` | (fora de carrer) | servei públic | 1900 | 588 | 1 |
| `0333803TM6503S` | Calle de la Iglesia | servei públic | 1900 | 353 | 1 |

## Expedient sense fitxa (motiu al notes.md) (0)

Cap.

## Genèriques (pendents) (90)

| referència | carrer (OSM) | ús | any | m² | parts |
|---|---|---|---:|---:|---:|
| `000100100TM65A` | (fora de carrer) | habitatge | 1985 | 175 | 1 |
| `001100100TM65C` | (fora de carrer) | habitatge | 1900 | 521 | 4 |
| `001600100TM65C` | (fora de carrer) | habitatge | 1900 | 54 | 1 |
| `001600200TM65C` | (fora de carrer) | industrial | 1978 | 57 | 2 |
| `001600400TM65C` | (fora de carrer) | servei públic | 1900 | 56 | 1 |
| `002000500TM55D` | (fora de carrer) | habitatge | 1981 | 152 | 3 |
| `002100200TM65C` | (fora de carrer) | industrial | 1980 | 31 | 1 |
| `002100300TM65C` | (fora de carrer) | industrial | 1980 | 31 | 1 |
| `002100400TM65C` | (fora de carrer) | habitatge | 1900 | 82 | 2 |
| `002100500TM65C` | (fora de carrer) | industrial | 1986 | 43 | 1 |
| `0432842TM6503S` | (fora de carrer) | habitatge | 2014 | 139 | 4 |
| `49130A50100077` | (fora de carrer) | habitatge | 2000 | 155 | 2 |
| `49130A50100381` | (fora de carrer) | agrari | 1970 | 299 | 1 |
| `49130A50100388` | (fora de carrer) | agrari | 2000 | 54 | 2 |
| `49130A50108447` | (fora de carrer) | industrial | 2015 | 702 | 1 |
| `49130A80105026` | (fora de carrer) | habitatge | 1980 | 24 | 1 |
| `49130A80105176` | (fora de carrer) | agrari | 2000 | 98 | 1 |
| `49130A80105178` | (fora de carrer) | agrari | 1990 | 1776 | 2 |
| `49130A80105179` | (fora de carrer) | agrari | 1975 | 240 | 2 |
| `49130A80105295` | (fora de carrer) | industrial | 1985 | 140 | 1 |
| `0232109TM6503S` | Calle Calzada | habitatge | 1986 | 190 | 2 |
| `0232110TM6503S` | Calle Calzada | habitatge | 2014 | 433 | 3 |
| `0232111TM6503S` | Calle Calzada | habitatge | 1900 | 208 | 2 |
| `0233149TM6503S` | Calle Calzada | habitatge | 2021 | 165 | 3 |
| `0233401TM6503S` | Calle Calzada | habitatge | 1980 | 250 | 2 |
| `0233402TM6503S` | Calle Calzada | habitatge | 1900 | 204 | 2 |
| `0233403TM6503S` | Calle Calzada | habitatge | 1900 | 148 | 2 |
| `0233404TM6503S` | Calle Calzada | habitatge | 1900 | 294 | 3 |
| `0233405TM6503S` | Calle Calzada | habitatge | 1900 | 257 | 2 |
| `0233701TM6503S` | Calle Calzada | habitatge | 1975 | 381 | 4 |
| `0233702TM6503S` | Calle Calzada | habitatge | 1900 | 55 | 1 |
| `0333801TM6503S` | Calle Calzada | habitatge | 1993 | 308 | 4 |
| `0334601TM6503S` | Calle Calzada | habitatge | 1980 | 555 | 4 |
| `0334602TM6503S` | Calle Calzada | habitatge | 1900 | 58 | 1 |
| `0232105TM6503S` | Calle La Rinconada | habitatge | 1986 | 100 | 2 |
| `0333202TM6503S` | Calle Santiago | habitatge | 1900 | 258 | 2 |
| `0333204TM6503S` | Calle Santiago | habitatge | 1982 | 440 | 3 |
| `0333205TM6503S` | Calle Santiago | habitatge | 1900 | 300 | 3 |
| `0333206TM6503S` | Calle Santiago | habitatge | 1900 | 192 | 1 |
| `0333207TM6503S` | Calle Santiago | habitatge | 2003 | 310 | 3 |
| `0333208TM6503S` | Calle Santiago | habitatge | 1900 | 263 | 2 |
| `0333209TM6503S` | Calle Santiago | habitatge | 1900 | 413 | 4 |
| `0333210TM6503S` | Calle Santiago | habitatge | 1900 | 128 | 1 |
| `0333211TM6503S` | Calle Santiago | habitatge | 1987 | 490 | 2 |
| `0333212TM6503S` | Calle Santiago | habitatge | 1900 | 27 | 1 |
| `0333214TM6503S` | Calle Santiago | habitatge | 1900 | 210 | 2 |
| `0333216TM6503S` | Calle Santiago | habitatge | 1900 | 192 | 4 |
| `0333217TM6503S` | Calle Santiago | habitatge | 2000 | 96 | 1 |
| `0333218TM6503S` | Calle Santiago | habitatge | 1942 | 76 | 1 |
| `0333219TM6503S` | Calle Santiago | habitatge | 1942 | 62 | 1 |
| `0333221TM6503S` | Calle Santiago | habitatge | 1900 | 252 | 3 |
| `0333223TM6503S` | Calle Santiago | habitatge | 1900 | 212 | 4 |
| `0333224TM6503S` | Calle Santiago | habitatge | 1900 | 339 | 4 |
| `0333225TM6503S` | Calle Santiago | habitatge | 2008 | 174 | 1 |
| `0333603TM6503S` | Calle Santiago | habitatge | 1990 | 104 | 1 |
| `0333605TM6503S` | Calle Santiago | habitatge | 1900 | 331 | 2 |
| `0333606TM6503S` | Calle Santiago | habitatge | 1900 | 182 | 1 |
| `0333607TM6503S` | Calle Santiago | habitatge | 1900 | 187 | 2 |
| `0334201TM6503N` | Calle Santiago | habitatge | 1985 | 851 | 1 |
| `0334202TM6503S` | Calle Santiago | industrial | 1900 | 204 | 1 |
| `0334203TM6503S` | Calle Santiago | industrial | 1900 | 184 | 2 |
| `0334204TM6503S` | Calle Santiago | industrial | 1985 | 135 | 2 |
| `0334205TM6503S` | Calle Santiago | habitatge | 1900 | 318 | 4 |
| `0334206TM6503S` | Calle Santiago | habitatge | 1900 | 236 | 2 |
| `0334207TM6503S` | Calle Santiago | habitatge | 1978 | 255 | 3 |
| `0334208TM6503S` | Calle Santiago | habitatge | 1976 | 264 | 3 |
| `0334209TM6503S` | Calle Santiago | servei públic | 2007 | 218 | 1 |
| `0334210TM6503S` | Calle Santiago | servei públic | 1965 | 122 | 1 |
| `0334211TM6503S` | Calle Santiago | industrial | 1965 | 148 | 1 |
| `0334603TM6503S` | Calle Santiago | habitatge | 1981 | 248 | 3 |
| `0432383TM6503S` | Calle Santiago | habitatge | 2010 | 35 | 1 |
| `0432801TM6503S` | Calle Santiago | habitatge | 1944 | 25 | 1 |
| `0432802TM6503S` | Calle Santiago | habitatge | 2010 | 23 | 1 |
| `0432803TM6503S` | Calle Santiago | habitatge | 1900 | 293 | 2 |
| `0432804TM6503S` | Calle Santiago | habitatge | 1900 | 206 | 3 |
| `0432805TM6503S` | Calle Santiago | habitatge | 1942 | 271 | 3 |
| `0432806TM6503S` | Calle Santiago | habitatge | 1900 | 118 | 1 |
| `0432807TM6503S` | Calle Santiago | industrial | 1970 | 20 | 1 |
| `0432809TM6503S` | Calle Santiago | habitatge | 1968 | 241 | 3 |
| `49130A50107682` | Calle Santiago | habitatge | 2009 | 46 | 2 |
| `0332007TM6503S` | Calle Viriato | habitatge | 1900 | 169 | 2 |
| `0333608TM6503S` | Calle Viriato | habitatge | 1900 | 457 | 3 |
| `0432811TM6503S` | Calle Viriato | habitatge | 1966 | 201 | 2 |
| `0432812TM6503S` | Calle Viriato | habitatge | 1965 | 37 | 1 |
| `0432813TM6503S` | Calle Viriato | habitatge | 1977 | 303 | 3 |
| `0432814TM6503S` | Calle Viriato | habitatge | 1984 | 409 | 3 |
| `0432815TM6503S` | Calle Viriato | habitatge | 1900 | 270 | 5 |
| `0432816TM6503S` | Calle Viriato | habitatge | 1900 | 21 | 1 |
| `0432817TM6503S` | Calle Viriato | habitatge | 1900 | 488 | 3 |
| `0432818TM6503S` | Calle Viriato | habitatge | 1998 | 180 | 1 |
