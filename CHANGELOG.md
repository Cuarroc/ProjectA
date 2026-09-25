# Changelog

## v1.4.1 — 2026-09-22

> **Updater-Hinweis:** Der Minisign-Signierschluessel der v1.x-Reihe war nicht
> mehr auffindbar und wurde rotiert. Installationen von v1.4.0 koennen deshalb
> **nicht automatisch** auf v1.4.1 updaten — einmalige manuelle Installation
> des v1.4.1-Installers noetig (Bruecke, wie bei v1.2.1); ab v1.4.1 arbeitet
> der Updater wieder selbststaendig.

Die Integrationswelle vom 22.09.: neun gemergte PRs aus der Arbeitswoche,
dazu Dependencies und die W1-02-Buchhaltung. Keine Datenbank-Migration.

**Worker-Zustellung (Ende der manuellen Assists):**

- **Claude-Adapter vollautomatisch** (PR #49): Trust-Dialoge werden durch
  den PTY-Launch-Pfad beantwortet, ConPTY-Cursorabfragen auch ohne
  Terminal-Tab, Claude-Smoke-Lauf ohne einzigen manuellen Eingriff.
- **Kimi-Zustellung (PR #50):** Headless gestartete Worker erhalten eine
  Cursor-Positionsantwort und koennen ihren Auftrag ohne Terminal-Tab
  annehmen. Nach erkanntem Prompt-Echo wartet Enter jetzt bei **allen
  Providern** auf 1 Sekunde Ruhe, maximal 5 Sekunden; damit wird Enter nicht
  mehr in Kimi-Paste-Redraws als Zeilenumbruch verschluckt.
- **OpenCode-Zustellung belegt** (PR #66): isolierte PTY-Probe durch den
  Guard-Zyklus ohne manuelle Zustellung (Echo ~200 ms, selbststaendige
  Dateischreibung, $0.00-Anzeige); neuer manueller Capture-Harness
  `capture_opencode_output`. Hinweis: belegt auf der OpenCode-Default-Route,
  der DeepSeek-Worker-Adapter bleibt W2-09b.

**Skills und Schnittstellen:**

- **Skills-Konvention `ConventionAt`** (PR #57): Runner, die Skills anderswo
  erwarten (`.agents/skills` bei Codex/OpenCode), bekommen ihre Packs an den
  richtigen Ort; Windows-Junction-Ausbrueche werden abgewehrt, ein verweigerter
  Pfad hinterlaesst kein leeres Tempverzeichnis mehr.
- **Empfehlungsstatus sagt, wessen Fehler es war** (PR #64, ersetzt #58):
  `recommendations/<id>/status` unterscheidet 400/404/500 statt pauschal 400,
  ungueltige Eingaben erreichen den Store gar nicht erst.
- **ui-ux-pro-max Skill-Pack + Accessibility-Runde** (PR #45): achtes
  gebündeltes Pack, dazu 43 Audit-Befunde an App und Dev-HQ umgesetzt —
  Tastaturpfade, Fokusringe, Live-Regionen, Roving-Tabindex, Inline-Formulare,
  36 harte Farbtints auf State-Tokens (Kontrast-Gate deckt sie jetzt ab).

**Sicherheit:**

- **F-SEC-9/3/4** (PR #56): `resets_at` wird geclampt, Marker werden gefaltet
  geprueft, Vault-Keys gehen nur an den verifizierten Router.
- **OmniRoute-Key-Push entfernt** (PR #62): Provider-Keys werden nicht mehr
  zum Router gepusht.

**Hygiene:**

- **Dependencies** (PR #65): jsdom 30.1.0 und die all-actions-Pins,
  Lockfile-Delta explizit geprueft.
- **Windows-Recovery-Abnahme** (PR #55): 20/20 Lastlaeufe unter gemessener
  CPU-Volllast gruen.

Seit `v1.4.0` (Tag auf `7fdf192`) auf `main` gemergt; Hashes am 17.09.2026
gegen `git log --oneline 7fdf192..origin/main` verifiziert. Kein Release,
keine Datenbank-Migration.

- **Dev-HQ-Einrichtung, Updates, Queue-Skript, Ollama-Coder** (PR #43,
  Merge `cea7dbe`, 16.09.):
  - **Setup-Doctor meldete auf CRLF-Checkouts einen falschen
    Manifest-Mismatch** (`cbb280a`): der Node-Doctor hashte die Rohbytes,
    die Rust-Seite CRLF-normalisiert; jetzt hashen beide gleich, roter Test
    `scripts/lib/dev-runtime-crlf.test.mjs`.
  - **`npm run hq:queue-open-points`** (`bfdeb2d`): reiht die konsolidierten
    offenen Punkte aus `.pa/report_devhq_setup_2026-09-15.md` §4a als echte
    Fix-Tasks in die Queue der laufenden App ein (Vorschau ohne, Schreiben
    mit `--apply`; idempotent, erfindet ohne laufende App nichts).
  - **Profil `ollama-coder`** (`2f0f887`): Coding-Modell
    `qwen3-coder:480b-cloud` über Ollama Cloud als ausgeliefertes Profil.
    Nur Helper — Worker-Zustellung über dieses Profil ist nicht belegt.
  - **Minor-/Patch-Updates npm und cargo** (`9ce8396`), dabei
    `@xterm/addon-webgl` auf 0.18.0 gepinnt (das Paar zu xterm 5.5) und das
    xterm-Paar aus Dependabot herausgenommen, Entscheidung in
    `docs/decisions.md` (`f73d6a5`).
  - Doku: Setup-Bericht, Konsolidierung der offenen Punkte, STAND-Nachtrag
    und Übergabenotiz (`5fbef6e`, `ebce46d`).
- **Ein Arbeitsplan `docs/PLAN.md`** (PR #44, Merge `db89ee2`, 15.09.):
  ersetzt Sanierungsplan Rev 9 und alle früheren Plan-/Spec-Papiere, die
  unter `docs/archive/plaene-2026-09/` archiviert sind; STAND.md
  verschlankt (`5860fc3`). Nebenbei **Clippy-Fix** `nonminimal_bool` an zwei
  Bool-Ausdrücken (`b729c82`).
- **W0-Entscheidungen vom 16.09. in `docs/PLAN.md`** (PR #46, Merge
  `449b9fa`; `0d274f2`): Claude-Zugang über das CLI-Abo, PR #38/#39
  weiterführen, Dependabot-Regel, Zombie-Queue verwerfen,
  Scout-Recommendations als W1-21…23.
- Doku direkt nach dem Release (`f7a0156`, `c1d2b27`): Release v1.4.0 in
  STAND/ACTIVITY festgehalten, Top-Level-Doku auf v1.4.0 gebracht.
### Noch nicht auf `main` (offene PRs)

Beschrieben, damit der Eintrag beim Merge nur noch nach oben wandert; bis
dahin nicht ausgeliefert.

PR #49 (`claude/focused-lewin-dd87dd`, Merge nach PR #50):

- **Claude Code kommt als Worker an:** kopflose Sitzungen (per `pa` ohne
  offenen Terminal-Tab) beantworten die ConPTY-Cursorabfrage jetzt selbst,
  statt auf xterm.js zu warten — Claude Code 2.1.266 zeichnete sonst nie.
- **Claudes Trust-Dialog** (steht seit 2.1.266 auf „No, exit") wird gestuft
  beantwortet: erst der Cursor auf „Yes, I trust this folder", Enter nur bei
  sichtbarem Selektor — nie mehr ein Enter, das den Agenten beendet.
- **Zustell-Wächter liest Ink-Ausgabe richtig:** Cursorbewegungen zählen als
  Wortlücke, damit Dialog- und Bereitschaftsmarker matchen.
- **Claude-Profil trägt seinen Bereitschaftsmarker** (`❯ Try "`, aus einem
  echten Mitschnitt), der Wächter tippt nicht mehr in die Stille vor dem
  Raw-Modus. Beleg: `.pa/report_provider_adapter_smoke_claude.md`.

## v1.4.0 — 2026-09-15

Continuous-DevHQ-Integration (150 Commits vom Arbeitsbranch): die Maschinen-
Schnittstelle HQ v1 läuft produktiv in der App (`pa hq runtime/context`,
fünf Tabs im Dev-HQ), und die native Windows-Paketierung prüft signierte
Host-Ressourcen vor dem Bundling.

**Diese Version migriert die Datenbank bis Schema 19.** Beim ersten Start
wird migriert; ein Backup entsteht davor automatisch (`.pre-migration-*.bak`).
Auf echten Bestandsdaten ab Version 1.2.x verifiziert.

- **Aufgaben kommen bei Codex bewiesen an:** der Zustell-Wächter beantwortet
  Codex' Start-Kette (Ordner-Vertrauen, Hooks-Review) selbst, mit gestufter
  Antwort — ein Enter erst, wenn der Selektor sichtbar auf der sicheren
  Option steht. Der Preis-Hinweis (Credits/Luna Reserve) bleibt bewusst
  manuell. Kimi/OpenCode liefern weiter halb-/manuell (ehrlich dokumentiert).
- **Terminal-Ansicht stürzt nicht mehr ab** beim Öffnen laufender Worker
  (xterm/addon-webgl auf die zu xterm 5.5 passende Version 0.18 gepinnt).
- **Weniger Fehlalarme unter Last:** Windows-Dateiersatz im Recovery-Journal
  wiederholt begrenzt bei vorübergehenden Zugriffssperren (Indexer/AV).
- **Update-Pakete:** der Release-Builder verlangt die signierten
  Host-Manifeste neben allen Programmen; die MSI-Inventur prüft App, CLI und
  Capture-Host nebeneinander.
- Continuous Mode bleibt abgeschaltet (fail-closed), bis seine
  Abnahme-Bohrungen belegt sind.

**Gefixte Bugs** (alle Fix-Commits des Intervalls v1.3.0..v1.4.0, gruppiert;
Duplikate zu einem Bullet mit finalem Hash zusammengefasst):

Agenten-Zustellung und Terminal:
- **Codex-Zustellung über den echten Startpfad** (`a7c262c`): der
  Zustell-Wächter beantwortet Codex' aufgezeichnete Start-Kette
  (Ordner-Vertrauen, Hooks-Review) positionsbasiert; das Codex-Profil trägt
  den aufgezeichneten Bereitschaftsmarker; die native Route behält den
  inerten Marker, statt das Profil abzulehnen. Der Preis-Hinweis bleibt
  bewusst manuell. Enthält auch den Terminal-Absturz-Fix:
  `@xterm/addon-webgl` auf 0.18 gepinnt (das Paar zu xterm 5.5) plus
  gemeinsamer Renderer-Dispose — die Terminal-Ansicht stürzte beim Öffnen
  laufender Worker ab.
- **Hooks-Review-Antwort gestuft hinter Selektor-Beleg** (`bd0af1c`): ein
  blindes Down-Down-Enter gegen das sich selbst aktualisierende CLI-Menü
  riskierte, auf „Trust all and continue" zu landen — genau die Option, die
  nie automatisch beantwortet werden sollte. Jetzt bewegt der Cursor nur,
  bis der Selektor sichtbar auf „3. Continue without trusting" ruht; ein
  umsortiertes Menü bekommt kein Enter und eskaliert. Aus demselben Review
  (GLM, Ollama-Cloud k3): TDZ-Fehler im Terminal-Renderer behoben (Variable
  vor der Context-Loss-Closure deklariert) und der native_route-Fehlertext
  nennt jetzt alle abgelehnten Einstellungen.
- **Kimi-Composer-Echo** (`f0e851b`): Kimis Composer klappt lange
  Einfügungen ein („↑ 17 more"); nur das Tail der Eingabe erreicht den
  PTY-Strom, das längste Zeilenfragment lag im verborgenen Bereich, und der
  Guard schrieb bis zu 3× neu, bevor er eskalierte. Das Echo akzeptiert
  jetzt auch das sichtbar gequetschte Fragment der letzten nicht-leeren
  Zeile; die Rewrite-Behandlung greift weiter, wenn keines von beiden
  sichtbar ist. Ehrlich: Teilfix — der Re-Smoke danach blieb negativ
  (Beleg in `ac340dd`), die Kimi-Automatisierung ist weiter offen.

Stabilität, Sessions, Recovery:
- **Recovery-Journal: transienter Zugriff verweigert** (`f8f48ac`):
  MoveFileExW auf eine frisch geschriebene Temp-Datei scheitert unter
  Windows kurzfristig, solange Indexer/AV sie halten (os error 5, am
  2026-09-14 dreimal unter paralleler Testlast beobachtet). Zugriffs- und
  Sharing-Fehler werden jetzt in einem begrenzten 500-ms-Budget wiederholt;
  andere Fehler scheitern sofort. Beleg: zwei volle Suite-Läufe
  hintereinander, 1188+79+51+1 Tests, null Fehler.
- **Recovery: Datenbanken überleben einen fehlgeschlagenen Dateiersatz**
  (`1002fd5`).
- **Updater: Installation atomar gegen laufende Sitzungen** (`0e23e2f`):
  die Sitzungszulassung wird vor der Installation atomar geschlossen, der
  Download läuft über das Backend, Settings über den bewachten Command;
  direkte Installations-Rechte entfernt. Dazu (`a71d38d`): ausstehendes und
  unsicheres Inventar bleibt für die Update-Guards erhalten.
- **Sessions: zwei Ownership-Races geschlossen** — Inventar-Freigabe erst
  nach Reader-Ruhestand (`76579e0`) und Ownership bis zum Ende der
  Exit-Buchführung (`2649e34`); beide verhindern, dass Installation/Updates
  gegen noch lebende Sessions laufen.
- **Capture** (`51dda8b`): unaufgelöstes Writer-Cleanup nach einem Timeout
  bleibt erhalten statt als Zustellfehler gezählt zu werden. (`6c42613`):
  operative und diagnostische Timeout-Grenzen getrennt.
- **Workers** (`97814ae`): die vorbereitete Invocation wird vor dem Spawn an
  die dauerhafte Route gebunden — eine zwischenzeitlich geänderte
  Invocation wird abgelehnt.
- **Evidence-Probes** (`cd86b2d`, `f20b864`): Git-Sonden liefen im
  gemeinsamen Tokio-Blocking-Pool und blieben unter fremder Last stehen;
  jetzt eigene, permit-begrenzte OS-Thread-Lane, fern des Async-Reaktors.

DevHQ / Continuous:
- **Schreibtransaktion vor Zustandslesung** (`1ddfb83`), **Capture-Identität
  bei der Usage-Abrechnung erneut geprüft** (`1f1a68c`), **gemeinsame
  Worker-Claim-Kapazität erzwungen** (`0b233b7`), **kompilierte
  Profil-Defaults mit Laufzeit-Herkunft geteilt** (`733e787`),
  **Readiness-Diagnosen dedupliziert** (`9c0b3b1`), **Setup erkennt eine
  veraltete HQ-Startanleitung** (`8039e5d`).

Verpackung und Release:
- **MSI-Inventur** (`d29e61c`): nicht jede CLI-Binary landete im Paket; der
  Builder verlangt und prüft jetzt App, CLI und Capture-Host nebeneinander.
- **Signatur-Skript nannte die Dirty-Pfade nicht** (`68d0c03`, `cae70ee`):
  der Installer-Job auf dem neuen Runner-Image scheiterte blind; die
  Verweigerung listet jetzt zuerst die betroffenen Pfade — auch nach dem
  unsignierten Build.
- **CRLF in Cargo-Manifesten** (`88652b6`): die Tauri-CLI normalisierte
  Manifeste auf CRLF und machte den Checkout damit „dirty";
  `.gitattributes` pinnt jetzt `eol=lf`, damit der Build sauber bleibt.
- **Mirror-Promote ohne `--latest`** (`cc11238`): das promotete
  Mirror-Release blieb unmarkiert, `releases/latest` zeigte weiter auf
  v1.3.0 — der Updater fand das neue Paket nicht.

CI und Test-Flakes:
- **CI** (`b9d826f`): modulqualifizierte Rust-Test-Trailer wurden nicht
  aufgelöst. (`1b33ffe`): lange Test-Logs werden jetzt vor der
  Ergebnis-Klassifizierung geleert.
- **Flakes** (`837b508`, `7fdf192`): Journal-Zeitstempel-Race; ein
  Sekundensprung in `sourceTimestamp` liess die No-Writes-Zusicherung
  sporadisch rot werden — die Beobachtungsuhr wird nicht mehr verglichen.

Betrieb: Cargo.lock-Sync auf 1.4.0 (`1449d6e`, mechanisch — der
Version-Bump liess den Lock auf 1.3.0, jeder Cargo-Aufruf auf dem
Release-Runner schrieb ihn um, und der signierte Builder lehnte den
„dirty checkout" korrekt ab; gefunden durch die neue Dirty-Pfad-Diagnose).


## v1.3.0 — 2026-09-09

Minor-Release: die Sanierung Rev 9 wird sichtbar. Aufgaben kommen jetzt
bewiesen beim Agenten an statt blind ins Terminal geschrieben zu werden,
Tests laufen im wegwerfbaren Merge-Kandidaten statt im Arbeitsbaum, und die
Freigabe eines Kartenstands ist an einen belegten Testlauf gebunden.

**Diese Version bringt Schema-Migration 3.** Beim ersten Start wird die
Datenbank migriert; ein Backup entsteht davor automatisch
(`.pre-migration-*.bak`). Ein Rückweg auf v1.2.4 braucht dieses Backup.

- **Zustellung an Agenten (F-CORE-3):** Aufgaben, Fragen-Antworten und
  `worker send` gehen jetzt durch einen Zustell-Wächter. Er wartet auf den
  Bereitschaftsmarker des Profils, schreibt, prüft das Echo und drückt Enter
  mit Wiederholungen. Erst wenn die Zustellung belegt ist, erscheint die
  Nachricht im Verlauf — vorher wurde sie sofort protokolliert, auch wenn
  sie in einem Dialog oder einem beschäftigten Prompt versickert war.
  Scheitert die Zustellung, bleibt der Text als Systemnotiz mit dem
  konkreten nächsten Schritt stehen statt zu verschwinden.
- **Geändertes Sendeverhalten:** `pa worker send` und die Sende-Route der API
  melden Erfolg, sobald der Wächter übernommen hat — nicht mehr, sobald
  getippt wurde. Ob der Text ankam, steht danach im Verlauf des Workers.
  Der bisherige Status „task delivery confirmed" entfällt: bestätigen kann
  ihn erst der Antwort-Marker, der noch nicht verdrahtet ist.
- **Isolierter Merge-Kandidat (F4):** Tests vor einem Merge laufen in einem
  wegwerfbaren Kandidatenbaum, nicht im Arbeitsbaum des Workers. Die
  Freigabe bindet die geprüften Objekt-IDs, den Merge-Baum und den gelesenen
  Diff — ein nachträglich geänderter Baum verliert seine Freigabe.
- **Freigabe braucht Beleg:** Desktop-Verdict und Testgate schreiben den
  Testnachweis in die Datenbank; „bereit zum Mergen" ist ohne ihn nicht
  erreichbar.
- **Sicherheit:** Hook-Einstellungen liegen jetzt unter den App-Daten statt
  im Temp-Verzeichnis, mit engen Rechten und Eigentümerprüfung (F-SEC-8);
  der PLAYBOOK-Spiegel folgt keinen vorplatzierten Symlinks mehr (F-SEC-7);
  die geteilte Leseschicht der drei HTTP-Server hat eine Gesamt-Frist und
  kann nicht mehr durch tröpfelnde Anfragen belegt werden (F-SEC-1). Der
  Review-Workflow lässt sich nicht mehr per Push auslösen — das war ein
  Exfiltrationspfad für den OpenRouter-Schlüssel.
- **Sitzungspuffer:** Composer-Entwürfe können verschlüsselt überleben; ein
  geleertes Eingabefeld löscht den Entwurf, damit ein Neustart keine
  gesendete Nachricht wiederbelebt. Belegt ist außerdem, dass ein
  unterbrochener Dispatch keine Aufgabe doppelt startet.
- **Ehrliche Fehlertexte:** `stats --range` nennt in CLI, API und
  Tauri-Command alle sechs akzeptierten Werte — `7d` und `30d` wurden
  angenommen, aber verschwiegen.
- **Dev-HQ:** ein aus `STAND.md` erzeugtes Lagebild unter `docs/dev-hq`
  (Paket-DAG, Beweismatrix, Zeitachse) für die Arbeit am Projekt selbst.
- **Betrieb:** Git-Hooks werden auf ihr Ausführbar-Bit geprüft, nicht nur auf
  den Hook-Pfad — vorher liefen sie bei niemandem, ohne dass es auffiel.

**Gefixte Bugs** (Fix-Commits des Intervalls v1.2.4..v1.3.0; die oben
beschriebenen Bausteine sind hier mit ihren Hashes nachgezogen):

- **Zustell-Wächter (F-CORE-3):** Baustein A — Submit-Guard mit
  Write-Baseline und bestätigter Zustellung (`6400088`); Baustein B.1 —
  Fragen-Antworten durch den Guard (`dd17309`); Baustein B.2 —
  `send_to_worker` stellt durch den Guard zu, Event-Texte nach Fortschritt,
  Eskalations-Auffangnetz (`ae9ce71`). Blocker aus dem Dual-Review:
  C-01/C-02 — Sweep-Antworten durch den Guard, Write-Fallback im Trait
  (`26abfac`); C-1 — ein ruhender Prompt gilt als Bereitschaft (`7c77028`);
  C-2 — MSG_USER erscheint erst hinter bewiesener Zustellung (`56edf48`);
  C-6 — Baseline-Slice klemmt kontrolliert, statt im Guard-Thread zu
  panicken (`55c6be7`); B.2-Auflagen — stats-range-Geschwister und ein
  geschluckter Store-Fehler (`b5d9cc9`).
- **stats --range Fehlertext** (`8d8c29f`, Geschwister-Fix in API/main
  `db3005b`): CLI, API und Tauri-Command nennen jetzt alle sechs
  akzeptierten Werte — `7d`/`30d` wurden angenommen, aber verschwiegen.
- **Review-Workflow als Exfiltrationspfad** (`f4bdaba`): der Workflow liess
  sich per Push auslösen und hätte so den OPENROUTER_KEY exfiltrieren
  können; Push-Trigger entfernt. Zwei Folgebefunde: auch das Entfernen der
  Auftragsdatei startete den Workflow — jetzt Tor vor dem Auftrag
  (`bcc18a0`); und der Workflow startete sich beim Branch-Neuaufbau selbst
  — Auslöserdatei entfernt, Original-Protokolle zurück (`f6a984e`).
- **Testgate/Setupgate** (`0aeca7e`): die Prozessgruppen-Zusicherung wartet
  den Zustandswechsel ab, statt ihn einmal zu behaupten.
- **Pre-Merge-Audit** (`1df023a`): drei Befunde behoben — maskierter
  Exit-Code, blindes Spec-Gate, Nachweis über null Läufe.
- **Linux-Build** (`3f84e08`): `raw` war nur unter cfg(windows) benutzt;
  auf Linux brach der Build mit `-D warnings`.
- **pre-push-Hook** (`ab724fa`): die Cargo-Tests erbten das GIT_DIR des
  Hooks und liefen dadurch gegen das falsche Repository.
- **API** (`f53d4ad`): die Projekt-Registrierung verlangt jetzt ein
  Verdict.
- **Git-Hooks** (`62214c8`, `5d5505f`): pre-commit/pre-push waren nicht
  ausführbar und liefen bei niemandem; install-hooks und sync.sh prüfen
  jetzt das Ausführbar-Bit, nicht nur den Hook-Pfad.
- **PLAYBOOK-Spiegel (F-SEC-7)** (`f4bff6f`): folgt keinen vorplatzierten
  Symlinks mehr.
- Dev-HQ-Werkzeug (projektintern): Parser- und Darstellungsbefunde im
  HQ-Generator behoben (`a0703ba`, `d759094`, `88c989c`, `1ca1aef`,
  `fe164c1`).

## v1.2.4 — 2026-09-02

- **Updater ohne GitHub-Token:** Der Updates-Tab und die manuelle Pruefung funktionieren ueber den oeffentlichen Mirror auch ohne gespeichertes GitHub-Token; ein altes Legacy-Token wird entfernt (`2798b56`).
- **Betriebsdiagnose:** Rotierende Laufzeit-Logs unter `<app data>/logs/projecta.log` und ein persistenter Panic-Marker machen einen früheren Absturz in Log/stderr nachvollziehbar; der sichtbare In-App-Hinweis folgt mit Diagnostics (`cffc16e`: Review-Auflagen — Panic-Hook verkettet statt ersetzt, Log-Rotation ueberlebt Fehler, Marker-Rotation idempotent, Start ohne Log-Verzeichnis).
- **Sichere externe Links:** PR- und Markdown-Links werden ueber das Tauri-Opener-Plugin im Standardbrowser geoeffnet. Eine explizite CSP und die neue Plugin-Matrix dokumentieren und testen die erlaubten Grenzen (`bcc663e`, `423d4ce`).
- **OpenCode-Zustellung (NT-17):** Aufgaben werden erst geschrieben, wenn der profilspezifische Bereitschaftsmarker sichtbar ist. Blosse Terminal-Stille gilt nicht mehr als Bereitschaft; der bestehende 30-Sekunden-Fallback bleibt erhalten (`50623fe`).
- **Abhaengigkeiten:** xterm-Addons und die verwendeten GitHub Actions wurden innerhalb der erlaubten Major-Versionen aktualisiert.
- **CI:** YAML-Syntax des `on`-Blocks im WIF-Workflow gefixt (`push:`/`workflow_dispatch:` als Mapping-Keys) (`57a6e29`).

## v1.2.3 — 2026-09-01

- **NT-3/B-2 (Auto-Zustellung):** Der Submit-Guard behauptete „submitted" ohne Wirkung — Aufgaben an Worker und Nachrichten an den Orchestrator kamen nicht an, jeder Start verlangte manuelles Enter. Jetzt wird die Wirkung geprueft: der Task wird ohne Enter geschrieben, die TUI muss ihn **sichtbar echoen** (sonst wird er komplett neu geschrieben, bis zu 3×), Enter reist als eigener Tastendruck, und erst wenn danach Output erscheint, gilt die Zustellung als bestaetigt („task delivery confirmed"). Eine ladende TUI verlaengert das Echo-Warten (bis 120 s), statt Text zu verlieren. (Fix `d723b34`, Merge `6165a53`)
- **Workspace-Trust-Dialoge:** Der Claude-Trust-Dialog („Yes, I trust this folder") und der kimi-Erststart-Dialog werden erkannt und automatisch bestaetigt — frische Workspaces blockieren Worker und Orchestrator nicht mehr. (Nur vor der Zustellung, mit Wiederholungs-Deckel, damit Marker-Woerter im Agent-Output keine Tastendruecke ausloesen.)
- **Orchestrator-Chat:** Nachrichten an den Orchestrator laufen durch dieselbe gepruefte Zustellung wie Worker-Tasks (B-2).

## v1.2.2 — 2026-09-01

- **NT-1 (Merge-Deadlock):** Ein archivierter Worker kann per Spalten-Pin zurück nach „Ready to merge" und ist damit wieder mergbar — bisher verlangte der Merge-Dialog „archive it first", das Archivieren entfernte aber jeden Merge-Pfad (der manuelle Override schlägt jetzt `archived` in der Spaltenableitung; der Fehlertext nennt den nächsten Schritt). Regressionstests: `status::tests::an_override_beats_archived_so_the_card_can_be_moved_back_to_merge`, `workers::tests::an_archived_worker_pinned_back_to_ready_to_merge_can_be_merged`
- **NT-2 (Sidebar-Layout):** Die Sidebar scrollt bei Platzmangel, statt Sektionen übereinander zu malen (`overflow-y: auto`); Sektionen behalten ihre natürliche Höhe (`flex-shrink: 0`); die bewusst quetschbaren Sektionen (Warteschlange, Empfehlungen) scrollen intern, statt Inhalt über die nächste Sektion zu malen — „Archive" bleibt bei jeder Fensterhöhe erreichbar. Regressionstest: `src/sidebar-layout.test.ts` (3 Assertions). Fix-Commit für beide Befunde: `1804914`

## v1.2.1 - 2026-08-31

- Updater-Kanal repariert: oeffentliches Mirror-Repo ProjectA-updates + anonymes CI-Verify-Gate (Fix: "Could not fetch a valid release JSON"); einmal manuell installieren — v1.1.1/v1.2.0 retten sich nicht selbst (Fixes: `151c73e` Mirror-Kanal, `967fcf0` Release-Manifest-CI)


## v1.2.0 - 2026-08-31

- Phase 1: 55 Beweise gefixt, Retention, DPAPI-Vault, HTTP-Haertung, S2

## v1.2.0 — 2026-08-31

Minor-Release: **Phase 1 des Sanierungsplans** — alle 55 bewiesenen Fehler der
letzten Audit-Runde behoben, die wichtigsten Sicherheitsgrenzen halten jetzt
nachweisbar (736 Rust-Tests, 43 Frontend-Tests).

- **Sicherheit:** Playbook-Verdict kann nicht mehr durch Agenten-Text umgangen
  werden; Budget-Selbstauskunft eines Workers kann echte Auslastung nicht mehr
  verstecken; Provider-Keys reisen nicht mehr lesbar in der Kommandozeile;
  Hook-Secrets aus kryptografischem Zufall; Vault verschlüsselt (DPAPI) mit
  atomaren Writes
- **Datenintegrität:** Retention — Status-/Usage-Events nach 90 Tagen gelöscht,
  Nachrichten nach 180 Tagen als Markdown archiviert (App-Data) bevor sie
  gelöscht werden; Merge nach Absturz nimmt sicher wieder auf (kein doppelter
  PR/Merge); Queue-Claims können nicht mehr doppelt laufen
- **Zuverlässigkeit:** Agenten, die beim Start sofort sterben, bleiben nicht
  mehr als „running" stehen; UI zeigt Fehler als Fehler statt als „leer";
  HTTP-Server mit Verbindungslimit, Größenlimits und Timeout-Härtung
- **Frontend:** 25 Fehler der „behauptet, was es nicht weiß"-Familie behoben

**Gefixte Bugs** (Auswahl der 55 Beweise mit Hashes; die vollständige
Beweismatrix liegt in den Triage-Reports unter `.pa/`):

- **Spawn-Bind-Race (S2)** (`1e007cc`): ein Agent, der Millisekunden nach
  dem Spawn exitete, blieb ewig „running" — der Exit-Hook fand keinen
  Worker, weil die Session-Bindung erst nach dem zurückgekehrten Spawn
  lief.
- **Respawn holte tote Karten zurück** (`88c66ad`): ein Agent, der während
  des Respawns exitete, wurde vom Exit-Hook auf „exited" gesetzt und danach
  bedingungslos wieder auf „running" geholt.
- **Merge nach Absturz verkeilt** (`df0c1f1`): `merge_worker` war nicht
  idempotent — ein Crash nach dem Merge liess den Worker auf „ready to
  merge" mit bereits gemergter Branch zurück; der nächste Aufruf scheiterte
  am zweiten `gh pr create`. Jetzt idempotenter Zustandsautomat.
- **Claim-Recovery attribuierte fremde Tasks** (`5c14b88`): ein verwaister
  Queue-Claim wurde dem ältesten laufenden Kind-Worker zugeschlagen — auch
  handgestarteten mit fremdem Task (stiller Arbeitsverlust); Attribution
  nur noch bei Task-Übereinstimmung.
- **PTY-Child-Leak u.a. (S13)** (`ec31114`): ein Fehler nach dem Spawn
  returnierte ohne kill/wait — ein laufender Agent ohne Kontrolle; dazu
  Reverse-Map, Exit-Wait, Token-Timing.
- **HTTP-Härtung der drei Server** (`3534a19`): Verbindungs-Semaphor
  (64 pro Server, Überschuss bekommt ein schnelles 503), Head-/Body-Limits,
  Content-Length-Desync geschlossen.
- **Vault** (`69d28a8`): Provider-Keys jetzt DPAPI-verschlüsselt
  (Legacy-Klartext wird beim nächsten Schreiben migriert), atomare Writes;
  eine korrupte Vault meldet vault_corrupt/vault_decrypt_failed/
  vault_unreadable, statt still zu versagen.
- **Plattform (P-1/P-3/P-4/P-6)** (`b2ec4d6`): Shim-Parser plattformfest
  testbar, COMSPEC- und Rechte-Routing, Worktree-Parent.
- **Frontend-Familien** (front-a `6d1ca17`, front-b `9cbe250`,
  restclaims/restfront `8fd5a90`): Behauptungen erst nach Antwort, Fehler
  nicht mehr als Leerzustand, leere Behauptungen hinter Ladegates.
- **Updater (E2E-Befunde):** fehlende `allow-download-and-install`-Capability
  (`35445c8`); der Install-Guard mass DB-Status statt Live-Sessions und
  hätte Updates nach einem App-Neustart dauerhaft blockiert (`ef0b746`);
  privates Repo funktionsfähig — `browser_download_url` liefert 404 trotz
  Token, Manifest und Assets jetzt über api.github.com mit octet-stream
  (`c67e3a1`).
- **Triage-Kern** (`0c922cc`): 14 rote Beweise zu Sicherheitsgrenzen und
  „fremden Zahlen" grün gedreht.

## v1.1.1 - 2026-08-31

- Auto-Updater End-to-End-Nachweis

## v1.1.0 — 2026-08-31

Minor-Release: Sicherheitsnetz (Phase A) + Sofort-Fixes (Phase 0) des
Sanierungsplans. Erste Version mit **Auto-Updater** — spätere Updates
kommen über Settings → Updates direkt in der App an.

- **Auto-Updater:** signierte Updates aus GitHub-Releases (privates Repo,
  Token in Settings hinterlegt). Installation nur, wenn keine Worker laufen
- **Migrations-Vertrag für die Datenbank:** versionierte, transaktionale
  Schema-Schritte mit automatischem Backup vor jeder Migration
- **Crash-Fix Web-Interface:** `percent_decode` panikte bei Multibyte-URLs
  (unauthentifiziert erreichbar) — Implementierung dedupliziert
- **Error Boundaries:** ein Render-Fehler reißt nicht mehr die ganze App
  in den weißen Bildschirm (App-weit + pro Ansicht)
- **Robustere Ansichten:** Statistik/Aktivität ignorieren verspätete
  Antworten nach Rang-/Projektwechsel
- **Kleinreparaturen:** defekter Farb-Token in eigenen Chat-Nachrichten,
  totes PR-Titel-Feld entfernt, Merge-Gate-Warnhinweis, Orchestrator-Stopp
  funktioniert jetzt, Spinner respektiert reduced-motion
- **Betrieb:** CI auf push/PR, wöchentlicher Dependency-Audit, ESLint-Gate,
  DB-Backup-Skript mit Restore-Probe, OmniRoute bindet Loopback

## v1.0.1 — 2026-08-30

Patch-Release. Das erste Release, das den Konsolenfenster-Fix (`proc.rs`,
B-1) enthält — er landete nach dem v1.0.0-Tag und war in keinem
Installationspaket.

- **Keine aufblitzenden Konsolenfenster mehr:** alle Kindprozesse laufen
  durch `proc::command` (`CREATE_NO_WINDOW`, per Quellscan-Test erzwungen)
- **Timeout besitzt den ganzen Prozessbaum:** Windows-Job-Objekte
  (`ProcessTree`) statt `taskkill /T` — der zuvor rote Testgate-Test ist grün
- **`max_workers = 0` schaltet den Dispatcher** eines Projekts aus
  (KI-4 behoben)
- **BootstrapScreen:** die App rendert erst, wenn die Projektliste geladen
  ist — keine Reads mit veralteter Projekt-Id mehr
- `.pa/ACTIVITY.md` ist versioniert (`merge=union`)

## v1.0.0 — 2026-08-28

Erstes Release. ProjectA ist ein agentisches Terminal: eine Tauri-2-
Desktop-App, die eine Flotte paralleler CLI-Coding-Agenten (`claude`,
`kimi`, `codex`, `opencode`, `ollama`) nebeneinander betreibt — ein
Task ist ein Agent in einem Git-Worktree.

### Terminal & Fleet
- PTY-Sessions (ConPTY), xterm.js-Tabs und -Splits
- Projekte, Worker, Git-Worktree-Isolation, SQLite-Persistenz
- Status-Engine (Hooks > Terminal-Heuristik > `gh`), Kanban-Board,
  Agenten-Hierarchie (Queen/Employees), Aktivitäts-Feed

### Orchestrierung
- Token-geschützte Control-API + `pa`-CLI, Task-Queue mit Dispatcher
- Command-Chat zum Orchestrator, Entscheidungs-Tab: Agenten stellen
  blockierende Fragen (`pa ask`), Antworten gehen in die Agent-PTY;
  `answeredBy` unterscheidet Mensch von Unverifiziertem
- Merge/Push-Pipeline mit Gates, PR via `gh` oder lokaler Merge
- Scout-Agent, Empfehlungen, Test-Gates, Remote-Board fürs Handy

### Prompting & Lernen
- Prompt-Master mit dialogischer Schärfung: unklare Aufgaben erzeugen
  Rückfragen statt Vermutungen, Antworten fließen in den finalen Prompt
- Skill-Packs pro Projekt
- Lernschleife: Critic, menschlich reviewte Learnings, Playbook-
  Injektion; adaptive Rollen mit menschlicher Freigabe (Verdict-Token)

### Provider & Kosten
- Provider-Registry mit Key-Vault, GitHub-Anbindung
- OmniRoute-Integration: Routing über Profil-`env`, Quota-Telemetrie,
  Free-Tier-Failover (ToS-Whitelist), Usage-Ledger mit Kostenanzeige
- Budget-Stopps pro Profil, Stuck-Diagnose, Daily Digest
- Statistik-Tab: Projekt-Kennzahlen, Sessions, Aktivitäts-Verlauf,
  dokumentierte Fertigstellungs-Schätzung; Token-Zahlen aus dem
  Usage-Ledger, ehrlich als „nicht gemessen" markiert, wo keine Quelle ist

### UI
- Konversations-Hauptfläche (Variante B), Board als Rail
- Diff-View mit Zeilen-Kommentaren zurück in die Agent-PTY
- Design-Studio, lokales Web-Interface (127.0.0.1, Token-Gate)

Bekannte offene Punkte: siehe `KNOWN_ISSUES.md`.
