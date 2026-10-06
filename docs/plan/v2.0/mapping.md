# Zuordnung: ein Plandokument (Anhang zu Plan v2.0)

Stand 06.10.2026, `origin/main` 01a0bf7. Jedes offene Paket aus [`docs/PLAN.md`](../../PLAN.md) (M1–M4, M5, Später, Geparkt) und aus [`docs/plan/v1.6.0/plan.md`](../v1.6.0/plan.md) hat hier genau ein Urteil: **übernehmen** (mit v2.0-Paket-ID), **nach v2.0 parken** oder **streichen**, jeweils mit Grund. `docs/PLAN.md` wird in diesem PR nicht geändert; das Ersetzen ist das Paket V2-FREEZE-1 (nach Freigabe, siehe `plan.md`, Abschnitt 9).

**Stand-Hinweis.** Die Stand-Spalten beider Pläne sind veraltet: `docs/PLAN.md` führt R-1 und W4-04 als „offen“, obwohl `gh release list` (06.10.2026) v1.5.0 (05.10., 21:18 UTC) und v1.5.1 (06.10., 00:00 UTC, Latest) zeigt; die v1.6.0-Pakete BENCH-01/02, FLOW-01 bis 07, WIN-01, V16-02, V16-07, M5-02, ARCH-D3a und ARCH-D6a stehen laut `git log origin/main --grep` als gemergt auf `main` (PR-Nummern unten). Ein Urteil „erledigt“ ist kein Paket. Wer ein „übernehmen“ startet, prüft vorher `git log --grep` und `gh pr list --search`, ob es nicht doch schon erledigt ist (Checkliste Punkt 2, v1.6.0 Abschnitt 6).

**ID-Regel.** Übernommene Pakete tragen `V2-` vor der alten ID (`ARCH-D2` → `V2-ARCH-D2`), `V16-nn` wird `V2-R-nn`. Lane, Stufe, Größe und Abnahme bleiben die der Quellzeile, bis V2-FREEZE-1 sie in den Plan kopiert.

## 1. `docs/PLAN.md`

### M2 bis M4 (nur Zeilen, die nicht „✓“ tragen)

| Quelle | Urteil | v2.0-ID | Grund |
|---|---|---|---|
| SETUP-14 (tote Keys, Permission-Regeln) | übernehmen | V2-N1 | Nutzer-Aufgabe, kein Agent; steht in der Wochenbrief-Liste |
| HQ2-03 (Tokens HQ) | streichen | – | ersetzt durch V2-F1 (Glass-Tokens, D6); Teile #311 und #326 sind gemergt |
| W1-18b, Codex-Teil | streichen | – | Probe lieferte eine Antwort (`projecta-workflow` gemeldet, 02.10.); den Rest deckt V2-B26 (Handbuch für Agenten) |
| ARCH-11 (KI-24b, Test-DB-Wettlauf) | übernehmen | V2-ARCH-11 | hält die Queue an, wenn er auftritt; braucht den Windows-PC |
| R-1 (Beta v1.5.0) | streichen | – | erledigt: v1.5.0 veröffentlicht (`gh release list`) |
| W4-04 (Release v1.5.1) | streichen | – | erledigt: v1.5.1 ist Latest (`gh release list`) |
| HQ2-05b (echte Proben je Anbieter) | übernehmen | V2-B21, V2-CLI-1 | Proben gehören in Kostenbuch und beobachteten CLI-Aufruf; Teil #341 gemergt |
| W5-02b3 (Env-Stufe global, st → api → fe) | übernehmen | V2-ST-A2 + V2-API-A | als Core-Schlüssel `env.level` mit einem Besitzer; Nutzerentscheid vom 04.10. gilt |
| W1-03f (Zustell-Queue, `pa worker done/blocked`) | nach v2.0 parken | – | gehört zum eingefrorenen Dauerbetrieb (AGENTS.md); kommt mit dem Einschalten |
| W3-07 (Produktionsschlüssel-Build, Signed-Updater-Relaunch) | übernehmen | V2-REL (Schritt) | Nutzer-Gate, hängt am Release; E14 bleibt Voraussetzung |
| W4-03 (Continuous-Aktivierung, fail-closed) | nach v2.0 parken | – | Dauerbetrieb bleibt aus (D7); der Schalter ist kein Kern |
| M4-Blocker (`planning_access` ohne Projektrahmen, TOCTOU) | übernehmen | V2-SEC-2 | Sicherheitsbefund; zuerst prüfen, ob er noch gilt; Orchestrator-Pakete nutzen die Planungsrouten |
| M4-R19-02/03/04/07/09 (Audit-Envelopes übrige Pfade) | nach v2.0 parken | – | Nutzer 04.10.: nach v1.5.1; Pfade gehören zum Dauerbetrieb |

