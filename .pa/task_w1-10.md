# W1-10: HQ-Stylesheet

Status: entwurf

Geparkt am 25.09.2026 (Review PR #175, kimi-k3 F-7): M3-Paket; in der hqL-Lane
steht W1-17 davor (`docs/PLAN.md`, „Reihenfolge der seriellen Lanes"). Wird
aktiv, wenn die Lane es erreicht.

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: M. Lane: parallel (keine Nahtstelle). Weg: Kimi/OpenCode.

## Ziel und Vertrag (aus PLAN.md)

- `scripts/contrast-check.mjs` auf `docs/dev-hq/hq.css` ausweiten, Light Mode, `prefers-contrast`

## Abnahme

- Gate rot → grün, Screenshots hell/dunkel angesehen

## Abhaengigkeiten

- keine (sofort startbar)

## Regeln

- Ein Paket = ein Agent = ein Worktree. Nahtstellen (`api.rs`, `main.rs`,
  `store.rs` samt `store/`, `bin/pa.rs`) nur in der eigenen Lane.
- Bugfix = kompilierender roter Regressionstest, dann gruen. Gestaltung =
  angesehener Screenshot. Keine `--no-verify`, Exit-Codes ungemaskiert.
- Diff > 300 Zeilen oder Nahtstelle = zwei unabhaengige Reviews mit
  Disposition in `.pa/review_w1-10_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-10.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.
