# W1-01: Kimi-Roh-PTY-Diagnose und Guard-Fix

Status: historisch

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: M. Lane: parallel (keine Nahtstelle). Weg: ProjectA lokal (Kimi-CLI nötig), Codex oder Orca.

## Ziel und Vertrag (aus PLAN.md)

- `submit_guard.rs`, `testutil.rs:99` (`capture_kimi_output`), Kimi-Profil
- Beleg bisher: `.pa/report_provider_adapter_smokes_kimi_opencode.md`.

## Abnahme

- Kimi-Smoke durch den Launch-Pfad ohne manuellen Enter; roter Test für die Echo-Lücke (Composer-Tail sichtbar, Match fehlte; Verdacht ConPTY-Cursor-Adressierung oder Write/Redraw-Fenster)

## Abhaengigkeiten

- keine (sofort startbar)

## Regeln

- Ein Paket = ein Agent = ein Worktree. Nahtstellen (`api.rs`, `main.rs`,
  `store.rs` samt `store/`, `bin/pa.rs`) nur in der eigenen Lane.
- Bugfix = kompilierender roter Regressionstest, dann gruen. Gestaltung =
  angesehener Screenshot. Keine `--no-verify`, Exit-Codes ungemaskiert.
- Diff > 300 Zeilen oder Nahtstelle = zwei unabhaengige Reviews mit
  Disposition in `.pa/review_w1-01_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-01.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.
