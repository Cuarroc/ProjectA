# Plan v1.6.0 (Entwurf, der Nutzer entscheidet)

Stand 05.10.2026, Basis `2ec6960` (`origin/main`). Dieser Entwurf ändert nichts an M1–M4 (`docs/PLAN.md`, Regel 2). Er gilt erst, wenn der Nutzer die Fragen in Abschnitt 10 beantwortet hat. Der Nachweis zur Arbeitsweise steht in [`benchmark.md`](benchmark.md).

## 1. Ziel

v1.6.0 verringert zuerst die Nacharbeit bedeutend und verbessert sie (Nutzervorgabe 05.10.): weniger Fix-PRs, weniger Review-Runden, weniger rote Läufe, und wenn doch Nacharbeit nötig ist, genau eine begrenzte Runde auf demselben Branch. Danach macht es ProjectA bereit für die ersten externen Tester: Die App startet nach einem Update sicher, das README sagt klar, wofür sie da ist, und es gibt ein Tester-Kit. Die vier Nahtstellen werden kleiner, und der Windows-Flake KI-30, der die Merge-Queue anhält, wird untersucht und behoben. Die Messung läuft jede Woche, rekursives Prompting ist Pflicht (Abschnitte 2a, 7a, 7b).

Fertig ist v1.6.0, wenn alle weiterhin freigegebenen Kern-Pakete gemergt sind und jede der vier Nahtstellen weniger Zeilen hat als an der Basis (`wc -l`: `api.rs` 8091, `store.rs` 7227, `bin/pa.rs` 6490, `main.rs` 5133). Vor dem Release bleiben tatsächliche Windows-/Linux-Prüfungen am Kandidaten, unabhängige Reviews gemäß Risikostufe, der Update-Probelauf und keine bekannten kritischen Fehler verbindlich. Diese Dokumentation erklärt keinen dieser Belege für erbracht.

**Nutzerentscheidung vom 06.10.2026 („Passt so“):** Die zwei Wochenmessungen mit den unveränderten Nacharbeits-Zielen aus Abschnitt 7a und die Beobachtung von 40 Queue-Läufen bleiben **offene Nachbeobachtung** nach v1.6.0, keine Vorab-Wartegates. Sie sind weder bestanden noch gestrichen. Befunde fließen in v1.6.1 ein, kritische Befunde werden früher behandelt. Releasehinweise müssen die fehlenden Langzeitnachweise ausdrücklich nennen. Andere Architektur-/Funktionspakete, Schwellenwerte und Sicherheitsgates bleiben unverändert; diese Entscheidung erlaubt keinen automatischen Tag oder Release.

## 2. Was sich an der Arbeitsweise ändert

Der Benchmark sagt: PRs landen viel schneller (p90 127 h → 3 h), aber die Nacharbeit ist nicht gesunken, und Plätze stehen oft leer. Darauf zielen die Änderungen. Red-first, `prepush`, gestufte Reviews, serielle Nähte, Merge nur über die Queue und die Hoheit des Nutzers bleiben unverändert. Alle Belege stehen in `benchmark.md`, Abschnitt 3; „lokal“ heißt: aus dem Orchestrator-Log, nicht öffentlich nachrechenbar.

| # | Engpass heute (Beleg) | Änderung | Wo | Metrik |
|---|---|---|---|---|
| S1 | Plätze frei, nichts startbar: 99 Leerlauf-Alarme in 3 Tagen (lokal) | Eine freigegebene Welle wird komplett eingereiht; Ziel ≥ 16 startbare Aufträge in Reserve; jeder freie Platz wird sofort gefüllt | lokal (L2) | M-IDLE, M-THR |
| S2 | 28 Konflikt-Aufträge in 3 Tagen (lokal) | Kette statt Zufall: Pakete, die dieselbe Naht oder dieselbe Datei ändern, laufen nacheinander; keine Datei eines offenen PRs; plan-lint prüft die Tabelle | lokal (L3), FLOW-03 | M-REWORK |
| S3 | 32 von 479 Aufträgen endeten blockiert, 13 davon vermeidbar (lokal) | Rekursives Prompting für jeden Auftrag (Abschnitt 6) | lokal (L1), FLOW-01/02 | M-RP, M-REWORK |
| S4 | 10 Blockaden durch die Umgebung, etwa fehlende Abhängigkeiten (lokal) | Der Startcheck prüft das vor dem Start | FLOW-04 | M-REWORK |
| S5 | 15,5 % rote Queue-Läufe; KI-30 trat in 8 von 42 Läufen auf (`KNOWN_ISSUES.md:200`) | KI-30 ist das erste Paket (V16-01) | Repo | CI, M-LEAD |
| S6 | Reviews laufen nur über den PC | Review-Fahrer auf den Server | lokal (L4), Frage 4 | M-LEAD |
| S7 | Ein Anbieter lieferte 134 von 226 gemergten PRs seit 02.10. (59 %; eigene Zählung am 05.10., 12:08 UTC, Befehl in `benchmark.md`, Abschnitt 5) | Kein Anbieter über 50 % pro Woche; Routing nach Restkontingent | lokal (L5) | M-THR |
| S8 | Einzelfragen unterbrechen den Nutzer | Entscheidungen gebündelt vor jeder Welle, Freigabe je Welle | `docs/PLAN.md`, Frage 5 | M-HUMAN |

