# W1-15: Poisoned-Mutex-Stillverwerfer

Status: historisch

Abgeschlossen: gemergt mit PR #76 (Zeile in `docs/ERLEDIGT.md`); diese Spec ist nur noch Beleg.

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: S. Lane: seriell `main.rs`. Weg: Codex.

## Ziel und Vertrag (aus PLAN.md)

- Lane **main.rs** (`main.rs:671`, dazu `hooks.rs:113`, `status.rs`, `quota.rs`, `omniroute.rs`, `providers.rs:1121`, `pty.rs` Reaper-Map)
- `.lock().ok()?` loggt statt zu schlucken; Reaper entfernt Sessions auch bei Poison

## Abnahme

- Roter Test bzw. angesehener Beleg je Punkt aus dem Vertrag; Gates gruen; Report.

## Abhaengigkeiten

- keine (sofort startbar)

## Regeln

- Ein Paket = ein Agent = ein Worktree. Nahtstellen (`api.rs`, `main.rs`,
  `store.rs` samt `store/`, `bin/pa.rs`) nur in der eigenen Lane.
- Bugfix = kompilierender roter Regressionstest, dann gruen. Gestaltung =
  angesehener Screenshot. Keine `--no-verify`, Exit-Codes ungemaskiert.
- Diff > 300 Zeilen oder Nahtstelle = zwei unabhaengige Reviews mit
  Disposition in `.pa/review_w1-15_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-15.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.
