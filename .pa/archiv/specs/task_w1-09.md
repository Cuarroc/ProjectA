# W1-09: KI-1, KI-3, KI-6

Status: historisch

Abgeschlossen: gemergt mit PR #78 (Zeile in `docs/ERLEDIGT.md`); diese Spec ist nur noch Beleg.

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: S. Lane: parallel (keine Nahtstelle). Weg: Kimi.

## Ziel und Vertrag (aus PLAN.md)

- `LearningsPanel`, `roles.rs::parse_distilled` (Deckel für `system_prompt`), `CommandChat` (Entwurf beim Projektwechsel verwerfen), `refused:`-Präfixe in der UI

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
  Disposition in `.pa/review_w1-09_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-09.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.
