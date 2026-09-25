# W1-07: Remote-Server-Leichen entfernen

Status: historisch

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: S. Lane: parallel (keine Nahtstelle). Weg: OpenCode.

## Ziel und Vertrag (aus PLAN.md)

- `scripts/remote-server-wizard.{sh,cmd}`, `scripts/remote-server-destroy.{sh,cmd}`, `scripts/omniroute-tunnel.cmd` (bricht mit exit 2 ab), `scripts/server/*` (7 Dateien), `scripts/test-pa-ops.sh`; Server-Abschnitte in `docs/development/WORKFLOW.md` und STAND.md auf einen Archivhinweis; `scripts/omniroute-serve.cmd` bleibt

## Abnahme

- `grep -rn <server-ip>` nur noch im Archiv

## Abhaengigkeiten

- keine (sofort startbar)

## Regeln

- Ein Paket = ein Agent = ein Worktree. Nahtstellen (`api.rs`, `main.rs`,
  `store.rs` samt `store/`, `bin/pa.rs`) nur in der eigenen Lane.
- Bugfix = kompilierender roter Regressionstest, dann gruen. Gestaltung =
  angesehener Screenshot. Keine `--no-verify`, Exit-Codes ungemaskiert.
- Diff > 300 Zeilen oder Nahtstelle = zwei unabhaengige Reviews mit
  Disposition in `.pa/review_w1-07_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-07.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.