## 2a. Ursachen der Nacharbeit

Belege: `benchmark.md`, Abschnitt 3 (M-REWORK, Review, CI) und Abschnitt 2 hier (lokal: Konflikte, Blockaden).

| Ursache (Beleg) | Paket, das sie beseitigt |
|---|---|
| Aufträge mit Lücken: 13 von 32 Blockaden vermeidbar, Abnahme oder Basis fehlte (lokal) | FLOW-01/02 und L1 (rekursives Prompting auf Aufträgen und Briefs); FLOW-03 (Abnahme-Befehl in jedem Auftrag, plan-lint) |
| Fehler, die der Autor vor dem Push selbst finden könnte: 15 % der Code-PRs mit Review-Fix-Commit | **FLOW-07** (Selbstprüfung vor dem Push, Checkliste) |
| Zwei Pakete an derselben Datei: 28 Konflikt-Aufträge in 3 Tagen (lokal) | FLOW-03, L3 |
| Windows-Rot erst in der Queue: 15,5 % rote Queue-Läufe | **WIN-01** (Windows-Lauf vor `review-ok`); V16-01 (KI-30) |
| Flake KI-30 (`workers::tests::real_native_provider_exit_before_input_delivery_reconciles_as_exited`, 8 von 42 Läufen; „os error 32“ nur Begleiterscheinung) | V16-01 |
| Umgebung: 10 Blockaden durch fehlende Abhängigkeiten (lokal) | FLOW-04 |
| Nacharbeit als neuer PR statt Runde am selben Branch | FLOW-07 (Fixrunde, Abschnitt 7b) |

## 3. Pakete

Größe: S ≤ 150, M ≤ 300 Diffzeilen mit Tests (Schätzung, vor dem Start messen). Stufe A/B/C nach AGENTS.md, Regel 5. Anbieter sind Vorschläge nach `docs/setup/providers.md`: astra/sol/terra = Codex (erst ab G2), glm-5.3/deepseek = OpenCode. Vor jedem Start gilt `npm run dev:start-check`.

