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

### Stand 2026-10-15 (datierter Schnappschuss, keine Live-Quelle)

Gelesen am 2026-10-15 um 20:35 MESZ, `origin/main` @ `ded1eef5`. Zahlen, die sich
stündlich ändern (offene PRs, Queue), stehen hier bewusst nicht mehr; sie
kommen nur aus den Live-Belegen oben.

- **Jüngstes veröffentlichtes Release:** v1.6.6 (Patch, Tag auf `a8b00911`;
  die Version auf `main` steht in `package.json` und
  `src-tauri/tauri.conf.json`). Release-Lauf `release.yml` 38706858983
  `success`, veröffentlicht 2026-10-15 09:07Z (`gh release view v1.6.6`:
  4 Dateien). Davor: v1.6.5. Veröffentlicht heißt nicht installiert.
- **Ziel v2.0:** Umfang „eng“ entschieden (E1, 2026-10-15); Kriterien und
  Restpakete in `docs/plan/v2.0/plan.md` (PR #1475).
- **Plan:** `docs/PLAN.md` ist der einzige Plan (Ziele Z1–Z4).
- **Wo der Live-Stand steht:** die Notiz `lage-jetzt` (außerhalb von Git, s. o.)
  und die drei Live-Belege oben. Dieser Schnappschuss ersetzt sie nicht.

Server-Automationen (review-feeder, dep-feeder, hold-feeder; 12 Server-Slots) leben in pa-orch und sind in der Projektnotiz `pa-orch-server-dispatch` dokumentiert, nicht im Repo.

### Nächster Griff

1. `lage-jetzt` und die Live-Belege lesen; Ziel, Owner und nächsten Schritt
   mit den Z1–Z4-Tabellen in `docs/PLAN.md` abgleichen.

Alte Paketlisten, PR-Schnappschüsse und Befunde sind Historie:
`.pa/archiv/` und `git log -p -- STAND.md`. Sie erteilen keine Startfreigabe.

## Feste Grundlagen (jeweils geprüft am 08.10.2026)

- **Release:** Das jüngste Release nennt `gh release list --limit 5`; vor jeder
  Release-Aussage wiederholen (Schnappschuss oben: v1.6.6 veröffentlicht).
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
