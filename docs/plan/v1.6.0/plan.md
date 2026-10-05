# Plan v1.6.0 (Entwurf, der Nutzer entscheidet)

Stand 05.10.2026, Basis `2ec6960` (`origin/main`). Dieser Entwurf ändert nichts an M1–M4 (`docs/PLAN.md`, Regel 2). Er gilt erst, wenn der Nutzer die Fragen in Abschnitt 10 beantwortet hat. Der Nachweis zur Arbeitsweise steht in [`benchmark.md`](benchmark.md).

## 1. Ziel

v1.6.0 macht ProjectA bereit für die ersten externen Tester: Die App startet nach einem Update sicher, das README sagt klar, wofür sie da ist, und es gibt ein Tester-Kit. Die vier Nahtstellen werden kleiner, und der Windows-Flake, der die Merge-Queue anhält, verschwindet. Die Arbeitsweise wird messbar besser: weniger Nacharbeit und Leerlauf, mit Wochenmessung und rekursivem Prompting als Pflicht.

Fertig ist v1.6.0, wenn alle Kern-Pakete gemergt sind, jede der vier Nahtstellen weniger Zeilen hat als an der Basis (`wc -l`: `api.rs` 8091, `store.rs` 7227, `bin/pa.rs` 6490, `main.rs` 5133) und zwei Wochenmessungen vorliegen.

## 2. Was sich an der Arbeitsweise ändert

Der Benchmark sagt: PRs landen viel schneller (p90 127 h → 3 h), aber die Nacharbeit ist nicht gesunken, und Plätze stehen oft leer. Darauf zielen die Änderungen. Red-first, `prepush`, gestufte Reviews, serielle Nähte, Merge nur über die Queue und die Hoheit des Nutzers bleiben unverändert.

| # | Engpass heute (Beleg) | Änderung | Wo | Metrik |
|---|---|---|---|---|
| S1 | Plätze frei, nichts startbar: 99 Leerlauf-Alarme in 3 Tagen (nur lokal) | Eine freigegebene Welle wird komplett eingereiht; Reserve ≥ 16 startbare Aufträge; jeder freie Platz wird sofort gefüllt | lokal | M-IDLE, M-THR |
| S2 | 28 Konflikt-Aufträge, 1 Naht-Kollision auf `main.rs` (03.–05.10., nur lokal) | Lane = Kette: ein neuer Auftrag wartet auf den letzten derselben Lane; keine Datei eines offenen PRs; plan-lint prüft die Tabelle | lokal, FLOW-03 | M-REWORK |
| S3 | 32 von 479 Aufträgen endeten blockiert, 13 davon vermeidbar (nur lokal) | Rekursives Prompting für jeden Auftrag (Abschnitt 6) | lokal, FLOW-01/02 | M-RP, M-REWORK |
| S4 | 10 Blockaden durch die Umgebung (fehlende Abhängigkeiten, alter Basispunkt; nur lokal) | Der Startcheck prüft das vor dem Start | FLOW-04 | M-REWORK |
| S5 | 15,5 % rote Queue-Läufe (`benchmark.md`, Abschnitt 3) | Die Flake-Ursache ist das erste Paket (V16-01) | Repo | CI, M-LEAD |
| S6 | Reviews laufen nur über den PC | Review-Fahrer auf den Server | lokal, Frage 5 | M-LEAD |
| S7 | Ein Anbieter lieferte 128 von 213 gemergten PRs seit 02.10. | Kein Anbieter über 50 % pro Woche; Routing nach Restkontingent | lokal | M-THR |
| S8 | Einzelfragen unterbrechen den Nutzer | Entscheidungen gebündelt vor jeder Welle, Freigabe je Welle | `docs/PLAN.md`, Frage 6 | M-HUMAN |

## 3. Pakete

Größe: S ≤ 150, M ≤ 300 Diffzeilen mit Tests (Schätzung, vor dem Start messen). Stufe A/B/C nach AGENTS.md, Regel 5. Anbieter sind Vorschläge nach `docs/setup/providers.md`: astra/sol/terra = Codex (erst ab G2), glm-5.3/deepseek = OpenCode. Vor jedem Start gilt `npm run dev:start-check`.