**Kern (19 Pakete)**

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme (messbares Signal) |
|---|---|---|---|---|---|---|---|---|
| V16-01 | KI-30: Ursache des `real_native_*`-Flakes belegen und beheben. Heute ist sie unbelegt (`KNOWN_ISSUES.md:193-205`); rot wird der Assert „native launch left unresolved“ (`workers.rs:4857`), „os error 32“ tritt nur zusätzlich auf (zuletzt Queue-Lauf 37301269691 am 05.10.) | wk | – | A | M | – | Claude, ab G2 astra | Beleg der Ursache zuerst (roter Test oder Messung); `--test-threads=1` in `scripts/ci/native-tests.sh:98` ist entfernt; 0 KI-30-Fehlschläge in den nächsten 40 Queue-Läufen (offene Nachbeobachtung nach v1.6.0, Abschnitt 7a.1). Ohne belegte Ursache: Bericht und neuer Schnitt statt Fix |
| BENCH-01 | Wochenmessung als Skript `scripts/dev/bench-weekly.mjs`, nur lesend; M-LEAD je Stufe und Größenklasse | ci | – | B | M | – | glm-5.3, sonst Claude | Test mit JSON-Fixtures; die Ausgabe enthält jede Metrik aus `benchmark.md`, Abschnitt 6; alle Zähl-Muster stehen im Skript |
| BENCH-02 | Montags-Workflow, der BENCH-01 ausführt (nur Leserechte, kein Commit) | ci | – | B | S | BENCH-01 | glm-5.3 | Ein Lauf per `workflow_dispatch` ist grün, der Bericht steht in der Job-Summary |
| FLOW-01 | Standard für rekursives Prompting: `docs/development/prompting.md` mit Checkliste und den fünf Vorlagen aus dem Text von PR #488 | doc | – | C | S | – | glm-5.3 | Datei enthält die fünf Vorlagen; `npm run dev:agent-check` Exit 0 |
| FLOW-02 | PR-Vorlage bekommt den Abschnitt `### Prompt-Log` | ci | – | C | S | FLOW-01 | glm-5.3 | ≥ 9 der nächsten 10 Paket-PRs tragen ein Prompt-Log |
| FLOW-04 | Startcheck `--deps`: fehlende oder veraltete Abhängigkeiten und alter Basispunkt geben Exit 1 | ci | – | B | S | BENCH-01 | glm-5.3 | Roter Test zuerst; Umgebungs-Blockaden ≤ 2 pro Woche (Basis 10 in 3 Tagen, lokal) |
| FLOW-03 | plan-lint: prüft diese Tabelle (Größe, Stufe, Lane, Abnahme vorhanden, nie zwei Pakete derselben Naht gleichzeitig; „→“ heißt nacheinander) | ci | – | B | M | FLOW-04 | glm-5.3, sonst Claude | Exit 0 auf diesem Plan, Exit 1 auf einem präparierten Fehlerfall |
| FLOW-05 | M-RP-Zähler: liest PR-Texte und zählt Prompt-Log, Runden und Befunde | ci | – | B | M | FLOW-03, FLOW-02 | glm-5.3 | JSON-Ausgabe; der Montagslauf zeigt M-RP |
| FLOW-06 | Ein Satz in `AGENTS.md`: rekursives Prompting ist Pflicht (Nutzerauftrag 05.10.) | doc | – | C | S | FLOW-01 | Koordinator | `npm run dev:agent-check` Exit 0 |
| FLOW-07 | `docs/development/prompting.md` ergänzen: Selbstprüfung vor dem Push (Checkliste aus Abschnitt 6, Punkte 4, 5, 9) und die eine begrenzte Fixrunde (Abschnitt 7b); PR-Vorlage bekommt `### Nacharbeit` | doc | – | C | S | FLOW-01 | glm-5.3 | `npm run dev:agent-check` Exit 0; beide Regeln stehen in der Datei; FLOW-05 zählt Fixrunden je PR |
| WIN-01 | `scripts/ci/win-signal.sh <branch>`: startet den `ci`-Workflow per `workflow_dispatch` auf dem Branch (beide Bahnen) für Pakete mit `#[cfg(windows)]`, Nähten oder PTY-Code, vor `review-ok`; liest das Ergebnis | ci | – | B | S | – | glm-5.3, sonst Claude | Test mit Fixture (Auswahl der Pakete); ein Probelauf auf einem Branch ist grün; Actions-Minuten im öffentlichen Repo kostenlos, sonst Frage an den Nutzer |
| V16-02 | Doku-Sync: Erledigtes steht nicht mehr als „offen“ da (KI-16, KI-19, M5-03, CSP, FE-Stale, FJ-*) | doc | – | C | S | dieser PR gemergt, Zuweisung durch den Koordinator | glm-5.3 | Prüfliste im PR: 0 gemergte IDs mit Stand „offen“ |
| M5-02 | README: Produktfokus „sicherer Dauerbetrieb: Not-Aus, Kostenkontrolle, Protokoll“ | doc | – | C | S | G1 | glm-5.3 | Der Fokus-Satz steht in den ersten 30 Zeilen des README |
| V16-03 | Tester-Kit: Installation, Rückmeldeformular, bekannte Grenzen | doc | – | C | S | G1, E16; der Nutzer legt ein frisches Windows-Konto an | glm-5.3 | Trockenlauf: Installation nach Anleitung im frischen Konto, Protokoll im PR |
| INV-SEC-CRED-CLEANUP | Abgelaufene Zugriffs-Grants löschen; Löschfehler melden statt verschlucken (`api/agent_access.rs:364`) | api | – | A | S | G1 | Claude, ab G2 astra | Roter Test zuerst: ein Löschfehler erscheint im Ergebnis |
| ARCH-D1 | Die drei Fehlertext-Klassifizierer `merge_status`, `verdict_status`, `core_status` zu einem zusammenführen | api | api.rs | A | S | INV-SEC-CRED-CLEANUP | Claude, ab G2 astra | `rg -c 'fn [a-z]+_status\(err' src-tauri/src/api.rs` sinkt von 3 auf 1; `api.rs` < 8091 Zeilen |
| V16-06 | KI-31-Rest: Der Start nach einem Update ohne Journal blockiert nicht mehr stumm | mn | main.rs | A | M | G1, Frage 3; Update-Drill am PC mit dem Nutzer | astra, vor G2 Claude | Roter Test zuerst; Update-Drill (Erfolg, Abbruch, Fehler): der nächste Start gelingt oder zeigt die Anleitung |
| ARCH-D2 | Doppelte Projektanlage zusammenführen | mn | main.rs | A | S | V16-06 | astra, vor G2 Claude | `rg -c 'fn create_project' src-tauri/src/main.rs`: von zwei Umsetzungen bleibt eine, die andere ruft sie auf; `main.rs` < 5133 Zeilen |
| ARCH-D3a | Die zwei direkten `BEGIN IMMEDIATE` in `store.rs` auf den vorhandenen Helfer `begin_write` (`store/continuous.rs:924`) umstellen, Teil a. `store.rs:1061` ist ein manuelles `BEGIN` auf einer eigenen Verbindung (Wartung): Der Auftrag prüft zuerst, ob der Helfer dort passt, sonst wird vorher geschnitten | st | store | A | S | G1 | Claude, ab G2 astra | `rg -c 'BEGIN IMMEDIATE' src-tauri/src/store.rs` sinkt von 2 auf 0; bleibt `:1061` bestehen, auf 1 mit Begründung im PR |
| ARCH-D6a | `pa::run`: Verteilung von Darstellung trennen, Teil a | pa | pa.rs | A | S | G1 | Claude, ab G2 astra | `bin/pa.rs` < 6490 Zeilen; die CLI-Tests laufen unverändert durch |

