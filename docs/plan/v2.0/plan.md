# Plan v2.0 (Entwurf, der Nutzer entscheidet)

Stand 06.10.2026, Basis `origin/main` 719426c (zuletzt per `git fetch` am 06.10. geprüft). Dieser Entwurf ändert nichts an `docs/PLAN.md` und nichts an v1.6.0 ([`../v1.6.0/plan.md`](../v1.6.0/plan.md)). Er gilt erst, wenn der Nutzer die Fragen in Abschnitt 7 beantwortet hat und dieser PR gemergt ist (Tor G0). Eingaben: die 24 Boards „Glass Leitstand“ (`docs/design/2026-10-ui-v2/glass/`), die Bestandsaufnahme [`inventory.md`](inventory.md) (70 Teile) und die Bewertung des Dev-HQ in [`dev-hq.md`](dev-hq.md). Rechenweg der Größenzahlen: [`size-evidence.md`](size-evidence.md).

Nutzerentscheidungen vom 06.10.2026 (verbindlich): (1) v2.0 ist der Entwurf mit echter Funktion, als **ein** großes Release, keine Zwischenreleases v1.7 bis v1.9; (2) das Fundament startet **parallel** zu v1.6.0, ohne die vier Nahtstellen und ohne Dateien offener PRs; (3) die Paketgrößenregel darf sich ändern; (4) jeder Agent läuft wahlweise auf diesem PC, in der Cloud des Anbieters oder auf einem eigenen Server über SSH.

## 1. Ziel und „fertig“

**Ziel.** Die 24 Bildschirme des Entwurfs sind in der App echt: gleiche Sprache (Glas, hell und dunkel, sechs Zustandsformen, Bewegung), echte Daten aus Rust und SQLite, und hinter jedem Knopf eine Funktion, die ihre Wirkung belegt. Ein Bildschirm mit erfundenen Daten ist nie fertig: Gibt es das Backend noch nicht, zeigt der Bildschirm den ehrlichen Zustand („noch nicht verbunden“, „aus, gesperrt bis …“).

**Fertig ist v2.0, wenn alles gilt (jede Zeile ist ein Befehl oder eine Prüfung mit Beleg):**

| # | Kriterium | Messung |
|---|---|---|
| 1 | 24 von 24 Bildschirmen erreichbar, jeder mit echter Datenquelle | Je Bildschirm ein Test gegen Store oder HTTP-Router, nicht gegen eine Attrappe (Muster: M4-E2E-14, `docs/PLAN.md`); die Tabelle „Datenquelle je Datenblock“ steht im PR des Bildschirms. Gesamtlauf: V2-ACC1 |
| 2 | Aussehen entspricht dem Board | Screenshot 1440×900, hell und dunkel, je Bildschirm angesehen und mit dem Board verglichen (48 Bilder); Abweichungen stehen im PR |
| 3 | Kontrast und Tastatur | `node scripts/contrast-check.mjs` Exit 0 (läuft schon in `npm run build`, `package.json:18`), erweitert auf die neue Tokendatei; je Bildschirm ein Test, dass jedes bedienbare Element per Tab erreichbar ist und der Fokusring sichtbar bleibt |
| 4 | Ein Zustandswörterbuch | `rg -ln -e '--state-' src` trifft nach V2-ACC1 nur noch `src/design/`; keine zweite Definition der sechs Zustände |
| 5 | Zwei Sprachen | Test auf Schlüsselgleichheit de/en, Exit 0; je Bildschirm Screenshot in beiden Sprachen |
| 6 | Not-Aus überall sichtbar | `EmergencyStop` in der Kopfleiste der Schale (heute nur `settings/GeneralTab.tsx:113`); Messung 10 s bleibt (`estop.rs:9`) |
| 7 | Ausführungsort | Ein Agent läuft nachweislich auf dem PC, einer auf dem eigenen Server (SSH) und, soweit der Anbieter einen Cloud-Modus hat, einer in dessen Cloud (Beleg je Ort: Lauf-ID und Ausgabe) |
| 8 | Backend sicher | Jede neue Tabelle hat Migration, Vorab-Sicherung (`store.rs:859`) und roten Test; `bash scripts/ci/gates.sh lane prepush` Exit 0 auf `main` |
| 9 | Dauerbetrieb bleibt, was er ist | Aus, bis der Nutzer ihn selbst einschaltet; kein neuer Selbststart ohne Freigabe (AGENTS.md, „Development loop“) |
| 10 | Fernansicht | Gekoppeltes Gerät sieht den Leitstand, antwortet auf „Braucht dich“ und stoppt; `merge` und `start` liefern 403 (V2-H4) |
| 11 | Release | Installation von v2.0 über den Updater am PC des Nutzers (Drill und Signatur: Nutzer, wie bei v1.5.1) |

**Nicht Teil von v2.0:** ein eingeschalteter Dauerbetrieb, ein Hintergrunddienst bei geschlossener App, Zugang aus dem Internet, Geldausgaben.

## 2. Fundament zuerst (startbar am Tag von G0, keine Nahtstelle)

Warum jetzt: Alle 24 Boards wiederholen denselben Block aus 215 Zeilen (`glass/Main.dc.html:15-229`; `diff` der Zeilen 15–229 gegen alle 24 Boards am 06.10.: keine Abweichung); das Fundament-Paket soll ihn in die App überführen (`glass/README.md:11-13`). Heute hat die App eine Stilsprache in einer Datei: `src/styles.css` (6784 Zeilen, Schrift Inter, `:8`), Hell/Dunkel nur per `prefers-color-scheme` (`styles.css:186,198`), keinen Umschalter und keine Übersetzung (`rg -i "i18n" package.json` leer). Die Zustandsfarben stehen als `--state-*` (`styles.css:156-171`).

**Kein Feature-Schalter fürs Fundament.** Es kommt nur neuer, zunächst ungenutzter Code dazu: Dateien unter `src/design/`, `src/i18n/`, `src/shell/` mit eigenem Namensraum (`--g-*`), ohne `styles.css` zu ändern. `tsconfig.json:16-17` verbietet nur ungenutzte lokale Variablen, nicht ungenutzte Exporte. Sichtbar wird erst V2-F9, und die Bildschirm-Pakete hängen am Schalter aus Frage D1 (Grund: v1.6.0 wird aus `main` gebaut, Abschnitt 5).

| Paket | Inhalt | Quelle im Entwurf |
|---|---|---|
| V2-F1 | Tokens hell/dunkel, zwei Materialien (`chrome`, `glass`), Radien 20/14/10, Schrift Geist selbst eingebunden (Lizenz OFL; die Boards laden von einem fremden Server, das übernehmen wir nicht), Kontrast-Gate erweitert | `Main.dc.html:19-52,65-68` |
| V2-F2 | Bewegung: 120/200/320 ms, `ease-out`, Drücken 0,98, ein Puls für „Läuft“, `prefers-reduced-motion` schaltet alles ab | `Main.dc.html:33-34,217-229` |
| V2-F3 | Sechs Zustandsformen und das Wörterbuch (Wort, Form, Farbe), eine Abbildung von den heutigen Statuswerten (`status.rs`) | `Main.dc.html:185-195,362-367` |
| V2-F4a/b | Atome: Button, Chip, **Filter-Chip mit Zähler** (im Entwurf acht Mal einzeln nachgebaut), **Schalter**, **Auswahl** (`select` und segmentiert), Eingabe, Kbd, Avatar, Lampe, Meter | Zählung der Boards (Klassen `.fbtn`, `.sf`, `.cat`, `.fchip`, `.hf`) |
| V2-F5a/b | Aufbau: **Tabs** (`role=tab`, Pfeiltasten), **Sheet** (Fokusfalle, Esc), Toast, Tabelle, Schlüssel-Wert, Beweis-Chip, `HonestState` (leer, nicht verbunden, gesperrt) | `Kontingente.dc.html:381`, `AgentStarten.dc.html:386` |
| V2-F6 | Deutsch und Englisch: Wörterbuch, Hook, Sprachwahl; ein Test gegen fest verdrahtete Texte in neuem Code | – |
| V2-F7 | Prüfwerkzeug: Screenshot 1440×900 hell/dunkel je Route, Tabulator-Test | Abnahme 2 und 3 |
| V2-F8 | Schale: Seitenleiste, Kopfleiste (Projektwähler, Suche, Quota-Balken, Glocke, Not-Aus), Stopband, Routenregister, Umschalter hell/dunkel/System | `Main.dc.html:280-347` |
| V2-F9 | Einhängen in `src/App.tsx` hinter dem Schalter; alte Ansichten bleiben als Routen, bis ihr Paket sie ersetzt | – |

