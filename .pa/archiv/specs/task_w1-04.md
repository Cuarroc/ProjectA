# W1-04: Flake `delivery_recovery::tests::every_interrupted_phase_has_one_deterministic_next_action`

Status: historisch

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: S. Lane: parallel (keine Nahtstelle). Weg: Codex/OpenCode.

## Ziel und Vertrag (aus PLAN.md)

- `delivery_recovery.rs`

## Abnahme

- 20 Läufe unter Volllast grün, Ursache benannt

## Abhaengigkeiten

- keine (sofort startbar)

## Regeln

- Ein Paket = ein Agent = ein Worktree. Nahtstellen (`api.rs`, `main.rs`,
  `store.rs` samt `store/`, `bin/pa.rs`) nur in der eigenen Lane.
- Bugfix = kompilierender roter Regressionstest, dann gruen. Gestaltung =
  angesehener Screenshot. Keine `--no-verify`, Exit-Codes ungemaskiert.
- Diff > 300 Zeilen oder Nahtstelle = zwei unabhaengige Reviews mit
  Disposition in `.pa/review_w1-04_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss 22.09.2026

20/20 Windows-Lastlaeufe erfolgreich, Exit0, 12 CPU-Lastprozesse;
GetSystemTimes-Auslastung und Kandidat/Quellhash in
.pa/evidence_w1-04_load_2026-09-22.json. Report .pa/report_w1-04.md.
Der bestehende Fix bleibt unveraendert. Kein kuenftiger Flake ausgeschlossen.