**Kern (17 Pakete)**

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme (messbares Signal) |
|---|---|---|---|---|---|---|---|---|
| V16-01 | Windows-Flake: Test-Tempdir sauber freigeben (`workers.rs:4857`, „os error 32“) | wk | – | B | S | – | deepseek, sonst Claude | Roter Test zuerst (`Regression-For:` Run 37301269691); 0 Fehlschläge dieser Art in den nächsten 40 Queue-Läufen |
| BENCH-01 | Wochenmessung als Skript `scripts/dev/bench-weekly.mjs`, nur lesend | ci | – | B | M | – | glm-5.3, sonst Claude | Test mit JSON-Fixtures; die Ausgabe enthält jede Metrik aus `benchmark.md`, Abschnitt 6 |
| BENCH-02 | Montags-Workflow, der BENCH-01 ausführt (nur Leserechte, kein Commit) | ci | – | B | S | BENCH-01 | glm-5.3 | Ein Lauf per `workflow_dispatch` ist grün, der Bericht steht in der Job-Summary |
| FLOW-01 | Standard für rekursives Prompting: `docs/development/prompting.md` mit Checkliste und Vorlagen | doc | – | C | S | – | glm-5.3 | Datei vorhanden; `npm run dev:agent-check` Exit 0 |
| FLOW-02 | PR-Vorlage bekommt den Abschnitt `### Prompt-Log` | ci | – | C | S | FLOW-01 | glm-5.3 | ≥ 8 der nächsten 10 Paket-PRs tragen ein Prompt-Log |
| FLOW-04 | Startcheck `--deps`: fehlende oder veraltete Abhängigkeiten und alter Basispunkt geben Exit 1 | ci | – | B | S | BENCH-01 | glm-5.3 | Roter Test zuerst; Umgebungs-Blockaden ≤ 2 pro Woche (Basis 10 in 3 Tagen, lokal) |
| FLOW-03 | plan-lint: prüft diese Tabelle (Größe, Stufe, Lane, nie zwei Pakete einer Naht zugleich, Abnahme vorhanden) | ci | – | B | M | FLOW-04 | glm-5.3, sonst Claude | Exit 0 auf diesem Plan, Exit 1 auf einem präparierten Fehlerfall |
| FLOW-05 | M-RP-Zähler: liest PR-Texte und zählt Prompt-Log, Runden und Befunde | ci | – | B | M | FLOW-03, FLOW-02 | glm-5.3 | JSON-Ausgabe; der Montagslauf zeigt M-RP |
| FLOW-06 | Ein Satz in `AGENTS.md`: rekursives Prompting ist Pflicht | doc | – | C | S | Frage 4 | Koordinator | `npm run dev:agent-check` Exit 0 |
| V16-02 | Doku-Sync: Erledigtes steht nicht mehr als „offen“ da (KI-16, KI-19, M5-03, CSP, FE-Stale, FJ-*) | doc | – | C | S | dieser PR gemergt, Zuweisung durch den Koordinator | glm-5.3 | Prüfliste im PR: 0 gemergte IDs mit Stand „offen“ |
| M5-02 | README: Produktfokus „sicherer Dauerbetrieb: Not-Aus, Kostenkontrolle, Protokoll“ | doc | – | C | S | G1 | glm-5.3 | Der Fokus-Satz steht in den ersten 30 Zeilen des README |
| V16-03 | Tester-Kit: Installation, Rückmeldeformular, bekannte Grenzen | doc | – | C | S | G1, E16 | glm-5.3 | Trockenlauf: Installation nach Anleitung in einem frischen Windows-Konto, Protokoll im PR |
| INV-SEC-CRED-CLEANUP | Abgelaufene Zugriffs-Grants löschen; Löschfehler melden statt verschlucken (`api/agent_access.rs:364`) | api | – | A | S | G1 | Claude, ab G2 astra | Roter Test zuerst: ein Löschfehler erscheint im Ergebnis |
| ARCH-D1 | Die HTTP-Fehlertext-Klassifizierer zu einem zusammenführen | api | api.rs | A | S | INV-SEC-CRED-CLEANUP | Claude, ab G2 astra | Genau 1 Klassifizierer (`rg`); `api::tests` grün; `api.rs` < 8091 Zeilen |
| V16-06 | KI-31-Rest: Der Start nach einem Update ohne Journal blockiert nicht mehr stumm | mn | main.rs | A | M | G1, Frage 3 | astra (G2), sonst Claude | Roter Test zuerst; Update-Drill (Erfolg, Abbruch, Fehler): der nächste Start gelingt oder zeigt die Anleitung |
| ARCH-D2 | Doppelte Projektanlage zusammenführen | mn | main.rs | A | S | V16-06 | astra | 1 Anlegepfad (`rg`); `main.rs` < 5133 Zeilen |
| ARCH-D3a | `BEGIN IMMEDIATE` über einen Store-Helfer, Teil a | st | store | A | S | G1 | Claude, ab G2 astra | Direkte Treffer sinken (Basis 15, `rg -c`); `store::tests` grün |
| ARCH-D6a | `pa::run`: Verteilung von Darstellung trennen, Teil a | pa | pa.rs | A | S | G1 | Claude, ab G2 astra | Bestehende CLI-Tests grün; `bin/pa.rs` < 6490 Zeilen |