**Fundament im Backend (seam-frei, ebenfalls ab G0):** V2-B1 bis V2-B5 und V2-B8 bis V2-B14 (Abschnitt 3). Sie liegen in Dateien, die keine Nahtstelle sind (`budget.rs`, `quota.rs`, `preflight.rs`, `worktree.rs`, `learnings.rs`, neue Dateien). Ihre Verdrahtung in `main.rs`, `api.rs` und `store.rs` bündeln die Nahtpakete der Abschnitte 3 und 4.

## 3. Pakete

**Lesehilfe.** Größe: S ≤ 150, M ≤ 300 Diffzeilen mit Tests, nach der heutigen Regel (AGENTS.md, Regel 1); „2×M“ = in zwei Pakete zu schneiden. Stufe nach AGENTS.md, Regel 5. Lane-Schlüssel wie `docs/PLAN.md`; zusätzlich: **fR** seam-freies Rust, **fe** `src/`, **doc**, **ci**. Nahtstellen: `api.rs`, `main.rs`, `store.rs` (mit `store/`), `bin/pa.rs`. Anbieter: Vorschlag nach `docs/setup/providers.md` (Nahtstelle und Security: astra; Rust ohne Naht: sol oder deepseek; Frontend: terra oder glm-5.3; Doku: glm-5.3). Bis Codex wieder verfügbar ist (G2 in v1.6.0, 11.10.2026 laut deren Plan, nicht neu beobachtet), nehmen Naht-Pakete Claude unter 70 % Wochenlimit.

**Standardabnahmen** (jede Zeile unten nennt nur, was dazukommt):
- **R** (Rust): roter Test zuerst (`Test-First: <Pfad>::<Test>`), dann `cargo nextest run --profile ci` Exit 0 und `bash scripts/ci/gates.sh lane prepush` Exit 0.
- **U** (Bildschirm): `npm run build` Exit 0 (enthält den Kontrast-Check), `npx vitest run <Ordner>` Exit 0, ein Test gegen echte Daten (nicht Attrappe), Screenshot 1440×900 hell und dunkel, angesehen und mit dem Board verglichen, Tab-Reihenfolge getestet, beide Sprachen, `prepush` Exit 0.
- **D**: `npm run dev:agent-check` Exit 0.

### 3.1 Fundament (Welle 0)

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme |
|---|---|---|---|---|---|---|---|---|
| V2-F1 | Tokens, Glas, Schrift (`src/design/tokens.css`, `glass.css`) | fe | – | B | M | G0 | terra | `node scripts/contrast-check.mjs` Exit 0 mit den neuen Paaren hell und dunkel (4,5:1); Token-Seite als Screenshot |
| V2-F2 | Bewegung | fe | – | B | S | V2-F1 | glm-5.3 | Test: mit `prefers-reduced-motion` keine Animation; `npm run build` Exit 0 |
| V2-F3 | Sechs Zustände und Wörterbuch | fe | – | B | M | V2-F1 | terra | Test: jeder Statuswert aus `status.rs` hat genau eine Form; Screenshot der sechs Formen mit Wort |
| V2-F4a | Button, Chip, Filter-Chip, Schalter, segmentiert | fe | – | B | M | V2-F1 | terra | Tastaturtest je Baustein; Screenshot |
| V2-F4b | Select, Eingabe, Kbd, Avatar, Lampe, Meter | fe | – | B | M | V2-F4a | terra | wie F4a |
| V2-F5a | Tabs, Sheet, Toast | fe | – | B | M | V2-F4a | terra | Test: Fokusfalle, Esc, Pfeiltasten |
| V2-F5b | Tabelle, Schlüssel-Wert, Beweis-Chip, `HonestState` | fe | – | B | M | V2-F3, V2-F4a | terra | Test: `HonestState` zeigt nie Zahlen |
| V2-F6 | de/en-Wörterbuch, Hook, Sprachwahl (Einstellung über vorhandenes `settings`) | fe | – | B | M | V2-F1 | terra | Schlüsselgleichheit-Test Exit 0; Prüfung gegen fest verdrahtete Texte |
| V2-F7 | Screenshot- und Tabulator-Werkzeug (`scripts/dev/`); ändert `package.json`, daher nach #567 | ci | – | B | M | #567 gemergt | glm-5.3 | `node scripts/dev/shot.mjs --route <r>` erzeugt 4 Bilder (2 Themen × 2 Sprachen); Test mit Fixture |
| V2-F8 | Schale mit Not-Aus in der Kopfleiste | fe | – | B | M | F3, F4a, F5a | terra | U; Test: `EmergencyStop` ist auf jeder Route im DOM |
| V2-F9 | Schale in `App.tsx` einhängen, hinter dem Schalter D1 | fe | – | B | S | V2-F8, D1 | terra | Schalter aus: Bild unverändert (Screenshot-Vergleich gegen `main`); an: Schale sichtbar |
| V2-O0 | `pa-orch` ist nicht im Repo (`ls pa-orch*` leer). Der Koordinator legt `docs/plan/v2.0/pa-orch.md` an: Skripte, Eingaben, Ausgaben, was nach V2-O1 bis O4 wandert | doc | – | C | S | G0, Koordinator | Koordinator | D; jede Funktion aus dem Inventar (Orchestrator, Chief of Staff, Wachhund, Pipeline, Startprüfung, Server-Ort) hat dort eine Zeile |
| V2-LOC-0 | Entscheidungsnotiz Ausführungsort: SSH-Sicherheit (Host-Schlüssel, Tresor-Verweis statt Passwort, kein Agent mit SSH zu fremden Hosts), Rückweg der Ergebnisse (Push und PR), Cloud-Modi je Anbieter (nur beobachtete) | doc | – | C (Berater-Paar) | M | G0 | Fable 5.1 + astra | `docs/decisions.md`-Eintrag; jede Cloud-Aussage mit Befehl und Datum |
| V2-CLI-0 | Welche 10 CLIs (Board `AgentStarten.dc.html:521-548`), welche davon installierbar, Lizenz, beobachteter Aufruf je CLI | doc | – | C | S | G0 | glm-5.3 | Tabelle je CLI: Befehl, Version, Exit; ohne Beobachtung steht „prüfen“ |

### 3.2 Backend-Kerne ohne Nahtstelle (Welle 0 bis 3, je nach Abhängigkeit)