**Nachrücker (vor dem Start in Einzelzeilen auflösen).** Für jedes gilt zusätzlich: `cargo nextest run --profile ci` Exit 0.

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme (messbares Signal) |
|---|---|---|---|---|---|---|---|---|
| ARCH-D3b → ARCH-D7 | Store-Helfer Teil b; Einstellungen nach `store/settings.rs` | st | store | A | S, M | ARCH-D3a | astra, vor G2 Claude | `rg 'begin_with\("BEGIN IMMEDIATE' src-tauri/src/store` trifft außerhalb von Testdateien nur noch `begin_write` (Rest nach D3a: 9 Aufrufe in drei Dateien); `store.rs` < Stand nach D3a |
| ARCH-D4a → D4b | Restlicher API-Router in kleinere serielle Teil-PRs schneiden (ARCH-D4-PLAN, siehe unten) | api | api.rs | A | M | ARCH-D1 | astra | Insgesamt ≥ 300 Zeilen Netto-Abbau in `api.rs` gegenüber der Basis vor ARCH-D4; jeder Teil-PR ≤ 300 Gesamtdiffzeilen einschließlich Tests. Kein Mindestabbau von 150 je Teil-PR |
| ARCH-D5a → D5b → D8a | Diagnose- und Einstellungsbefehle aus `main.rs` lösen; Ereignisnamen als Konstanten | mn | main.rs | A | 2× M, S | ARCH-D2 | astra | `main.rs` je Scheibe um ≥ 150 Zeilen kleiner; D8a: der Auftrag nennt den Anker (heute fehlt er) |
| ARCH-D8b → D8c | Ereignisnamen in PTY, dann im Frontend | pty → fe | – | A, B | 2× S | ARCH-D8a | sol, terra | wie D8a: Muster und Zielzahl stehen im Auftrag |
| ARCH-D6b | `pa::run`, Teil b | pa | pa.rs | A | S | ARCH-D6a | astra, vor G2 Claude | `bin/pa.rs` < Stand nach D6a |
| V16-07 | HQ ehrlich machen: Restzeit, Zustand `blocked`, UTC-Tagesgrenze, Body-Limit | hqL | – | B | M | – | glm-5.3, ab G2 terra | Je Punkt ein roter Test zuerst (4 Tests) |
| V16-08 | Gate gegen CRLF-blinde Quelltextvergleiche in Rust-Tests | ci | – | B | S | FLOW-05 | deepseek, ab G2 sol | Gate ist rot auf einem präparierten Fall, grün auf `main` |
| ARCH-09c | PR #269 fertigstellen oder schließen | fe | – | B | S | – | glm-5.3, ab G2 terra | #269 ist gemergt oder geschlossen |
| ADR-A1 → ADR-A7 | Entscheidungsnotizen: `ApiBackend` teilen; st-Lane teilen | doc | – | C | 2× S | A7: zwei Wochenmessungen | Berater-Paar | Je ein Eintrag in `docs/decisions.md` |

**Lokal beim Orchestrator (kein PR, Eigentümer: Orchestrator):** L1 Auftrags-Erzeuger mit Kritikschritt und den Kopfzeilen `Prompt-Rounds:` und `Critique-By:`. L2 Reserve füllt alle freien Plätze. L3 Sperre für Dateien offener PRs. L4 Review-Fahrer auf den Server (nach Frage 4). L5 Anbieteranteil im Stundenbericht. L6 Prüfskript für Review-Prompts (Exit 1 = nicht senden). BENCH-03 Wochen-Aggregat für M-IDLE, M-HUMAN, M-RP und Kontingent. Abnahme für alle: Die Wochenmessung zeigt die Zielwerte aus Abschnitt 7.

**ARCH-D4-PLAN, Nutzerentscheidung vom 06.10.2026:** `serial-total300` (Revision 1, Antwort `6b733c02-a4ff-466e-aaf6-905511d5570c`, gespeichert 21:55:57.174 UTC; Rootempfang 21:57:52.126 UTC, State-Revision 7). ARCH-D4a/D4b bezeichnet die bestehende Kette; vor dem Dispatch wird sie in kleinere, einzeln ausführbare Teil-PRs geschnitten. Jeder Teil-PR hält die Grenze von 300 Gesamtdiffzeilen einschließlich Tests ein; der Netto-Abbau in `api.rs` beträgt über die gesamte Kette mindestens 300 Zeilen. Die frühere Vorgabe von mindestens 150 Zeilen je Scheibe entfällt. Ein vorhandener Schnittentwurf ist noch kein Machbarkeitsbeleg.

Vor dem ersten Teil-PR bindet der Auftrag die Ausgangszeilenzahl an den Kandidaten-SHA vor ARCH-D4. Jeder Teil-PR dokumentiert den kumulierten Netto-Abbau mit `wc -l` und Vorher-/Nachher-SHA sowie seinen vollständigen Diffumfang mit `git diff --numstat <PR-Basis> <Kandidat>` (Summe aller Hinzufügungen und Löschungen, einschließlich Tests). Red-first, vollständige Gates, Tier A mit zwei Reviewern anderer Anbieter als der Autor und eine exklusive serielle API-Naht bleiben unverändert. Der nächste Teil-PR wartet auf den gemergten Vorgänger. Der Rootempfang belegt keine Umsetzung; diese Planänderung allein belegt weder API-Abbau noch Releasefähigkeit.