**Nachrücker (zugleich die Reserve für S1; vor dem Start in Einzelzeilen auflösen)**

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme (messbares Signal) |
|---|---|---|---|---|---|---|---|---|
| ARCH-D3b → ARCH-D7 | Store-Helfer Teil b; Einstellungen nach `store/settings.rs` | st | store | A | S, M | ARCH-D3a | astra | `store.rs` < 7227 Zeilen; `store::tests` grün |
| ARCH-D4a → D4b | Restlicher API-Router in zwei Scheiben | api | api.rs | A | 2× M | ARCH-D1 | astra | Zweige in `route()` sinken (Basis 51); `api::tests` grün |
| ARCH-D5a → D5b → D8a | Diagnose- und Einstellungsbefehle aus `main.rs` lösen; Ereignisnamen als Konstanten | mn | main.rs | A | 2× M, S | ARCH-D2 | astra | `main.rs` sinkt weiter; Tests grün |
| ARCH-D8b → D8c | Ereignisnamen in PTY, dann im Frontend | pty → fe | – | A, B | 2× S | ARCH-D8a | sol, terra | Kein Ereignisname mehr als freier Text (`rg`) |
| ARCH-D6b | `pa::run`, Teil b | pa | pa.rs | A | S | ARCH-D6a | astra | `bin/pa.rs` sinkt weiter; CLI-Tests grün |
| V16-07 | HQ ehrlich machen: Restzeit, Zustand `blocked`, UTC-Tagesgrenze, Body-Limit | hqL | – | B | M | – | terra, sonst glm-5.3 | Je Punkt ein roter Test zuerst |
| V16-08 | Gate gegen CRLF-blinde Quelltextvergleiche in Rust-Tests | ci | – | B | S | FLOW-05 | sol | Gate ist rot auf einem präparierten Fall |
| ARCH-09c | PR #269 fertigstellen oder schließen | fe | – | B | S | – | terra | #269 ist gemergt oder geschlossen |
| ADR-A1, ADR-A7 | Entscheidungsnotizen: `ApiBackend` teilen; st-Lane teilen | doc | – | C | 2× S | A7: zwei Wochenmessungen | Berater-Paar | Eintrag in `docs/decisions.md` |

## 4. Wellen

Tore: **G0** = der Nutzer gibt den Plan frei (Fragen 1, 2 und 6). **G1** = v1.5.1 ist veröffentlicht; vorher startet kein Naht-Paket (`docs/PLAN.md:202`). **G2** = Codex ist wieder verfügbar (11.10.2026, 14:31).

