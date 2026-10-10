# STAND — Wegweiser und feste Grundlagen

## Wo die aktuelle Lage steht

**STAND.md ist nicht der Live-Stand.** Die aktuelle Lage steht in der einen
AgentsRoom-Projektnotiz `lage-jetzt`: für AgentsRoom-Agenten per `memory_get`
mit dem Namen `lage-jetzt`, als Spiegel unter
`.agentsroom/memory/features/lage-jetzt.md` (außerhalb von Git).
Die Notiz wird an Ort und Stelle aktualisiert; keine Kopie im Branch pflegen.
Ist der Spiegel im Arbeitsbaum nicht verfügbar, die Live-Quellen prüfen und
fehlenden Notizzugriff ausdrücklich nennen.

Aktuelle Belege bei jedem Neustart neu lesen:

- `gh pr list` — offene Pull Requests.
- `git fetch origin`, danach `git log origin/main -1` — jüngster Hauptstand.
- Server: `~/pa-orch/events.log` — aktuelle Orchestrator-Ereignisse.

### Nächster Griff

1. `lage-jetzt` und die Live-Belege lesen; Ziel, Owner und nächsten Schritt
   mit den Z1–Z4-Tabellen in `docs/PLAN.md` abgleichen.

Alte Paketlisten, PR-Schnappschüsse und Befunde sind Historie:
`.pa/archiv/` und `git log -p -- STAND.md`. Sie erteilen keine Startfreigabe.

## Feste Grundlagen (jeweils geprüft am 08.10.2026)

- **Release:** v1.6.0 (Tag `d2582ceb`, geprüft 09.10.2026) ist das jüngste
  Release; Release-Run 38004103979 grün, anonymous `latest.json` 1.6.0.
  Vor einer erneuten Release-Aussage `gh release list --limit 5` wiederholen.
- **Merge:** ausschließlich über die Mergify-Queue, gemäß `AGENTS.md`.
- **Continuous Mode:** bleibt ausgeschaltet und bis M4 eingefroren (`AGENTS.md`).
- **Desktop-App nicht zur Inspektion starten:** ihre Queue kann sofort echte
  Worker auslösen (`AGENTS.md`).
- **Ziele:** Die Zielstruktur Z1–Z4 steht im einzigen Plan
  [`docs/PLAN.md`](docs/PLAN.md); Regeln stehen in [`AGENTS.md`](AGENTS.md).

### Historischer Prüfbestand (08.10.2026)

Die folgenden Texte bleiben für bestehende Gates erhalten, nicht als Live-Lage:
`hq-pages.test.mjs` bindet den gespeicherten HQ-Snapshot an diesen alten Satz:
„M2 nach PLAN.md abarbeiten; die Queue mergt grüne PRs selbst.“
Er ist historisch und keine Handlungsanweisung; die Mergify-Regeln gelten.

### Aktive Specs

Technisches Register für `spec-status-check.mjs`, die Hygiene-Tests und den
HQ-Parser (geprüft 08.10.2026). Die Dateistatus werden damit abgeglichen;
aktuelle Aufträge, Reihenfolge und Owner kommen aus `lage-jetzt` und `docs/PLAN.md`.

| Spec | Paket | Lane |
|---|---|---|
| `.pa/task_arch-d4-05.md` | ARCH-D4: API-Router, serieller Teil 5 | seriell: `api.rs`; Root, Slot B |
| `.pa/task_w1-05.md` | W1-05b: Queue-Abnahmerest, Cancel-Regel für `dispatched` | seriell: `store.rs`, danach `api.rs` (Nahtstellen) |
| `.pa/task_f_core3_delivery.md` | W1-03e/f: F-CORE-3 Rest B.3/C | W1-03e: `workers.rs` (keine Nahtstelle); W1-03f (M4) zusätzlich `bin/pa.rs` |
| `.pa/task_w1-20.md` | W1-20: Zweites Setup reproduzieren | parallel (keine Nahtstelle) |
| `.pa/task_w1-17.md` | W1-17: HQ-Parser prüfen | parallel (keine Nahtstelle) |
| `.pa/task_w4-01.md` | W4-01: Fünf reproduzierbare Benchmark-Aufgaben | parallel (keine Nahtstelle) |
| `.pa/task_w3-01.md` | W3-01a: Globaler DB-Wartungs-/Write-Lock | seriell: `store.rs` + `store/` |