## 4. Wellen

Tore: **G0** = der Nutzer gibt den Plan frei (Fragen 1, 2 und 5) und dieser PR ist gemergt. **G1** = v1.5.1 ist veröffentlicht; vorher startet kein Naht-Paket (`docs/PLAN.md:202`). **G2** = Codex ist wieder verfügbar (11.10.2026, 14:31).

| Welle | Start | Läuft gleichzeitig | Plätze |
|---|---|---|---|
| W0 | nach G0, ohne Codex, ohne Naht | Sofort acht (Nacharbeits-Pakete zuerst): V16-01 · BENCH-01 · FLOW-01 · WIN-01 · V16-07 · ARCH-09c · ADR-A1 · V16-02. Danach FLOW-07 (nach FLOW-01), BENCH-02, FLOW-02, FLOW-06 und die Datei-Kette FLOW-04 → FLOW-03 → FLOW-05 → V16-08 | Server: bis 6 Worker, Rest Reviews. PC: 1 Cargo-Build (V16-01 braucht Windows) |
| W1 | nach G1 | Vier Ketten-Köpfe, je einer pro Lane: st ARCH-D3a · mn V16-06 · api INV-SEC-CRED-CLEANUP · pa ARCH-D6a. Füllung: M5-02, V16-03 | Server: 4 Ketten-Köpfe + 4 Füllung und Reviews. PC: höchstens 1 Build (Update-Drill für V16-06) |
| W2 | sobald der Vorgänger der Lane gemergt ist | mn ARCH-D2 · api ARCH-D1 · st ARCH-D3b · pa ARCH-D6b | wie W1 |
| W3 | nach G2, Nachrücker | st ARCH-D7 · api D4a → D4b · mn D5a → D5b → D8a, dann D8b, D8c · ADR-A7 | wie W1 |

Regeln für jede Welle:
- **Nähte strikt seriell:** Je Naht (`api.rs`, `main.rs`, `store.rs` mit `store/`, `bin/pa.rs`) läuft nie mehr als ein Paket. Verschiedene Nähte dürfen gleichzeitig laufen. Ein Paket mit zwei Nähten sperrt beide.
- **Ketten nur bei gleicher Datei:** Pakete außerhalb der Nähte laufen parallel, solange ihre Dateilisten sich nicht überschneiden (der Auftrag nennt die Dateien). Jedes neue Dev-Skript ändert `package.json`, deshalb die Kette BENCH-01 → FLOW-04 → FLOW-03 → FLOW-05 → V16-08. BENCH-02 (neue Workflow-Datei) und FLOW-02 (PR-Vorlage) laufen daneben.
- **Plätze:** Server 8 = höchstens 4 Naht-Pakete und mindestens 4 für Füllung und Reviews. PC: höchstens 2 Cargo-Builds (Grenze 3); solange ein Release-Drill des Nutzers läuft, 0.
- **Reserve vor G1:** Aus diesem Plan sind vor G1 nur die W0-Pakete startbar. Ob die laufende Arbeit aus `docs/PLAN.md` (M3/M4) die Reserve von 16 bis dahin füllt, ist nicht gezählt; der Orchestrator prüft das vor G0.
- **Ohne Codex (bis G2):** Naht-, Security- und Stufe-A-Pakete nur über Claude und nur unter 70 % Wochenlimit (`docs/setup/providers.md`), sonst warten sie auf G2. Doku und Skripte gehen an OpenCode.
- **Reviews:** C nur Gates. B ein Reviewer einer anderen Modellfamilie (bei einem GLM-Autor also Kimi K3). A zwei Anbieter, nie die Familie des Autors (Kimi K3 + GLM 5.2, ab G2 auch Codex).

## 5. Kritischer Pfad

- **Kern:** G0 → G1 → V16-06 → ARCH-D2 (Lane mn). V16-06 braucht Frage 3 und den Update-Drill von v1.5.1. Riskant ist auch V16-01: Die Ursache von KI-30 ist unbelegt, das Paket kann als reine Diagnose enden.
- **Mit Nachrückern:** mn hat fünf Naht-Pakete in Folge (V16-06 → D2 → D5a → D5b → D8a). st hat nur drei, wenn Frage 2 mit Ja beantwortet wird; bei Nein sind es sieben, und st wird der längste Pfad.
- **Zweiter Pfad:** die Datei-Kette der fünf Skript-Pakete. BENCH-01 steht vorn, damit die Messung läuft, bevor die Änderungen wirken.
- **Keine Tageszusage:** Der Benchmark kennt PR → Merge (p90 3 h) nur über alle Stufen, nicht für Stufe A an Nähten. BENCH-01 weist den Wert je Stufe aus. G1 liegt außerhalb dieses Plans.

