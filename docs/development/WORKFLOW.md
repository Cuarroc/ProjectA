# AGENTS.md

Diese Datei gilt für **jeden** Agenten, der an diesem Repo arbeitet — Claude,
Codex, Kimi, OpenCode, Orca-Worker. Sie ist die gemeinsame Grundlage;
anbieterspezifische Dateien wie `CLAUDE.md` verweisen hierher, statt eigene
Fassungen derselben Wahrheit zu führen.

ProjectA ist ein „agentic terminal": eine Tauri-2-Desktop-App, die eine Flotte
paralleler CLI-Coding-Agenten nebeneinander betreibt. Grundprinzip: **eine
Aufgabe = ein Agent = ein git-Worktree.** Aktuelle Version und offene Arbeiten
stehen in `STAND.md` — nicht hier.

---

## ZUERST LESEN: `STAND.md`

Egal ob du neu anfängst oder mitten in laufender Arbeit übernimmst —
`STAND.md` im Projektwurzelverzeichnis ist dein erster Griff. Sie beantwortet:

1. **Was sofort zu prüfen ist** — laufende Worker, Kontingente.
2. **Wo wir stehen** — welche Branches welche Beweise tragen, was auf Review wartet.
3. **Welcher Agent wofür taugt** — mit Belegstelle statt Behauptung.
4. **Fallen, in die schon jemand getreten ist** — mit der Lösung daneben.

Ist die Zeitangabe dort mehrere Stunden alt, gilt ihr eigener Rat: erst die
drei Prüfbefehle, dann glauben.

---

## Pflicht: das Dev-HQ ist dein Cockpit, nicht nur des Menschen

`npm run hq:live` startet das Live-Dev-HQ auf `http://127.0.0.1:4173/live.html`
— **jeder Agent, der an diesem Repo arbeitet, benutzt es**, nicht nur der
Mensch. Es zeigt die Flotte, die Queue, offene Fragen, Verdicts, Quota/Budget-
Kapazität, Usage, Provider-Vault-Status und agentengenerierte Empfehlungen in
Echtzeit gegen die echte Control-API — dieselbe Quelle, aus der `pa board`
liest. Ein Agent, der stattdessen manuell `pa`-Kommandos zusammenklickt oder
den Zustand errät, tut doppelte Arbeit, die das HQ schon anzeigt. Ein Scout
oder Orchestrator kann außerdem über die **Recommendations**-Karte
Folgearbeit vorschlagen (`POST /api/recommendations`), die ein Mensch oder ein
anderer Agent später annimmt oder verwirft.

**Bug im HQ gefunden? Dokumentieren *und* einreihen — nicht nur eins von
beidem:**

1. Eintrag in `docs/dev-hq/BUGS.md` anhängen (append-only, Vorlage steht dort):
   was, wo, wie reproduzierbar, wie schwer.
