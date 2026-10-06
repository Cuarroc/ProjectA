# Plan v2.0 (Entwurf, der Nutzer entscheidet)

Stand 06.10.2026, Basis `origin/main` 01a0bf7 (`git fetch` am 06.10.; Zeilennummern im Text galten an 719426c und wurden nur dort neu geprüft, wo es unten steht). Dieser Entwurf ändert nichts an `docs/PLAN.md` und nichts an v1.6.0 ([`../v1.6.0/plan.md`](../v1.6.0/plan.md)). Er gilt erst, wenn der Nutzer die Fragen in Abschnitt 7 beantwortet hat und dieser PR gemergt ist (Tor G0). Eingaben: die 24 Boards „Glass Leitstand“ (`docs/design/2026-10-ui-v2/glass/`), die Bestandsaufnahme [`inventory.md`](inventory.md) (70 Teile), die Bewertung des Dev-HQ in [`dev-hq.md`](dev-hq.md). Anhänge: [`core.md`](core.md) (die App-KI), [`mapping.md`](mapping.md) (Zuordnung aller offenen Pakete), [`evidence-r2.md`](evidence-r2.md) (Belege der 36 Ergänzungen), [`size-evidence.md`](size-evidence.md) (Rechenweg der Größenzahlen). **Runde 2 (06.10.):** Core, Ausführung, 36 Ergänzungen, ein einziges Plandokument.

Nutzerentscheidungen vom 06.10.2026 (verbindlich): (1) v2.0 ist der Entwurf mit echter Funktion, als **ein** großes Release, keine Zwischenreleases v1.7 bis v1.9; (2) das Fundament startet **parallel** zu v1.6.0, ohne die vier Nahtstellen und ohne Dateien offener PRs; (3) die Paketgrößenregel darf sich ändern; (4) jeder Agent läuft wahlweise auf diesem PC, in der Cloud des Anbieters oder auf einem eigenen Server über SSH; (5) v2.0 bekommt **eine** App-KI mit Rechten, den Core ([`core.md`](core.md)); (6) die Ausführung läuft in AgentsRoom ohne Leerlauf (Abschnitt 4a); (7) alle 36 Ergänzungen sind aufgenommen, und dieser Plan wird nach der Freigabe das **einzige** Plandokument (Abschnitt 9).

## 1. Ziel und „fertig“

**Ziel.** Die 24 Bildschirme des Entwurfs sind in der App echt: gleiche Sprache (Glas, hell und dunkel, sechs Zustandsformen, Bewegung), echte Daten aus Rust und SQLite, und hinter jedem Knopf eine Funktion, die ihre Wirkung belegt. Ein Bildschirm mit erfundenen Daten ist nie fertig: Gibt es das Backend noch nicht, zeigt der Bildschirm den ehrlichen Zustand („noch nicht verbunden“, „aus, gesperrt bis …“).

**Fertig ist v2.0, sobald der Kern (Abschnitt 1a) echt läuft und alles unten gilt (jede Zeile ist ein Befehl oder eine Prüfung mit Beleg). Alle übrigen Bildschirme werden fertig gebaut, liegen aber standardmäßig hinter Funktionsschaltern (Abschnitt 1a); 2.x schaltet sie ohne neues großes Release frei.**

| # | Kriterium | Messung |
|---|---|---|
| 1 | Jeder Kern-Bildschirm (1a) erreichbar mit echter Datenquelle; jeder übrige gemergte Bildschirm hinter seinem Schalter: aus = Route fehlt und kein Backend-Aufruf, an = echte Datenquelle | Je Bildschirm ein Test gegen Store oder HTTP-Router, nicht gegen eine Attrappe (Muster: M4-E2E-14, `docs/PLAN.md`); die Tabelle „Datenquelle je Datenblock“ steht im PR des Bildschirms. Gesamtlauf: V2-ACC1 |
| 2 | Aussehen entspricht dem Board | Screenshot 1440×900, hell und dunkel, je Bildschirm (Kern, übrige mit Schalter an) angesehen und mit dem Board verglichen (bis zu 50 Bilder); Abweichungen stehen im PR |
| 3 | Kontrast und Tastatur | `node scripts/contrast-check.mjs` Exit 0 (läuft schon in `npm run build`, `package.json:18`), erweitert auf die neue Tokendatei; je Bildschirm ein Test, dass jedes bedienbare Element per Tab erreichbar ist und der Fokusring sichtbar bleibt |
| 4 | Ein Zustandswörterbuch | `rg -ln -e '--state-' src` trifft nach V2-ACC1 nur noch `src/design/`; keine zweite Definition der sechs Zustände |
| 5 | Zwei Sprachen | Test auf Schlüsselgleichheit de/en, Exit 0; je Bildschirm Screenshot in beiden Sprachen |
| 6 | Not-Aus überall sichtbar | `EmergencyStop` in der Kopfleiste der Schale (heute nur `settings/GeneralTab.tsx:113`); Messung 10 s bleibt (`estop.rs:9`) |
| 7 | Ausführungsort | Ein Agent läuft nachweislich auf dem PC, einer auf dem eigenen Server (SSH) und, soweit der Anbieter einen Cloud-Modus hat, einer in dessen Cloud (Beleg je Ort: Lauf-ID und Ausgabe) |
| 8 | Backend sicher | Jede neue Tabelle hat Migration, Vorab-Sicherung (`store.rs:859`) und roten Test; `bash scripts/ci/gates.sh lane prepush` Exit 0 auf `main` |
| 9 | Dauerbetrieb bleibt, was er ist | Aus, bis der Nutzer ihn selbst einschaltet; kein neuer Selbststart ohne Freigabe (AGENTS.md, „Development loop“) |
| 10 | Fernansicht | Gekoppeltes Gerät sieht den Leitstand, antwortet auf „Braucht dich“ und stoppt; `merge` und `start` liefern 403 (V2-H4) |
| 11 | Release | Installation von v2.0 über den Updater am PC des Nutzers (Drill und Signatur: Nutzer, wie bei v1.5.1) |
| 12 | Core | Abnahmen aus [`core.md`](core.md), Abschnitt 5, je Fähigkeit; Sicherheitsreview V2-SEC-1 ohne offenen Befund „hoch“ |
| 13 | Nutzerabnahme | Je Welle und für den Kern: Beta-Build, Klick-Checkliste (höchstens 10 Punkte), Bildschirmvideo, „neu / bewiesen / nicht abgedeckt“; der Nutzer gibt frei, was er gesehen hat (V2-UAT-1) |
| 14 | Leitzahl | Nicht mehr „gemergte PRs“, sondern: Kernteile mit bestandener Nutzerabnahme und Funktionen, die ein Tester benutzt hat (V2-KPI-1) |

**Nicht Teil von v2.0:** ein eingeschalteter Dauerbetrieb, ein Hintergrunddienst bei geschlossener App, Zugang aus dem Internet, Geldausgaben.

## 1a. Kern und Schalter

**Kern** sind die Teile, ohne die ProjectA 2.0 sein Versprechen nicht hält („Grün heißt bewiesen“, „Kein Modell prüft sich selbst“, Kontrolle über Kosten und Stopp). Alle anderen Bildschirme sind gebaut, aber ausgeschaltet (Paket V2-FLAG-1: ein Schalterverzeichnis, Standard aus, Schalten über die vorhandene Einstellung; nichts wird öffentlich ohne Freigabe des Nutzers). Die Beweis-Schicht steht in der ersten Welle nach dem Fundament, weil zwei der drei Alleinstellungsmerkmale laut Systemkarte nicht oder nur teilweise gebaut sind.

| Kernteil | Pakete | Abnahme (messbar) |
|---|---|---|
| Beweis-Schicht: Beweise und Merge, Fremd-Review, Merge nur über die Queue | V2-B9, B10, MQ1, ST-B1, S03 | Am Test-PR: Beleg trägt Gate, Exit-Code, SHA; neuer Commit macht ihn „veraltet“; `rg -n build_pr_merge_args src-tauri/src` trifft nur die Einreihung; gleiche Modellfamilie wird abgelehnt; ein Queue-Lauf beobachtet |
| Leitstand | V2-S01a, S01b | Karte je laufender Agent aus dem Store; Antwort auf „Braucht dich“ erreicht das Terminal (Test); Auftrag mit offenem Vorgänger zeigt den Grund |
| Agent starten, mit Ausführungsort | V2-S02, B5, B6a bis c, CLI-1, CTX | Kriterium 7: je ein Lauf auf PC und eigenem Server mit Lauf-ID; Ort grau, wenn nicht beobachtet verfügbar |
| Kontingente und Failover | V2-B1, B2, S05a | „Jetzt prüfen“ löst die echte Probe aus; Pflichtregel „Pause statt Rechnung“ nicht abschaltbar; Treffer des Limits wechselt nach Regel den Anbieter |
| Not-Aus | V2-F8 (Schale), B6b (Server), CORE-10 | Messung höchstens 10 s auch für einen Server-Lauf; der Core wendet danach nichts an |
| Core · Steuerung (Vorschlagen und Selbst mit Bericht) | V2-CORE-1 bis 10, S25, SEC-1 | [`core.md`](core.md), Abschnitt 5; Board `glass/Core.dc.html` |
| Ersteinrichtung | V2-S19, B28 | Der Nutzer durchläuft die Klick-Checkliste (≤ 10 Punkte) in einem frischen Profil bis zum ersten Agenten; Test mit Fixture-Repo |
| Demo-Modus | V2-DEMO-1 | Beispielprojekt ohne Abo: im Demo-Modus null Anbieter-Aufrufe (Zähler), jede Kernseite trägt „Demo“ |