## 6. Rekursives Prompting (fester Bestandteil)

Jeder Prompt läuft durch: Entwurf → Kritik gegen die Checkliste → Verfeinerung, höchstens zwei Runden, protokolliert. Dieser Plan ist selbst so entstanden (Protokoll im Text von PR #488).

| Prompt | Entwurf | Kritik von | Stoppregel | Protokoll | Umsetzung |
|---|---|---|---|---|---|
| Auftrag (Job-Spec) | Orchestrator | andere Modellfamilie, nur Text; dazu plan-lint | kein offener Punkt „hoch“, höchstens 2 Runden | Kopf des Auftrags und PR `### Prompt-Log` | L1, FLOW-03 |
| Worker-Brief | Worker | Worker selbst | 1 Runde, eine zweite nur bei Befund | PR `### Prompt-Log` | FLOW-01, FLOW-02 |
| Review-Prompt | Pipeline | Prüfskript (Diff vollständig, Regelauszug, Ausgabeformat); der Reviewer widerlegt seine Befunde selbst | Prüfskript Exit 0 | Review-Disposition im PR | L6 |
| Team-Schritt | Agent | Agent selbst | höchstens 2 Runden | Team-Notiz | Team-Definition |
| Prompt-Bibliothek | Autor | andere Modellfamilie | höchstens 2 Runden | Beschreibung „RP v1, n Runden“ | Orchestrator |

Jeder Paket-Auftrag aus diesem Plan beginnt mit dem Worker-Brief: Plan mit höchstens 15 Zeilen (Dateien, roter Test, Abnahme-Befehl, Risiken), Prüfung gegen die Checkliste, höchstens zwei Runden, Eintrag im `### Prompt-Log`. Zeigt die Prüfung, dass der Auftrag selbst falsch ist, meldet der Worker „BLOCKIERT“ mit der Nummer des Punkts. Die fünf Vorlagen (Auftrag, Kritik, Worker-Brief, Review, Team-Schritt) stehen in [`docs/development/prompting.md`](../../development/prompting.md) (Standard samt Checkliste).

Checkliste:
1. Jeder Beleg ist eingefügte `rg -n`-Ausgabe, ein SHA oder ein gemergter PR, sonst steht „prüfen“ da.
2. Das Paket ist nicht schon erledigt (`git log --grep`, `gh pr list --search`).
3. Lane und Naht stehen fest; der Auftrag wartet auf den Vorgänger an derselben Naht oder Datei und fasst keine Datei eines offenen PRs an.
4. Höchstens 300 Diffzeilen, sonst vorher schneiden.
5. Die Abnahme hat Befehl und Exit-Code; der rote Test ist als `Test-First: <Pfad>::<Test>` benannt.
6. Eine nötige Nutzerentscheidung steht schon in `docs/PLAN.md`.
7. Der Ort passt zur Umgebung (Abhängigkeiten, Build-Slot, Windows).
8. Die Stufe folgt aus den Dateien. Nichts Persönliches, kein Geld, keine Installation.
9. Ein Modell ohne Gedächtnis versteht den Auftrag allein (Basis-SHA, Ausgabeform).
10. Der wahrscheinlichste Grund für „BLOCKIERT“ ist ausgeräumt.

Messung (M-RP, wöchentlich über FLOW-05): Anteil der Paket-PRs mit Prompt-Log, Ziel ≥ 90 % (Basis: kein PR vor #488). Dazu Kritikbefunde je Auftrag, blockierte Aufträge je Start (Basis 6,7 %, davon vermeidbar 2,7 %, Ziel unter 1 %; lokal) und Nacharbeit mit und ohne Prompt-Log getrennt. Der Vergleich ist nicht zufällig verteilt und bleibt ein Hinweis, kein Beweis.

## 7. Vorwärts-Benchmark: Ziele

Baseline ist J2 (02.10. bis Basis), gemessen wird jeden Montag. Die volle Tabelle steht in `benchmark.md`, Abschnitt 6.

| Metrik | Baseline | Ziel v1.6.0 |
|---|---|---|
| M-THR | 7 221 Code-Zeilen und 21 Pakete pro aktivem Tag | ≥ 7 000 und ≥ 20, auch in Wochen ohne Codex |
| M-LEAD | p90 3,0 h | p90 ≤ 6 h |
| M-REWORK | 15,7 % Fix-PRs binnen 72 h; 4 Hotfixes/Reverts | ≤ 8 %; ≤ 1 pro Woche (Detail: 7a) |
| CI | 8,0 % rote PR-Köpfe; 15,5 % rote Queue-Läufe | ≤ 5 %; ≤ 8 % |
| M-IDLE | 31 Leerlauf-Alarme pro Tag (lokal, J2) | ≤ 10 pro Tag |
| M-HUMAN | 25 Inbox-Einträge in 4 Tagen | ≤ 10 neue pro Woche |
| M-RP | kein PR mit Prompt-Log; lokal 6 % der Aufträge mit Kritik-Protokoll | ≥ 90 % der Paket-PRs mit Prompt-Log |

## 7a. Nacharbeit: harte Ziele

Messung jeden Montag. Heute heißt: `gh`/`git`-Befehle aus `benchmark.md`, Abschnitt 5; ab BENCH-01: `node scripts/dev/bench-weekly.mjs` (die Ausgabe weist jede Zeile aus; Flag-Namen legt BENCH-01 fest). „lokal“: BENCH-03.

| Metrik | Heute (J2) | Ziel v1.6.0 | Gemessen durch |
|---|---|---|---|
| Fix-PRs, gleiches Paket, ≤ 72 h | 15,7 % | ≤ 8 % | BENCH-01 |
| Hotfix-/Revert-PRs | 4 in 4 Tagen | ≤ 1 pro Woche | BENCH-01 |
| Ohne Merge geschlossene PRs | 7,9 % | ≤ 4 % | BENCH-01 |
| Code-PRs mit Review-Fix-Commit | 15 % | ≤ 8 % | BENCH-01 |
| PR-Text nennt Runde 2 | 12 % | ≤ 5 %; nie Runde 3 | BENCH-01, FLOW-05 |
| Rote PR-Köpfe | 8,0 % | ≤ 5 % | BENCH-01 |
| Rote Queue-Läufe (= Entfernungen aus der Queue) | 15,5 % | ≤ 8 % | BENCH-01 |
| Aufträge, die BLOCKIERT enden, vermeidbar / Umgebung | 2,7 % / 10 in 3 Tagen (lokal) | < 1 % / ≤ 2 pro Woche | BENCH-03, FLOW-04 |
| Konflikt-Aufträge | 28 in 3 Tagen (lokal) | ≤ 3 pro Woche | BENCH-03, FLOW-03 |

Zu hohe Ziele werden nicht still gesenkt: Verfehlt eine Zeile nach zwei Wochenmessungen das Ziel, kommt sie als Frage in die Inbox. Die Ergebnisse bleiben Nachbeobachtung für v1.6.1; kritische Befunde werden früher behandelt.

### 7a.1 Offene Nachbeobachtung nach v1.6.0

| Nachweis | Originalkriterium und Stand | Zuständigkeit und nächster Abgleich |
|---|---|---|
| Zwei Wochenmessungen | **Offen:** zwei vollständige Wochenfenster mit Zielerreichung nach Abschnitt 7a; Baseline J2, Nenner, Ausschlüsse und Schwellenwerte bleiben gleich. Ein erfolgreicher Workflow-Lauf allein belegt kein vollständiges Fenster oder Zielerreichung. | Root sammelt BENCH-01/02-Berichte und BENCH-03-Aggregate; PM pflegt die Releaseakte, Chief verfolgt Befunde. Nach der ersten und zweiten vollständigen Messwoche ab tatsächlichem Release, im bestehenden Montagsrhythmus. Releasedatum und konkrete Prüfdaten sind noch unbekannt. |
| 40 Queue-Läufe | **Offen:** 0 KI-30-Fehlschläge in 40 Queue-Läufen; bestehendes Fenster nach #518-Merge vom 05.10.2026 22:12:40 UTC wird fortgeführt, nicht am Release neu begonnen. Root-Audit vom 06.10.2026 17:15 UTC: 21 Läufe, 19 erfolgreich, 2 fehlgeschlagen; dies ist kein aktueller Vollnachweis. Queue-Fehler sind nicht automatisch KI-30. | Root ergänzt den gespeicherten Audit mit Run-ID, Kandidaten-SHA und Fehlerdisposition; Chief/PM führen den offenen Befund nach. Nächster Releaseakte-Abgleich beim tatsächlichen Release, Abschlussprüfung beim 40. Lauf des bestehenden Fensters; konkrete Prüfdaten unbekannt. |

Belegquellen: [`benchmark.md`](benchmark.md), `scripts/dev/bench-weekly.mjs`, `.github/workflows/bench-weekly.yml` (Job-Summary), vorhandene lokale BENCH-03-Aggregate und Root-Audit `root-v160-queue-evidence-20261006.json`. Queue-Auswahl: Workflow `ci`, Ereignis `pull_request`, Branch `mergify/merge-queue/*`, vollständiges bestehendes Zeitfenster und eindeutige Run-IDs; nicht `merge_group`. Der Auditpfad und lokale Rohdaten gehören nicht ins öffentliche Repo. Neue Beobachtungen brauchen Quellenstand, vollständigen Nenner und Fehlerzuordnung; fehlende Daten bleiben offen.

Pflicht in den Releasehinweisen: „Die zwei Wochenmessungen und der 40-Queue-Lauf-Nachweis sind noch offen und werden nach v1.6.0 fortgeführt. Befunde gehen in v1.6.1 ein, kritische Befunde werden früher behandelt.“ Das ist keine Releasefreigabe.

## 7b. Bessere Nacharbeit

Ist Nacharbeit nötig (Review-Befund, rote Prüfung), gilt: **genau eine begrenzte Fixrunde auf demselben Branch, kein neuer PR.** Jeder Befund steht als `Datei:Zeile` mit Befehl und Exit-Code im Abschnitt `### Nacharbeit` des PR-Textes. Der Fix ist ein Commit auf dem Branch, danach ein erneutes `prepush`. Bleibt ein Befund offen, entscheidet der Nutzer (AGENTS.md, Regel 5), es folgt keine zweite Fixrunde. Befund ohne `Datei:Zeile` zählt als unbelegt. Die Pakete FLOW-01, FLOW-02, FLOW-07, FLOW-03 und WIN-01 liegen deshalb in der ersten Welle (W0), nicht erst nach G1.

## 8. Bewusst nicht in v1.6.0

M4-R19-02/03/04/07/09 (Frage 2), V16-10, W1-24c, W1-09c, W5-31, M5-04, Dependabot-Majors, W2-02b3, V16-11, ARCH-12, HQ2-04/06–10 und das Einschalten des Dauerbetriebs (Entscheidung des Nutzers, kein Paket). M5-01 (Testerrunde) folgt auf V16-03.

## 9. Risiken

- **G1 liegt nicht in diesem Plan.** Verzögert sich v1.5.1, läuft nur W0. W0 enthält kein Naht-Paket; die Nachrücker an den Nähten warten mit.
- **KI-30 kann offen bleiben.** Die Ursache ist unbelegt. Endet V16-01 als Diagnose, bleibt die serielle Minderung, und das CI-Ziel (≤ 8 % rote Queue-Läufe) ist gefährdet.
- **Größen sind Schätzungen.** Ein Architektur-Paket lag früher doppelt über dem Budget. Der Worker-Brief misst vor dem ersten Edit und schneidet.
- **Ohne Codex fehlt Kapazität.** Codex lieferte 41 % der PRs im Messfenster. Das Durchsatz-Ziel ist bis G2 unsicher.
- **Reviews hängen am PC,** solange Frage 4 offen ist. Bis G2 ist das der Engpass für Stufe A und B.
- **Mehr Regeln können bremsen.** Rekursives Prompting kostet je Auftrag eine Runde. M-LEAD (Ziel p90 ≤ 6 h) zeigt, ob es zu teuer wird.
- **V16-06 fasst den Update-Start an.** Stufe A, Berater-Paar, roter Test zuerst, Drill unter Windows.
- **Belege zu den ARCH-D-Paketen sind Stichproben:** `docs/PLAN.md` nennt für D1 vier Klassifizierer (gefunden: drei) und für D3 elf direkte Aufrufe (gezählt außerhalb von Tests: elf, dazu der Helfer und drei Kommentarzeilen, zwei in `store/continuous.rs` und eine in `workers/delivery_state.rs`); D8 hat noch keinen Anker.

## 10. Fragen an den Nutzer

Die E-Nummern vergibt der Koordinator beim Eintrag in die Entscheidungs-Inbox. Dieser Plan kostet kein Geld und löscht nichts. Releases bleiben Sache des Nutzers (AGENTS.md, Regel 10).

| # | Art | Frage | Empfehlung |
|---|---|---|---|
| 1 | Richtung | Ist „tester-tauglich und schlanker“ mit den 19 Kern-Paketen das Thema von v1.6.0? | Ja. |
| 2 | Richtung | Die fünf Audit-Reste M4-R19-02/03/04/07/09 (am 04.10. nach M5 gelegt) auf v1.6.x verschieben? | Ja. Die Tester-Abnahme braucht sie nicht, und st sinkt von 7 auf 3 Pakete. |
| 3 | Sicherheit | Start nach einem Update ohne Journal: gesperrt bleiben und eine Anleitung zeigen, oder dem ersten Start vertrauen? | Gesperrt mit Anleitung. Sicherheit geht vor Komfort. |
| 4 | Installation | Den kostenlosen Ollama-Client auf dem Build-Server installieren, damit Reviews nicht mehr am PC hängen? | Ja. Ohne ihn bleibt der PC der Engpass. |
| 5 | Arbeitsweise | Freigabe je Welle statt je Paket, mit allen Entscheidungen der Welle gebündelt davor? | Ja. |

Schon in der Inbox und Voraussetzung: E16 (Lizenz, blockiert V16-03 und M5-01), E14 (Schlüssel-Backup, dringend), E23 (Aufgaben-Benchmark). Mitwirkung des Nutzers ohne Entscheidung: ein frisches Windows-Konto für V16-03 und ein Termin für den Update-Drill von V16-06.

## 11. NICHT ABGEDECKT

- Die Orchestrator-Zahlen (Leerlauf, Blockaden, Konflikte) stammen aus einem lokalen Log und sind nicht öffentlich nachrechenbar.
- Kein Build, kein Test und kein Lauf wurden für diesen Plan ausgeführt. Die Zeilennummern gelten an der Basis `2ec6960`.
- Kontingent und Modell der Anbieter wurden nicht beobachtet; die Anbieter-Spalte ist ein Vorschlag.
- Ob der Ollama-Client auf dem Server läuft, ist ungeprüft.
- Die Wirkung von S1–S8 ist eine Prognose. Erst die Wochenmessung zeigt, ob sie eintritt.