2. Einen echten Fix-Task in die Queue stellen, damit ein Worker ihn wirklich
   abarbeitet — entweder über die **Queue**-Karte im HQ selbst (Human
   Controls → „task to queue") oder direkt gegen die Control-API:
   `POST /api/queue {"projectId": "...", "rawText": "HQ-Bug: <kurzbeschreibung>, siehe docs/dev-hq/BUGS.md"}`.

Ein Fund ohne Queue-Eintrag verschwindet, sobald die Session endet — der
Beweismaßstab dieser Datei gilt auch für Bugs im eigenen Werkzeug.

**Lessons — das Gedächtnis bekannter Fehler (`docs/dev-hq/lessons.json`):**
Bevor du einen Fehler debuggst, frag das Gedächtnis:
`npm run hq:lesson -- search "<Fehlertext>"` (oder die Lessons-Karte im Live-
HQ). Trifft es, wende den Fix an und **melde zurück**, ob er geholfen hat:
`npm run hq:lesson -- worked <id> --run <runId>` oder `failed <id> --run <runId>` (Live: „Fix worked" /
„Didn't help") — daraus entsteht die Konfidenz, mit der die nächste Instanz dem
Fix traut. War der Fix falsch und du kennst den richtigen: `refine <id> --fix
"…" --note "…"`, der alte bleibt in der Historie. Für Worker-Prompts liefert
`npm run hq:lesson -- brief "<Fehler>"` einen Markdown-Block. Hast du etwas
behoben, das dort fehlt, trag es ein — Symptom, Ursache, Fix, Tags, Quelle:
`npm run hq:lesson -- add --symptom "…" --cause "…" --fix "…" --tags a,b --source <report>`
und committe die Datei mit dem Fix. Ein Fix ohne Lesson ist für die nächste
Instanz unsichtbar; die Gotchas unten sind der Anfang dieser Liste, nicht ihr
Ende. Der Setup-Helper oben im Live-HQ sagt, was auf dieser Maschine fehlt,
mit Kopierbefehl — zuerst dort nachsehen, bevor du an Gates vorbeiarbeitest.

---

## Die zwei Regeln, die am meisten Arbeit retten

### 1. Die vier Nahtstellen

```
src-tauri/src/api.rs      src-tauri/src/main.rs
src-tauri/src/store.rs    src-tauri/src/bin/pa.rs
```

**Nur ein Worker fasst sie gleichzeitig an.** Jede Fläche, die neue Operationen
hinzufügt, läuft durch alle vier — deshalb kollidieren dort parallele Arbeiten
zuerst. Diese Regel hat an einem einzigen Tag dreimal Arbeit gerettet.

Braucht dein Fund einen Test in einer dieser Dateien und du arbeitest parallel
zu anderen: liefere ein Reproduktionsrezept statt eines Tests und vermerke
„Naht — für den Menschen".

### 2. Der Beweismaßstab

**Ein Fund ohne roten Test ist eine Behauptung. Ein Fund mit rotem Test ist eine
Tatsache.**

„Rot" heißt: **der Test kompiliert und schlägt fehl.** Ein Test, der nicht
kompiliert, ist nicht rot — er ist kaputt. Das ist der häufigste Selbstbetrug
bei dieser Arbeit; kopiere die echte Fehlerausgabe in deinen Bericht, sonst
zählt der Fund als unbewiesen.

Dasselbe gilt außerhalb von Tests: **Ein Ergebnis ohne Beleg ist eine
Behauptung.** Bei Gestaltung heißt der Beleg: ein Screenshot, den jemand
angesehen hat. Bei einer Konfigurationsänderung: eine Messung vorher und
nachher. Wer einen Neustart meldet, hat nachzumessen, dass er stattgefunden hat.

---

## Fünf Arbeitsregeln, jede aus einem echten Fehlschlag

Diese Regeln stehen hier, weil ihre Verletzung an einem einzigen Tag mehrere
Stunden gekostet hat. Sie sind keine Vorsicht, sondern Erfahrung.

**1. Untersuche den ersten Fehlschlag, nicht den dritten.**
Ein Fehler mit einem eigenen Code (`chat_admission_busy`, `invalid_api_key`) ist
eine dokumentierte Bedingung, kein Rauschen. *„retry shortly"* ist eine
Anweisung. Wer sie ignoriert und blind wiederholt, automatisiert das Wegsehen.
Der billigste Moment zur Untersuchung ist das erste Auftreten.
→ Werkzeug war `worker-why <name>` auf dem Server (gelöscht 09.09.2026);
die Regel gilt weiter: erst Ursache benennen, dann wiederholen.

**2. Eine Prüfung, die nicht scheitern kann, prüft nichts.**
Eine frühere Erreichbarkeitsprüfung fragte *„Antworte mit BEREIT"* und suchte
dann „BEREIT" — Codex spiegelt den Prompt zurück, also bestand sie auch bei
totem Dienst. Frag nach etwas, dessen Antwort **nicht in der Frage steht**, und
lass die Prüfung einmal absichtlich scheitern, bevor du ihr traust.
→ Werkzeug war `preflight --selftest` auf dem Server (gelöscht 09.09.2026);
die Regel gilt für jede neue Erreichbarkeitsprüfung.

**2a. Verifikation mit Credentials, die das Produkt nicht hat, ist keine
Verifikation.**
Die v1.2.0-Endpoint-Prüfung lief mit `gh auth token` — „grün", während die
Updater-App anonym 404 bekam („Could not fetch a valid release JSON"). Prüfe
Remote-Endpunkte immer **ohne** Credentials und mit exakt den Headern/dem
Verhalten des Produkts. Deshalb steht im Release-Workflow ein anonymes
Verify-Gate (app-identische Requests).

**3. „Fertig" wird aus Belegen bestimmt, nicht aus einem Formular.**
Ein Statuswerkzeug meldete fünf erfolgreiche Worker als tot, weil es Erfolg nur
an einer Berichtsdatei erkannte — die Commits auf ihren Branches lagen die ganze
Zeit da. Leite Zustand aus dem ab, was die Arbeit **hinterlässt**, nicht aus dem,
was jemand melden sollte.

**4. Beobachte nicht schneller, als sich etwas ändert.**
Ein Orchestrator prüfte alle 60 Sekunden bei 20-Minuten-Arbeit: 223.711 Tokens,
fast alles fürs Warten. Das Prüfintervall ist ein Bruchteil der erwarteten Dauer
— oder man wartet auf ein billiges Signal (Datei da, Prozess beendet) statt zu
fragen.

**5. Nach einem Fix im eigenen Fix nach Geschwistern suchen.**
Direkt nach der Reparatur des Statuswerkzeugs wurde derselbe Fehler nebenan neu
eingebaut. Ein Fix ist der Moment mit der höchsten Wahrscheinlichkeit für
denselben Fehler — frag danach einmal: *Habe ich das gerade nochmal gemacht?*

**Und eine Regel über Regeln:** Formuliere das Prinzip, nicht den Einzelfall.
Die Anweisung „`/tmp` ist verboten" führte dazu, dass ein Worker stattdessen
einen Nachbar-Worktree las — auch verboten, aber nicht aufgezählt. Eine
Aufzählung lädt dazu ein, die Lücke zu finden.

---

## Dual-Review-Regel

Pläne und große Diffs — **über 300 Zeilen oder mit Änderung an einer der vier
Nahtstellen** — werden vor dem Merge von **zwei anderen KIs** reviewt, nicht
vom Autor und nicht von einer einzigen. Annahme oder Ablehnung wird mit
Begründung protokolliert (im Report bzw. `.pa/`), damit die Entscheidung
später nachvollziehbar bleibt. Eine zweite Meinung, die nie widerspricht, ist
keine Prüfung.

---

## Bug → Regel-Pipeline

Jeder Bugfix liefert zwei Dinge: einen **Regressionstest**, der ohne den Fix
rot wäre, und eine **Prüfung, ob die Fehlerklasse per Lint, Gate oder Hook
verhinderbar gewesen wäre.** Ist sie es, gehört die Absicherung dorthin — ein
Bug, der nur an seiner Stelle gefixt wird, kommt als Geschwister wieder.
Einmal im Monat werden die so entstandenen Regeln gemeinsam durchgesehen: was
nie ausgelöst hat, fliegt raus; was oft ausgelöst hat, wird härter.

---

## Befehle

Frontend (Repo-Root):

```sh
npm install
npm run tauri dev   # die Desktop-App — nur hier existieren die IPC-Commands
npm run dev         # Vite allein auf :1420 — jeder invoke() schlägt fehl, nur für Styling
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + Kontrastprüfung + Produktions-Bundle nach dist/
npm test            # vitest + Coverage-Ratsche
npm run test:unit   # vitest ohne Coverage, fuer enge Rot-Gruen-Schleifen
npx playwright install chromium # einmalig pro Clone
npm run test:e2e    # Playwright-Smoke mit Tauri mockIPC
npm run test:watch  # vitest im Watch-Modus
npm run lint        # eslint --max-warnings=0 — das Budget ist aufgebraucht, nicht vergeben
```

**Der Frontend-Testrunner ist jung** (bis 30.08.2026: null Tests). Tests liegen
neben ihrem Gegenstand (`Foo.test.tsx` neben `Foo.tsx`), Konfiguration in
`vitest.config.ts`, jsdom-Setup in `src/test/setup.ts`.

**Git-Hooks (Gates vor Commit/Push) sind Clone-lokal.** Nach einem frischen
Clone: `bash scripts/install-hooks.sh` (setzt `core.hooksPath .githooks`) —
ohne das laufen die Bahn `precommit`, der Trailer-Check (commit-msg) und die
Bahn `prepush` nicht automatisch; `scripts/sync.sh start` warnt, wenn sie
fehlen. Die Hooks führen seit dem 09.09. keine eigene Liste mehr, sondern
rufen `scripts/ci/gates.sh` (siehe unten).

**Test-First (T-1, ≤15 Zeilen).** Jeder Commit, der Nicht-Test-Quellcode
ändert, trägt genau einen Trailer: `Test-First: <pfad>` (neue Testdatei, auf
der Merge-Base fehlend = rot), `Test-First: <pfad>::<testname>` (bestehende
Datei; CI führt genau ihn aus), `Regression-For: <sha>` (nur Kopf grün) oder
`No-Test: <Grund>`. Mehrere Belege = mehrere Zeilen, nie eine Liste.
`commit-msg` prüft nur die Anwesenheit, keinen Testlauf. Der CI-Job
`red-first` checkt die Merge-Base aus: Test-First-Specs müssen dort
fehlschlagen oder fehlen, am Kopf grün sein. Probe:
`bash scripts/test-red-first.sh` (frisches Temp-Repo).

**Jede neue Dependency-/Architektur-Entscheidung → 3 Zeilen in
`docs/decisions.md`** (Was? Warum? Wann zurücknehmen? — M12). Sonst nichts
dorthin, das Journal ist kein zweites AGENTS.md.

Rust-Kern (in `src-tauri/`):

```sh
cargo test                                   # gesamte Suite
cargo test <filter>                          # z. B. cargo test providers::
cargo test --bin pa                          # nur die pa-CLI-Tests
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo build
```

### Die Gates: eine Quelle, `scripts/ci/gates.sh`

**Hier steht keine Gate-Liste.** Bis zum 09.09. stand sie fünffach da — in
beiden Hooks, in `ci.yml`, in `release.yml` und als Prosa an dieser Stelle —
und sie driftete: `pre-push` fuhr `cargo test`, CI `cargo nextest run
--profile ci`. Was lokal grün war, war nicht das, was CI misst. Eine sechste
Fassung hier wäre derselbe Fehler, den `CLAUDE.md` für Doku beschreibt.

```sh
bash scripts/ci/doctor.sh            # was kann diese Maschine belegen?
bash scripts/ci/gates.sh --list      # die Liste, immer aktuell
bash scripts/ci/gates.sh lane prepush   # die volle lokale Bahn
bash scripts/ci/gates.sh --from clippy lane linux   # nach einem Fehlschlag weiter
```

Bahnen: `precommit`, `prepush`, `linux`, `windows`, `release`, `audit`.
`ci.yml`, `release.yml`, `audit.yml` und beide Hooks rufen genau diese Bahnen
auf — ein Schritt je Bahn, keine Liste mehr im YAML. Drift ist damit nicht
geprüft, sondern unmöglich.

**Die Gates lokal ausführen, nicht auf CI warten** — schneller, billiger, und
der Fehler fällt vor dem Push auf statt danach. Der produktive Bundle-Build
existiert weiterhin nur im Release-Workflow (`v*`-Tags).

**Jeder Lauf endet mit einem Block „NICHT ABGEDECKT".** Er gehört in den
PR-Text bzw. `.pa/ACTIVITY.md`: die `#[cfg(unix)]`-Tests (Dateirechte,
Prozessgruppen-Kill) kompilieren unter Windows nicht, die
`#[cfg(windows)]`-Tests nicht unter Linux (`KNOWN_ISSUES` KI-7) — **kein
einzelner Rechner deckt beide Hälften ab.** Die Linux-Hälfte kommt seit der
Server-Löschung aus WSL2 (Clone auf ext4): `docs/ci-lokal.md`. „Vollgates
grün" ohne diesen Block ist nach dem Beweismaßstab eine Behauptung.

### Rust-Testablage und gemeinsamer Capture-Kern

App- und CLI-Tests liegen in den Modulen ihrer Binärtargets. Der native
Capture-Kern wird einmal in der Bibliothek `projecta_capture` kompiliert
(`src/capture_core.rs`); App und isolierter Host verwenden dieselben Typen und
dieselbe Implementierung. `cargo test --lib` prüft diesen gemeinsamen Kern,
`cargo test` zusätzlich die Binärtargets. Datenbank und Sitzungsverwaltung
bleiben im App-Target. Testmodule können inline oder mit `#[path]` angebunden
sein; gemeinsam verwendeten Quellcode nicht erneut je Binary einbinden.

---

## Architektur

Zwei Hälften, verbunden über Tauris IPC (Command-Tabelle und Events: `README.md`
→ „IPC contract"):

- **`src/` — React + TypeScript + Vite.** `App.tsx` hält Session-/Tab-/
  Pane-Lifecycle, `lib/ipc.ts` sind die typisierten `invoke()`/`listen()`-
  Wrapper, `types.ts` die geteilten IPC+UI-Typen. Hauptfläche ist der
  Orchestrator-Dialog (`ConversationView`), das Board ist eine Rail.
- **`src-tauri/src/` — der Rust-Kern (40 Module + `bin/pa.rs`).** Einstieg
  `main.rs`
  (Tauri-Commands, App-Setup). Zentrale Achsen:
  - `pty.rs` — PTY-Sessions (ConPTY), Scrollback-Ringpuffer, Submit-Guard;
    Sessions überleben keinen Neustart, alles andere schon (SQLite).
  - `store.rs` — das komplette SQLite-Schema und **jede** Query; eine geteilte
    `projecta.db`.
  - `workers.rs` / `queue.rs` / `status.rs` — Worker-Lifecycle, Task-Queue mit
    30-s-Dispatcher (Default max. 4 pro Projekt; **`0` schaltet den Dispatcher
    für das Projekt aus**), Status-Engine mit Rangfolge Hooks > Terminal-Heuristik > `gh`.
  - `routing.rs` / `omniroute.rs` / `quota.rs` / `freetier.rs` / `budget.rs` —
    Spawn-Umgebung, OmniRoute-Routing (Daemon auf `:20128`, Probe `/healthz`),
    Quota-/Budget-Blocks, Free-Tier-Failover mit ToS-Whitelist.
  - `api.rs` (token-geschützte lokale Control-API) und `web_interface.rs`
    (read-only Remote-Board) — **beide HTTP-Server sind handgerollt auf
    `std::net`, thread-per-connection, ohne Framework.** Read-only ist beim
    Remote-Board die Sicherheitsgrenze, kein fehlendes Feature.
  - `proc.rs` — **jeder** Kindprozess läuft hierüber; unter Windows sonst
    aufblitzende Konsolenfenster. Ein Quellscan-Test erzwingt das.
  - `bin/pa.rs` — die `pa`-Bridge-CLI: bewusst dependency-freier
    Loopback-Client der Control-API für Orchestrator-Agenten.
- **Drei Agenten-Arten:** Worker (hat Branch + Worktree, steht auf dem Board),
  Orchestrator (plant, delegiert via `pa`), Scout (recherchiert, schreibt
  Empfehlungen). Koordinatoren haben keinen Branch und erscheinen nicht auf dem
  Board.
- **Secrets:** Provider-Keys im Vault (`<app data dir>/provider-keys.json`),
  Ollama-Key in `.pa/secrets.json` (gitignored) — **nie im Repo.**

---

## Was welcher Anbieter kann — belegte Eigenschaften

Keine Tagesform, sondern Werkzeugeigenschaften. Wer sie ignoriert, verbrennt
Kontingent an einer Wand.

> **Historisch (Stand vor dem 24.09.2026).** Die Tabelle und die
> Arbeitsteilung darunter beschreiben den OmniRoute-/Free-Tier-Betrieb; Kimi
> Code, das Ollama-Reviewerpaar und die Advisors fehlen. Die aktuelle
> Einrichtung und Rollenverteilung je Anbieter steht in
> [`docs/setup/`](../setup/README.md). Die Einzelbefunde unten (Bilder,
> Prozessgruppe, Pfadgrenze) sind dort übernommen.

| | Codex | OpenCode (über OmniRoute) | Claude |
|---|---|---|---|
| Agentisch arbeiten | ja | ja | ja |
| **Bilder ansehen** | **ja** (`-i <datei>`) | **nein** | ja |
| Sicherheitsthemen | **verweigert** („flagged for possible cybersecurity risk") | ja | ja |
| Kosten | eigenes Kontingent | Free-Tier | eigenes Kontingent |

> **Archiv:** Server am 09.09.2026 gelöscht; Prozeduren in der Versionshistorie
> (Tag `v1.4.0`) und in `docs/archive/plaene-2026-09/STAND-2026-09-15.md` §5.

**Daraus folgt die Arbeitsteilung:** Codex ist *das Auge und der Entscheider* —
kurze, gehaltvolle Aufrufe, alles mit Bildern. OpenCode ist *die Hand* — lange
agentische Arbeit, Sicherheitsthemen, alles, was Kontingent schonen soll.

**Cursor als Orchestrator, Claude als Hand:** Wenn die Sitzung in Cursor
läuft und Worker das Claude-Abo verbrauchen sollen, spawnt der Orchestrator
mit `--profile claude` (Abo).
`claude-omni` und Cursor-Task-Subagents verlassen das Abo bzw. zählen gegen
Cursor. Die Codex/OpenCode-Teilung oben bleibt für Läufe über OmniRoute.

Weitere harte Eigenschaften:

- **Codex räumt beim Befehlsende seine Prozessgruppe ab.** Ein per `&`
  gestarteter Hintergrundprozess stirbt mit dem Aufruf. Abhilfe: `setsid` davor.
- **OpenCode verweigert jeden Pfad außerhalb seines Arbeitsordners** — auch
  `/tmp`. Und es verweigert nicht nur den Zugriff, sondern **den ganzen Befehl**:
  `rm -f /tmp/x && cargo test` scheitert komplett. Temporäres in den eigenen
  Arbeitsordner legen.
- **Ein Agent, der einen Prompt zurückspiegelt, taugt nicht als Prüfobjekt.**
  Eine Erreichbarkeitsprüfung muss nach etwas fragen, das im Prompt nicht
  vorkommt (`sieben mal sechs` → `42`), sonst besteht sie auch bei totem Dienst.

### OmniRoute: globales Budget für schwere Anfragen

Eine Anfrage gilt als **schwer** ab 32.000 geschätzten Tokens, 64 Werkzeugen,
200 Nachrichten **oder** 256 KB Körpergröße — jeder agentische Aufruf ist damit
schwer. Wer über dem Limit anfragt, bekommt **503 `chat_admission_busy`**.

Die Grenze steht in `OMNIROUTE_CHAT_MAX_HEAVY_IN_FLIGHT` (Standard 1, hier auf
8 gesetzt — per Messung unter Last belegt, `scripts/omniroute-serve.cmd`). Sie
schützt den Heap des Daemons, nicht das Upstream-Kontingent. Trotzdem gilt:
**plane mit höchstens fünf schweren Agenten gleichzeitig — als globales
Budget, lokale Aufrufe mitgezählt.** Das Budget liegt bewusst unter dem
technischen Limit, damit Reserve für Ad-hoc-Aufrufe und Spitzen bleibt.

`auto/coding` ist agentisch bewiesen; `auto/best-coding` scheitert bei
Werkzeugaufrufen, obwohl es einfache Fragen beantwortet.

---

## Betriebs-Gotchas (hart erlernt)

- **Die App zu starten hat Folgen:** der Dispatcher zieht sofort Queue-Einträge
  und spawnt echte Worker. Nicht „nur mal kurz starten" mit gefüllter Queue.
- **Worktrees: immer `git -C <pfad>`, nie `cd X && git …`** — die Shell setzt
  das Arbeitsverzeichnis zwischen Aufrufen zurück.
- **`cargo fmt` ist repoweit angewandt.** Bei Branches von einer Prä-fmt-Basis:
  **Feature zuerst mergen, `fmt` danach — nie andersherum.**
- **Cargo unter Last:** parallele Builds können mit `0xc000012d` /
  mmap-Fehlern abbrechen — kein Code-Problem; `CARGO_BUILD_JOBS=2` und neu
  bauen. **Niemals `CARGO_PROFILE_*`-Umgebungsvariablen setzen** — das
  invalidiert den kompletten Dep-Cache (~466 Crates), den diese Maschine nicht
  ohne Weiteres neu baut.
- **`504 Outdated Optimize Dep`** auf jedem Modul: Vites Dep-Cache ist veraltet
  → `scripts/dev-fresh.cmd`.
- **Roh-PTY-Sicht auf einen Worker:** `PROJECTA_PTY_TRACE_DIR=<dir>` vor dem
  App-Start schreibt pro PTY-Session `<session>.io.log` (Millisekunde,
  Richtung, escapte Bytes jedes Writes und jedes Read-Chunks) und
  `<session>.out.raw`. Standardmäßig aus, zeichnet Auftragstexte auf — nur
  in Scratch-Umgebungen. Das ist die Sicht, die der Harness
  `testutil::capture_kimi_output` *nicht* liefert: Spawn-Args, Kadenz und
  Timing des Launch-Pfads (W1-01: das verschluckte Enter war nur hier
  sichtbar). TUIs wie Kimi und Claude Code fragen als Erstes `ESC[6n` und
  blockieren ohne Antwort; der Reader-Thread antwortet seit W1-01 selbst.
- **Screenshots der App:** aus nicht-interaktiven Shells `.pa/ui-shot.ps1`
  (PrintWindow, braucht keinen Vordergrund). `scripts/window-shot.ps1` scheitert
  aus nicht-interaktiven Shells.
- **`KNOWN_ISSUES.md` ist eingefroren:** die dort gelisteten Befunde sind bewusst
  offen, mit Begründung pro Zeile — nicht nebenbei „mitfixen".
- **Ein Daemon, den eine geplante Aufgabe gestartet hat, überlebt
  `Stop-ScheduledTask`.** Er koppelt sich ab und läuft mit alter PID weiter. Den
  Prozess direkt beenden — und danach nachmessen, nicht annehmen.
- **Updater-Kanal läuft über das öffentliche Mirror-Repo `Cuarroc/ProjectA-updates`**
  (nur `latest.json` + Installer; der Code bleibt privat). Die Release-CI spiegelt
  dorthin und braucht das Secret `UPDATES_MIRROR_TOKEN` (fine-grained PAT, nur
  dieses Repo, contents: rw). `updates/latest.json` im Hauptrepo ist entfallen —
  wer es wieder anlegt, pflegt eine Leiche.
- Weitere Workarounds: `STAND.md` und die Gotchas in dieser Datei.
  (`HANDOVER.md` ist am 02.09.2026 entfallen; der Inhalt lebt in `STAND.md`
  und `docs/PLAN.md`, die Historie in git.)

---

## Cursor Cloud specific instructions

Cloud-Agenten laufen headless auf Linux (Ubuntu 24.04), nicht auf Windows. Die
Umgebung ist ein gespeicherter Snapshot; `install` frischt nur die Abhängigkeiten
auf. Was für diese Umgebung belegt gilt:

- **System-Pakete für Tauri 2:** `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
  `libsoup-3.0-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`,
  `build-essential`, `pkg-config`, `xvfb` (für die GUI). Ohne diese scheitert
  `cargo build`/`cargo test` schon am Linken von `projecta`.
- **Toolchains:** Node 24 (via `nvm` installiert). Das Basis-Image legt ein
  älteres `/exec-daemon/node` (v22) früh in den `PATH`; damit **jede** Shell
  (Login wie `bash -c`) trotzdem v24 sieht, sind `node`/`npm`/`npx` nach
  `/usr/local/cargo/bin` verlinkt — dem einzigen beschreibbaren `PATH`-Eintrag
  vor `/exec-daemon`. Rust ist **stable** (nicht das ältere Image-Default 1.83):
  eine transitive Dep (`serde_spanned`) verlangt `edition2024`, also
  `rustc >= 1.85` — `rustup default stable`.
- Alle Gates (`cargo fmt/test/clippy/build`, `npm run typecheck/test/lint/build`)
  laufen hier grün; die `#[cfg(unix)]`-Tests, die unter Windows fehlen, laufen
  auf diesem Linux mit.

### Cloud-Testablauf

1. **GUI starten:** `start` hält `Xvfb :99` offen. Mit
   `DISPLAY=:99 npm run tauri dev` startet die Tauri-CLI auch den in
   `beforeDevCommand` eingetragenen Vite-Server. Wer stattdessen das bereits
   gebaute Binary mit `DISPLAY=:99 ./src-tauri/target/debug/projecta` startet,
   muss vorher `npm run dev` laufen lassen; der Debug-Build lädt die `devUrl`
   `http://localhost:1420`.
2. **Rendern belegen:** Die echte Desktop-Oberfläche auf Display `:99`
   öffnen und einen Screenshot bzw. eine kurze Aufnahme prüfen. Ein
   „Could not connect to localhost" belegt nur, dass Vite fehlt — nicht, dass
   die App funktioniert.
3. **Kern end-to-end prüfen:** Die laufende App schreibt Port + Token nach
   `~/.local/share/com.projecta.app/projecta-api.json`. Danach mindestens
   `./src-tauri/target/debug/pa board` und
   `./src-tauri/target/debug/pa tree` ausführen. Echte Antworten wie
   `no workers` / `no projects` belegen den Pfad Desktop-App → Control-API →
   SQLite → `pa`; ein bloßer Vite-HTTP-200 reicht dafür nicht.

---

## Ressourcen-Nutzung (RAM sparen)

ProjectA und OmniRoute (lokaler Daemon auf `:20128`,
`scripts/omniroute-serve.cmd`) dürfen jederzeit benutzt werden — ihre Nutzung
ist sogar **bevorzugt**, um auf der lokalen Maschine RAM zu sparen:
Auslagerbare Arbeit (Agenten-Läufe, Routing) läuft bevorzugt über OmniRoute
statt in zusätzlichen lokalen Prozessen.

> **Archiv (Server-Worker, SSH-Rücktunnel, `scripts/server/`):** Server am
> 09.09.2026 gelöscht; Prozeduren in der Versionshistorie (Tag `v1.4.0`) und
> in `docs/archive/plaene-2026-09/STAND-2026-09-15.md` §5.

---

## Inter-Instanz-Protokoll (Pflicht)

An diesem Repo arbeiten parallel mehrere Agent-Instanzen in verschiedenen
Checkouts und Worktrees. Damit keine Instanz von den Änderungen der anderen
überrascht wird, gilt:

### Session-Start (bevor irgendetwas geändert wird)

```
bash scripts/sync.sh start
```

Das Briefing zeigt Branch, `git status`, alle Worktrees, die letzten Commits
über alle Branches und die letzten Journal-Einträge. Ohne Script (manuell):
`STATUS.md` (oberste Einträge) und `STAND.md` lesen, `git status --short`,
`git log --all --oneline -12`, `git worktree list`, Ende von `.pa/ACTIVITY.md`.

### Während der Arbeit

- Wer eine neue Top-Level-Datei oder einen neuen Ordner anlegt, nennt sie/ihn im
  späteren Aktivitäts-Eintrag namentlich.
- Task-Specs und Reports gehören als `task_*.md` / `report_*.md` nach `.pa/`.
- Keine Laufzeit-Artefakte im Repo-Root; was nicht ins Repo gehört, kommt in die
  `.gitignore`.
- Vor größeren Eingriffen `git status` + `.pa/ACTIVITY.md` prüfen, ob eine
  andere Instanz gerade im selben Bereich arbeitet.

### Session-Ende

```
bash scripts/sync.sh note "<instanz>" "<zusammenfassung>" [commits]
```

Der Eintrag landet append-only in `.pa/ACTIVITY.md`; Zeitstempel, Branch und
Uncommitted-Liste ermittelt das Script selbst aus git. Nie uncommittete
Änderungen ohne Eintrag mit Begründung hinterlassen. `STATUS.md` und
`STAND.md` aktualisieren, wenn eine Phase abgeschlossen oder der
Betriebszustand geändert wurde.

Als Sicherheitsnetz schreibt ein Session-Ende-Hook
(`scripts/session-end-hook.sh`) automatisch einen Skelett-Eintrag mit dem
offenen Dateistand — gedebounced auf maximal einen Eintrag pro 30 min. Er
ersetzt die manuelle Zusammenfassung nicht.

---

## Doku-Rollen

| Datei | Rolle |
|---|---|
| `AGENTS.md` | **diese Datei** — die gemeinsame Grundlage für alle Anbieter |
| `STAND.md` | Momentaufnahme: wo genau stehen wir, was ist der nächste Griff |
| `TRIAGE.md` | die offenen Beweise, sortiert nach Schwere, mit Empfehlung |
| `README.md` | Feature-Referenz (Profile, Routing, Ledger, IPC-Contract, `pa`) |
| `STATUS.md` | Chronik abgeschlossener Arbeit auf main (neueste oben) |
| `KNOWN_ISSUES.md` | bewusst offene v1.0.0-Befunde, mit Begründung je Zeile |
| `docs/PLAN.md` | der eine Arbeitsplan (Wellen, Pakete, Entscheidungen); alte Pläne unter `docs/archive/plaene-2026-09/` |
| `.pa/ACTIVITY.md` | versioniertes, append-only Sitzungsjournal (`merge=union`) |
| `docs/dev-hq/README.md` | wie das Live-Dev-HQ gestartet und benutzt wird |
| `docs/dev-hq/BUGS.md` | append-only Bug-Log für Funde im HQ selbst — vor dem Queue-Eintrag ausfüllen |
| `docs/dev-hq/lessons.json` | Gedächtnis bekannter Entwicklungsfehler: Symptom → Ursache → Fix; `npm run hq:lesson` |
| `PRODUCT.md` | **nur Produktwahrheit für Gestaltungsarbeit**: Nutzer, Zweck, Positionierung, Betriebskontext, belegte Grenzen. Liegt laut Werkzeugvorgabe im Wurzelverzeichnis (`impeccable`-Schema). Enthält **keine** Feature-Referenz (→ `README.md`), **keinen** Stand (→ `STAND.md`) und **keine** Arbeitsregeln (→ diese Datei); bei Widerspruch gewinnen jene. |

**Was nur an einem Ort liegt, ist verloren.** Alles Wertvolle gehört ins
Repo, bevor die Maschine verschwindet, auf der es entstand.