| Welle | Start | Läuft gleichzeitig | Plätze |
|---|---|---|---|
| W0 | nach G0, ohne Codex, ohne Naht | V16-01 · BENCH-01 · FLOW-01; danach BENCH-02, FLOW-02 und V16-02; die ci-Kette läuft weiter: FLOW-04 → FLOW-03 → FLOW-05 | Server: bis 4 Worker, Rest Reviews. PC: 1 Cargo-Build (V16-01 braucht Windows) |
| W1 | nach G1 | Vier Ketten-Köpfe, je einer pro Lane: st ARCH-D3a · mn V16-06 · api INV-SEC-CRED-CLEANUP · pa ARCH-D6a. Füllung: M5-02, V16-03, V16-07, ARCH-09c, ADR-A1, FLOW-06 | Server: 4 Ketten-Köpfe + 4 Füllung und Reviews. PC: höchstens 1 Build (Update-Drill für V16-06) |
| W2 | sobald der Vorgänger der Lane gemergt ist | mn ARCH-D2 · api ARCH-D1 · st ARCH-D3b · pa ARCH-D6b | wie W1 |
| W3 | nach G2, Nachrücker | st ARCH-D7 · api D4a → D4b · mn D5a → D5b → D8a, dann D8b, D8c · V16-08 · ADR-A7 | wie W1 |

Regeln für jede Welle:
- **Nähte strikt seriell:** Je Naht (`api.rs`, `main.rs`, `store.rs` mit `store/`, `bin/pa.rs`) läuft nie mehr als ein Paket. Verschiedene Nähte dürfen gleichzeitig laufen. Ein Paket mit zwei Nähten sperrt beide.
- **ci-Kette:** Jedes neue Dev-Skript trägt eine Zeile in `package.json` ein. Diese Pakete laufen deshalb nacheinander: BENCH-01 → FLOW-04 → FLOW-03 → FLOW-05 → V16-08.
- **Plätze:** Server 8 = höchstens 4 Naht-Pakete und mindestens 4 für Füllung und Reviews. PC: höchstens 2 Cargo-Builds (Grenze 3), während eines Release-Drills 0.
- **Ohne Codex (bis G2):** Naht- und Security-Pakete nur über Claude und nur unter 70 % Wochenlimit (`docs/setup/providers.md`), sonst warten sie auf G2. Doku und Skripte gehen an OpenCode.
- **Reviews:** C nur Gates. B ein Reviewer einer anderen Modellfamilie (bei einem GLM-Autor also Kimi K3). A zwei Anbieter, nie die Familie des Autors (Kimi K3 + GLM 5.2, ab G2 auch Codex).

## 5. Kritischer Pfad

- **Kern:** G0 → G1 → V16-06 → ARCH-D2 (Lane mn). V16-06 ist das einzige Kern-Paket mit hohem Risiko; es braucht Frage 3 und den Update-Drill von v1.5.1.
- **Mit Nachrückern:** mn hat fünf Naht-Pakete in Folge (V16-06 → D2 → D5a → D5b → D8a). st hat nur drei, wenn Frage 2 mit Ja beantwortet wird; bei Nein sind es sieben, und st wird der längste Pfad.
- **Zweiter Pfad:** die ci-Kette mit fünf Paketen. BENCH-01 steht vorn, damit die Messung läuft, bevor die Änderungen wirken.
- **Keine Tageszusage:** Der Benchmark kennt PR → Merge (p90 3 h) nur über alle Stufen, nicht für Stufe A an Nähten. BENCH-01 soll den Wert je Stufe ausweisen. G1 liegt außerhalb dieses Plans.

## 6. Rekursives Prompting (fester Bestandteil)

Jeder Prompt läuft durch: Entwurf → Kritik gegen die Checkliste → Verfeinerung, höchstens zwei Runden, protokolliert. Dieser Plan ist selbst so entstanden (Protokoll im PR-Text).

