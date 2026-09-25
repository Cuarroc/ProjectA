# W1-17: HQ-Parser auf diesen Plan umstellen

Status: aktiv

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: M. Lane: parallel (keine Nahtstelle). Weg: OpenCode/Kimi.

## Ziel und Vertrag (aus PLAN.md)

- `scripts/lib/hq-parse.mjs` (Paket-DAG aus `docs/PLAN.md`-Wellen und IDs statt hartem F0–F8), `docs/dev-hq/hq.js`, Tests; M13 (`Next` zeigt einzige Zeile als `waits`) mit lösen

## Abnahme

- `npm run test:hq`, Screenshot Map/Next

## Abhaengigkeiten

- keine (sofort startbar)

## Regeln

- Ein Paket = ein Agent = ein Worktree. Nahtstellen (`api.rs`, `main.rs`,
  `store.rs` samt `store/`, `bin/pa.rs`) nur in der eigenen Lane.
- Bugfix = kompilierender roter Regressionstest, dann gruen. Gestaltung =
  angesehener Screenshot. Keine `--no-verify`, Exit-Codes ungemaskiert.
- Diff > 300 Zeilen oder Nahtstelle = zwei unabhaengige Reviews mit
  Disposition in `.pa/review_w1-17_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-17.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.