Gemeinsame Regel: Der Kern liegt in einer neuen Datei oder einer Nicht-Naht-Datei und ist ohne Datenbank testbar. Persistenz und Verdrahtung kommen aus den Nahtpaketen 3.3.

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme (zusätzlich zu R) |
|---|---|---|---|---|---|---|---|---|
| V2-B1 | Kontingent-Fenster: 5 h, Woche, **Monat** (heute `Window::FiveHour`/`SevenDay`, `budget.rs:84-87`, kein Monat) und **Entsperr-Probe** (heute nur Zeitablauf, `quota.rs:160`) | fR | – | B | M | G0 | sol | Test: Monatsfenster rechnet; Probe hebt Sperre nur bei beobachtetem Erfolg auf |
| V2-B2 | Failover-Regeln als Sätze (Bedingung → Aktion), Kette über Anbieter ohne Kontowechsel im Gespräch, Pflichtregel „Pause statt Rechnung“ nicht abschaltbar (`fallback: null` in allen 8 Profilen, `src-tauri/resources/agent-defaults.json`) | fR | – | A | M | V2-B1 | astra | Test: Pflichtregel lässt sich nicht deaktivieren; belegt vorher mit `rg -n KIND_API_KEY src-tauri/src`, welche Wege heute einen API-Schlüssel nutzen (Inventar-Aussage „keine API-Schlüssel“ ist falsch, `providers.rs:56`) |
| V2-B3 | Startprüfung: freier RAM, laufende Builds, belegte Naht als Fakten in `preflight.rs` (heute ohne RAM, `preflight.rs:71`) | fR | – | B | M | G0 | sol | Test: unter 1,5 GiB frei → Start abgelehnt mit Grund |
| V2-B4 | Warteschlange mit Vorgängern und Naht-Spur (Logik; heute kennt nur `workers/lane_guard.rs:229` `depends_on`, `task_queue` kein Vorgängerfeld, `store.rs:1533-1544`) | fR | – | A | M | V2-B3 | astra | Test: Auftrag mit offenem Vorgänger startet nicht und nennt den Grund |
| V2-B5 | Ausführungsort: Modell (PC, Cloud, SSH), Auflösung (Vorgabe je Persona, je Projekt, „automatisch“ nach freiem RAM aus V2-B3) | fR | – | A | M | V2-LOC-0 | astra | Test: Auflösungsreihenfolge Start > Persona > Projekt > automatisch; „automatisch“ wählt bei < 1,5 GiB frei den Server |
| V2-B6a | SSH-Anbindung: Host-Schlüssel prüfen, Schlüssel nur als Tresor-Verweis, Verbindung aufbauen, kein Passwort speichern | pty | – | A | M | V2-LOC-0, V2-B5, ST-A2 | astra | zwei Fremd-Reviews; Test: unbekannter Host-Schlüssel → Abbruch |
| V2-B6b | Start auf dem Server (Worktree dort, Ausgabe zurück, Ergebnis über Push und PR), Not-Aus erreicht den Server-Lauf | pty + wk | – | A | M | V2-B6a, MN-A | astra | Beleg: ein echter Lauf auf dem eigenen Server (Lauf-ID), Not-Aus-Messung ≤ 10 s |
| V2-B6c | Cloud-Ausführung je Anbieter, der einen Abo-Cloud-Modus hat (Umfang aus V2-LOC-0) | wk | – | A | M je Anbieter | V2-LOC-0, MN-A | astra | Beleg je Anbieter: Lauf-ID, Ausgabe; ohne Beleg bleibt der Ort im Start-Sheet grau mit „nicht verfügbar“ |
| V2-B8 | Checkpoints nach jedem Agentenschritt (Referenz im Worktree), Diff A/B, **Rückspulen** mit Sicherungsreferenz vorweg | fR | – | A | M | G0 | astra | Test: Rückspulen verliert nie einen ungepushten Commit (Sicherungsreferenz bleibt); `rg -i rewind` ist heute ohne Treffer |
| V2-B9 | Beweis am Commit: Gate-Ergebnis (Lane, Gate, Exit-Code, SHA), Entwertung bei neuem Commit, Risikostufe A/B/C aus Dateipfaden in Rust (Spiegel von `src/lib/reviewClass.ts:14,34`), Block NICHT ABGEDECKT aus dem PR-Text | fR | – | A | M | G0 | astra | Test: neuer Commit macht Beleg ungültig (Vorbild `store/development_runs.rs:207`); Stufe A für jede der vier Nahtdateien |
| V2-B10 | Fremd-Review-Regel für Worker-PRs: Familie je Modell, „kein Modell prüft die eigene Familie“ (Vorbild `store/development_runs.rs:1322`) | fR | – | A | S | V2-B9 | astra | Test: gleiche Familie → abgelehnt |
| V2-B11 | Benachrichtigungs-Kern: Ereignisarten, laut/leise/stumm, Ruhezeit, zwei Pflicht-„laut“ | fR | – | B | S | G0 | sol | Test: Pflichtereignis ist in der Ruhezeit laut |
| V2-B12 | Gedächtnis: Notiz mit Quelle, Prüfdatum, Bestätigung; erneute Prüfung der Belege gegen `main` (Datei:Zeile existiert noch) | fR | – | B | M | G0 | sol | Test: verschobene Zeile → „veraltet“ |
| V2-B13 | Ideen-Triage: Dubletten, Größe, Meilenstein, Prüfstufe stehen vor dem Ticket fest | fR | – | B | M | G0 | sol | Test mit Fixture-Ideen; Antwort eines Modells nur als Vorschlag |
| V2-B14 | Bugs: Zustandsmaschine „kein Fix ohne kompilierenden roten Test mit Exit-Code“; nach drei gescheiterten Versuchen entscheidet der Nutzer; Screenshot-Upload mit Secret-Scan (`scripts/ci/secret-scan.sh`) | fR | – | A | M | G0 | astra | Test: Fix ohne roten Test wird abgelehnt |
| V2-B15 | Trigger-Kern: Cron-Auswertung, Ratenbegrenzung (6/h), Webhook-Signatur mit 24 h Übergang bei Schlüsselwechsel, Testlauf ohne Verbrauch | fR | – | A | M | G0 | astra | Test: gefälschte Signatur → abgelehnt; siebter Lauf in einer Stunde → gedrosselt |
| V2-B16 | Ablauf-Vorlagen: Modell (Schritte, Rolle, Gate, bei Fehler) und Läufer auf der Warteschlange; Start nur auf Befehl des Nutzers | fR | – | A | M | V2-B4 | astra | Test: Gate rot → Schritt-Regel „bei Fehler“ greift |
| V2-B17 | Personas: Rechte, Failover, MCP, Kontext, Autonomiestufe, 14 Vorlagen als Ressource; „ein Agent erweitert seine Rechte nie selbst“ (AGENTS.md) erzwungen (heute `roles.rs`, Rollenvarianten) | fR | – | A | M | G0 | astra | Test: Persona mit mehr Rechten als ihre Abteilung → abgelehnt |
| V2-B18 | Abteilungsregeln erzwingen: Budget, erlaubte CLIs, Autonomie als Grenze beim Start | fR | – | A | M | V2-B17, V2-B1 | astra | Test: Start über Budget oder mit nicht erlaubter CLI → abgelehnt mit Grund |
| V2-B19 | MCP-Register: Server, Team-Rechte, Schlüssel nur als `tresor://`-Verweis, „Mergen über MCP“ gesperrt; MCP je Agent beim Start einhängen (heute `ruflo.rs`, `pty/agent_env.rs`) | pty + fR | – | A | 2×M | G0 | astra | Test: Merge-Recht kann nicht vergeben werden; Klartext-Schlüssel nirgends gespeichert (`rg`) |
| V2-B20 | Verbesserungen: Katalog, Voreinstellungen, Kette global → Projekt → Persona; **nur Schalter mit belegter Wirkung** werden angezeigt | fR | – | B | M | G0 | sol | Test: jeder Schalter im Katalog nennt seine Wirkstelle im Code (`rg`-Beleg); sonst nicht im Katalog |
| V2-B21 | Zeugnis je Modell und Kostenbuch aus `usage_events` (`store.rs:1591-1601`) und Reviews; Verbrauch in Kontingent-Prozent je Lauf | fR | – | B | M | V2-B1 | sol | Test: Zahlen gleichen der Summe der Ereignisse; Schätzwerte sind als „geschätzt“ markiert |
| V2-B22 | Wachhund in der App: fertige und stehengebliebene Läufe erkennen und melden (heute `stuck.rs:117`, Skript `pa-orch/watchdog.sh` nicht prüfbar) | fR | – | B | M | V2-O0 | sol | Test: ein stehengebliebener Lauf erzeugt genau eine Meldung |
| V2-B23 | Grenzen je Job: prüfen, ob #53 nur misst (`resources.rs`) oder durchsetzt; wenn nur gemessen, durchsetzen | fR | – | B | S | G0 | sol | Test: Job über Grenze wird beendet; sonst Bericht „bereits durchgesetzt“ |
| V2-B24 | Sicherung und Umzug: Paket aus Datenbank und Einstellungen (ohne Schlüssel) auf einen anderen Rechner (heute `db_restore.rs`, Backup-Skripte) | fR | – | A | M | G0 | astra | Drill: Export, frischer Ordner, Import, Prüfsumme gleich |
| V2-B25 | Aufzeichnung der Läufe für „Wiederholung“: Schritte (Werkzeug, Terminalausschnitt, Entscheidung, Wachhund) mit Grund | pty | – | A | M | G0 | astra | Test: Wiederholung gibt die aufgezeichneten Schritte in Reihenfolge aus; Secret-Scan über die Aufzeichnung |
| V2-B26 | App-Handbuch für Agenten (aus `resources/skills`), Regeln „Wann was“, Nutzungsprotokoll mit „Verpasst“-Zähler | fR | – | B | M | G0 | sol | Test: Handbuch nennt jeden Befehl, den `pa` kennt (Vergleich mit `pa.rs:36-47`) |
| V2-B27 | Verdiente Autonomie: Zähler sauberer Läufe je Aufgabenart, Obergrenze der Stufe; der Agent kann sie nie selbst erhöhen | fR | – | A | M | V2-B17 | astra | Test: Stufe steigt erst nach 20 sauberen Läufen (Wert aus dem Board `Projekteinstellungen.dc.html`, einstellbar) |
| V2-B28 | Ersteinrichtung: Repo-Scan (Hauptzweig, `gates.sh`, `.mergify.yml`, AGENTS.md, Nahtdateien aus AGENTS.md, RAM) | fR | – | B | S | G0 | sol | Test mit Fixture-Repo |
| V2-CLI-1 | Erste fünf CLIs aus V2-CLI-0 als Profile und PTY-Aufrufe (heute 5 Befehle, `src-tauri/resources/agent-defaults.json:5,21,36,46,76`) | wk | – | B | 2×M | V2-CLI-0 | sol | Beobachteter Aufruf je CLI (Exit, Modellname aus der Ausgabe, Datum) |
| V2-CLI-2 | Zweite fünf CLIs | wk | – | B | 2×M | V2-CLI-1 | sol | wie CLI-1 |
| V2-CTX | Kontextfenster je Modell wählbar (200k/1M), Kostenhinweis bei 1M, „Automatisch verdichten ab“ (heute nur Lesen, `status.rs:3394`) | wk + pty | – | A | M | V2-CLI-1 | astra | Beobachtung je CLI, welche Stufen sie wirklich annimmt; sonst nicht wählbar |
| V2-MQ1 | Merge nur über die Warteschlange: `merge_worker` reiht in Mergify ein statt `gh pr merge --merge` (heute `gh.rs:632-642` ← `workers.rs:1612`; die Aufrufer in `main.rs`/`api.rs`/`pa.rs` bleiben unverändert, daher keine Naht; prüfen) | fR | – | A | M | G0 | astra | roter Test: kein Pfad ruft den direkten Merge; `rg -n "build_pr_merge_args" src-tauri/src` nur noch in der Einreihung; Queue-Lauf am eigenen Test-PR beobachtet |