**Querschnitt des Kerns:** V2-GATE-DESIGN, V2-GATE-PERF, V2-GATE-SIZE, V2-E2E-0 (ein Playwright-Durchlauf je Kernseite als Gate), V2-MIG-1, V2-UPD-1, V2-SEC-0/1, V2-UAT-1.

**Hinter Schaltern (gebaut, Standard aus):** V2-S04, S05b, S06 bis S18, S20 bis S24. Für Orte und Ersteinrichtung gibt es die Vorgabe schon im Start-Sheet und im Core-Bildschirm; die Seiten Personas (S09) und Projekteinstellungen (S18) sind dafür keine Voraussetzung. Was beim Kern-Release noch nicht gemergt ist, läuft in 2.x weiter, ohne ein großes Release zu blockieren (Frage 2).

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
- **U** (Bildschirm): `npm run build` Exit 0 (enthält den Kontrast-Check), `npx vitest run <Ordner>` Exit 0, ein Test gegen echte Daten (nicht Attrappe), Screenshot 1440×900 hell und dunkel, angesehen und mit dem Board verglichen, Tab-Reihenfolge getestet, beide Sprachen, bei Kernseiten ein Playwright-Durchlauf (V2-E2E-0), `prepush` Exit 0.
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
| V2-F7 | Screenshot- und Tabulator-Werkzeug (`scripts/dev/`); ändert `package.json` (die Kette FLOW-05 #567 ist gemergt) | ci | – | B | M | G0 | glm-5.3 | `node scripts/dev/shot.mjs --route <r>` erzeugt 4 Bilder (2 Themen × 2 Sprachen); Test mit Fixture |
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
| V2-ST-B1 | Tabellen: Beweise (Gate-Läufe, Reviews, Entwertung) – prüfen, was `store/development_runs.rs` schon abdeckt, bevor neu gebaut wird. **Erstes Paket der store-Spur** (Beweis-Schicht zuerst, 1a) | st | store | A | M | V2-B9, V2-B10 | astra | wie A1 |
| V2-ST-B2 | Tabellen: Checkpoints, Lauf-Schritte (Wiederholung) | st | store | A | M | V2-ST-B1, V2-B8, V2-B25 | astra | wie A1; Secret-Scan über Testdaten |
| V2-ST-B3 | Tabellen: Notizen (Gedächtnis) und Lessons, Ideen, Bugs, Entscheidungen | st | store | A | M | V2-ST-B2, V2-B12, V2-B13, V2-B14 | astra | wie A1; `lessons.json` wird einmal migriert (V2-H5) |
| V2-API-B | Routen für Bündel B. **Schnitt:** Scheibe B-Kern (Beweise, Review, Queue-Einreihung) hängt nur an V2-ST-B1; Scheibe B-Rest (Notizen, Ideen, Bugs, Lessons) an V2-ST-B3 | api | api | A | M | V2-ST-B1 (Kern; steht in der api-Spur vor API-A), V2-ST-B3 und V2-API-A (Rest) | astra | wie API-A |
| V2-MN-B | Tauri-Befehle für Bündel B, gleicher Schnitt B-Kern / B-Rest | mn | main | A | M | V2-ST-B1 (Kern; steht in der main-Spur vor MN-A), V2-ST-B3 und V2-MN-A (Rest) | astra | wie MN-A |
| V2-ST-C1 | Tabellen: Trigger und Läufe, Ablauf-Vorlagen und Läufe | st | store | A | M | V2-B15, V2-B16, V2-ST-B3 | astra | wie A1 |
| V2-ST-C2 | Tabellen: Geräte und Kopplung, Benachrichtigungen, Kostenbuch, Verbesserungs-Schalter, Nutzungsprotokoll | st | store | A | M | V2-ST-C1, V2-B11, V2-B20, V2-B21, V2-B26 | astra | wie A1 |
| V2-API-C | Routen für Bündel C inklusive Kopplung und eingeschränkter Rechte (V2-H4) | api | api | A | 2×M | V2-ST-C2, V2-API-B | astra | wie API-A; gekoppeltes Gerät: `merge`, `start` → 403 |
| V2-MN-C | Tauri-Befehle für Bündel C; **Sicherer Start**: nach Neustart bleiben alte Aufträge pausiert (heute `main.rs:295`, Aufruf `:4006`; prüfen, was fehlt) | mn | main | A | M | V2-ST-C2, V2-MN-B | astra | Test: Neustart mit zwei `dispatched`-Einträgen startet keinen Agenten |
| V2-PA-1 | `pa`: sechs Zustände mit denselben Wörtern wie die App; baut auf der gemergten Zerlegung ARCH-D6a (#579) auf | pa | pa | A | M | G0 | astra | Test: `pa`-Ausgabe nennt für jeden Zustand dasselbe Wort wie `src/design/` (gemeinsame Fixture) |
| V2-PA-2 | `pa`-Befehle für die neuen Bereiche (Personas, Orte, Ideen, Bugs, Gedächtnis), damit Agenten sie bedienen können | pa | pa | A | M | V2-PA-1, V2-API-C | astra | Test je Befehl; V2-B26-Handbuch nennt sie |

### 3.4 Bildschirme (je Board; „Daten“ nennt, was echt sein muss)

Größen sind Schätzungen aus den Boardzeilen ohne den gemeinsamen Block (`wc -l`: 471 bis 1527 Zeilen je Board, Summe 14879; abzüglich 24 × 215 ≈ 9700 Zeilen; Umrechnung in Diffzeilen **prüfen**, erst das erste Paket misst sie). Alle Bildschirme: U, hängen am Schalter D1 und an V2-F1 bis V2-F9. **Kern-Bildschirme** (1a): S01a, S01b, S02, S03, S05a, S19, S25; alle anderen sind gebaut und hinter einem Funktionsschalter (V2-FLAG-1).

| ID | Bildschirm (Board) | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Daten und zusätzliche Abnahme |
|---|---|---|---|---|---|---|---|---|
| V2-S01a | Leitstand (Main): Karten, Filter, „Braucht dich“ mit Antwort im Stream, Beweis je Karte; ersetzt `BoardView`/`WorkerPanel`-Optik, restylt `QuestionsView` | fe | – | B | 3×M | F9, V2-B9 (Beweis-Chip nur mit Daten, sonst `HonestState`) | terra | `get_board_state` (`main.rs:1720`), `answer_question`; Antwort erreicht das Terminal (Test) |
| V2-S01b | Leitstand, Betrieb: Warteschlange, Startprüfung, Wachhund, Sicherer Start, Grenzen je Job | fe | – | B | M | S01a, MN-A, V2-B3, V2-B4, V2-B22, V2-B23 | terra | Test: Auftrag mit Vorgänger zeigt den Grund |
| V2-S02 | Agent starten (AgentStarten): Persona, Ort, CLI, Modell, Aufwand, MCP, Failover, Startprüfung | fe | – | B | 3×M | MN-A, V2-B5, V2-CLI-1, V2-CTX | terra | Modellname „beim Start beobachtet“ (`status.rs:1888`); Ort grau, wenn nicht verfügbar |
| V2-S03 | Beweise & Merge (Beweise): Kette, Gates je Lane, Fremd-Review, NICHT ABGEDECKT, Queue-Position | fe | – | A | 3×M | MN-B (Scheibe B-Kern), V2-MQ1, V2-B9, V2-B10 | terra | Beleg am Commit (Test: neuer Commit → „stale“); Knopf „In die Warteschlange“ reiht ein, kein direkter Merge |
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
| V2-S25 | **Core · Steuerung** (Board `glass/Core.dc.html`, vom Koordinator angelegt): Anträge und Diff-Vorschau, Journal mit Rücknahme, Stufen je Bereich, Probezeiten, Tagesbericht, Satz-Eingabe. Kern | fe | – | B | 3×M | MN-K, V2-CORE-6, V2-CORE-9, F9 | terra | Alle Daten aus Journal und Register; „Selbst mit Bericht“ in Geld, Rechte, Sicherheit, Löschen, Releases nicht wählbar (Test); Not-Aus sichtbar |
| V2-S24 | Systemkarte: erzeugt aus einer maschinenlesbaren Fassung von `inventory.md`; heutiger Entwurf hat von Hand gepflegte Stände | fe + ci | – | B | 2×M | V2-F9 | terra | Test: jede Kachel hat eine Zeile im Inventar; Stand „gebaut“ nur mit Verweis auf ein gemergtes Paket |

### 3.5 Orchestrierung in der App

Heute liegt vieles in `pa-orch` außerhalb des Repos (`ls pa-orch*` leer; nicht prüfbar). Wichtige Grenze: Diese Pakete arbeiten **auf Befehl des Nutzers** („nimm dieses Paket“), nicht als Selbststart. Der Selbststart ist der Dauerbetrieb und bleibt bis zur Freigabe des Nutzers aus.

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme (zusätzlich zu R) |
|---|---|---|---|---|---|---|---|---|
| V2-O1 | Orchestrator: nimmt ein Paket aus dem Plan (V2-H2), prüft die Startprüfung (V2-B3), gibt es einem Agenten (V2-B5 Ort) und beobachtet es; Auftrag nur nach Klick | fR | – | A | 2×M | V2-O0, V2-H2, V2-B4, MN-B | astra | Test: ohne Klick kein Start; Startprüfung rot → Auftrag bleibt mit Grund liegen |
| V2-O2 | Chief of Staff: Übergaben sichtbar, nur wichtige Fragen erreichen den Nutzer (Filter-Regel als Sätze) | fR | – | B | M | V2-O1 | sol | Test: unwichtige Frage wird im Übergabe-Log gesammelt, wichtige als „Braucht dich“ |
| V2-O3 | Drei Teams parallel: Abhängigkeiten und Naht-Spur sichtbar, kein Zombie-Auftrag (nutzt `lane_guard.rs`, B4) | fR | – | A | M | V2-O1, V2-ST-A3 | astra | Test: zwei Aufträge derselben Naht laufen nacheinander |
| V2-O4 | Mergify-Pipeline in der App als **Vorschlag**: CI rot → Fix-Auftrag vorgeschlagen, Konflikt → Merge-Auftrag vorgeschlagen, aus der Queue geworfen → ein Versuch vorgeschlagen; der Nutzer bestätigt (Selbstausführung wäre Dauerbetrieb) | fR | – | A | M | V2-O1, V2-MQ1 | astra | Test: Vorschlag entsteht, nichts startet ohne Bestätigung |

| V2-O5 | Review-Fahrer und Queue-Freigabe als getesteter Code: wählt Prüfer nach Stufe und Familie (B9, B10), sammelt Befunde, setzt `review-ok` erst bei vollständiger Disposition ohne offenen Befund „hoch“, nie für den eigenen Autor | fR | – | A | M | V2-O1, V2-B9, V2-B10 | astra | Test: Stufe A ohne zwei Prüfer anderer Anbieter → kein `review-ok`; der Pfad `api/agent_access.rs` ergibt A (Fall #578, Beleg in `evidence-r2.md`) |
| V2-DOG-1 | **Dogfood-Tor DG1 „ProjectA wird mit ProjectA gebaut“:** die Regeln aus `pa-orch` (Stufen-Einordnung = B9, Review-Fahrer = O5, Queue-Freigabe = MQ1/O4, Wachhund = B22, Reserve = EX-4) laufen als getesteter Code im Repo und sind der Hut „Arbeit“ des Core. Danach zieht die Entwicklung Schritt für Schritt von `pa-orch` und AgentsRoom in die App; jeder Schritt ist umkehrbar | doc + Messung | – | C | S | V2-O0, O5, B22, EX-4 | Koordinator | je Regel: Test grün und eine Woche Parallellauf App gegen `pa-orch` ohne Abweichung; Rückweg: `pa-orch` bleibt startbar, bis der Nutzer den Schritt freigibt |

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
| V2-ACC1 | Gesamtabnahme: alle gemergten Bildschirme (24 Boards plus Core, Schalter an) × 2 Themen × 2 Sprachen, Tabulator, Kontrast, Datenquellen-Test, Gate gegen zweite Zustandsdefinition | fe + ci | – | B | M | alle V2-S | terra | Kriterien 1 bis 6 mit Befehlen im PR |
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
| Core (Steuerung, Arbeit, Aufmerksamkeit) | V2-CORE-1 bis 10, V2-CORE-AT, V2-S25, V2-O1 bis O5; Beschreibung `core.md` |
| Ausführung in AgentsRoom | V2-EX-1 bis EX-6 (Abschnitt 4a) |

### 3.9 Core, Sicherheit und Architektur-Skizze (Kern)

Beschreibung und Abnahmen je Fähigkeit: [`core.md`](core.md). Der Core ist **eine** App-KI mit drei Hüten (Steuerung, Arbeit = V2-O1 bis O5, Aufmerksamkeit = V2-O2 und V2-CORE-AT); ein zweiter Orchestrator entsteht nicht. Ein Schreiber je Einstellung, ein Journal, feste Grenzen im Code.

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme (zusätzlich zu R) |
|---|---|---|---|---|---|---|---|---|
| V2-ARCH-0 | **Architektur-Skizze vor Welle 1:** Datenmodell, Ereignisfluss und Rechte-Modell für Core-Journal, Anträge, Rechte-Stufen, Personas, Trigger und Webhooks; als ADRs in `docs/decisions.md` (dazu die st-Frage „Module gleichzeitig“ aus ADR-A7) | doc | – | C (Berater-Paar laut Auftrag) | M | G0 | Fable 5.1 + astra | ADRs nennen Tabellen, Module und Ereignisse; jedes spätere Core-, Trigger- und Persona-Paket nennt seinen ADR; beide Gegenprüfungen im PR |
| V2-ARCH-1 | Nichts Neues in die Nähte: `scripts/ci/seam-budget.json` mit Zielzahl je Naht (Start 8091, 7227, 6490, 5133; nur sinkend), Regel „neue v2.0-Funktion = neues Modul, Naht nur Verdrahtung“, Zulage je Paket nur mit Label `seam-ok` | ci | – | B | M | G0 | glm-5.3 | roter Test auf präpariertem Fall; `architecture-drift.test.mjs` grün; Exit 0 auf `main`; kein Allowlisten ohne Begründung |
| V2-SEC-0 | Bedrohungsmodell v2.0: Core, Webhooks, MCP, Server-Zugriff (SSH), Prompt-Injection aus Repo-Inhalten und Agentenpost; dazu der Prüfpunkt „Descriptor-Datei unter Unix“ | doc | – | A (Berater-Paar) | M | G0 | Fable 5.1 + astra | Tabelle Bedrohung → Maßnahme → Paket → Test; jede Zeile trägt eine Paket-ID, Befunde nur mit `Datei:Zeile` |
| V2-SEC-1 | Sicherheitstests für den Core: Injection aus Repo und Agentenpost, Umgehung der Freigabe, feste Grenzen (Tests aus `core.md`, Abschnitt 6) | fR | – | A | M | V2-CORE-1, V2-CORE-2, V2-SEC-0 | astra | zwei Fremd-Reviews; Test: präpariertes Repo erzeugt keinen Eintrag außerhalb des Registers; läuft vor dem ersten „Selbst mit Bericht“ |
| V2-SEC-2 | `planning_access` ohne Projektrahmen und die TOCTOU-Lücke (M4-Blocker in `docs/PLAN.md`); zuerst prüfen, ob der Befund noch gilt | api | api (prüfen) | A | S | V2-SEC-0 | astra | roter Test zuerst, sonst Bericht „gilt nicht mehr“ mit Beleg |
| V2-CORE-1 | Register (Schlüssel → Besitzer, Bereich, Risikoklasse, Wirkstelle), Antrag, Änderungs-Journal (`key`, `old`, `new`, `reason`, `evidence`, `risk_class`, `rollback`), Serialisierung je Schlüssel; Kern ohne Datenbank | fR | – | A | M | V2-ARCH-0 | astra | Schlüssel ohne Besitzer nicht änderbar; zwei Anträge auf denselben Schlüssel nacheinander; Hilfs-Agent kann nur Anträge stellen |
| V2-CORE-2 | Stufen je Bereich (Aus, Vorschlagen, Selbst mit Bericht) und die festen Grenzen in Rust: Geld, Rechte, Sicherheit, Löschen, Releases und die eigene Stufe sind immer nur Vorschlag; Vertrauenszähler; der Core erhöht seine Stufe nie | fR | – | A | M | V2-CORE-1 | astra | roter Test je feste Grenze, auch bei falsch gepflegtem Register |
| V2-CORE-3 | Probezeit 24 h mit Messgröße, Toleranz und automatischer Rücknahme | fR | – | A | M | V2-CORE-1, V2-CORE-2 | astra | Test mit verschlechterter Messgröße: Rücknahme, vollständiger Eintrag; Wirkung ohne Messung bleibt Vorschlag |
| V2-CORE-4 | Register füllen: Schlüssel der heutigen Einstellungen und der Pakete B2, B5, B15, B17, B20 mit Besitzer und Wirkstelle | fR | – | B | M | V2-CORE-1, V2-B20 | sol | jeder Schlüssel nennt seine Wirkstelle (`rg`-Beleg), sonst nicht im Register |
| V2-ST-K1 | Tabellen: Journal (append-only, Trigger gegen UPDATE/DELETE), Anträge, Stufen, Probezeiten | st | store | A | M | V2-CORE-1 bis 3, V2-ST-B1 | astra | wie A1; UPDATE auf das Journal scheitert |
| V2-API-K | Routen `api/core_routes.rs` + Haken in `api.rs` | api | api | A | M | V2-ST-K1, V2-API-A | astra | HTTP-Test je Route; Antrag ohne Run-Credential → 403; gekoppeltes Gerät kann nicht bestätigen |
| V2-MN-K | Tauri-Befehle für den Core + Haken in `main.rs` | mn | main | A | M | V2-ST-K1, V2-MN-A | astra | Test je Befehl |
| V2-CORE-5 | Selbstheilung: RAM knapp → Agenten auf Server oder Cloud (nur belegt verfügbare Orte), Kontingent nahe am Limit → Failover, stehengebliebener Agent → eine Meldung | fR | – | A | M | V2-CORE-3, V2-B2, V2-B3, V2-B5, V2-B22 | astra | je Fall ein Test mit Fixture |
| V2-CORE-6 | Steuerung per Satz mit Diff-Vorschau; das Modell wählt nur aus einer vom Code erzeugten Liste erlaubter Änderungen | fR | – | A | M | V2-CORE-4, V2-SEC-1 | astra | Wert außerhalb des Registers abgelehnt; Vorschau zeigt alt und neu |
| V2-CORE-7 | Optimierer: Verbesserungen als Einwochen-Versuche mit Messgröße | fR | – | B | M | V2-CORE-3, V2-B20, V2-B21 | sol | Versuch endet nach einer Woche mit Vergleich und ändert danach nichts ohne Bestätigung |
| V2-CORE-8 | App-Wissen der Agenten pflegen („Wann was“-Regeln aus V2-B26) | fR | – | B | M | V2-B26, V2-CORE-1 | sol | Lücke zwischen `pa`-Befehlen und Handbuch wird zum Antrag |
| V2-CORE-9 | Einstellungen erklären mit Verlauf; Tagesbericht in genau drei Zeilen | fR | – | B | M | V2-CORE-1 | sol | Test: drei Zeilen, jede mit Journal-Verweis |
| V2-CORE-10 | Regelmodus ohne Kontingent (nie dunkel); Not-Aus stoppt den Core | fR | – | A | M | V2-CORE-2, V2-B1 | astra | Kontingent leer → Regeln greifen ohne Modellanfrage; Not-Aus: nichts wird angewendet, Messung mit der 10-s-Frist |
| V2-CORE-AT | Aufmerksamkeit: Sammelkorb, festes Tagesfenster, Ausnahmen nur Not-Aus und Sicherheit; nachts laufen nur Aufträge ohne offene Entscheidung | fR | – | A | M | V2-O2, V2-B11, V2-CORE-2 | astra | Frage außerhalb des Fensters landet im Korb; Not-Aus bleibt laut |
| V2-DEMO-1 | Demo-Modus: Beispielprojekt ohne Abos, für Tester und die Webseite | fR + fe | – | B | 2×M | V2-F9, V2-B28 | terra | Null Anbieter-Aufrufe im Demo-Modus (Zähler); Seiten tragen „Demo“ |
| V2-FLAG-1 | Schalterverzeichnis für Seiten außerhalb des Kerns und Vorschau-Funktionen; Standard aus; Wirkung über die vorhandene Einstellung, keine neue Tabelle | fR + fe | – | B | M | G0 | terra | Schalter aus: Route fehlt, kein Backend-Aufruf; an: Route da; `rg -il featureFlag src` heute leer (Beleg), danach ein Ort |

### 3.10 Ergänzungen: Gates, Abnahme, Betrieb, Recht, Lernen

Alles Folgende ist aus den 36 Ergänzungen vom 06.10. (Zuordnung Punkt → Paket: [`evidence-r2.md`](evidence-r2.md), Abschnitt 2).

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme |
|---|---|---|---|---|---|---|---|---|
| V2-GATE-SIZE | CI-Gate für die Größenregel: über der Grenze rot, außer mit Label `size-ok` vom Koordinator und einem Grund im PR-Text. Grenzwerte in einer Datei; bis D3 beantwortet ist, gilt 300 (Beleg: #579 kam mit 417 Diffzeilen) | ci | – | B | M | G0 | glm-5.3 | roter Test auf einem 417-Zeilen-Fall; mit `size-ok` grün; Exit 0 auf `main`; `gates.sh --list` führt es |
| V2-GATE-DESIGN | Design-Gate aus den Audit-Skripten: Kopfzeile, Radien, Schalterfarbe, Zustandsformen, Kontrast, abgeschnittener Text ohne Titel. Die Skripte liegen nicht im Repo (Beleg `evidence-r2.md`); der Koordinator übergibt sie, `contrast-check.mjs` ist der Kontrast-Teil | ci | – | B | M | V2-F1, V2-F3, Skripte vom Koordinator | glm-5.3 | je Regel ein roter Fall; grün auf der Schale |
| V2-GATE-PERF | Leistungsbudgets: Startzeit, RAM je Agent, Leerlauf-CPU. **Das Paket misst zuerst** (drei Läufe, Streuung), bevor es Grenzen festlegt | ci | – | B | M | G0 | sol | Messprotokoll im PR; Gate rot bei Überschreitung des gemessenen Budgets plus Toleranz |
| V2-E2E-0 | Playwright-Rahmen: ein Durchlauf je Kernseite als Gate, schreibt Schritte und Bilder in ein Ablauf-Protokoll (`@playwright/test` ist vorhanden, `package.json:62`, keine neue Abhängigkeit) | ci + fe | – | B | M | V2-F7 | glm-5.3 | Durchlauf der Schale grün; Protokoll mit Bildern je Schritt |
| V2-MAN-1 | Nutzerhandbuch aus denselben Abläufen (Schritt für Schritt mit Bildern), deutsch und englisch | doc | – | C | M | V2-E2E-0 | glm-5.3 | jede Kernseite hat ein Kapitel; Bilder stammen aus dem Durchlauf |
| V2-UAT-1 | Nutzerabnahme je Welle: Beta-Build über den internen Kanal, Klick-Checkliste (höchstens 10 Punkte, einfache Worte), kurzes Bildschirmvideo, „neu / bewiesen / nicht abgedeckt“; Vorlage und Skript | doc + ci | – | C | S | V2-BETA-1 | glm-5.3 | Vorlage im Repo; erste Welle durchgespielt; der Nutzer gibt frei, was er gesehen hat |
| V2-BETA-1 | Interner Beta-Kanal: Updater-Endpunkt und Release-Weg für Beta-Builds, nie öffentlich ohne Freigabe; Eingriff in `release.yml` | ci + N | – | A | M | G0, Freigabe des Nutzers | astra | Beta-Build erreicht nur den internen Kanal (Test mit Endpunkt); Veröffentlichung braucht den Nutzer |
| V2-MIG-1 | Migration 1.5 → 2.0 mit Rückweg: Kopie einer echten v1.5.1-Datenbank durch alle neuen Migrationen, Vorab-Sicherung (`store.rs:859`), Rücksprung auf die Sicherung | fR | – | A | M | V2-ST-C2 | astra | Zeilenzahlen gleich; Rücksprung belegt; Drill am PC mit dem Nutzer |
| V2-UPD-1 | Updater: Abbrechen-Knopf und Versionsanzeige nach dem Neustart (Lücken aus dem Update-Drill vom 06.10.; Beleg `evidence-r2.md`); Zusammenarbeit mit V2-R-06 | fe + mn | main (Haken in MN-C) | A | M | V2-MN-C | astra | Test: Abbrechen lässt die alte Version laufen; nach dem Neustart steht die neue Version da |
| V2-BAK-1 | Sicherung und Wiederherstellung in der App (auf V2-B24) mit automatischem Wiederherstellungstest (Vorbild `scripts/restore-probe.sh`) | fR + fe | – | A | M | V2-B24 | astra | Test: Sicherung → frischer Ordner → Wiederherstellung → Prüfsumme gleich, läuft nächtlich |
| V2-FB-1 | „Fehler melden“ mit einem Klick: Logs ohne Geheimnisse (Secret-Scan vor dem Senden), Opt-in, Standard ist ein lokales Paket ohne Netzwerk | fR + fe | – | A | M | V2-LEGAL-1 | astra | Test: Log mit Geheimnis wird nicht gesendet; ohne Zustimmung kein Netzwerkaufruf |
| V2-LEGAL-1 | Rechtscheck vor dem Verkauf: Produktname, Domain, Markenrecherche; Nutzungsbedingungen der Anbieter für automatisierte Nutzung ihrer Abo-CLIs **mit Quellen** (ungeprüft gilt „prüfen“); Lizenzvorschlag (heute MIT, `LICENSE:1`); Datenschutz: Opt-in, Datenminimierung, Datenschutzerklärung für „Fehler melden“, Telemetrie und Webhooks. Keine Rechtsberatung; der Nutzer entscheidet am Ende | doc | – | C | M | G0 | glm-5.3 | je Aussage Quelle und Abrufdatum; Entscheidungsvorlage für Frage 8; kein Haken ohne Quelle |
| V2-WEB-1 | Monetarisierung und Reichweite: Preismodell, kleine Webseite, Mac/Linux (heute nur Windows, `release.yml` baut auf `windows-latest`); Entscheidung mit Empfehlung | doc | – | C | M | V2-LEGAL-1, V2-DEMO-1 | glm-5.3 | Vorlage für Frage 9; die Webseite entsteht erst nach Freigabe |
| V2-LEARN-1 | Lernmodus: zu jeder Welle erklärt der Erklärer in einfachen Worten, was gebaut wurde und warum; dazu ein Glossar | doc | – | C | S je Welle | V2-UAT-1 | glm-5.3 | eine Seite je Welle im PR der Welle; Glossar-Begriffe stehen im Glossar |
| V2-LEARN-2 | Portfolio-Seite mit Belegen als Grundlage für die Bewerbung (IT-Ausbildung). **Wird lokal erzeugt und nie eingecheckt** (öffentliches Repo: nichts Persönliches) | fe | – | B | M | V2-LEARN-1 | terra | Seite entsteht aus Journal und PR-Belegen; `git status` zeigt sie nicht als versionierbar |
| V2-KPI-1 | Leitzahl statt Durchsatz: Kernteile mit bestandener Nutzerabnahme, Funktionen, die ein Tester benutzt hat (Nutzungsprotokoll mit Opt-in, V2-B26); Erweiterung von `bench-weekly.mjs` | ci | – | B | M | V2-UAT-1, V2-B26 | glm-5.3 | Wochenausgabe nennt beide Zahlen mit Quelle; die Zahl gemergter PRs bleibt nur Nebenwert |
| V2-DIET-1 | Prozess-Diät messen: Anteil Prozess- und Doku-Pakete je Woche (Grenze 20 %), neue Prozess-Werkzeuge nur gegen ein altes | ci | – | B | S | V2-KPI-1 | glm-5.3 | Wochenausgabe zeigt den Anteil; Beleg heute: 87 von 281 PRs mit „fix“, 52 mit „docs“ im Titel (`evidence-r2.md`) |
| V2-HYG-1 | Hygiene-Check erweitern (`scripts/dev/hygiene.mjs`, Prüfung 5): Dateien mit Shell-Zeichen im Namen und Rückstand des Hauptcheckouts gegen `origin/main`; nur melden. Aufräumen nur mit Sicherung und Freigabe des Nutzers (Frage 12) | doc | – | B | S | G0 | glm-5.3 | roter Test mit einer Datei `!fs.existsSync(dir`; Ausgabe nennt den Rückstand |
| V2-BRIEF-1 | Wochenbrief: eine Seite je Woche (Ziel, erreicht, nicht erreicht, Kosten und Kontingente, **genau 3 Entscheidungen mit Empfehlung**); ersetzt Einzelmeldungen außer Not-Aus und Sicherheit. Zuerst als Skript (aus `bench-weekly.mjs` und der Inbox), später durch den Core | ci | – | B | M | V2-DEC-1 | glm-5.3 | Probe auf den Daten der letzten Woche; Entscheidungen ≤ 3 (Test) |
| V2-STOP-1 | Abbruch-Regel: ein Paket mit mehr als 2 Nacharbeitsrunden wird geteilt oder gestrichen, nicht weiter geflickt; automatisch, Meldung im Wochenbrief (Zähler FLOW-05 ist gemergt) | ci | – | B | S | V2-BRIEF-1 | glm-5.3 | Test: Fixture mit 3 Runden → Vorschlag „teilen oder streichen“ |
| V2-DEC-1 | Entscheidungen mit Ablaufdatum: jeder Eintrag in `docs/decisions.md` bekommt „Prüfen am“; ein Skript meldet fällige Einträge, später erinnert der Core | ci + doc | – | B | S | G0 | glm-5.3 | Test: fälliger Eintrag wird gemeldet; neue Einträge ohne Datum lehnt `dev:agent-check` ab (nur neue) |
| V2-SRV-1 | Server: Kosten gegen Nutzen: monatliche Auslastungszahl, belegte Plätze über die Zeit (aus der Startprüfung V2-B3 statt aus dem lokalen Log) | fR | – | B | M | V2-B3 | sol | Monatszahl mit Quelle; Entscheidung des Nutzers in Frage 7 |
| V2-CAP-1 | Kapazitätsrechnung: Tokens je Paket (Median je Stufe und Größe) × Pakete gegen die Wochenlimits aller Anbieter → Zeitrahmen in Wochen als Spanne und Routing nach Restkontingent; **kein Anbieter über 50 % der Pakete je Woche**. Messdaten fehlen im Repo (`benchmark.md` ohne Token-Zahlen); `usage_events` liefert sie | fR + ci | – | B | M | V2-B21 | sol | Ausgabe mit Spanne und Stichprobengröße; ohne Daten „zu wenig Daten“, nie eine Tageszusage |
| V2-CLI-3 | CLI-Vertragstests, nächtlich je angebundener CLI: Startflags, Modellnamen, Ausgabeformat (Beleg: Codex-Namen änderten sich). Läuft auf Server oder PC, nicht in GitHub Actions (braucht Abo-Anmeldung); Ergebnis im Morgenbericht | wk + ci | – | B | M | V2-CLI-1 | sol | je CLI ein Test; eine gebrochene CLI erscheint am Morgen, nicht beim Kunden |
| V2-TEST-1 | Testerrunde über den Beta-Kanal (aus M5-01 und V16-03): Tester-Kit, Rückmeldeformular, bekannte Grenzen; ein frisches Windows-Konto stellt der Nutzer | doc + N | – | C | S | V2-BETA-1, V2-LEGAL-1, Frage 8 | glm-5.3 | Trockenlauf der Installation im frischen Konto |
| V2-RULE-2 | AGENTS.md: Wissensrangfolge (Repo > AgentsRoom-Gedächtnis > lokale Notizen), Agenten schreiben nie in den Hauptcheckout, Prozess-Diät, Plan-Freeze (nur nach Freigabe) | doc | – | C | S | Fragen 8, 11, 12 | Koordinator | `npm run dev:agent-check` Exit 0 |
| V2-FREEZE-1a | Plan-Freeze, Teil a: Leserliste. 25 Dateien nennen `docs/PLAN.md` (`development_plan.rs` liest die DEVFLOW-Tabelle mit 38 Zeilen, `hq-parse.mjs`, `ci.yml`, PR-Vorlage und andere); jede bekommt ein Ziel. Die übernommenen Zeilen aus `mapping.md` werden in `docs/plan/v2.0/` kopiert | doc | – | C | M | Freigabe (Frage 11), V2-H2 | Koordinator | Liste vollständig (`rg -l`), kein Leser zeigt ins Leere |
| V2-FREEZE-1b | Plan-Freeze, Teil b (**eigener Folge-PR, nicht dieser**): `docs/PLAN.md` wird Verweis auf den v2.0-Plan, v1.6.0-Plan und `docs/plan/roadmap/` gehen ins Archiv, `STAND.md` und `docs/ERLEDIGT.md` folgen | doc | – | C | M | V2-FREEZE-1a | Koordinator | `npm run dev:agent-check` Exit 0; `bash scripts/ci/gates.sh lane prepush` Exit 0; Sicherung vorher |
| V2-N1 | Nutzer-Aufgaben aus `docs/PLAN.md` (SETUP-14: tote Keys, Permission-Regeln) und die Klick-Checklisten der Wellen | N | – | – | – | – | Nutzer | vom Nutzer abgehakt |

### 3.11 Ausführungsort: Paketkette

Schon in 3.1 bis 3.4 als Pakete enthalten, hier nur die Reihenfolge: V2-LOC-0 (Notiz) → V2-B3 (RAM-Fakten) → V2-B5 (Auflösung: Start > Persona > Projekt > „automatisch“) → V2-ST-A1/A2 (Personas, Hosts als Verweise, Projekt-Richtlinien mit Ort) → V2-B6a (SSH) → V2-B6b (Server-Lauf, Not-Aus erreicht ihn) und V2-B6c (Cloud, je Anbieter nur mit Beleg) → V2-S02 (Start-Sheet), V2-S09, V2-S18 (Vorgaben) → V2-CORE-5 (Selbstheilung nutzt „automatisch“). Ort und Standardwerte sind Core-Schlüssel mit einem Besitzer (V2-CORE-4).

## 4. Wellen und Tore

Tore: **G0** = der Nutzer gibt den Plan frei (Fragen 1 bis 4) und dieser PR ist gemergt. **G-F** = V2-F1 bis V2-F5b gemergt: Bildschirme dürfen starten. **G-A/B/C/K** = das jeweilige Nahtbündel gemergt (K = Core). **G-Kern** = alle Kernteile aus 1a erfüllt, V2-SEC-1 ohne offenen Befund „hoch“, Nutzerabnahme. **G-REL** = G-Kern, V2-ACC1 grün und der Nutzer gibt frei. Die **Beweis-Schicht kommt zuerst** nach dem Fundament (W1), weil zwei der drei Alleinstellungsmerkmale heute fehlen oder nur teilweise gebaut sind.

| Welle | Start | Läuft gleichzeitig | Plätze (Server 8: höchstens 4 Naht, mindestens 4 Füllung/Review; PC höchstens 2 Builds) |
|---|---|---|---|
| W0 Fundament und Grundlagen | G0 | F1 → (F2, F3, F4a → F4b, F5a → F5b, F6) → F7 → F8 → F9; B1, B3, B8, B11 bis B14, B20, B23, B28, H1, H2, O0, LOC-0, CLI-0; Doku und CI ohne Naht: **V2-ARCH-0, V2-SEC-0 (zuerst, vor W1)**, ARCH-1, GATE-SIZE, GATE-DESIGN, GATE-PERF, FLAG-1, DEC-1, HYG-1, LEGAL-1, CAP-1 | alles ohne Nahtstelle; Rust: 1 bis 2 Builds, Frontend ohne Cargo |
| W1 Beweis-Schicht und Core-Kern | G0, V2-ARCH-0, V2-SEC-0, Nahtplätze nach 4.1 | Kerne **B9 → B10, MQ1** (Beweise zuerst), B2, B4, B5, B17, B18, B19, B27, CORE-1 → CORE-2 → CORE-3, CORE-4, O1; Nähte: store `ST-B1 → ST-K1 → ST-A1 → A2 → A3`, api `API-B (Kern) → API-A → API-K`, main `MN-B (Kern) → MN-A → MN-K`; Ausführung EX-1 bis EX-6 (4a) | 1 Naht-Paket je Naht |
| W2 Kern-Bildschirme | G-F, G-B (Kern), G-A, G-K | S03, S01a, S01b, S02, S05a, S19, S25, DEMO-1; CLI-1 → CLI-2, CTX; B6a → B6b, B6c; E2E-0; CORE-5, 6, 9, 10, AT, SEC-1; dahinter (Schalter aus): S08, S09, S14, S17, S18, S24 | bis 6 Frontend-Pakete parallel (ein Ordner je Bildschirm; `App.tsx` nur F9 und Routenregister) |
| W3 Bündel B-Rest, Kern-Abnahme | G-B (Kern) | B21, B22, B24, B25, B26, O2 bis O5, DOG-1; `ST-B2 → B3`, `API-B (Rest)` ‖ `MN-B (Rest)`, H3, H5; UAT-1 für den Kern, BAK-1, FB-1, MIG-1 (nach ST-C2) | wie W1 |
| W3 Bildschirme B | G-B (Rest) | S04, S06, S07, S10, S11, S12, S13, S20 (alle hinter Schaltern) | wie W2 |
| W4 Bündel C | G-B | `ST-C1 → C2`, `API-C`, `MN-C` (mit UPD-1), PA-1 → PA-2, H4 → H6, CORE-7, CORE-8 | wie W1 |
| W4 Bildschirme C | G-C | S05b, S15, S16, S21, S22, S23 (hinter Schaltern) | wie W2 |
| W5 Abschluss | G-Kern | V2-I18N, V2-ACC1, V2-RULE1, V2-RULE-2, V2-H7 (nach Freigabe), V2-REL (Nutzer); danach V2-FREEZE-1b | – |

Regeln wie in v1.6.0, Abschnitt 4: Nähte strikt seriell; Pakete derselben Datei laufen nacheinander (neue Dev-Skripte ändern `package.json`); keine Datei eines offenen PRs; Reviews A zwei Anbieter, B einer. Laufende Wellen werden nicht umgeplant, außer bei Sicherheit oder einem roten `main` (Abschnitt 4b).

### 4.1 Nahtstellen und die übernommenen v1.6.0-Pakete (Stand `gh pr list` und `git log origin/main` vom 06.10.2026)

| Naht | Heute belegt durch | Übernommene v1.6.0-Pakete (`mapping.md`) | v2.0-Pakete in dieser Spur | Länge der Spur |
|---|---|---|---|---|
| `store.rs` | #577 ARCH-D3a ist gemergt; #587 ARCH-D3b ist ein offener Entwurf | D3b → D7 | ST-B1, K1, A1, A2, A3, B2, B3, C1, C2, H5 | 2 + 10 = 12 |
| `bin/pa.rs` | #579 ARCH-D6a ist gemergt | D6b | PA-1, PA-2 | 1 + 2 = 3 |
| `api.rs` | #578 ändert nur `api/agent_access.rs` (`gh pr view 578 --json files`), `api.rs` ist frei | ARCH-D1 → D4a → D4b | API-B (Kern), A, K, B (Rest), C (2×M), H4, SEC-2, EX-2 (Webhook) | 3 + 9 = 12 |
| `main.rs` | frei | V2-R-06 → D2 → D5a → D5b → D8a | MN-B (Kern), A, K, B (Rest), C (mit UPD-1), H6 | 5 + 6 = 11 |

Befund: Die längsten Spuren sind `store.rs` und `api.rs` mit je 12 seriellen Paketen, danach `main.rs` mit 11. Der Core fügt je Naht ein Paket hinzu (K). Das Fundament (Abschnitt 2) ist davon unabhängig. **Vorschlag (Frage 4):** je Naht abwechselnd ein übernommenes Paket, dann ein v2.0-Paket, ab dem nächsten freien Platz; ein bereits offenes Paket läuft zu Ende. So bleibt jede Spur in Bewegung, und die D-Pakete machen die Nahtdateien kleiner, bevor v2.0 sie größer macht. Das Gate V2-ARCH-1 hält neue Logik aus den Nähten heraus. Keine Tageszusage: Die Messung der Nahtpakete (Median 185 Diffzeilen, `size-evidence.md`) sagt nichts über die Wartezeit in der Spur.

## 4a. Ausführung (AgentsRoom, ohne Leerlauf)

Vorgabe des Nutzers (06.10.): schnell und effektiv, ohne Leerläufe, lange Wartezeiten und Nachbesserungen, bei hoher Qualität. Grundlage ist [`../v1.6.0/plan.md`](../v1.6.0/plan.md), Abschnitt 2 (Engpässe S1 bis S8, Ziele M-IDLE und M-REWORK) und Abschnitt 6 (rekursives Prompting, Checkliste, Fixrunde 7b); das wird hier **nicht wiederholt**, nur erweitert. Bis V2-DOG-1 läuft die Ausführung in AgentsRoom (extern, nicht prüfbar); danach übernimmt der Core (Hut „Arbeit“) Schritt für Schritt.

| Paket | Regel | Abnahme |
|---|---|---|
| V2-EX-1 (ci, B, M) | **Ein Ticket je Paket** mit Voraussetzungen (`backlog_link`): `scripts/dev/plan-to-tickets.mjs` liest die Paketspalten dieses Plans (Spalte „Hängt ab von“) und schreibt eine Liste; den Import in AgentsRoom macht der Koordinator (die Schnittstelle ist hier nicht beobachtet: prüfen) | Test mit Fixture; jedes Paket hat genau ein Ticket; kein Ticket ohne seine Vorgänger |
| V2-EX-2 (api, A, M; Haken in `api.rs`) | **GitHub-Webhook statt der 3-Minuten-Schleife:** Empfänger mit Signaturprüfung (Kern: V2-B15), nur die Ereignisse „PR bereit“, „Check fertig“, „Queue-Ergebnis“. Erreichbarkeit von außen ist Frage 5; bis zur Antwort fragt die App bedingt ab (`ETag`, 304); ob 304-Antworten das Ratenlimit schonen, ist zu prüfen | gefälschte Signatur → 403; Ereignis löst genau eine Aktion aus; ohne Antwort auf Frage 5 bleibt der Webhook aus |
| V2-EX-3 (fR, A, M) | **ship- und start-next-Trigger:** „Paket gemergt“ (ship) und „Platz frei oder Vorgänger gemergt“ (start-next) starten den nächsten startbaren Auftrag; **Agenten-Post weckt den Empfänger**, statt auf die Schleife zu warten. Nur auf Befehl des Nutzers (Abschnitt 3.5), nie als Dauerbetrieb | Test: Merge eines Vorgängers startet den Nachfolger nach Startprüfung; Post an einen schlafenden Agenten weckt ihn |
| V2-EX-4 (fR + ci, B, M) | **Reserve von mindestens 16 startbaren Paketen.** Startbar heißt: alle Vorgänger gemergt, Naht frei oder an der Reihe, Spec-Kritik bestanden, Anbieter und Ort verfügbar. Fällt die Zahl unter 16, meldet der Wochenbrief „Nachschub“ (Quelle: `plan-lint` und `start-check`) | Zähler mit Fixture; Reserve < 16 erzeugt genau eine Meldung |
| V2-EX-5 (fR + ci, B, M) | **Spec-Kritik vor dem Start, Selbstprüfung vor dem Push, eine begrenzte Fixrunde** (v1.6.0, Abschnitt 6 und 7b; `docs/development/prompting.md`): kein Start ohne Kopfzeilen `Prompt-Rounds:` und `Critique-By:`; Review-Prompts laufen durch das Prüfskript; „fertig“ nur mit Gate-Exit, Kandidaten-SHA, `git ls-remote` und PR. Mehr als zwei Nacharbeitsrunden: V2-STOP-1 | Test: Auftrag ohne Kritik-Kopf startet nicht; Meldung „fertig“ ohne `ls-remote`-Beleg wird abgelehnt |
| V2-EX-6 (fR + doc, B, M) | **Quota-Regeln für alle Anbieter** (Tabelle unten), gespeist von `start-check --usage` und V2-B1; Routing nach Restkontingent | Test je Zeile der Tabelle; unbeobachteter Anbieter gilt als „prüfen“ und bekommt nur Stufe C |

| Beobachtetes Wochenlimit eines Anbieters | Regel (Schwellen sind Vorschläge; V2-CAP-1 kalibriert sie an Messdaten) |
|---|---|
| unter 70 % | alle Stufen, auch Nahtstellen und Sicherheit (Wert 70 % steht schon in `docs/setup/providers.md` für Claude-Worker) |
| 70 % bis unter 90 % | Stufe B und C; Stufe A nur bei einem anderen Anbieter |
| ab 90 % oder Limit-Meldung | kein Neustart bei diesem Anbieter; laufende Pakete enden; Failover nach V2-B2; „Pause statt Rechnung“ bleibt (nie API-Schlüssel, nie Geld) |
| immer | kein Anbieter über 50 % der Pakete je Woche (Stand 05.10.: 59 %, v1.6.0 S7); nie Kontowechsel im laufenden Gespräch |

**Messung jede Woche:** M-IDLE (Leerlauf-Alarme, Ziel ≤ 10 pro Tag) und M-REWORK (Fix-PRs binnen 72 h, Ziel ≤ 8 %) nach v1.6.0, Abschnitt 7 und 7a, über `scripts/dev/bench-weekly.mjs` (BENCH-01/02 sind gemergt); sie stehen im Wochenbrief. Verfehlt eine Zeile nach zwei Wochen ihr Ziel, kommt sie als Frage in die Inbox, das Ziel wird nicht still gesenkt. Die Zahlen für M-IDLE stammen heute aus dem lokalen Log (nicht nachrechenbar); V2-SRV-1 und V2-B3 holen sie in die App.

## 4b. Betriebsregeln (ab G0)

| Regel | Inhalt | Durchsetzung |
|---|---|---|
| Wissensrangfolge | Repo (AGENTS.md, Plan) > AgentsRoom-Gedächtnis > lokale Notizen. Wöchentlicher Widerspruchs-Check, später durch den Core. Beleg am 06.10.: Fast Mode „an“ gegenüber „nie“ und Check „10 min“ gegenüber „30 min“ (lokale Notizen, im Repo nicht prüfbar) | V2-B12, V2-RULE-2 |
| Prozess-Diät | Neue Prozess-Werkzeuge nur, wenn sie ein altes ersetzen. Höchstens 20 % der Pakete je Woche sind Prozess oder Doku (V2-DIET-1). Beleg: 87 von 281 gemergten PRs seit 02.10. tragen „fix“ im Titel, 52 „docs“ | V2-DIET-1; Welle 0 ist wegen der Grundlagenpakete eine begründete Ausnahme |
| Ergebnis statt Durchsatz | Leitzahl: Kernteile mit bestandener Nutzerabnahme und Funktionen, die ein Tester benutzt hat, nicht die Zahl gemergter PRs | V2-KPI-1 |
| Sauberer Hauptcheckout | Agenten schreiben nie in den Hauptcheckout, nur in eigene Worktrees (der Checkout auf diesem Server liegt 959 Commits hinter `origin/main`). Ein Hygiene-Check meldet kaputte Dateinamen; Aufräumen nur mit Sicherung und Freigabe des Nutzers | V2-HYG-1, Frage 12 |
| Nachtruhe | Core · Aufmerksamkeit bündelt Fragen in ein festes Tagesfenster; nachts läuft nur, was keine Entscheidung braucht; der Nutzer muss nie wach bleiben, damit das System weiterläuft. Ausnahmen: Not-Aus und Sicherheit | V2-CORE-AT |
| Wochenbrief | Eine Seite je Woche: Ziel, erreicht, nicht erreicht, Kosten und Kontingente, genau 3 Entscheidungen mit Empfehlung; ersetzt Einzelmeldungen außer Not-Aus und Sicherheit | V2-BRIEF-1 |
| Abbruch vorab | Mehr als 2 Nacharbeitsrunden: das Paket wird geteilt oder gestrichen, nicht weiter geflickt; automatisch, Meldung im Wochenbrief | V2-STOP-1 |
| Ablaufdatum | Jeder Eintrag im Entscheidungslog trägt „Prüfen am“; der Core erinnert. Beleg: Fast Mode und das 1M-Kontextfenster wurden mehrfach anders entschieden | V2-DEC-1 |
| Ideen-Parkplatz | Neue Ideen gehen automatisch in den Ideen-Eingang (bis V2-S12: Abschnitt „Später“ in `docs/PLAN.md`); der Core sortiert sie einmal je Woche ein. **Höchstens 3 offene Entscheidungen gleichzeitig** (die 12 Fragen in Abschnitt 7 sind die einmalige Freigabe dieses Plans, danach gilt die Grenze). Laufende Wellen werden nicht umgeplant, außer bei Sicherheit oder einem roten `main` | V2-B13, Wochenbrief |
| Plan-Freeze | Nach der Freigabe ist dieser Plan das einzige Plandokument; er wird nur noch ausgeführt. Änderungen nur über Ideen-Parkplatz und Wochenbrief: höchstens eine Planänderung je Woche, mit Kosten, Nutzen und Freigabe des Nutzers | V2-FREEZE-1a/b, V2-RULE-2 |
| Dogfood | Ab DG1 (V2-DOG-1) zieht die Entwicklung schrittweise von `pa-orch` und AgentsRoom in die App; jeder Schritt ist umkehrbar | V2-DOG-1 |

## 5. Kritischer Pfad und Risiken

**Kritischer Pfad.** G0 → V2-ARCH-0 und V2-SEC-0 → Beweis-Kerne (B9, B10) → `store.rs`-Spur (12 Pakete, mit ST-B1 vorn und ST-K1 für den Core) → MN-K → Kern-Bildschirme (S03, S01, S02, S05a, S25) → V2-SEC-1 → G-Kern → V2-ACC1 → V2-REL. Der zweite Pfad ist die Frontend-Kette F1 → F9 → Kern-Bildschirme; die übrigen Bildschirme (hinter Schaltern) liegen nicht mehr auf dem Pfad zum Release. Der dritte ist die `api.rs`-Spur (12 Pakete, mit dem Webhook EX-2).

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

- **Der Core liest Fremdtext und ändert Einstellungen.** Prompt-Injection aus Repo-Inhalten und Agentenpost, Umgehung der Freigabe: V2-SEC-0 und V2-SEC-1 (Stufe A, zwei Fremd-Reviews) laufen vor dem ersten „Selbst mit Bericht“ ([`core.md`](core.md), Abschnitt 6).
- **Webhook braucht einen Weg von außen.** Ohne Antwort auf Frage 5 bleibt er aus; bedingtes Abfragen ersetzt ihn (Abschnitt 4a).
- **Plan-Freeze kann Leser brechen.** 25 Dateien nennen `docs/PLAN.md`; V2-FREEZE-1a legt vorher fest, wohin jeder Leser zeigt.
- **Prozess-Anteil in Welle 0.** Viele Doku- und CI-Pakete (Gates, Rechtscheck, Skizze) überschreiten dort die 20-%-Grenze der Prozess-Diät; die Ausnahme ist begründet, die Messung (V2-DIET-1) zeigt es.
- **Kern-Release lässt Seiten offen.** Was beim G-Kern nicht gemergt ist, läuft in 2.x weiter (Frage 2); die Schalter müssen aus-Zustand sicher machen (V2-FLAG-1).
- **Nutzungsbedingungen der Anbieter für automatisierte Abo-Nutzung sind ungeprüft** (V2-LEGAL-1); „prüfen“ gilt, keine Annahme.

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

## 7. Entscheidungs-Inbox (eine gebündelte Liste, höchstens 12 Fragen)

Die alten Fragen D1 bis D8 und alle neuen Entscheidungen stehen hier zusammen. Die E-Nummern vergibt der Koordinator beim Eintrag in `docs/PLAN.md`. Sortiert nach Dringlichkeit: Zeilen 1 bis 4 blockieren Welle 1, 5 bis 7 Welle 2, 8 bis 12 die Welle vor Beta, Testern und Verkauf. Zuordnung der alten Nummern: D1 = Frage 1, D2 und D3 = 4, D5 = 5, D4, D6, D7 und D8 = 6. Dieser Plan kostet kein Geld und löscht nichts. In „Ohne Antwort“ steht, was ohne Entscheidung geschieht (immer die vorsichtige Wahl).

| # | Frage | Empfehlung | Ohne Antwort |
|---|---|---|---|
| 1 | **Oberfläche hinter einem Schalter** (früher D1): „Neue Oberfläche (Vorschau)“, Standard aus, bis v2.0, damit v1.6.0 aus `main` keine halbe neue Oberfläche trägt | Ja; der Schalter fällt mit v2.0 weg (V2-ACC1) | Nur das Fundament (Abschnitt 2, ungenutzter Code) startet; kein Bildschirm |
| 2 | **Kern-Umfang und Release-Regel:** v2.0 erscheint, sobald der Kern aus 1a echt läuft (Beweis-Schicht, Leitstand, Agent starten mit Ort, Kontingente, Not-Aus, Core · Steuerung, Ersteinrichtung, Demo-Modus); alle anderen Seiten fertig gebaut, standardmäßig hinter Schaltern, 2.x schaltet sie frei | Ja | Planung läuft mit dem Kern aus 1a; es gibt kein Release-Datum und keinen Freischalttermin |
| 3 | **Core: Stufen und Grenzen** ([`core.md`](core.md)): Start auf „Vorschlagen“ in jedem Bereich; „Selbst mit Bericht“ nur für Orte, Kontingente und Benachrichtigungen, erst nach 24 h Probezeit-Beleg und nach V2-SEC-1; Geld, Rechte, Sicherheit, Löschen, Releases und die eigene Stufe bleiben für immer nur Vorschlag | Ja | Der Core arbeitet nur im Modus „Vorschlagen“ |
| 4 | **Arbeitsregeln der Nähte und der Größe:** (a) Nahtspuren abwechselnd, ein übernommenes Paket, dann ein v2.0-Paket (früher D2); (b) neue Größenregel aus Abschnitt 6, Stufe A 300, B 400, nur Frontend 600, netto, zwei Wochen Probe, mit CI-Gate und Ausnahme `size-ok` (früher D3); (c) Prozess-Diät: höchstens 20 % Prozess und Doku je Woche | Ja zu a, b und c; Rückkehr zu 300, wenn Fix-PRs über 8 % steigen | Es gilt 300 Diffzeilen; V2-GATE-SIZE läuft mit 300; Nähte nach der Reihenfolge der Spur |
| 5 | **Erreichbarkeit:** (a) Fernansicht nur im eigenen Netz und per SSH-Tunnel (früher D5); (b) wie erreicht ein GitHub-Webhook den Rechner: Tunnel des Nutzers, oder bis dahin bedingtes Abfragen | a Ja; b: erst Tunnel prüfen, bis dahin Abfragen mit `ETag` | Kein Zugang aus dem Internet; Webhook aus, bedingtes Abfragen |
| 6 | **Entwurfsregeln** (früher D4, D6, D7, D8): (a) Warten, Blockiert, Pausiert nur als Text, keine siebte Form; (b) die Glass-Boards ersetzen das HQ-Studio-Konzept; (c) Trigger starten nur Meldungen und Testläufe, kein Hintergrunddienst; (d) „Verbesserungen“ zeigt nur Schalter mit belegter Wirkung | Ja zu a bis d | Es gilt jeweils die vorsichtige Wahl: nur Text; Studio bleibt eingefroren; Trigger ohne Agentenstart; Schalter nur mit Beleg |
| 7 | **Server: Kosten gegen Nutzen** (E15): behalten, kleiner mieten oder kündigen; Entscheidungsgrundlage ist die monatliche Auslastungszahl aus V2-SRV-1 (Beleg: mehrere Leerlauf-Alarme „Server 0/8“ in der Nacht zum 06.10., lokales Log, nicht prüfbar) | Erst auslasten (Reserve ≥ 16, Abschnitt 4a), nach einem Monat entscheiden | Server bleibt unverändert; keine Kündigung, kein Kauf |
| 8 | **Rechtscheck** vor dem Verkauf (V2-LEGAL-1): Produktname, Domain, Marke; Nutzungsbedingungen der Anbieter für automatisierte Nutzung ihrer Abo-CLIs; Lizenz (heute MIT, E16); Datenschutz (Opt-in, Datenminimierung, Erklärung). Keine Rechtsberatung: für den Verkauf eine Fachperson fragen | Paket jetzt starten (kostenlos, Doku); Entscheidung mit den Quellen am Ende | Kein Verkauf, kein externer Tester, keine Telemetrie; „Fehler melden“ nur lokal; Lizenz bleibt MIT |
| 9 | **Monetarisierung und Plattformen** (V2-WEB-1): Preismodell, kleine Webseite, Mac und Linux (heute nur Windows, `release.yml` baut auf `windows-latest`) | Erst Demo-Modus und Webseite als Entwurf; Mac/Linux nur als Machbarkeitsstudie nach dem Kern-Release | Kein Preis, keine Webseite, nur Windows |
| 10 | **Code-Signatur des Installers:** Zertifikat kaufen (Geld), Alternative oder vorerst nicht. Ob der Installer heute ein Authenticode-Zertifikat trägt, ist nicht belegt (nur der Updater-Schlüssel, `build-signed-windows.mjs:12`) | Vorerst nicht kaufen; Testern Prüfsumme und Hinweis geben; vor dem öffentlichen Verkauf neu entscheiden | Kein Kauf; unsignierter Beta-Kanal nur für den Nutzer |
| 11 | **Plan-Freeze:** Nach der Freigabe ist dieser Plan das einzige Plandokument, ersetzt `docs/PLAN.md` und den v1.6.0-Plan (sie gehen ins Archiv), ab dann nur Ausführung; Änderungen höchstens einmal je Woche über Wochenbrief und Ideen-Parkplatz | Ja; zuerst die Leserliste V2-FREEZE-1a (25 Dateien lesen `docs/PLAN.md`) | `docs/PLAN.md` bleibt, wie es ist; beide Pläne laufen nebeneinander |
| 12 | **Aufräumen** (immer mit Sicherung, nie ohne dich): 5 von 13 Teams, die nie liefen (Zahl nicht prüfbar), alte Arbeitsbäume (E17), der Hauptcheckout mit kaputten Dateinamen | Erst melden lassen (V2-HYG-1), dann einzeln freigeben | Nichts wird gelöscht |

Schon offen und Voraussetzung für V2-REL: E3 (Secrets in geschützte Umgebungen), E14 (Sicherung des Schlüssels, dringend). Sie stehen in `docs/PLAN.md` und werden hier nicht neu gefragt. Die Fragen 1 bis 4 muss der Nutzer vor G0 beantworten; für alle anderen gilt „Ohne Antwort“.

## 8. NICHT ABGEDECKT

- Kein Build, kein Test, keine App wurde gestartet; die Zeilennummern gelten an der Basis 719426c.
- Die Boards wurden als Text gelesen, nicht gerendert; Zahlen und Namen in ihnen sind Beispieldaten.
- Die Größenschätzungen der Bildschirme (Abschnitt 3.4, 6) sind nicht gemessen.
- Anbieter, Modelle und Limits sind Vorschläge nach `docs/setup/providers.md`, nicht beobachtet.
- `pa-orch` ist nicht im Repo und wurde nicht gelesen.
- Review-Runden und rote Queue-Läufe je PR-Größe sind nicht gemessen (Abschnitt 6).
- Die Windows-Hälfte der späteren Pakete ist hier nicht Gegenstand; sie läuft in der Merge-Queue.
- Fremdkritik durch eine andere Modellfamilie: **ausstehend** (kein Ollama auf diesem Server, siehe Prompt-Log im PR-Text).
- Runde 2: Der Core, die Ausführung und die 36 Ergänzungen sind Entwurf; Datei-, Tabellen- und Schlüsselnamen legt V2-ARCH-0 fest. Das Board `glass/Core.dc.html` liegt noch nicht im Repo.
- AgentsRoom, `pa-orch`, `pipeline.py` und die lokalen Orchestrator-Zahlen sind nicht prüfbar; Aussagen darüber sind Nutzerangaben (siehe `evidence-r2.md`, Abschnitt 1).
- Die Schwellen der Quota-Regeln (70/90 %), die Reserve von 16, die Wochenziele und die Zulage je Naht sind Vorschläge; V2-CAP-1 und V2-ARCH-1 messen sie.
- Rechtliche, steuerliche und markenrechtliche Aussagen: keine geprüft; V2-LEGAL-1 liefert Quellen, keine Beratung.
- Die Zuordnung (`mapping.md`) beruht auf `git log origin/main --grep` und `gh pr list` am 06.10.; ein „erledigt“ ist nur dort belegt, wo eine PR-Nummer steht.

## 9. Ein Plandokument: Zuordnung und Freeze

Nach der Freigabe ist dieser Plan das **einzige** Plandokument. Er übernimmt `docs/PLAN.md` (M1 bis M4, M5, „Später“, Geparkt) und den v1.6.0-Plan; die alten Pläne kommen ins Archiv. Dieser PR ändert **nicht** `docs/PLAN.md`.

[`mapping.md`](mapping.md) gibt jedem offenen Paket genau ein Urteil mit Grund:

| Quelle | übernehmen (mit v2.0-ID) | nach v2.0 parken | streichen |
|---|---|---|---|
| `docs/PLAN.md` (M2 bis M5, Später, Geparkt, Inbox) | 35 Zeilen | 21 | 14 |
| `docs/plan/v1.6.0/plan.md` | 16 Zeilen | 0 | 8 (alles Gemergte) |

Fünf Hinweise zur Lesart: (1) Eine Zeile kann mehrere Pakete bündeln (Gruppen wie DEVFLOW). (2) „Streichen“ heißt bei Gemergtem „erledigt“ mit PR-Nummer, bei Offenem „fällt weg, bei Bedarf neu einplanen“. (3) Die Stand-Spalten beider Pläne sind veraltet: `docs/PLAN.md` führt R-1 und W4-04 als offen, v1.5.1 ist veröffentlicht. (4) Übernommene Pakete tragen `V2-` vor der alten ID und behalten Lane, Stufe, Größe und Abnahme der Quellzeile, bis V2-FREEZE-1a sie in den Plan kopiert. (5) Dauerbetrieb bleibt aus: seine Pakete sind geparkt oder gestrichen (D7), nicht übernommen.

**Freeze in zwei Paketen, beide erst nach Frage 11:**
- **V2-FREEZE-1a** (Leserliste): 25 Dateien nennen `docs/PLAN.md` (`rg -l "docs/PLAN.md" scripts src-tauri/src src .github package.json`, 06.10.). Darunter lesen `development_plan.rs` (DEVFLOW-Tabelle, 38 Zeilen), `hq-parse.mjs`, `ci.yml` und die PR-Vorlage den Plan maschinell. Jeder Leser bekommt ein Ziel; V2-H2 (ein Plan-Parser) ist Voraussetzung. Die übernommenen Zeilen werden nach `docs/plan/v2.0/` kopiert.
- **V2-FREEZE-1b** (Folge-PR): `docs/PLAN.md` wird zum Verweis, die alten Pläne und `docs/plan/roadmap/` gehen ins Archiv, `STAND.md` und `docs/ERLEDIGT.md` folgen, mit Sicherung vorher.

Ab dann gilt Regel „Plan-Freeze“ (Abschnitt 4b): nur Ausführung, höchstens eine Planänderung je Woche mit Kosten, Nutzen und Freigabe des Nutzers.
