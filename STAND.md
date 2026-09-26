# Stand — 25.09.2026

Wo wir stehen, in Kürze. Plan und Reihenfolge: [`docs/PLAN.md`](docs/PLAN.md).
Regeln: [`AGENTS.md`](AGENTS.md). Die alte Langfassung: `.pa/archiv/STAND_2026-09-24.md`.

## Wo wir stehen

- **Release:** v1.4.1 (22.09.) ist der jüngste; alles danach liegt nur auf `main`.
  Nächster Release: v1.5.0-beta als Abschluss von M3.
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

## Nächster Griff

1. M2 nach PLAN.md abarbeiten; die Queue mergt grüne PRs selbst.
2. Die toten Queue-Einträge read-only nachzählen und mit der neuen Cancel-Regel gezielt verwerfen (W1-05b, PR #19).
3. Fragen an den Nutzer gehen in die Entscheidungs-Inbox in PLAN.md.

## Offene Befunde (Details: `KNOWN_ISSUES.md`)

- KI-24: SQLite-Lastklasse (`database is locked`), beobachten.
- KI-27: `exited_undelivered` gibt Reservierung und Delivery frei (DF-15b, PR #16), beobachten.
- KI-20: doppelte Antwort auf `ESC[6n`, Behebung W1-27 in M3.

## Aktive Specs

Nur hier gelistete `.pa/task_*.md` mit `Status: aktiv` sind ausführbar; `npm run specs` prüft das.
Neue Specs gibt es nur für M-Pakete; die Alt-Specs der S-Pakete W1-03e, W1-17 und W1-20 laufen mit ihrem Paket aus.
Specs aus M3/M4 (`task_w1-10.md`, `task_hq2-02.md`, `task_ollama_worker_adapter.md`) stehen auf `Status: entwurf`, bis ihre Lane sie erreicht (Review PR #175, kimi-k3 F-7).

| Spec | Paket | Lane |
|---|---|---|
| `.pa/task_w1-05.md` | W1-05b: Queue-Abnahmerest, Cancel-Regel für `dispatched` | seriell: `store.rs`, danach `api.rs` (Nahtstellen) |
| `.pa/task_f_core3_delivery.md` | W1-03e/f: F-CORE-3 Rest B.3/C | W1-03e: `workers.rs` (keine Nahtstelle); W1-03f (M4) zusätzlich `bin/pa.rs` |
| `.pa/task_w1-20.md` | W1-20: Zweites Setup reproduzieren | parallel (keine Nahtstelle) |
| `.pa/task_w1-17.md` | W1-17: HQ-Parser prüfen | parallel (keine Nahtstelle) |