### 3.3 Nahtpakete (seriell je Naht, Abschnitt 4)

Jedes Bündel hängt am Kern aus 3.2. Die Domänenlogik liegt in neuen Dateien (`api/<name>_routes.rs` nach dem Muster `api/hq_routes.rs`, `store/<name>.rs`); in der Nahtdatei steht nur der Haken. Jede Migration hat einen Eintrag in `MIGRATIONS` (`store.rs:872`) und die Vorab-Sicherung (`store.rs:859`). Bis zum Beleg im Paket gilt „prüfen“, ob ein Haken wirklich genügt.

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme (zusätzlich zu R) |
|---|---|---|---|---|---|---|---|---|
| V2-ST-A1 | Tabellen: Personas, Abteilungen, Teams | st | store | A | M | V2-B17, V2-B18 | astra | Migration von Version n auf n+1 aus einer Kopie der echten Datenbank (Sicherung vorher, Zählung der Zeilen gleich) |
| V2-ST-A2 | Tabellen: MCP-Server und Team-Rechte, Hosts (nur Verweise), Projekt-Richtlinien (Allow/Deny, nur-seriell-Dateien, Autonomie je Aufgabenart) | st | store | A | M | V2-ST-A1, V2-B19 | astra | wie A1; Test: kein Klartext-Schlüssel in einer Spalte |
| V2-ST-A3 | Tabellen: Failover-Regeln; Spalten der Warteschlange für Vorgänger und Naht | st | store | A | M | V2-ST-A2, V2-B2, V2-B4 | astra | wie A1; alte Einträge bleiben lesbar |
| V2-API-A | Routen und Befehle für Bündel A (`api/<name>_routes.rs` + Haken in `api.rs`) | api | api | A | M | V2-ST-A3 | astra | HTTP-Test gegen echten Router + Store je Route; Rechte-Test (403 ohne Recht) |
| V2-MN-A | Tauri-Befehle für Bündel A (`main.rs` + `ApiBackend`, bleibt dort bis nach M4 laut Entscheidung F1 in `docs/PLAN.md`) | mn | main | A | M | V2-ST-A3 | astra | Test je Befehl; `rg -c invoke_handler src-tauri/src/main.rs` bleibt 1 (eine Befehlsliste) |
| V2-ST-B1 | Tabellen: Beweise (Gate-Läufe, Reviews, Entwertung) – prüfen, was `store/development_runs.rs` schon abdeckt, bevor neu gebaut wird | st | store | A | M | V2-B9, V2-B10 | astra | wie A1 |
| V2-ST-B2 | Tabellen: Checkpoints, Lauf-Schritte (Wiederholung) | st | store | A | M | V2-ST-B1, V2-B8, V2-B25 | astra | wie A1; Secret-Scan über Testdaten |
| V2-ST-B3 | Tabellen: Notizen (Gedächtnis) und Lessons, Ideen, Bugs, Entscheidungen | st | store | A | M | V2-ST-B2, V2-B12, V2-B13, V2-B14 | astra | wie A1; `lessons.json` wird einmal migriert (V2-H5) |
| V2-API-B | Routen für Bündel B | api | api | A | M | V2-ST-B3, V2-API-A | astra | wie API-A |
| V2-MN-B | Tauri-Befehle für Bündel B | mn | main | A | M | V2-ST-B3, V2-MN-A | astra | wie MN-A |
| V2-ST-C1 | Tabellen: Trigger und Läufe, Ablauf-Vorlagen und Läufe | st | store | A | M | V2-B15, V2-B16, V2-ST-B3 | astra | wie A1 |
| V2-ST-C2 | Tabellen: Geräte und Kopplung, Benachrichtigungen, Kostenbuch, Verbesserungs-Schalter, Nutzungsprotokoll | st | store | A | M | V2-ST-C1, V2-B11, V2-B20, V2-B21, V2-B26 | astra | wie A1 |
| V2-API-C | Routen für Bündel C inklusive Kopplung und eingeschränkter Rechte (V2-H4) | api | api | A | 2×M | V2-ST-C2, V2-API-B | astra | wie API-A; gekoppeltes Gerät: `merge`, `start` → 403 |
| V2-MN-C | Tauri-Befehle für Bündel C; **Sicherer Start**: nach Neustart bleiben alte Aufträge pausiert (heute `main.rs:295`, Aufruf `:4006`; prüfen, was fehlt) | mn | main | A | M | V2-ST-C2, V2-MN-B | astra | Test: Neustart mit zwei `dispatched`-Einträgen startet keinen Agenten |
| V2-PA-1 | `pa`: sechs Zustände mit denselben Wörtern wie die App; baut auf der Zerlegung ARCH-D6a (#579) auf | pa | pa | A | M | #579 gemergt | astra | Test: `pa`-Ausgabe nennt für jeden Zustand dasselbe Wort wie `src/design/` (gemeinsame Fixture) |
| V2-PA-2 | `pa`-Befehle für die neuen Bereiche (Personas, Orte, Ideen, Bugs, Gedächtnis), damit Agenten sie bedienen können | pa | pa | A | M | V2-PA-1, V2-API-C | astra | Test je Befehl; V2-B26-Handbuch nennt sie |

### 3.4 Bildschirme (je Board; „Daten“ nennt, was echt sein muss)

Größen sind Schätzungen aus den Boardzeilen ohne den gemeinsamen Block (`wc -l`: 471 bis 1527 Zeilen je Board, Summe 14879; abzüglich 24 × 215 ≈ 9700 Zeilen; Umrechnung in Diffzeilen **prüfen**, erst das erste Paket misst sie). Alle Bildschirme: U, hängen am Schalter D1 und an V2-F1 bis V2-F9.

| ID | Bildschirm (Board) | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Daten und zusätzliche Abnahme |
|---|---|---|---|---|---|---|---|---|
| V2-S01a | Leitstand (Main): Karten, Filter, „Braucht dich“ mit Antwort im Stream, Beweis je Karte; ersetzt `BoardView`/`WorkerPanel`-Optik, restylt `QuestionsView` | fe | – | B | 3×M | F9, V2-B9 (Beweis-Chip nur mit Daten, sonst `HonestState`) | terra | `get_board_state` (`main.rs:1720`), `answer_question`; Antwort erreicht das Terminal (Test) |
| V2-S01b | Leitstand, Betrieb: Warteschlange, Startprüfung, Wachhund, Sicherer Start, Grenzen je Job | fe | – | B | M | S01a, MN-A, V2-B3, V2-B4, V2-B22, V2-B23 | terra | Test: Auftrag mit Vorgänger zeigt den Grund |
| V2-S02 | Agent starten (AgentStarten): Persona, Ort, CLI, Modell, Aufwand, MCP, Failover, Startprüfung | fe | – | B | 3×M | MN-A, V2-B5, V2-CLI-1, V2-CTX | terra | Modellname „beim Start beobachtet“ (`status.rs:1888`); Ort grau, wenn nicht verfügbar |
| V2-S03 | Beweise & Merge (Beweise): Kette, Gates je Lane, Fremd-Review, NICHT ABGEDECKT, Queue-Position | fe | – | A | 3×M | MN-B, V2-MQ1, V2-B9, V2-B10 | terra | Beleg am Commit (Test: neuer Commit → „stale“); Knopf „In die Warteschlange“ reiht ein, kein direkter Merge |
| V2-S04 | Aktivität & Wiederholung (Aktivitaet): Protokoll, Schritt-für-Schritt-Wiederholung | fe | – | B | 2×M | MN-B, V2-B25 | terra | Prüfpfad `store/audit.rs:11-13` angezeigt; „Als Lektion merken“ schreibt ins Gedächtnis |
| V2-S05a | Kontingente & Failover (Kontingente): drei Fenster, Probe, Regeln als Sätze, Protokoll | fe | – | B | 2×M | MN-A, V2-B1, V2-B2 | terra | „Jetzt prüfen“ löst die echte Probe aus |
| V2-S05b | Kontingente: Zeugnisse und Kostenbuch | fe | – | B | M | MN-C, V2-B21 | terra | Summe der Zeilen = Summe der Ereignisse |
| V2-S06 | Plan & Entscheidungen (Plan, größtes Board mit 1527 Zeilen): Roadmap, Graph, Board, Charts, Entscheidungen; kritischer Pfad und Vorhersage aus echtem Durchsatz | fe | – | B | 4×M | MN-B, V2-H2 | terra | Quelle `docs/PLAN.md`; Vorhersage nur mit ≥ 4 Wochen Durchsatz, sonst „zu wenig Daten“ |
| V2-S07 | Team-Lauf (TeamLauf): Orchestrator-Chat, Teams, Naht-Spur, Übergaben | fe | – | B | 2×M | V2-O1, V2-O2, V2-O3 | terra | Chat nutzt `CommandChat.tsx:38`; Dauerbetrieb-Zustand ehrlich (Abschnitt 5) |
| V2-S08 | Organigramm | fe | – | B | 2×M | MN-A, V2-B18 | terra | Budgetgrenze wird beim Start durchgesetzt (Test aus B18) |
| V2-S09 | Personas & Vorlagen | fe | – | B | 2×M | MN-A, V2-B17 | terra | Duplizieren und Speichern über Store |
| V2-S10 | Agenten-Generator | fe | – | B | 2×M | V2-S09, V2-CTX | terra | Kostenhinweis bei 1M-Kontext und Schnellmodus nur nach Freigabe; Vorschlag des Orchestrators aus echten Daten |
| V2-S11 | Projektgedächtnis (Gedaechtnis, 1158 Zeilen) | fe | – | B | 4×M | MN-B, V2-B12 | terra | Kontextvorschau mit Token-Budget; Notiz ohne Beleg nicht „bestätigt“ |
| V2-S12 | Ideen | fe | – | B | 2×M | MN-B, V2-B13 | terra | Triage nutzt ein echtes Modell, Antwort als Vorschlag |
| V2-S13 | Bugs | fe | – | B | 2×M | MN-B, V2-B14 | terra | Bug ohne roten Test nicht „in Arbeit“ |
| V2-S14 | MCP-Server | fe | – | B | 2×M | MN-A, V2-B19 | terra | Fehlertext mit Lösung stammt vom echten Start |
| V2-S15 | Trigger & Webhooks | fe | – | B | 2×M | MN-C, V2-B15 | terra | Aktion „Agent starten“ ausgeschaltet, bis der Nutzer den Dauerbetrieb einschaltet (D7); Testlauf verbraucht nichts |
| V2-S16 | Befehle & Automatik: App-Wissen und Befehlspalette (Strg K) | fe | – | B | 2×M | MN-C, V2-B26 | terra | Palette aus echter Befehlsliste; „Verpasst“-Zähler aus Protokoll |
| V2-S17 | Einstellungen (zwölf Abschnitte); Restyle von `SettingsView`; Not-Aus nicht mehr versteckt | fe | – | B | 3×M | F9 | terra | Alle bisherigen Schalter bleiben erreichbar (Liste vorher/nachher); Sprachwahl |
| V2-S18 | Projekteinstellungen: Allow/Deny, nur-seriell, Autonomie, Merge-Modus | fe | – | B | 2×M | MN-A, V2-B27 | terra | „Direkt mergen“ gesperrt und erklärt; Abweichungszähler echt |
| V2-S19 | Ersteinrichtung: sechs Schritte (Restyle von `FirstRunChecklist.tsx`, `BootstrapScreen.tsx`) | fe | – | B | 2×M | F9, V2-B28 | terra | Test mit Fixture-Repo; Abo-Status aus echter Anmeldung |
| V2-S20 | Diff & Rückspulen (Diff): Dateibaum, Zeilenkommentare, Checkpoints, Rückspulen mit Bestätigung | fe | – | A | 3×M | MN-B, V2-B8 | terra | Rückspulen am Testarbeitsbaum, nichts geht verloren |
| V2-S21 | Benachrichtigungen & Handy | fe | – | B | 2×M | MN-C, V2-B11, V2-H4 | terra | Kopplungs-QR echt; Handy-Rechte nur antworten und stoppen |
| V2-S22 | Ablauf-Vorlagen | fe | – | B | 2×M | MN-C, V2-B16 | terra | „Mit Team starten“ reiht ein; Laufstatistik aus echten Läufen |
| V2-S23 | Erweitert · Verbesserungen | fe | – | B | 3×M | MN-C, V2-B20 | terra | Zahl der Schalter = Zahl mit belegter Wirkung (D8) |
| V2-S24 | Systemkarte: erzeugt aus einer maschinenlesbaren Fassung von `inventory.md`; heutiger Entwurf hat von Hand gepflegte Stände | fe + ci | – | B | 2×M | V2-F9 | terra | Test: jede Kachel hat eine Zeile im Inventar; Stand „gebaut“ nur mit Verweis auf ein gemergtes Paket |

### 3.5 Orchestrierung in der App

Heute liegt vieles in `pa-orch` außerhalb des Repos (`ls pa-orch*` leer; nicht prüfbar). Wichtige Grenze: Diese Pakete arbeiten **auf Befehl des Nutzers** („nimm dieses Paket“), nicht als Selbststart. Der Selbststart ist der Dauerbetrieb und bleibt bis zur Freigabe des Nutzers aus.

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme (zusätzlich zu R) |
|---|---|---|---|---|---|---|---|---|
| V2-O1 | Orchestrator: nimmt ein Paket aus dem Plan (V2-H2), prüft die Startprüfung (V2-B3), gibt es einem Agenten (V2-B5 Ort) und beobachtet es; Auftrag nur nach Klick | fR | – | A | 2×M | V2-O0, V2-H2, V2-B4, MN-B | astra | Test: ohne Klick kein Start; Startprüfung rot → Auftrag bleibt mit Grund liegen |
| V2-O2 | Chief of Staff: Übergaben sichtbar, nur wichtige Fragen erreichen den Nutzer (Filter-Regel als Sätze) | fR | – | B | M | V2-O1 | sol | Test: unwichtige Frage wird im Übergabe-Log gesammelt, wichtige als „Braucht dich“ |
| V2-O3 | Drei Teams parallel: Abhängigkeiten und Naht-Spur sichtbar, kein Zombie-Auftrag (nutzt `lane_guard.rs`, B4) | fR | – | A | M | V2-O1, V2-ST-A3 | astra | Test: zwei Aufträge derselben Naht laufen nacheinander |
| V2-O4 | Mergify-Pipeline in der App als **Vorschlag**: CI rot → Fix-Auftrag vorgeschlagen, Konflikt → Merge-Auftrag vorgeschlagen, aus der Queue geworfen → ein Versuch vorgeschlagen; der Nutzer bestätigt (Selbstausführung wäre Dauerbetrieb) | fR | – | A | M | V2-O1, V2-MQ1 | astra | Test: Vorschlag entsteht, nichts startet ohne Bestätigung |

### 3.6 Fernansicht und Dev-HQ

Begründung und Belege: [`dev-hq.md`](dev-hq.md), Abschnitte 3 bis 6.

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme |
|---|---|---|---|---|---|---|---|---|
| V2-H1 | HQ einfrieren, Zuordnung der Ansichten in die README | doc | – | C | S | G0 | glm-5.3 | D |
| V2-H2 | Ein Plan-Parser (Rust) statt zwei; `hq-parse.mjs` entfällt später | fR | – | B | M | G0 | sol | R; Fixture mit allen Meilenstein-Spalten |
| V2-H3 | Browser-Übertragungsweg hinter `ipc.ts` (89 `invoke<`; `SettingsView.tsx` ruft `invoke(` selbst), zweiter Einstieg `remote.html` | fe | – | B | M | V2-F1 | terra | Test: Tauri- und HTTP-Adapter liefern dieselbe Form; `npm run build` Exit 0 |
| V2-H4 | Kopplung (QR) und eingeschränkte Rechte; Control-API-Token bleiben serverseitig | api | api | A | M | V2-H3, V2-ST-C2 | astra | zwei Fremd-Reviews; 403 für `merge` und `start`; Not-Aus über die Fernansicht ≤ 10 s |
| V2-H5 | Lessons im Store (`npm run hq:lesson` bleibt der Befehl) | fR + st | store | A | M | V2-ST-B3 | astra | Migration verlustfrei (Anzahl, Abstimmungen) |
| V2-H6 | Die Rust-Seite liefert die Fernansicht aus (`web_interface.rs`), der Node-Proxy entfällt | mn | main | A | M | V2-H4 | astra | Host-/DNS-Rebinding-Test bleibt grün; `npm run hq:live` nicht mehr nötig |
| V2-H7 | `docs/dev-hq/` entfernen | doc | – | C | S | V2-H2, V2-H5, V2-ACC1, Freigabe des Nutzers | Koordinator | Sicherung vorher; D |

### 3.7 Abschluss

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme |
|---|---|---|---|---|---|---|---|---|
| V2-I18N | Übersetzungsdurchgang: Lücken, Zeichenlängen, Datum und Zahl je Sprache | fe | – | B | 2×M | alle V2-S | glm-5.3 | Kriterium 5 |
| V2-ACC1 | Gesamtabnahme: 24 Bildschirme × 2 Themen × 2 Sprachen, Tabulator, Kontrast, Datenquellen-Test, Gate gegen zweite Zustandsdefinition | fe + ci | – | B | M | alle V2-S | terra | Kriterien 1 bis 6 mit Befehlen im PR |
| V2-RULE1 | AGENTS.md: neue Größenregel (nur nach Freigabe von D3) | doc | – | C | S | D3 | Koordinator | D |
| V2-REL | Release v2.0: Update-Drill, Signatur, Tag, Veröffentlichung | N | – | – | – | V2-ACC1, E3, E14 (offen in `docs/PLAN.md`) | Nutzer | Kriterium 11 |

### 3.8 Abdeckung des Inventars (alle 70 Zeilen)

„Restyle“ heißt: kein eigenes Paket, die Optik kommt mit dem genannten Paket.

| Inventar-Zeile | Paket |
|---|---|
| Leitstand | V2-S01a, V2-S01b |
| Agent starten · Modell & Failover | V2-S02 |
| Beweise & Merge | V2-S03 |
| Kontingente & Failover | V2-S05a |
| Organigramm | V2-S08 |
| Personas & Vorlagen | V2-S09 |
| Team-Lauf · Orchestrator | V2-S07 |
| Projektgedächtnis | V2-S11 |
| Ideen | V2-S12 |
| Bugs | V2-S13 |
| Plan & Entscheidungen | V2-S06, V2-H1 |
| MCP-Server | V2-S14 |
| Agenten-Generator | V2-S10 |
| Trigger & Webhooks | V2-S15 |
| Befehle & Automatik | V2-S16 |
| Einstellungen | V2-S17 |
| Projekteinstellungen | V2-S18 |
| Ersteinrichtung | V2-S19 |
| Diff & Rückspulen | V2-S20 |
| Benachrichtigungen & Handy | V2-S21, V2-H3, V2-H4 |
| Aktivität & Wiederholung | V2-S04 |
| Ablauf-Vorlagen | V2-S22 |
| Sechs Zustände, ein Wörterbuch | V2-F3, V2-PA-1 |
| „Braucht dich“ mit Antwort im Stream | kein Paket, Restyle in V2-S01a (`QuestionsView.tsx:388`, `questions.rs`) |
| Glass, hell und dunkel | V2-F1, V2-F8, V2-ACC1 |
| Deutsch und Englisch | V2-F6, je Bildschirm, V2-I18N |
| Orchestrator | V2-O1 |
| Chief of Staff | V2-O0, V2-O2 |
| Abteilungsregeln | V2-B18, V2-S08 |
| Drei Teams parallel | V2-O3 |
| Personas als Rollen | V2-B17, V2-ST-A1 (heute gibt es Rollenvarianten, `roles.rs`, `store.rs:1569`; das Inventar sagt „ohne Rollen“) |
| Trigger und Abläufe | V2-B15, V2-B16, V2-ST-C1 |
| Warteschlange | V2-B4, V2-ST-A3 |
| Verdiente Autonomie | V2-B27 (die Regel steht nicht in AGENTS.md; `rg -i autonom AGENTS.md` leer) |
| Dauerbetrieb | kein Paket: „geplant“ in `docs/PLAN.md` (W4-03); Bildschirme zeigen den ehrlichen Zustand |
| Wachhund | V2-B22, V2-O0 |
| Agent im Worktree | kein Paket (gebaut: `workers.rs`, `TerminalView.tsx`), Restyle in V2-S01a |
| CLI-Anbieter | V2-CLI-0, V2-CLI-1, V2-CLI-2 |
| Failover-Kette | V2-B2 |
| Kontingente | V2-B1 |
| Nur Abos | V2-B2 (Pflichtregel); Inventar-Angabe „Tresor, keine API-Schlüssel“ ist falsch, `providers.rs:56` kennt `KIND_API_KEY` |
| Startprüfung | V2-B3 |
| MCP-Anbindung | V2-B19, V2-ST-A2 |
| Gedächtnis | V2-B12, V2-ST-B3 |
| Grenzen je Job | V2-B23 (W2-08b ist gemergt, #53, `docs/PLAN.md:152`; das Inventar sagt „geplant“) |
| Server-Ort | V2-LOC-0, V2-B5, V2-B6a, V2-B6b |
| Gates | kein Paket (gebaut: `scripts/ci/gates.sh`), angezeigt in V2-S03 |
| Fremd-Review | V2-B10 |
| Merge-Queue | V2-MQ1 (Anker im Inventar `gh.rs:429` ist falsch: dort steht `build_pr_create_args`; der Merge ist `gh.rs:444` und `:632`; `KI-29` meint den OmniRoute-Sync, `KNOWN_ISSUES.md:45`) |
| Risikostufe | V2-B9 |
| Beleg am Commit | V2-B9, V2-ST-B1 (das Datenmodell gibt es schon teilweise: `store/development_runs.rs:207`) |
| NICHT ABGEDECKT | V2-B9, V2-S03 |
| red-first | V2-B14, V2-S13 |
| Not-Aus in 10 s | V2-F8 (Frist ist gebaut: `estop.rs:9`, W5-04b ✓ #125), V2-H4 (Fernstopp) |
| Mergify-Pipeline | V2-O4 |
| Sicherer Start | V2-MN-C |
| Signierter Installer | kein Paket: W3-07 und E14 liegen beim Nutzer (`docs/PLAN.md`); V2-REL hängt daran |
| SQLite-Store | die Bündel V2-ST-A1 bis V2-ST-C2 |
| Plan als Quelle | V2-H2, V2-S06 |
| Lessons | V2-H5, V2-S11 |
| Prüfpfad | kein Paket: gebaut (W5-05 ✓ #44, `store/audit.rs:11-13`), angezeigt in V2-S04 |
| Anbieter-Zeugnisse | V2-B21, V2-S05b |
| Kostenbuch | V2-B21, V2-ST-C2, V2-S05b |
| Sicherung & Umzug | V2-B24 |
| Lizenz | kein Paket: MIT liegt vor (`LICENSE:1`); offen ist E16 (Nutzer) |
| Erweitert · Verbesserungen | V2-B20, V2-S23 |
| Kontextfenster je Modell | V2-CTX |
| App-Wissen der Agenten | V2-B26, V2-S16, V2-PA-2 |
| Bewegung | V2-F2 |
| Ausführungsort je Agent | V2-LOC-0, V2-B5, V2-B6a/b/c, V2-S02, V2-S09, V2-S18 |

## 4. Wellen und Tore

Tore: **G0** = der Nutzer gibt den Plan frei (Fragen D1 bis D3) und dieser PR ist gemergt. **G-F** = V2-F1 bis V2-F5b gemergt: Bildschirme dürfen starten. **G-A/B/C** = das jeweilige Nahtbündel gemergt. **G-REL** = V2-ACC1 grün und der Nutzer gibt frei.

| Welle | Start | Läuft gleichzeitig | Plätze (Server 8: höchstens 4 Naht, mindestens 4 Füllung/Review; PC höchstens 2 Builds) |
|---|---|---|---|
| W0 Fundament | G0 | F1 → (F2, F3, F4a → F4b, F5a → F5b, F6) → F7 (nach #567) → F8 → F9; B1, B3, B8, B9, B11 bis B14, B20, B23, B28, H1, H2, V2-O0, LOC-0, CLI-0 | alles ohne Nahtstelle; Rust: 1 bis 2 Builds, Frontend ohne Cargo |
| W1 Bündel A | G0, Nahtplätze nach 4.1 | Kerne B2, B4, B5, B17, B18, B19, B27 (fR), dann `ST-A1 → A2 → A3`, danach `API-A` ‖ `MN-A` | 1 Naht-Paket je Naht |
| W2 Bildschirme A | G-F und G-A | S01a, S01b, S02, S05a, S08, S09, S14, S17, S18, S19, S24; CLI-1 → CLI-2, CTX; MQ1; B6a → B6b, B6c | bis 6 Frontend-Pakete parallel (Dateien trennen: ein Ordner je Bildschirm; `App.tsx` nur F9 und die Routenregister) |
| W3 Bündel B | G-A | Kerne B9, B10, B21, B22, B24, B25, B26, O1 bis O4; `ST-B1 → B2 → B3`, `API-B` ‖ `MN-B`, V2-H3, V2-H5 | wie W1 |
| W3 Bildschirme B | G-B | S03, S04, S06, S07, S10, S11, S12, S13, S20 | wie W2 |
| W4 Bündel C | G-B | `ST-C1 → C2`, `API-C`, `MN-C`, PA-1 → PA-2, H4 → H6 | wie W1 |
| W4 Bildschirme C | G-C | S05b, S15, S16, S21, S22, S23 | wie W2 |
| W5 Abschluss | alle S gemergt | V2-I18N, V2-ACC1, V2-RULE1, V2-H7 (nach Freigabe), V2-REL (Nutzer) | – |

Regeln wie in v1.6.0, Abschnitt 4: Nähte strikt seriell; Pakete derselben Datei laufen nacheinander (neue Dev-Skripte ändern `package.json`: FLOW-05 #567 hält sie heute); keine Datei eines offenen PRs; Reviews A zwei Anbieter, B einer.

### 4.1 Nahtstellen und v1.6.0 (Stand `gh pr list` vom 06.10.2026)

| Naht | Heute belegt durch | Weitere v1.6.0-Pakete (Plan, Abschnitt 3) | v2.0-Pakete in dieser Spur | Länge der Spur |
|---|---|---|---|---|
| `store.rs` | #577 ARCH-D3a (offen) | D3b → D7 (nach G2) | ST-A1, A2, A3, B1, B2, B3, C1, C2, H5 | 3 + 9 = 12 |
| `bin/pa.rs` | #579 ARCH-D6a (offen) | D6b | PA-1, PA-2 | 2 + 2 = 4 |
| `api.rs` | frei (#578 INV-SEC-CRED-CLEANUP berührt `api.rs` nicht, `gh pr list --json files`) | ARCH-D1 → D4a → D4b | API-A, B, C (C = 2×M), H4 | 3 + 5 = 8 |
| `main.rs` | frei | V16-06 → D2 → D5a → D5b → D8a | MN-A, B, C, H6 | 5 + 4 = 9 |

Befund: Die längste Spur ist `store.rs` mit 12 seriellen Paketen, danach `main.rs` mit 9. Das Fundament (Abschnitt 2) ist davon unabhängig. **Vorschlag (Frage D2):** je Naht abwechselnd, ein v1.6.0-Paket, dann ein v2.0-Paket, ab dem nächsten freien Platz; ein bereits offenes Paket läuft zu Ende. So bleibt jede Spur in beiden Plänen in Bewegung, und die Architektur-Pakete (D-Pakete) machen die Nahtdateien kleiner, bevor v2.0 sie größer macht. Keine Tageszusage: Die Messung der Nahtpakete (Median 185 Diffzeilen, `size-evidence.md`) sagt nichts über die Wartezeit in der Spur.

## 5. Kritischer Pfad und Risiken

**Kritischer Pfad.** G0 → Kerne (W0) → `store.rs`-Spur (12 Pakete) → `MN-C` → Bildschirme C → V2-ACC1 → V2-REL. Der zweite Pfad ist die Frontend-Kette F1 → F9 → alle Bildschirme (24 Bildschirme, geschätzt 60 Pakete nach der heutigen Größenregel, Abschnitt 6).

**Risiken.**
- **v1.6.0 wird aus `main` gebaut.** Alles, was bis dahin auf `main` landet, steckt im v1.6.0-Build. Das Fundament ist unsichtbar (nur neue, ungenutzte Dateien); Bildschirme und die Schale hängen am Laufzeitschalter D1, Standard aus. Ohne D1 würde v1.6.0 halb die neue Oberfläche ausliefern.
- **Dauerbetrieb bleibt aus.** Die Bildschirme, die davon abhängen, zeigen den ehrlichen Zustand statt einer Attrappe: Team-Lauf (Übergaben „von Hand ausgelöst“), Trigger (Aktion „Agent starten“ gesperrt), Orchestrator-Pakete (nur nach Klick), Mergify-Pipeline (nur Vorschlag), Leitstand („Dauerbetrieb: aus, gesperrt bis zur Freigabe“). Der Zustand kommt aus `capabilities.continuousScheduler` (`main.rs:2909`, heute `false`). Die Einfrierung gilt laut AGENTS.md bis M4; ob `docs/PLAN.md` und `STAND.md` den Stand nach v1.5.1 schon abbilden, ist **prüfen** (`gh release list` zeigt v1.5.1 als Latest, 06.10.2026 00:00 UTC; `docs/PLAN.md` führt W4-04 noch als „offen“).
- **Zwei Stilsprachen während der Umstellung.** `styles.css` hat 6784 Zeilen; die neuen Bausteine nutzen einen eigenen Namensraum, die alte Datei wird nicht umgebaut, sondern nach V2-ACC1 geleert (Paket folgt dann, Größe unbekannt, **prüfen**).
- **Die Boards sind nicht renderbar** (Vorlagensyntax, die Laufzeit liegt nicht im Repo) und alle Daten darin sind Beispiele (`glass/README.md:13`). Der Vergleich mit dem Board braucht ein Bild je Board. Das ist eine Mitwirkung des Nutzers (unten), kein Paket.
- **Inventar enthält Fehler** (in den Abschnitten oben korrigiert): Anker `gh.rs:429`; KI-28 und KI-29; „Nur Abos“; „Personas ohne Rollen“; „Prüfpfad“, „Grenzen je Job“ und „Not-Aus-Frist“ sind schon gebaut; „Lizenz fehlt“ stimmt nicht (MIT); Kontingente kennen keine Fenster in `quota.rs`, sondern in `budget.rs`. Jedes Paket prüft seinen Anker vor dem Start.
- **Capacity bis G2.** Naht-Pakete laufen bis dahin nur über Claude unter 70 % Wochenlimit (`docs/setup/providers.md`); die Zahl der Stufe-A-Pakete in W1 ist größer als das, was dieses Limit trägt (Zahl nicht gemessen).
- **`pa-orch` ist nicht prüfbar.** V2-O0 liefert die Funktionsliste; vorher sind V2-O1 bis O4 und V2-B22 nicht startbar.
- **Cloud-Ort ist unbelegt.** Welcher Anbieter einen Abo-Cloud-Modus hat, ist nicht beobachtet; V2-LOC-0 entscheidet. Server-Ort: SSH ist heute für Agenten gesperrt (`pty/agent_env.rs:195`, `protocol.ssh.allow=never`); ob diese Sperre den Git-Weg betrifft und die Anbindung nicht, klärt V2-LOC-0.
- **Hintergrund-Trigger widersprechen dem Einfrieren,** wenn sie Agenten starten (D7).
- **32 Schalter sind kein Ziel.** Ein Schalter ohne Wirkung ist eine Attrappe (D8).
- **Schriften:** Geist ist OFL (erlaubt); die Boards laden sie von einem fremden Server, die App bindet sie selbst ein (V2-F1).
- **Echte Proben verbrauchen Abo-Kontingent** (CLI-Beobachtung, Cloud-Lauf); erlaubt sind sie laut N2 in `docs/PLAN.md`.
- **Widersprüche in den Boards:** Der Chief of Staff läuft mit Kimi K3 (`Organigramm.dc.html:388`, Kimi CLI) oder Claude Sonnet 5.5 (`Ersteinrichtung.dc.html:356`); das Modell kommt aus der Persona, nicht aus dem Bild.
- **Sechs Zustände reichen nicht für alles:** Warten, Blockiert, Pausiert haben keine Form (D4).

**Mitwirkung des Nutzers ohne Entscheidung:** je Board ein Bild hell und dunkel (48 Bilder) als Vergleichsbasis; ein eigener Server für V2-B6b (kein Kauf durch Agenten); der PC für Update-Drill und V2-REL.

## 6. Vorschlag: Paketgrößenregel

**Heute** (AGENTS.md, Regel 1): höchstens 300 Diffzeilen einschließlich Tests, für alle Pakete gleich.

**Befund.** Rechenweg, Befehle und Grenzen: [`size-evidence.md`](size-evidence.md). Stichprobe: 301 gemergte PRs vom 25.09. bis 05.10.2026 (10 Tage), dazu 28 ohne Merge geschlossene (240 Queue-Entwürfe ausgenommen).

| Größe (Diffzeilen, roh) | gemergt | Folge-Fix binnen 72 h (streng) | ohne Merge geschlossen | Median offen → Merge | p90 |
|---|---|---|---|---|---|
| ≤ 150 | 168 | 4 (2 %) | 12 (7 %) | 1,1 h | 3,0 h |
| 151–300 | 84 | 0 | 6 (7 %) | 1,2 h | 3,0 h |
| 301–600 | 27 | 0 | 7 (21 %) | 1,5 h | 32,3 h (netto 5,5 h) |
| 601–1200 | 4 | 0 | 0 | 0,9 h | 4,3 h |
| > 1200 | 18 | 1 | 3 (14 %) | 4,1 h | 140 h |

| Typ | gemergt | Folge-Fix (streng) | ohne Merge geschlossen |
|---|---|---|---|
| nur Doku | 53 | 4 | 0 |
| Frontend (`src/`) | 40 | 0 | 6 |
| Rust | 120 | 0 | 12 |
| Rust + Frontend | 7 | 0 | 3 |
| `scripts/` und `.github/` | 77 | 1 | 5 |

**Was die Zahlen sagen und was nicht.**
- 84 % der PRs halten die 300 schon ein (Median 124 Zeilen). Die Regel bremst heute wenig.
- Zwischen ≤ 300 und 301–600 gibt es **keinen belegten Qualitätsunterschied**, aber auch keinen Beleg dagegen: Folge-Fixes sind selten (fünf Fälle: #463, #284, #266, #208, #38), der Bereich 301–600 hat 27 PRs, 601–1200 nur 4. Aus fünf Fällen lässt sich kein Größeneffekt ablesen.
- Das Schließen ohne Merge liegt bei 301–600 höher (21 % von 7 Fällen gegenüber 7 %): ein Hinweis, kein Beweis.
- Die Wartezeit hängt kaum an der Größe (Median rund 1 h über alle Stufen); die Ausreißer im p90 sind große Importe und erzeugte Dateien.
- **Nicht gemessen:** Review-Runden je PR (ein API-Aufruf je PR; nicht ausgeführt), rote Queue-Läufe je Größe (der `ci`-Workflow zeigt kein Ereignis `merge_group`, die Queue läuft über Zweige `mergify/merge-queue/*`), Seam-PRs getrennt nach Größe (63 Seam-PRs, Median 185 Zeilen, keine Auffälligkeit).
- Die breite Suche nach „Fix-PRs“ (Titel mit fix, gemeinsame Datei) trifft 49 bis 64 % und ist unbrauchbar; verwendet ist nur die strenge Zuordnung (Paket-ID oder Branch-Stamm), die eine Untergrenze liefert.

**Vorschlag.** Größe nach Art und Stufe, gemessen **netto** (ohne erzeugte Dateien: `docs/dev-hq/data.*`, Lockfiles, `*.snap`, Fixtures; Verschiebungen zählen einfach):

| Art | Grenze (netto, mit Tests) | Begründung |
|---|---|---|
| Nahtstelle, Sicherheit, PTY, Datenbank (Stufe A) | 300, wie heute | Zwei Fremd-Reviews je Paket; der Seam-Median liegt mit 185 darunter; hier hilft Kleinheit der Prüfung |
| Rust und Skripte ohne Naht (Stufe B) | 400 | Kein Beleg für Nachteile oberhalb 300; kleine Lockerung |
| Nur Frontend (`src/`, keine Naht, Stufe B) | 600 | Ein Bildschirm ist ein Stück (Board 471 bis 1527 Zeilen); Schnitte durch ein Bild erzeugen halbe Oberflächen; Frontend hatte in der Stichprobe 0 Folge-Fixes bei 40 PRs |
| Doku, Tests, Snapshots, Konfiguration ohne Laufzeitwirkung (Stufe C) | keine Zeilengrenze; lesbar bleiben (Plan < 600 Zeilen) | Prüfung sind die Gates |

Mit der Frontend-Grenze 600 sinkt die geschätzte Zahl der Bildschirm-Pakete von 60 (Summe der `×M`-Faktoren in 3.4, 26 Zeilen) auf etwa 30 (Hälfte, aufgerundet je Bildschirm). Das ist eine Schätzung; das erste Paket misst die tatsächliche Umrechnung von Boardzeilen in Diffzeilen.

**Absicherung.** Probe über zwei Wochen, gemessen durch `node scripts/dev/bench-weekly.mjs` (BENCH-01): Steigt der Anteil der Fix-PRs binnen 72 h bei den größeren Paketen über 8 % (Ziel aus v1.6.0, Abschnitt 7a), kehrt die Regel zurück. Jedes Paket über der Grenze braucht einen Satz „Warum nicht geteilt“ im PR. Die Änderung selbst ist **nicht** in diesem PR: Sie wird das Paket V2-RULE1, das erst nach Freigabe von D3 startet.

## 7. Entscheidungs-Inbox (bündeln, mit Empfehlung)

Die E-Nummern vergibt der Koordinator beim Eintrag in `docs/PLAN.md`. Dieser Plan kostet kein Geld und löscht nichts.

| # | Frage | Empfehlung |
|---|---|---|
| D1 | Die neue Oberfläche kommt hinter einen Laufzeitschalter „Neue Oberfläche (Vorschau)“, Standard **aus**, bis v2.0. Sonst enthält v1.6.0, das aus `main` gebaut wird, eine halbe neue Oberfläche. Annahme dabei: v1.6.0 wird wie geplant veröffentlicht, danach gibt es bis v2.0 keine v1.x-Funktionsreleases. | Ja. Der Schalter fällt mit v2.0 weg (Paket in V2-ACC1). |
| D2 | Nahtspuren abwechselnd: ein v1.6.0-Paket, dann ein v2.0-Paket (Abschnitt 4.1)? | Ja. Sonst wartet v2.0 hinter 5 `main.rs`- und 3 `store.rs`-Paketen von v1.6.0. |
| D3 | Neue Größenregel nach Abschnitt 6 (Stufe A 300, B 400, nur Frontend 600, jeweils netto) als Zwei-Wochen-Probe? | Ja, mit Rückkehr bei > 8 % Fix-PRs. Die AGENTS.md-Änderung folgt erst danach (V2-RULE1). |
| D4 | Warten, Blockiert, Pausiert haben im Entwurf keine Form (Abschnitt 5 in `dev-hq.md`). Eine siebte Form oder nur Text? | Nur Text in grauer Schrift, keine siebte Form in v2.0. |
| D5 | Reichweite der Fernansicht: nur eigenes Netz oder SSH-Tunnel, oder auch aus dem Internet? | Nur eigenes Netz und SSH-Tunnel. Internet bräuchte eigene Sicherheitsprüfung und gehört nicht zu v2.0. |
| D6 | Die Richtung „HQ als Hauptbereich mit Studio-Layout“ (E1, HQ2-02, `docs/PLAN.md:495`) wird durch die Glass-Boards ersetzt; das Studio-Konzept wird nach v2.0 entfernt. | Ja. |
| D7 | Trigger und Webhooks starten in v2.0 nur Meldungen und Testläufe; die Aktion „Agent starten“ bleibt aus, bis du den Dauerbetrieb einschaltest. Kein Hintergrunddienst bei geschlossener App. | Ja. Ein Dienst bei geschlossenem Fenster wäre Dauerbetrieb und eine Installation (Sache des Nutzers). |
| D8 | „Verbesserungen“ zeigt nur Schalter, deren Wirkung im Code belegt ist; die Zahl 32 ist kein Ziel. | Ja. |

Schon offen und Voraussetzung für V2-REL: E3 (Secrets in geschützte Umgebungen), E14 (Sicherung des Schlüssels, dringend), E16 (Lizenzmodell vor externen Nutzern). Sie stehen in `docs/PLAN.md` und werden hier nicht neu gefragt.

## 8. NICHT ABGEDECKT

- Kein Build, kein Test, keine App wurde gestartet; die Zeilennummern gelten an der Basis 719426c.
- Die Boards wurden als Text gelesen, nicht gerendert; Zahlen und Namen in ihnen sind Beispieldaten.
- Die Größenschätzungen der Bildschirme (Abschnitt 3.4, 6) sind nicht gemessen.
- Anbieter, Modelle und Limits sind Vorschläge nach `docs/setup/providers.md`, nicht beobachtet.
- `pa-orch` ist nicht im Repo und wurde nicht gelesen.
- Review-Runden und rote Queue-Läufe je PR-Größe sind nicht gemessen (Abschnitt 6).
- Die Windows-Hälfte der späteren Pakete ist hier nicht Gegenstand; sie läuft in der Merge-Queue.
- Fremdkritik durch eine andere Modellfamilie: siehe Prompt-Log im PR-Text.
