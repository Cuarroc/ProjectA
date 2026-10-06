# Belege der Ergänzungen (Anhang zu Plan v2.0, Runde 2)

Stand 06.10.2026, `origin/main` 01a0bf7. Der Nutzer hat 36 Ergänzungen freigegeben. Jede Belegbehauptung darin wurde gegen das Repo geprüft, soweit das Repo sie enthält. Wo der Befund abweicht, gilt der Befund; die Abweichung steht in Abschnitt 1 und im PR-Text. Abschnitt 2 ordnet jeden Punkt einem Paket, einer Regel oder einer Frage zu.

## 1. Prüfung der Belege

| Punkt | Behauptung | Befund | Befehl |
|---|---|---|---|
| 3 | PR 578 ist ein Sicherheits-PR, offen, nur Beleg, die ungetestete Regex in `pipeline.py` stufte ihn als B ein | #578 ist offen (`fix(agent-access): report descriptor file removal failures`) und ändert nur `src-tauri/src/api/agent_access.rs`. Die Stufe A folgt aus `src/lib/reviewClass.ts:19` (`agent_access` im Dateinamen). `pipeline.py` liegt nicht im Repo: die Regex-Behauptung ist **nicht prüfbar** (Paket V2-O0 holt das Skript ins Repo) | `gh pr view 578 --json files,state`; `sed -n 15,25p src/lib/reviewClass.ts` |
| 6 | #579 hatte 417 Diffzeilen, erlaubt waren 150 | **bestätigt:** 221 Zeilen hinzu, 196 weg = 417; ARCH-D6a ist im v1.6.0-Plan eine S-Zeile (≤ 150) | `gh pr view 579 --json additions,deletions` |
| 11 | Updater ohne Abbrechen-Knopf und Versionsanzeige nach dem Neustart | **teilweise:** `src/components/settings/UpdatesTab.tsx:29-33` zeigt die laufende Version; ein Abbrechen-Knopf fehlt (`rg -i "cancel\|abbrech"` in der Datei: leer). Den Update-Drill vom 06.10. gibt es als Beleg nur beim Nutzer | `rg -n -i "cancel\|abbrech\|version" src/components/settings/UpdatesTab.tsx` |
| 12 | Sicherung in der App mit Wiederherstellungstest | Bausteine vorhanden: `src-tauri/src/db_restore.rs`, `scripts/backup-db.sh`, `scripts/restore-probe.sh`; eine Bedienung in der App und ein automatischer Test fehlen | `ls` der drei Dateien |
| 13 | Secret-Scan vor dem Senden | `scripts/ci/secret-scan.sh` und das Gate `SEC-01` (gitleaks) gibt es; ein Sendeweg „Fehler melden“ nicht | `ls scripts/ci/secret-scan.sh` |
| 14 | Feature-Flags | **fehlen:** `rg -il "featureFlag\|feature_flag\|feature flag" src src-tauri/src` ist leer | siehe links |
| 16 | Reichweite heute nur Windows | **bestätigt:** `release.yml` baut nur auf `windows-latest` (Zeilen 43 und 57), Installer NSIS und MSI | `rg -n "runs-on" .github/workflows/release.yml` |
| 18 | Fast Mode „an“ gegenüber „nie“, Check „10 min“ gegenüber „30 min“ | **nicht prüfbar:** stammt aus lokalen Notizen außerhalb des Repos | – |
| 19 | Seit 02.10. 276 gemergte PRs, 82 mit „fix“ (30 %), 52 „docs“ (19 %) | **abweichend, aktueller:** 281 gemergte PRs mit `mergedAt` ab 2026-10-02 (letzter 06.10., 01:41 UTC), 87 mit „fix“ im Titel (31 %), 52 mit „docs“ (19 %). Nur am Titelanfang (`^fix`, `^docs`): 79 und 51. Die Größenordnung stimmt | `gh pr list --state merged --limit 600 --json number,title,mergedAt`, Zählung per Skript |
| 19 | 5 von 13 Teams liefen nie | **nicht prüfbar:** AgentsRoom-Bestand, nicht im Repo | – |
| 21 | Hauptcheckout 955 Commits hinter `main`, Dateien mit kaputten Namen (`!fs.existsSync(dir`, `20`, `S.dec[id]`) | Der Checkout auf **diesem Server** ist 959 Commits hinter `origin/main` (`git rev-list --count HEAD..origin/main`), Dateien dieser Namen liegen dort **nicht** im obersten Verzeichnis (`ls`). Die Angabe kann den Checkout am PC meinen: nicht prüfbar. `scripts/dev/hygiene.mjs` Prüfung 5 meldet schon unversionierte Dateien im Hauptcheckout; sie kennt keine kaputten Namen und keinen Rückstand | `git -C <Hauptcheckout> rev-list --count HEAD..origin/main`; `sed -n 1,12p scripts/dev/hygiene.mjs` |
| 26 | Leerlauf-Alarme „Server 0/8“ in der Nacht zum 06.10. | **nicht prüfbar:** lokales Orchestrator-Log (wie die Zahlen in v1.6.0, Abschnitt 11) | – |
| 30 | `api.rs` 8091, `store.rs` 7227, `bin/pa.rs` 6490, `main.rs` 5133 Zeilen | **bestätigt für die v1.6.0-Basis und teilweise überholt:** an `origin/main` 01a0bf7 hat `api.rs` 8091 und `main.rs` 5133 Zeilen, `store.rs` 7224 (ARCH-D3a, #577) und `bin/pa.rs` 6340 (ARCH-D6a, #579). V2-ARCH-1 startet mit den neuen Zahlen | `git show origin/main:src-tauri/src/<datei> \| wc -l` |
| 32 | Codex-Modellnamen haben sich geändert (`gpt-5.6-sol` statt `gpt-6-sol`) | **bestätigt:** `docs/setup/providers.md:42,56` nennt `gpt-5.6-sol` und `gpt-6-astra`; `gpt-6-sol` kommt in `docs/setup` nicht vor | `rg -n "gpt-5.6\|gpt-6" docs/setup/providers.md` |
| 33 | Unsignierte Windows-Installer lösen SmartScreen-Warnungen aus | Das Repo kennt nur den **Updater-Schlüssel** (Tauri, `build-signed-windows.mjs:12`). Ob der Installer ein Authenticode-Zertifikat trägt, ist **nicht belegt**: „prüfen“ | `rg -n "SIGNING" scripts/build-signed-windows.mjs` |
| 35 | Playwright je Kernseite | **ohne neue Abhängigkeit möglich:** `@playwright/test` steht in `package.json:63`, Skript `test:e2e` in `:22`, `e2e/` hat zwei Specs. Abnahme-Gate und Handbuch bauen darauf | `rg -n playwright package.json` |
| 8 | Design-Gate aus den Audit-Skripten | Die Audit-Skripte (Kopfzeile, Radien, Schalterfarbe, Zustandsformen, abgeschnittener Text) sind **nicht im Repo** (`git ls-files \| rg audit`: nur `continuous-audit.mjs`, unabhängig). Den Kontrast-Teil gibt es: `scripts/contrast-check.mjs`. Der Koordinator übergibt die übrigen Skripte (wie `pa-orch` in V2-O0) | `git ls-files \| rg -i audit` |
| 4 | Token-Mediane je Paket aus „den Messdaten“ | `docs/plan/v1.6.0/benchmark.md` enthält **keine** Token-Zahlen (`rg -i token` leer). Das Repo hat `usage_events` (`store.rs:1591`); V2-CAP-1 misst zuerst, bevor es rechnet | `rg -n -i token docs/plan/v1.6.0/benchmark.md` |
| 15 | Ein Lizenzvorschlag | `LICENSE` ist **MIT** (`LICENSE:1`, Eintrag „Copyright (c) 2026“). Die Frage ist nicht „Lizenz fehlt“, sondern „MIT behalten oder ändern“ (E16) | `head -3 LICENSE` |
| 31 | `docs/PLAN.md` wird ersetzt | 25 Dateien nennen `docs/PLAN.md` (unter anderem `development_plan.rs`, `store/development_plan.rs`, `development_plan_access.rs`, `scripts/lib/hq-parse.mjs`, `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `scripts/ci/lane-plan.sh`). `development_plan.rs` liest die DEVFLOW-Tabelle (38 Zeilen). Das Ersetzen braucht zuerst eine Leserliste: V2-FREEZE-1a | `rg -l "docs/PLAN.md" scripts src-tauri/src src .github package.json` |

Die Stand-Spalten der Pläne sind teils veraltet (siehe `mapping.md`, Stand-Hinweis); auch `plan.md` Abschnitt 4.1 wurde nachgeführt: #577 und #579 sind gemergt, #587 (D3b) und #578 sind offen.

## 2. Punkt → Paket, Regel oder Frage

| Punkt | Wohin |
|---|---|
| 1 Kern und Schalter | `plan.md` 1a; V2-FLAG-1; Frage 2 |
| 2 Beweis-Schicht zuerst | Wellen (Abschnitt 4): V2-B9, V2-B10, V2-MQ1, V2-ST-B1 in W1 |
| 3 Tor D1 | V2-DOG-1, V2-O0, V2-RUN-1 bis V2-RUN-4 (Abschnitt 3.5, 4b) |
| 4 Kapazität | V2-CAP-1; Abschnitt 4a |
| 5 Ausführung in AgentsRoom | Abschnitt 4a; V2-EX-1, EX-2, EX-4 bis EX-6 (EX-3 steckt in V2-RUN-2) |
| 6 Größenregel als Gate | V2-GATE-SIZE (Abschnitt 6, Frage 4) |
| 7 Abnahme je Welle | V2-UAT-1 |
| 8 Design-Gate | V2-GATE-DESIGN |
| 9 Leistungsbudgets | V2-GATE-PERF |
| 10 Bedrohungsmodell | V2-SEC-0, V2-SEC-1 |
| 11 Migration, Updater | V2-MIG-1, V2-UPD-1 (mit V2-R-06) |
| 12 Sicherung | V2-B24 (mit Wiederherstellungstest) |
| 13 Fehler melden | geparkt (`plan.md` 3.13); lokales Paket wie heute |
| 14 Beta-Kanal, Flags | V2-BETA-1, V2-FLAG-1 |
| 15 Rechtscheck | geparkt (3.13); Bedingungen der Anbieter in V2-CLI-0 |
| 16 Monetarisierung | geparkt (3.13) |
| 17 Demo-Modus | geparkt (3.13) |
| 18 Rangfolge des Wissens | Regel in Abschnitt 4b; V2-B12; V2-RULE-2 |
| 19 Prozess-Diät | Regel in 4b; V2-KPI-1; Frage 11 |
| 20 Ergebnis statt Durchsatz | V2-KPI-1 |
| 21 Sauberer Hauptcheckout | Regel in 4b; V2-HYG-1; Frage 11 |
| 22 Nachtruhe | V2-CORE-AT; Regel in 4a |
| 23 Wochenbrief | V2-BRIEF-1 |
| 24 Abbruch-Regeln | V2-BRIEF-1 |
| 25 Entscheidungen mit Ablaufdatum | V2-DEC-1 |
| 26 Server: Kosten gegen Nutzen | V2-CAP-1; Frage 7 |
| 27 Ideen-Parkplatz | Regel in 4b; V2-B13 |
| 28 Lernmodus | V2-UAT-1, V2-LEARN-2 |
| 29 Architektur-Skizze | V2-ARCH-0 |
| 30 Nichts Neues in die Nähte | V2-ARCH-1 |
| 31 M1–M4 einordnen | `mapping.md`; Abschnitt 9 |
| 32 CLI-Vertragstests | V2-CLI-3 |
| 33 Code-Signatur | geparkt (3.13) |
| 34 Datenschutz | V2-PRIV-1 bis 3 (Kundendaten), Frage 8; Versand mit Opt-in geparkt |
| 35 E2E und Handbuch | V2-E2E-0; Handbuch geparkt; je Kernseite im U-Standard |
| 36 Plan-Freeze | V2-FREEZE-1a/b; Regel in 4b; Frage 10 |

## 3. Belege der Richtungsentscheidung (Runde 3, 06.10.2026)

Gelesen und gezählt, nichts gestartet.

| Aussage | Befund | Befehl |
|---|---|---|
| Alle 25 Boards tragen denselben Block | Prüfsumme der Zeilen 15–229 von `Main.dc.html` gleich bei allen 25 Dateien (auch `Core.dc.html`) | `sed -n 15,229p <Board> \| md5sum` je Datei, Ergebnis `same=25` |
| Größe der Boards | 508 bis 1572 Zeilen, Summe 17149 (Plan 1572, Gedächtnis 1201, Core 1165) | `wc -l docs/design/2026-10-ui-v2/glass/*.dc.html` |
| Boardanker haben sich verschoben | Material `Main.dc.html:69-71`, Bewegung `:255-260,267`, Zustandswörterbuch `:216-224`, Schale `:331,379,390`, Tabs `Kontingente.dc.html:425`, Sheet `AgentStarten.dc.html:432` | `rg -n` auf die genannten Klassen |
| Die Boards zeigen zehn CLIs und Ollama Cloud als letzte Stufe | `AgentStarten.dc.html:577-586` (Claude, Codex, Kimi, OpenCode, Gemini, Copilot, Kilo, Ollama, Cursor, Grok); `:532` Ollama `glm-5.2:cloud`, „danach Pause statt Rechnung“ | `sed -n 575,587p`; `rg -n Ollama` |
| Ollama ist im Bestand | Profil `agent-defaults.json:76` (`ollama run llama3.2`), Cloud-Profil `:86`; Anbieter `providers.rs:194`, Port 11434 `:82`, lokaler Verbrauch `:1064` | `rg -n -i ollama src-tauri/resources/agent-defaults.json src-tauri/src/providers.rs` |
| Maskierung vorhanden, PII-Muster fehlen | `src-tauri/src/redact.rs:213` (`pub fn redact`); `rg -i "email\|phone\|password\|passwort\|@" src-tauri/src/redact.rs` ohne Treffer | `rg -n "fn redact" src-tauri/src`; die zweite Zeile |
| Playwright vorhanden und Apache-2.0 | `package.json:62` (`@playwright/test`), `node_modules/@playwright/test/package.json:16` `"license": "Apache-2.0"` | `rg -n playwright package.json`; `rg -n '"license"' node_modules/@playwright/test/package.json` |
| Paketzahl vor Runde 3 | 163 eindeutige Pakete in den Tabellen ab 3.1, 215 mit den `×M`-Schnitten (ohne übernommene Pakete) | Zählskript in `size-evidence.md` auf dem Stand `25e7c95` |
