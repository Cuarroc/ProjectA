# W1-18: PR #38 rebasen: Skills `ConventionAt`

Status: historisch

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: M. Lane: parallel (keine Nahtstelle). Weg: Codex.

## Ziel und Vertrag (aus PLAN.md)

- `skills.rs`, `capabilities.rs`, `oneshot.rs` (kennt `ConventionAt` noch nicht), `workers.rs` (Konflikt)

## Abnahme

- Test an der Spawn-Stelle, Probe auf einer Maschine mit Codex und OpenCode, ob `.agents/skills` gelesen wird

## Abhaengigkeiten

- keine (sofort startbar)

## Regeln

- Ein Paket = ein Agent = ein Worktree. Nahtstellen (`api.rs`, `main.rs`,
  `store.rs` samt `store/`, `bin/pa.rs`) nur in der eigenen Lane.
- Bugfix = kompilierender roter Regressionstest, dann gruen. Gestaltung =
  angesehener Screenshot. Keine `--no-verify`, Exit-Codes ungemaskiert.
- Diff > 300 Zeilen oder Nahtstelle = zwei unabhaengige Reviews mit
  Disposition in `.pa/review_w1-18_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-18.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.

Abnahme22.09.: Spawn-Stellentest vierCapabilities gruen, Codex/OpenCode-Discovery
und WindowsJunctions gemessen; Bericht .pa/report_w1-18.md. KeineModellnutzungbehauptet.
