# Stand — Priorität 08.10.2026, übriger Snapshot 04.10.2026

Wo wir stehen, in Kürze. Plan und Reihenfolge: [`docs/PLAN.md`](docs/PLAN.md).
Regeln: [`AGENTS.md`](AGENTS.md). Die alte Langfassung: `.pa/archiv/STAND_2026-09-24.md`.

## Wo wir stehen

- **Aktuelle Priorität (08.10.):** Z1 Denkraum zuerst; die Z1–Z4-Tabellen in
  `docs/PLAN.md` disponieren. IDEAS-L0-Ergebnisse bleiben erhalten. Die weiteren
  Angaben hier sind der historische 04.10.-Snapshot, kein aktueller Livebeleg.

- **Release:** v1.4.1 (22.09.) ist der jüngste; alles danach liegt nur auf `main`.
  Nächster Release: v1.5.0 (Beta) als Abschluss von M3.
- **Meilenstein M1** „Alles Laufende gelandet, App startbar“: erreicht
  (26.09.2026, PLAN.md, Tabelle M1). Zuletzt gelandet: SEC-01 (PR #20),
  CLEAN-02 (PR #25), W1-21d (PR #27), CI-04 (PR #28), W1-18b (PR #30),
  CLEAN-01 (PR #31), W1-30 (PR #32), W1-10 (PR #33).
- **App nicht starten:** Die Queue hat tote `dispatched`-Einträge, die echte
  Worker auslösen können. W1-05b ist gelandet (PR #19);
  die toten Einträge vorher read-only nachzählen und gezielt verwerfen.
- **Continuous Mode:** aus und bis M4 eingefroren; `development_policy.rs` lehnt ihn ab.
- **Merge** nur über die Mergify-Queue. CI kostet Minuten, Ziel 0 €.
- **Live-Stand** kommt aus `gh pr list` und `git log origin/main`, bald aus OPS-01.
- **Pakete Architektur-Rat (Status beobachtet 04.10.2026 13:50 UTC = 15:50 Berlin mit `gh pr list`/`gh pr view`; Quellstand `origin/main` effef1a, `ci`-Lauf 37194125481 grün):**
  ARCH-08 (a–f), ARCH-03c (#256), ARCH-09a (#260), ARCH-09b (#264) und ARCH-10
  sind gemergt, ebenso #262 (KI-30-Diagnose), #274, #275 und #279. Offen:
  #269 ARCH-09c (Draft, `do-not-merge`), #270 OPS-02-Doku und #273 SETUP-09-Fix
  (in der Queue), #282 SETUP-12-Rest (Draft). Einzelheiten und Nachweise:
  `docs/PLAN.md`. Das ist ein Schnappschuss, kein Live-Stand.

## Nächster Griff

1. Z1 nach den aktuellen Z-Tabellen in PLAN.md liefern; Owner und Vorgänger prüfen.
   Historische M1–M5-Stände starten keine Jobs; Merge nur über Mergify.
2. Die toten Queue-Einträge read-only nachzählen und mit der neuen Cancel-Regel gezielt verwerfen (W1-05b, PR #19).
3. Fragen an den Nutzer gehen in die Entscheidungs-Inbox in PLAN.md.

## Offene Befunde (Details: `KNOWN_ISSUES.md`)

- KI-30: sporadische `real_native_*`-Fehlschläge auf Windows, Ursache unbekannt; #262 (gemergt) gibt nur Diagnose aus; neue Beobachtung 04.10. (Queue-Lauf 37196272431).
- KI-24: SQLite-Lastklasse (`database is locked`), beobachten.
- KI-27: `exited_undelivered` gibt Reservierung und Delivery frei (DF-15b, PR #16), beobachten.
- KI-20: doppelte Antwort auf `ESC[6n` behoben (W1-27): das Backend antwortet allein, die Anfrage wird aus Scrollback und UI entfernt.

## Aktive Specs

Nur hier gelistete `.pa/task_*.md` mit `Status: aktiv` sind ausführbar; `npm run specs` prüft das.
Neue Specs gibt es nur für M-Pakete; die Alt-Specs der S-Pakete W1-03e, W1-17 und W1-20 laufen mit ihrem Paket aus.
Specs aus M3/M4 (`task_w1-10.md`, `task_hq2-02.md`, `task_ollama_worker_adapter.md`) stehen auf `Status: entwurf`, bis ihre Lane sie erreicht (Review PR #175, kimi-k3 F-7).

| Spec | Paket | Lane |
|---|---|---|
| `.pa/task_arch-d4-04.md` | ARCH-D4: API-Router, serieller Teil 4 | seriell: `api.rs`; Root, Slot B |
| `.pa/task_w1-05.md` | W1-05b: Queue-Abnahmerest, Cancel-Regel für `dispatched` | seriell: `store.rs`, danach `api.rs` (Nahtstellen) |
| `.pa/task_f_core3_delivery.md` | W1-03e/f: F-CORE-3 Rest B.3/C | W1-03e: `workers.rs` (keine Nahtstelle); W1-03f (M4) zusätzlich `bin/pa.rs` |
| `.pa/task_w1-20.md` | W1-20: Zweites Setup reproduzieren | parallel (keine Nahtstelle) |
| `.pa/task_w1-17.md` | W1-17: HQ-Parser prüfen | parallel (keine Nahtstelle) |
| `.pa/task_w4-01.md` | W4-01: Fünf reproduzierbare Benchmark-Aufgaben | parallel (keine Nahtstelle) |
| `.pa/task_w3-01.md` | W3-01a: Globaler DB-Wartungs-/Write-Lock | seriell: `store.rs` + `store/` |