### M5

| Quelle | Urteil | v2.0-ID | Grund |
|---|---|---|---|
| M5-01 (Testerrunde, 3 bis 5 Tester) | übernehmen | V2-TEST-1 | läuft über den internen Beta-Kanal (V2-BETA-1); blockiert durch Lizenz- und Rechtscheck (Frage 8) |
| M5-02 (README-Fokus) | streichen | – | erledigt, #576; die Neufassung für 2.0 steckt in V2-WEB-1 |
| M5-04 (Dogfooding) | übernehmen | V2-DOG-1, V2-O0 bis O5 | genau das ist Dogfood-Tor DG1 und der Hut „Arbeit“ |
| ARCH-D1, D2 | übernehmen | V2-ARCH-D1, V2-ARCH-D2 | Nahtstellen kleiner machen, bevor v2.0 sie größer macht |
| ARCH-D3 | übernehmen | V2-ARCH-D3b → V2-ARCH-D7 | Teil a ist gemergt (#577), Teil b ist als Entwurf offen (#587) |
| ARCH-D4 | übernehmen | V2-ARCH-D4a → D4b | wie oben |
| ARCH-D5 | übernehmen | V2-ARCH-D5a → D5b → D8a | wie oben |
| ARCH-D6 | übernehmen | V2-ARCH-D6b | Teil a ist gemergt (#579) |
| ARCH-D7 | übernehmen | V2-ARCH-D7 | folgt auf D3b |
| ARCH-D8 | übernehmen | V2-ARCH-D8a → D8b → D8c | Anker legt D8a fest |

### „Später“ und Architektur-Pakete

| Quelle | Urteil | v2.0-ID | Grund |
|---|---|---|---|
| Agenten per Protokoll statt Tippen steuern | nach v2.0 parken | – | Anbieter-Schnittstellen unbeobachtet; Core kommt ohne aus |
| ADR „st-Lane teilen“ | übernehmen | V2-ARCH-0 | die Architektur-Skizze entscheidet, wie `store/`-Module gleichzeitig laufen dürfen |
| Öffentlicher Neustart des Repos ohne Historie | nach v2.0 parken | – | nicht umkehrbar, Nutzer entscheidet; nicht Teil von 2.0 |
| Vorzeige-README für die Bewerbung | übernehmen | V2-LEARN-2 | Portfolio-Seite (lokal erzeugt, nie eingecheckt) |
| Prompt-Kompression, MCP-Injektion | nach v2.0 parken | – | Auslöser („Worker scheitert am Kontextlimit“) nicht beobachtet |
| Command Palette | übernehmen | V2-S16 | Board „Befehle“ |
| Globale FTS-Suche, Fokusmodus | nach v2.0 parken | – | Nutzer vermisst sie nicht (Auslöser) |
| Remote-Board | übernehmen | V2-H3, V2-H4, V2-H6 | Fernansicht |
| Ideen-Pipeline, Zeitachse, Vorschlags-Tab | übernehmen | V2-B13, V2-S12, V2-S06 | Ideen-Triage und Roadmap-Board |
| hermes-agent, Multi-Harness | nach v2.0 parken | – | Multi-Harness teilweise durch V2-CLI-1/2 |
| Dependabot-Majors | nach v2.0 parken | – | einzeln, nach dem Kern-Release |
| Tauri-Plugins `dialog`, `notification`, `window-state` | nach v2.0 parken | – | erst wenn ein Paket sie braucht (V2-B11 prüft `notification`) |
| OmniRoute-Cutover | nach v2.0 parken | – | erst mit gemessenem Kostensieg |
| Design Studio, Queen/Employee-Neuanlage | streichen | – | steht schon als „nie“ da; D6 ersetzt das Studio-Konzept |
| W2-02b-Rest „Merge-Ergebnis als Kandidat“, M4-W2-Merge-Vertrag | nach v2.0 parken | – | Vertrag der Upstream-Quelle ungeklärt; hängt am Dauerbetrieb |
| Abschlussvertrag für Headless-Läufe | übernehmen | V2-EX-5 | „fertig“ nur mit Gate-Exit, SHA, `ls-remote`, PR |
| Sicheres Aktionsmuster (nummerierte Liste) | übernehmen | V2-SEC-1 | Core wählt nur aus einer erzeugten Liste erlaubter Änderungen |
| Startcheck-Doku, Abhängigkeits-Drift | streichen | – | erledigt: `start-check --deps` (#528) |
| PTY-Read/Emit-Diagnose | nach v2.0 parken | – | erst mit eingespeistem Beleg |
| ARCH-01, ARCH-09c | streichen | – | erledigt (#166, #167, #269) |
| ARCH-12 (`ControlBackend` aus `main.rs`) | nach v2.0 parken | – | F1: `ApiBackend` bleibt in `main.rs`; eine Verschiebung würde jedes V2-MN-Paket stören |
| INV-SEC-CREDENTIAL-EXPIRY/-CLEANUP | übernehmen | V2-INV-SEC-CRED | #578 ist offen (`gh pr list`, 06.10.) |
| API-Descriptor (private Datei unter Unix) | übernehmen | V2-SEC-0 (Prüfpunkt) | geht in das Bedrohungsmodell ein, Paket nur bei Befund |
| INV-SEC-PRIVATE-PATHS | nach v2.0 parken | – | Idee ohne Befund |
| Frontend: `HistoryView.tsx:47` | streichen | – | die Ansicht wird von V2-S04 ersetzt; roter Test zuerst, falls vorher gebraucht |
| Queue: drei offene Punkte (`status.rs:1474`, Worker-Limits, 30-s-Sweep) | übernehmen | V2-B4 | Warteschlange mit Vorgängern prüft sie zuerst |
| HQ: Restzeit, `blocked`, UTC, Body-Limit | streichen | – | erledigt in V16-07 (#495); HQ eingefroren (V2-H1) |
| Tests und Plattform (`resources.rs`) | übernehmen | V2-B23 | Grenzen je Job prüfen |
| Performance (`useQuestions`, Digest) | nach v2.0 parken | – | erst messen; Leistungsbudget V2-GATE-PERF liefert die Zahlen |
| Ops-Prozess: Tier-Einordnung, „Review disposition“ | übernehmen | V2-B9, V2-O5 | Beleg am 06.10.: die Regex in `pipeline.py` stufte #578 als B ein; `src/lib/reviewClass.ts:19` stuft denselben Pfad als A ein |
| Wartezeit (CI-06 semantisch, Flake-Auswertung) | nach v2.0 parken | – | `--plan` reicht heute; Flake-Auswertung läuft schon (E11) |
| Doku (Link-Prüfer) | nach v2.0 parken | – | Komfort |
| Links auf den v1.6.0-Plan und `docs/plan/roadmap/` | streichen | – | beide Pläne gehen im Archiv auf (V2-FREEZE-1); der Fahrplan v1.7 bis v1.9 widerspricht der Entscheidung „ein großes Release“ |

### Geparkt und Gestrichen (Gruppen)

| Quelle | Urteil | v2.0-ID | Grund |
|---|---|---|---|
| W5 außerhalb des Kerns (W5-01 bis W5-39 laut Tabelle) | nach v2.0 parken | – | Projekt-System; Teile mit v2.0-Pendant: W5-30/33 Routing → V2-B2, W5-02d Review-Befugnis → V2-B10, W5-31 (App zu, Worker laufen weiter) bleibt aus (D7) |
| DEVFLOW-Motor DF-11, DF-13 bis DF-17, DF-06b, DF-08d | streichen | – | eine zweite Steuerung neben dem Core; Core · Arbeit und V2-B16 ersetzen sie (es gibt keinen zweiten Orchestrator) |
| DEVFLOW-Ausbau DF-21 bis DF-25, DF-27, DF-28 | nach v2.0 parken | – | Erweiterungskatalog, Architekturansicht, Livebild: kein Kern |
| DF-29 bis DF-32 (Messung, Statistik, Prognose) | übernehmen | V2-B21, V2-S06, V2-CAP-1 | Kostenbuch und Vorhersage aus echtem Durchsatz |
| DF-33, DF-34 (Vorlagen) | übernehmen | V2-S09, V2-S22 | Personas- und Ablauf-Vorlagen |
| DF-09b, DF-10 (Profilwahl, Chat-Modi) | übernehmen | V2-S02, V2-S07 | Start-Sheet und Orchestrator-Chat |
| HQ2-04, HQ2-06 bis HQ2-10 | streichen | – | die Glass-Boards ersetzen das HQ-Studio (D6); Routing HQ2-07 → V2-B2 |
| W1-09c, W1-12, W4-03a, W3-09 | nach v2.0 parken | – | Komfort oder inaktiv |
| Entscheidungs-Inbox E3, E14 | übernehmen | V2-REL (Voraussetzung) | bleiben Nutzer-Gates |
| E15 (Server bleibt?) | übernehmen | Frage 7 | Auslastungszahl liefert V2-SRV-1 |
| E16 (Lizenz, Geschäftsmodell) | übernehmen | Frage 8 und 9 | Rechtscheck V2-LEGAL-1 |
| E17 (alte Arbeitsbäume) | übernehmen | Frage 12 | Löschen entscheidet der Nutzer, vorher Sicherung |
| E21, E22 (Matrixzeilen 2 und 16 für v1.5.0) | streichen | – | gegenstandslos: v1.5.0 und v1.5.1 sind veröffentlicht |
| E23 (Benchmark-Lauf, Abo-Verbrauch) | übernehmen | V2-CAP-1 | liefert Token-Mediane je Paket |

## 2. `docs/plan/v1.6.0/plan.md`

| Quelle | Urteil | v2.0-ID | Grund |
|---|---|---|---|
| V16-01 (KI-30) | übernehmen | V2-R-01 | #518 hat einen Teil behoben; offen ist die Messung über 40 Queue-Läufe, Ende kann „Bericht“ sein |
| BENCH-01, BENCH-02 | streichen | – | erledigt (#496, #530); Erweiterungen: V2-KPI-1, V2-DIET-1 |
| FLOW-01, 02, 03, 04, 05, 06, 07 | streichen | – | erledigt (#493, #523, #553, #528, #567, #509, #510) |
| WIN-01 | streichen | – | erledigt (#505) |
| V16-02 (Doku-Sync) | streichen | – | erledigt (#494) |
| M5-02 | streichen | – | erledigt (#576) |
| V16-03 (Tester-Kit) | übernehmen | V2-TEST-1 | geht im Testpaket auf; Lizenzfrage zuerst |
| INV-SEC-CRED-CLEANUP | übernehmen | V2-INV-SEC-CRED | #578 offen |
| ARCH-D1, ARCH-D2 | übernehmen | V2-ARCH-D1, V2-ARCH-D2 | siehe oben |
| V16-06 (Start nach Update ohne Journal) | übernehmen | V2-R-06 + V2-UPD-1 | Update-Drill am PC; Abbrechen-Knopf und Versionsanzeige kommen dazu |
| ARCH-D3a, ARCH-D6a | streichen | – | erledigt (#577, #579) |
| ARCH-D3b → D7, D4a → D4b, D5a → D5b → D8a, D8b → D8c, D6b | übernehmen | V2-ARCH-D3b … V2-ARCH-D6b | wie oben; #587 (D3b) ist offen |
| V16-07 (HQ ehrlich) | streichen | – | erledigt (#495) |
| V16-08 (CRLF-Gate) | übernehmen | V2-R-08 | ci, klein |
| ARCH-09c | streichen | – | erledigt (#269) |
| ADR-A1 → A7 | übernehmen | V2-ARCH-0 | A7 (st-Lane) geht in die Skizze; A1 (`ApiBackend` teilen) wird mit ARCH-12 geparkt |
| L1 Auftrags-Erzeuger mit Kritik | übernehmen | V2-EX-5 | Kritik vor dem Start |
| L2 Reserve füllt freie Plätze | übernehmen | V2-EX-4 | Reserve ≥ 16 |
| L3 Sperre für Dateien offener PRs | übernehmen | V2-B3, V2-B4 | Startprüfung kennt belegte Naht und Dateien |
| L4 Review-Fahrer auf den Server | übernehmen | V2-O5 | Hut „Arbeit“ |
| L5 Anbieteranteil | übernehmen | V2-CAP-1 | kein Anbieter über 50 % |
| L6 Prüfskript für Review-Prompts | übernehmen | V2-EX-5 | Teil der Spec-Kritik |
| BENCH-03 (Wochenaggregat M-IDLE, M-HUMAN, M-RP) | übernehmen | V2-KPI-1, V2-SRV-1 | Leerlauf und Auslastung aus der App statt aus dem lokalen Log |
| Fragen 1 bis 5 (Richtung, Audit-Reste, Update-Start, Ollama-Client, Freigabe je Welle) | übernehmen | Frage 4 und 11 | Freigabe je Welle steht im Wochenbrief; Frage 2 entfällt (M4-R19-0x geparkt); Frage 3 und 4 sind Voraussetzungen von V2-R-06 und V2-O5 |

## 3. Zahlen

Gezählt in den Tabellen oben (Gruppenzeilen zählen je eine): **übernehmen** 51, **nach v2.0 parken** 21, **streichen** 22 Zeilen (94 Zeilen). Prüfung am Ende: `rg -c "^\| .* \| (übernehmen|nach v2.0 parken|streichen) \|" docs/plan/v2.0/mapping.md`.
