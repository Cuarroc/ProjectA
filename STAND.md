# Stand — 24.09.2026

Kurze Momentaufnahme für die nächste Instanz: wo wir stehen, was gerade läuft,
welche Specs ausführbar sind. Alles Weitere steht an genau einem Ort:

- **Offene Arbeit, geordnet, mit Fortschritt:** [`docs/MASTERPLAN.md`](docs/MASTERPLAN.md)
- **Erledigte Arbeit (gemergte PRs):** [`docs/ERLEDIGT.md`](docs/ERLEDIGT.md)
- **Paketdefinitionen offener Arbeit:** [`docs/PLAN.md`](docs/PLAN.md), W5 in
  [`.pa/plan_projects_w5.md`](.pa/plan_projects_w5.md)
- **Offene Befunde und Flakes:** [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md)

Historie: git, `CHANGELOG.md`, `STATUS.md`, `.pa/ACTIVITY.md`. Die frühere
PR-#39-Übergabe liegt in `.pa/report_pr39_handoff_historical_2026-09-21.md`,
die Vollfassung vom 15.09. unter `docs/archive/plaene-2026-09/STAND-2026-09-15.md`.

## Wo wir stehen

- **Release:** v1.4.1 ist der jüngste veröffentlichte Release (22.09.,
  PR #69, `3bcaed3`). Alles danach ist auf `main`, aber nicht ausgeliefert;
  ob und wann es ein Release wird, entscheidet der Nutzer. Die installierte
  App bleibt bis dahin unangetastet.
- **Fortschritt:** `docs/MASTERPLAN.md` rechnet 112 von 419 Punkten der
  geplanten Pakete als erledigt (26,7 %), mit den neu vorgeschlagenen
  Folgepaketen 131 von 493 (26,6 %). Überschneidende HQ2-/W5-Pakete sind
  Aliase der DF-Pakete und zählen nicht mehr doppelt.
- **Sanierungsplan Rev 9:** F0 ist abgeschlossen; alle F-Pakete sind mit
  Report abgenommen und `historisch`, bis auf den F-CORE-3-Rest B.3/C
  (W1-03e/f).
- **Continuous Mode bleibt fail-closed abgeschaltet.** `development_policy.rs`
  lehnt `continuous.enabled=true` ab; die Freischaltung ist W4-03 nach der
  Abnahmematrix (`.pa/continuous_acceptance_matrix.md`, 27 Zeilen) und nur
  mit Freigabe des Nutzers.
- **Queue:** die zehn toten `dispatched`-Einträge vom 15./17.09. sind weiter
  nicht verwerfbar. `POST /api/queue/<id>/cancel` antwortet seit W1-16
  (PR #82) für `dispatched` mit 409 statt 400; die sichere Cancel-Regel selbst
  fehlt noch (W1-05b). Bis dahin keine App mit dieser Queue starten.
- **CI und Merge:** `main` wird seit 24.09. über die Mergify-Merge-Queue
  gemergt (CI-01, PR #108; Regeln in `AGENTS.md` „Merging", Langfassung
  `docs/setup/mergify.md`). Required Checks: `gates (linux)`,
  `gates (windows)`, `red-first`, `Mergify Merge Protections`; `strict` ist
  aus. Draft-PRs bekommen keine CI.
- **Bekannter Blocker beim Push:** Der pre-push-Hook fährt die Gates im
  Hauptcheckout statt im gepushten Worktree (`core.hooksPath`); ist dort ein
  Gate rot, scheitert jeder Push. Nicht umgehen; Behebung in CI-02.

## Was gerade läuft

| Paket | Stand | Lane |
|---|---|---|
| W2-01b Review-Route nimmt den Reviewer-Run aus dem Credential | PR #124 in der Merge-Queue | api |
| W2-03 Usage-/Billing-Collectors | Worker läuft | st |
| W2-06 Supervisor: Producer-Audit, Runtime-Notifications | Worker läuft | mn (+ sup) |
| W2-08a Ressourcendruck- und Streaming-Enforcement | Worker läuft | fR |
| W1-15c übrige Mutex-Stellen in pty.rs | Worker läuft | pty |
| CI-02 leichtes prepush, W1-19b, pre-push-Hook | Worker läuft | ci |
| SETUP-B Dev-Skripte | Worker läuft | scripts/dev |
| SETUP-04 AGENTS.md und dieser Plan-Nachtrag | dieser Stand | doc |

Hinweis: PR #70 steht auf GitHub als „closed" statt „merged". Sein Inhalt ist
vollständig über `fef9eaa` auf `main` (GitHub-Störung beim Auto-Merge am 24.09.;
nur der Support kann das Flag setzen). `docs/ERLEDIGT.md` führt ihn als gemergt.

## Nächster Griff

1. Die laufenden Pakete abschließen (Tabelle oben); die Queue mergt fertige
   PRs selbst. Danach die Reihenfolge je Lane aus `docs/MASTERPLAN.md`
   („Worker-Struktur") ziehen; DF-07d (visueller PASS) braucht keinen
   Build-Slot.
2. W1-05b: sichere Cancel-Regel für `dispatched` implementieren und testen,
   Prozessende verifizieren, doppelte Neueinreihung verhindern; die produktive
   Queue bis dahin nicht durch einen App-Start dispatchen.
3. Nutzerentscheidungen einholen, die Pakete blockieren: Schnitt W4-03a
   (Journal-Teil ohne Aktivierung, Voraussetzung für W5-03), Grenzwerte für
   W2-08b, Secrets aus der Repo-Ebene in geschützte Environments,
   Release-Frage für die Arbeit nach v1.4.1 (Liste in `docs/PLAN.md` §5).

## Aktive Specs

- `.pa/task_devflow.md`: DEVFLOW-Ausführung; Pakete DF-00 bis DF-37, einzelne Pakete nur mit erfüllten Abhängigkeiten und Write-Allowlist.

Eine `.pa/task_*.md` ist nur ausführbar, wenn sie hier aufgeführt ist **und**
selbst `Status: aktiv` trägt; `npm run specs` (in `npm run build`) erzwingt
beides. Ein Paket aus `docs/PLAN.md` wird beim Start als `.pa/task_<id>.md`
angelegt und hier eingetragen; beim Merge wird die Spec `Status: historisch`
und die Zeile verschwindet. Folgepakete aus Reports brauchen keine Spec, ihr
Report ist die Quelle.

| Spec | Paket | Lane |
|---|---|---|
| `.pa/task_f_core3_delivery.md` | W1-03e/f: F-CORE-3 Rest B.3/C (C-3 selbst erledigt, PR #72) | `pty.rs` / `workers.rs` (keine Nahtstelle) |
| `.pa/task_w1-05.md` | W1-05b: Queue-Abnahmerest, Cancel-Regel für `dispatched` | parallel (keine Nahtstelle) |
| `.pa/task_w1-10.md` | W1-10: HQ-Stylesheet | parallel (keine Nahtstelle) |
| `.pa/task_w1-12.md` | W1-12: Design-Reste | parallel (keine Nahtstelle) |
| `.pa/task_w1-17.md` | W1-17: HQ-Parser auf diesen Plan umstellen | parallel (keine Nahtstelle) |
| `.pa/task_w1-20.md` | W1-20: Zweites Setup reproduzieren | parallel (keine Nahtstelle) |
| `.pa/task_ollama_worker_adapter.md` | W2-09b: DeepSeek V4 Flash Cloud ueber OpenCode; CLI-Probe belegt, TUI/Worker offen | hooks/capabilities/profile; main nur seriell fuer fallible Spawn-Integration |
| `.pa/task_hq2-02.md` | HQ2-02: Konzeptdemo, Inhalt über #70 auf main; Nutzer- und visuelle Abnahme offen | isolierte Demo-Datei, keine Produkt-UI-Lane |

## Bewusst offene Produktbefunde

Das Zuhause dieser Befunde ist seit 24.09. `KNOWN_ISSUES.md`. Hier steht nur
der Verweis:

- KI-24: SQLite-Lastklasse (`database is locked` / `pool timed out`), mit #77/#85 bearbeitet, beobachten.
- KI-25: Linux-Prozessgruppen-Test in `testgate.rs`, einmal rot, Ursache offen (W1-29).
- KI-26: Windows-PTY-Argumenttest, Kaltstart-Fix seit PR #104, beobachten.
- KI-27: `exited_undelivered` gibt Reservierung und Delivery frei (DF-15b, PR #16), beobachten.
- KI-28: Capture-Host bleibt Windows-only (Entscheidung 16.09.).
- KI-29: F-SEC-4-Restrisiko des OmniRoute-Key-Syncs bei eingeschaltetem Opt-in.
- KI-20: doppelte Antwort auf `ESC[6n`, braucht eine Entscheidung (W1-27).

## Stehende Regeln

- Vier Nahtstellen, je eine serielle Lane: `src-tauri/src/api.rs`, `main.rs`,
  `store.rs` (samt `store/`), `bin/pa.rs`.
- Plan oder großer/Nahtstellen-Diff: zwei unabhängige Reviews mit
  protokollierter Disposition.
- Bugfix: kompilierender roter Regressionstest, dann grün. Gestaltung:
  angesehener Screenshot. Laufzeit/Routing: echte Messung vorher/nachher.
- Keine App nur zur Sichtprüfung starten, solange eine gefüllte Queue echte
  Worker auslösen könnte. Nie über eine aktive Sitzung installieren.
- Kein Ergebnis aus Formularstatus ableiten, wenn Git, Prozess oder Testbeleg
  die Wahrheit liefern. Exit-Codes ungemaskiert lesen.
- PR als Draft öffnen, einmal pushen; gemergt wird nur über die
  Mergify-Queue (Hand-Merge nur Koordinator im Notfall, `AGENTS.md`).
- Gemergtes Paket: aus PLAN/MASTERPLAN streichen, Zeile in `docs/ERLEDIGT.md`,
  Spec auf `Status: historisch`.
- Session-Ende über `bash scripts/sync.sh note "<agent>" "<summary>"`.

## Dokumente

| Datei | Zweck |
|---|---|
| `docs/MASTERPLAN.md` | alle offene Arbeit in Ausführungsreihenfolge, Fortschritt |
| `docs/ERLEDIGT.md` | erledigte Pakete mit PR, Merge-SHA und Report |
| `docs/PLAN.md` | Paketdefinitionen offener Arbeit, Regeln, Entscheidungen |
| `STAND.md` | diese Momentaufnahme |
| `AGENTS.md` | Arbeitsregeln für alle Agenten |
| `KNOWN_ISSUES.md` | offene bekannte Befunde und Flakes |
| `CHANGELOG.md` | ausgelieferte Nutzeränderungen |
| `STATUS.md` | abgeschlossene Meilensteine |
| `.pa/task_*.md` | ausführbare Paketspezifikationen |
| `.pa/report_*.md` | Belege und Review-Disposition |
| `.pa/continuous_acceptance_matrix.md` | Abnahmematrix Continuous Mode |
| `.pa/ACTIVITY.md` | append-only Instanzjournal |
| `docs/archive/plaene-2026-09/` | archivierte Pläne und Specs (nur Beleg) |
