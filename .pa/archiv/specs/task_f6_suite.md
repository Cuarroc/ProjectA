# F6: 20-Lauf-Suite und Cheap-vs-Reliable-Kosten

Status: historisch

Repo: `<repo-root>`.

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F6.

## Auftrag

1. Zwanzig sequentielle Transportläufe. HTTP 100–599 klassifiziert;
   fehlender/ungültiger Status bleibt unklassifiziert und zählt als Fehler
   im Live-Script (healthz muss 200 sein). Skip wenn healthz tot.
2. `cheap` vs `reliable` Kosten nur aus gemessenen History-`totalCost`.
   Gleiche Totals sind kein Cheap-Sieg. Kein Cutover (Spawn bleibt
   `auto/cheap`).
3. Live: `scripts/f6-suite.ps1` gegen `:<omniroute-port>`, Skip wenn healthz tot.
   Höchstens zwei schwere Chat-Sonden (`-Heavy`).

## Report

`.pa/report_f6_suite.md`
