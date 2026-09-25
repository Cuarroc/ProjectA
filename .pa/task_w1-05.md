# W1-05: Doku-Nachzug I

Status: aktiv

Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
Groesse: S. Lane: parallel (keine Nahtstelle). Weg: OpenCode/Ollama.

## Ziel und Vertrag (aus PLAN.md)

- Docs + Queue am PC
- Zuerst Runtime, Queue und Workerprozesse read-only erfassen. dispatched-Cancel wird bisher mit HTTP 400 abgewiesen (#48/#60): sichere Cancel-Regel und bestaetigtes Prozessende sind Voraussetzungen fuer gezieltes Verwerfen. Die acht bereits eingereihten Tasks deduplizieren; kein pauschales erneutes --apply. Offline keine App mit ungepruefter Queue starten.
- `.pa/continuous_acceptance_matrix.md` („main integration" ist erledigt, Release-Zeile mit v1.4.0-Beleg), `.pa/task_continuous_devhq.md` (Genehmigungsvermerk 10.09. im Status), `docs/dev-hq/BUGS.md` (überholte Vermerke „uncommitted branch / review pending / 404", Reihenfolge, Platzhalterzeile, fehlende Queue-Tasks), `CHANGELOG.md` Abschnitt „Unreleased"

## Abnahme

- Roter Test bzw. angesehener Beleg je Punkt aus dem Vertrag; Gates gruen; Report.

## Abhaengigkeiten

- Sichere Cancel-Regel fuer dispatched und aktueller Prozess-/Queue-Nachweis; Dokumentationsanteil bereits mit #54 integriert.

## Regeln

- Ein Paket = ein Agent = ein Worktree. Nahtstellen (`api.rs`, `main.rs`,
  `store.rs` samt `store/`, `bin/pa.rs`) nur in der eigenen Lane.
- Bugfix = kompilierender roter Regressionstest, dann gruen. Gestaltung =
  angesehener Screenshot. Keine `--no-verify`, Exit-Codes ungemaskiert.
- Diff > 300 Zeilen oder Nahtstelle = zwei unabhaengige Reviews mit
  Disposition in `.pa/review_w1-05_*.md`; sonst ein Reviewer ungleich Autor.
- Ein PR je Paket gegen `main`, CI gruen (gates linux/windows, red-first).

## Abschluss

Report `.pa/report_w1-05.md` (Belege, Gates, Review-Disposition), diese Datei
auf `Status: historisch`, Haekchen in `docs/PLAN.md`, Zeile aus STAND.md
„Aktive Specs" entfernen, `bash scripts/sync.sh note "<agent>" "<summary>"`.

Nachpruefung 22.09.: Dokumentation integriert, Queue-Abnahme offen. Aktuellen Runtime-/Queue-/Workerzustand zuerst lesen. Cancel dispatched wird im PC-Beleg #48/#60 mit 400 abgewiesen; sichere Cancel-Regel und bestaetigtes Prozessende sind Vorbedingungen. Alte acht Tasks deduplizieren, kein pauschales erneutes --apply. Offline keinen Appstart zur Sichtpruefung.