| Prompt | Entwurf | Kritik von | Stoppregel | Protokoll |
|---|---|---|---|---|
| Auftrag (Job-Spec) | Orchestrator | andere Modellfamilie, nur Text; dazu plan-lint | kein offener Punkt „hoch“, höchstens 2 Runden | Kopf des Auftrags (`Prompt-Rounds:`, `Critique-By:`) und PR `### Prompt-Log` |
| Worker-Brief | Worker | Worker selbst | 1 Runde, eine zweite nur bei Befund | PR `### Prompt-Log` |
| Review-Prompt | Pipeline | Prüfskript (Diff vollständig, Regelauszug, Ausgabeformat); der Reviewer widerlegt seine Befunde selbst | Prüfskript Exit 0 | Review-Disposition im PR |
| Team-Schritt | Agent | Agent selbst | höchstens 2 Runden | Team-Notiz |
| Prompt-Bibliothek | Autor | andere Modellfamilie | höchstens 2 Runden | Beschreibung „RP v1, n Runden“ |

Jeder Paket-Auftrag aus diesem Plan beginnt mit dem Worker-Brief: Plan mit höchstens 15 Zeilen (Dateien, roter Test, Abnahme-Befehl, Risiken), Prüfung gegen die Checkliste, höchstens zwei Runden, Eintrag im `### Prompt-Log`. Zeigt die Prüfung, dass der Auftrag selbst falsch ist, meldet der Worker „BLOCKIERT“ mit der Nummer des Punkts. Die Vorlagen stehen nach FLOW-01 in `docs/development/prompting.md`.

Checkliste:
1. Jeder Beleg ist eingefügte `rg -n`-Ausgabe, ein SHA oder ein gemergter PR, sonst steht „prüfen“ da.
2. Das Paket ist nicht schon erledigt (`git log --grep`, `gh pr list --search`).
3. Lane und Naht stehen fest; der Auftrag wartet auf den letzten derselben Lane und fasst keine Datei eines offenen PRs an.
4. Höchstens 300 Diffzeilen, sonst vorher schneiden.
5. Die Abnahme hat Befehl und Exit-Code; der rote Test ist als `Test-First: <Pfad>::<Test>` benannt.
6. Eine nötige Nutzerentscheidung steht schon in `docs/PLAN.md`.
7. Der Ort passt zur Umgebung (Abhängigkeiten, Build-Slot, Windows).
8. Die Stufe folgt aus den Dateien. Nichts Persönliches, kein Geld, keine Installation.
9. Ein Modell ohne Gedächtnis versteht den Auftrag allein (Basis-SHA, Ausgabeform).
10. Der wahrscheinlichste Grund für „BLOCKIERT“ ist ausgeräumt.

Messung (M-RP, wöchentlich über FLOW-05): Anteil der PRs mit Prompt-Log (Ziel 100 % bei Stufe A und B); Kritikbefunde je Auftrag; blockierte Aufträge je Start (Basis 6,7 %, davon vermeidbar 2,7 %, Ziel unter 1 %; nur lokal); Nacharbeit mit und ohne Prompt-Log getrennt. Der Vergleich ist nicht zufällig verteilt und bleibt ein Hinweis, kein Beweis.

## 7. Vorwärts-Benchmark: Ziele

Baseline ist J2 (02.10. bis Basis), gemessen wird jeden Montag. Die volle Tabelle steht in `benchmark.md`, Abschnitt 6.

| Metrik | Baseline | Ziel v1.6.0 |
|---|---|---|
| M-THR | 7 221 Code-Zeilen und 21 Pakete pro aktivem Tag | ≥ 7 000 und ≥ 20, auch in Wochen ohne Codex |
| M-LEAD | p90 3,0 h | p90 ≤ 6 h |
| M-REWORK | 15,7 % Fix-PRs binnen 72 h; 4 Hotfixes/Reverts | ≤ 8 %; ≤ 1 pro Woche |
| CI | 8,0 % rote PR-Köpfe; 15,5 % rote Queue-Läufe | ≤ 7 %; ≤ 10 % |
| M-IDLE | 31 Leerlauf-Alarme pro Tag (lokal) | ≤ 10 pro Tag |
| M-HUMAN | 25 Inbox-Einträge in 4 Tagen | ≤ 10 neue pro Woche |
| M-RP | 6 % der Aufträge mit Kritik-Protokoll (lokal) | ≥ 90 % |

## 8. Bewusst nicht in v1.6.0

