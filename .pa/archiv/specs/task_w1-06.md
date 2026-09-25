# W1-06: Doku-Nachzug II

Status: historisch

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: S. Lane: parallel (keine Nahtstelle). Weg: OpenCode/Ollama.

## Ziel und Vertrag (aus PLAN.md)

- nur Docs
- `KNOWN_ISSUES.md`: KI-7/KI-12 neu bewerten (Server seit 09.09. weg, Heimat ist Linux-CI), KI-4-Lücke erklären, TRIAGE-Restnotizen 1–7 (`TRIAGE.md:189–209`) als KI-13ff. aufnehmen oder schließen; `docs/plugin-matrix.md` (tote Phasennummern 3.6/8, `single-instance` fehlt, addon-webgl ist 0.18)

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
  Disposition in `.pa/review_w1-06_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-06.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.
