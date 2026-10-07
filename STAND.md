# Stand — 08.10.2026

Wo wir stehen, in Kürze; ein Schnappschuss, kein Live-Stand. Plan und
Reihenfolge: [`docs/PLAN.md`](docs/PLAN.md). Regeln: [`AGENTS.md`](AGENTS.md).
Ältere Fassungen: `.pa/archiv/` (`STAND_2026-09-24.md`, `STAND-AGENTS-history-2026-10.md`).

## Wo wir stehen

- **Priorität:** zuerst die Ideensammlung IDEAS-L0 (Nutzer 07.10.; `docs/PLAN.md`,
  „Für den Nutzer“).
- **Release:** v1.5.1 ist der jüngste (06.10.2026; v1.5.0 am 05.10.; beobachtet
  mit `gh release list` am 07.10.2026 22:44 UTC). Nächster Strang: v1.6.0
  ([`docs/plan/v1.6.0/plan.md`](docs/plan/v1.6.0/plan.md)).
- **Meilenstein M1** „Alles Laufende gelandet, App startbar“: erreicht
  (26.09.2026, PLAN.md, Tabelle M1).
- **App nicht starten:** Die Queue hat tote `dispatched`-Einträge, die echte
  Worker auslösen können. W1-05b ist gelandet (PR #19);
  die toten Einträge vorher read-only nachzählen und gezielt verwerfen.
- **Continuous Mode:** aus und eingefroren („Development loop“ in `AGENTS.md`);
  `development_policy.rs` lehnt ihn ab.
- **Merge** nur über die Mergify-Queue. CI kostet Minuten, Ziel 0 €.
- **Live-Stand** kommt aus `gh pr list` und `git log origin/main`.

## Nächster Griff

1. IDEAS-L0 nach PLAN.md: Ideen speichern, wiederfinden, bearbeiten, ordnen.
2. M2 nach PLAN.md abarbeiten; die Queue mergt grüne PRs selbst.
3. Die toten Queue-Einträge read-only nachzählen und mit der neuen Cancel-Regel gezielt verwerfen (W1-05b, PR #19).
4. Fragen an den Nutzer gehen in die Entscheidungs-Inbox in PLAN.md.

## Offene Befunde (Details: `KNOWN_ISSUES.md`)

- KI-30: sporadische `real_native_*`-Fehlschläge auf Windows, Ursache unbekannt; #262 (gemergt) gibt nur Diagnose aus.
- KI-24: SQLite-Lastklasse (`database is locked`), beobachten.
- KI-27: `exited_undelivered` gibt Reservierung und Delivery frei (DF-15b, PR #16), beobachten.

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