M4-R19-02/03/04/07/09 (Frage 2), V16-10, W1-24c, W1-09c, W5-31, M5-04, Dependabot-Majors, W2-02b3, V16-11, ARCH-12, HQ2-04/06–10 und das Einschalten des Dauerbetriebs (Entscheidung des Nutzers, kein Paket). M5-01 (Testerrunde) folgt auf V16-03.

## 9. Risiken

- **G1 liegt nicht in diesem Plan.** Verzögert sich v1.5.1, läuft nur W0. Gegenmittel: W0 und die Reserve enthalten kein Naht-Paket.
- **Größen sind Schätzungen.** Ein Architektur-Paket lag früher doppelt über dem Budget. Der Worker-Brief misst vor dem ersten Edit und schneidet.
- **Ohne Codex fehlt Kapazität.** Codex lieferte 41 % der PRs im Messfenster. Das Durchsatz-Ziel ist bis G2 unsicher.
- **Reviews hängen am PC,** solange Frage 5 offen ist. Bis G2 ist das der Engpass für Stufe A und B.
- **Mehr Regeln können bremsen.** Rekursives Prompting kostet je Auftrag eine Runde. M-LEAD (Ziel p90 ≤ 6 h) zeigt, ob es zu teuer wird.
- **V16-06 fasst den Update-Start an.** Stufe A, Berater-Paar, roter Test zuerst, Drill unter Windows.
- **Belege zu den ARCH-D-Paketen sind Stichproben:** D1 nennt vier Klassifizierer, gefunden wurden drei; D3 nennt elf Treffer, gezählt wurden 15; D8 hat noch keinen Anker.

## 10. Fragen an den Nutzer

Die E-Nummern vergibt der Koordinator beim Eintrag in die Entscheidungs-Inbox. Dieser Plan kostet kein Geld und löscht nichts.

| # | Art | Frage | Empfehlung |
|---|---|---|---|
| 1 | Richtung | Ist „tester-tauglich und schlanker“ mit den 17 Kern-Paketen das Thema von v1.6.0? | Ja. |
| 2 | Richtung | Die fünf Audit-Reste M4-R19-02/03/04/07/09 (am 04.10. nach M5 gelegt) auf v1.6.x verschieben? | Ja. Die Tester-Abnahme braucht sie nicht, und st sinkt von 7 auf 3 Pakete. |
| 3 | Sicherheit | Start nach einem Update ohne Journal: gesperrt bleiben und eine Anleitung zeigen, oder dem ersten Start vertrauen? | Gesperrt mit Anleitung. Sicherheit geht vor Komfort. |
| 4 | Regel | Rekursives Prompting als ein Pflicht-Satz in `AGENTS.md` (FLOW-06)? | Ja. |
| 5 | Installation | Den kostenlosen Ollama-Client auf dem Build-Server installieren, damit Reviews nicht mehr am PC hängen? | Ja. Ohne ihn bleibt der PC der Engpass. |
| 6 | Arbeitsweise | Freigabe je Welle statt je Paket, mit allen Entscheidungen der Welle gebündelt davor? | Ja. |
| 7 | Release | Wer veröffentlicht v1.6.0? | Der Nutzer gibt frei, sobald die Abnahme aus Abschnitt 1 belegt ist. |

Schon in der Inbox und Voraussetzung: E16 (Lizenz, blockiert V16-03 und M5-01), E14 (Schlüssel-Backup, dringend), E23 (Aufgaben-Benchmark).

## 11. NICHT ABGEDECKT

- Die Orchestrator-Zahlen (Leerlauf, Blockaden, Konflikte) stammen aus einem lokalen Log und sind nicht öffentlich nachrechenbar.
- Kein Build, kein Test und kein Lauf wurden für diesen Plan ausgeführt. Die Zeilennummern gelten an der Basis `2ec6960`.
- Kontingent und Modell der Anbieter wurden nicht beobachtet; die Anbieter-Spalte ist ein Vorschlag.
- Ob der Ollama-Client auf dem Server läuft, ist ungeprüft.
- Die Wirkung von S1–S8 ist eine Prognose. Erst die Wochenmessung zeigt, ob sie eintritt.
