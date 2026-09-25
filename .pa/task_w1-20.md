# W1-20: Zweites Setup reproduzieren

Status: aktiv

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: S. Lane: parallel (keine Nahtstelle). Weg: siehe PLAN.md.

## Ziel und Vertrag (aus PLAN.md)

- Nutzer + Agent
- Node 24, `npm ci`, `npm run dev:setup`, `npm run dev:doctor` grün auf einer zweiten Maschine oder WSL; Report

## Abnahme

- Roter Test bzw. angesehener Beleg je Punkt aus dem Vertrag; Gates gruen; Report.

## Abhaengigkeiten

- schließt Matrix-Zeile 1.

## Regeln

- Ein Paket = ein Agent = ein Worktree. Nahtstellen (`api.rs`, `main.rs`,
  `store.rs` samt `store/`, `bin/pa.rs`) nur in der eigenen Lane.
- Bugfix = kompilierender roter Regressionstest, dann gruen. Gestaltung =
  angesehener Screenshot. Keine `--no-verify`, Exit-Codes ungemaskiert.
- Diff > 300 Zeilen oder Nahtstelle = zwei unabhaengige Reviews mit
  Disposition in `.pa/review_w1-20_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-20.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.
