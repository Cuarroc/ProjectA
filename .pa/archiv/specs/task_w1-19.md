# W1-19: PR #39 rebasen: eine Gate-Quelle

Status: historisch

Historisch seit 24.09.2026: der Kern ist über PR #39 erledigt, der Rest W1-19b
ist in CI-02 aufgegangen (Nutzerentscheidung, `docs/MASTERPLAN.md`).

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: M. Lane: parallel (keine Nahtstelle). Weg: OpenCode/Orca.

## Ziel und Vertrag (aus PLAN.md)

- `.github/workflows/*`, `scripts/ci/*` (Konflikte in `ci.yml`, `red-first.sh`, AGENTS.md, decisions.md)
- dazu: Dependabot-Commits im `red-first`-Gate behandeln (#42/#34 rot wegen fehlendem Trailer) und den `ci.yml:36`-Kommentar nach W0-06 anpassen
- zweites Review Pflicht

## Abnahme

- CI grün auf beiden Plattformen, `red-first`-`CARGO_TARGET_DIR`-Regression bleibt

## Abhaengigkeiten

- keine (sofort startbar)

## Regeln

- Ein Paket = ein Agent = ein Worktree. Nahtstellen (`api.rs`, `main.rs`,
  `store.rs` samt `store/`, `bin/pa.rs`) nur in der eigenen Lane.
- Bugfix = kompilierender roter Regressionstest, dann gruen. Gestaltung =
  angesehener Screenshot. Keine `--no-verify`, Exit-Codes ungemaskiert.
- Diff > 300 Zeilen oder Nahtstelle = zwei unabhaengige Reviews mit
  Disposition in `.pa/review_w1-19_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-19.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.
