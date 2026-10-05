# Fahrplan v1.6.1 bis v2.0.0 (Entwurf, der Nutzer entscheidet)

Basis `origin/main` `d01bc55` (05.10.2026). Dieser Fahrplan setzt `docs/plan/v1.6.0/plan.md` fort und ändert M1–M4 nicht (`docs/PLAN.md`, Regel 2). Pakete stehen je Release in [`v1.7.md`](v1.7.md), [`v1.8.md`](v1.8.md), [`v1.9.md`](v1.9.md), [`v2.0.md`](v2.0.md); v1.6.1 steht unten. Alle `Datei:Zeile`-Belege sind an `d01bc55` geprüft; Größen sind Schätzungen und werden vor dem Start gemessen.

## 1. Ziel

ProjectA soll in kleinen, sicheren Schritten von v1.6.0 zu einem vertragsstabilen v2.0.0 wachsen, das einfache Änderungen belegt selbst mergt und seine Freiheit sofort senkt, wenn etwas schiefgeht. Jedes Zwischenrelease hat ein Thema, ein messbares Eintritts- und Austrittstor und eine Testerrunde, und die Nacharbeit sinkt von Release zu Release messbar (Abschnitt 5). Rekursives Prompting bleibt fester Teil jedes Auftrags (`docs/plan/v1.6.0/plan.md` Abschnitt 6), es kostet kein Geld, und die Nähte bleiben strikt seriell, während alles ohne Naht daneben läuft.

## 2. Release-Raster

Beta `x.y.0`, Endrelease `x.y.1` (nur Fixes, Naht-Sperre ab der Beta), weil die Pipeline nur `x.y.z` annimmt (`docs/PLAN.md` Inbox E24). Tag und Veröffentlichung entscheidet der Nutzer, die Freigabe zu v1.5.x gilt nicht automatisch für spätere Releases. Jedes Tor enthält zusätzlich: `main` grün, M-RP ≥ 90 %, NICHT-ABGEDECKT-Block in jedem PR.

| Release | Thema | Eintritt | Austritt (messbar) | Pakete | Tester |
|---|---|---|---|---|---|
| v1.6.1 | Fixrunde nach Testerrunde 1 | v1.6.0 veröffentlicht, G1, Testerrunde läuft | jeder Befund mit `Datei:Zeile` entschieden, 0 offene Hoch-Befunde; Ziele aus v1.6.0 7a zwei Wochen in Folge; Update-Drill belegt | 5 + ≤ 10 Fixes | 3–5 (M5-01) |
| v1.7.0 / v1.7.1 | Nähte öffnen, ohne Angst installieren | v1.6.1, `main` grün, zwei Wochenmessungen | [`v1.7.md`](v1.7.md): Nähte kleiner als an der Basis, Testlisten-Parität, frisches Konto ohne Hilfe bis zur ersten Aufgabe | 42 | 8–10 |
| v1.8.0 / v1.8.1 | Projekte mit Rahmen, eine Oberfläche | v1.7.1, E16 beantwortet, A7 entschieden | [`v1.8.md`](v1.8.md): fremde Projekt-ID → 404 auf jeder Route, Projekt-Not-Aus, Schema-Gleichheit | 33 | 15–20, erste Pilotnutzer |
| v1.9.0 / v1.9.1 | Dauerbetrieb überwacht, Postfach, Messung | v1.8.1, Frage 4 = Ja | [`v1.9.md`](v1.9.md): Not-Aus ≤ 10 s, Wiederanlauf ohne Doppelstart, ≥ 2 Wochen betreut ohne ungeklärten Zustand, Funktionsstopp | 46 | 20+ |
| v2.0.0 | belegt autonom, vertragsstabil | v1.9.1, ≥ 4 Wochen betreut ohne Rückschlag (`docs/PLAN.md:295`) | [`v2.0.md`](v2.0.md): Rampe nie über dem Rahmen, Revert senkt sofort, Stufe 1 ≥ 2 Wochen sauber, Migrationsprobe, Zusage | 16 | öffentlicher Start (Nutzer) |

### v1.6.1 (Patch, nur Fixes und nahtfreie Arbeit)

| ID | Titel — Ziel | Gr. | Lane | Stufe | Naht | Hängt ab von | Abnahme | Beleg |
|---|---|---|---|---|---|---|---|---|
| R161-01 | Fixrunde aus Testerrunde 1: je Befund ein Paket, roter Test zuerst; Naht-Fixes nur als Ausnahme mit Begründung | n× S (≤ 10) | je Befund | je Datei | je Befund | M5-01 | je Fix `bash scripts/ci/gates.sh lane prepush` Exit 0 | `docs/PLAN.md` M5-01 |
| R161-02 | Stale-Antworten im Frontend: ein roter Wechseltest je Stelle; zuerst prüfen, ob die Stelle noch offen ist (`git log --grep`) | 3× S | fe | B | – | – | `npm run test` Exit 0 | `docs/PLAN.md:437-439` (`AttentionInbox.tsx:63`, `ActivityView.tsx:48`, `HistoryView.tsx:36`, `SessionRestorePanel.tsx:67`) |
| R161-03 | Link-Prüfer für README und KNOWN_ISSUES | S | ci | C | – | – | Prüfer auf `main` Exit 0, auf präpariertem Fall Exit 1 | `docs/PLAN.md:467` |
| R161-04 | Update-Drill am echten Release (cancel, fail, success) | N | N | – | – | v1.6.0 | Protokoll unter `docs/drills/` | `docs/drills/updater-drill.md`, `KNOWN_ISSUES.md:48` (KI-31) |
| R161-05 | Dokumentstand: PLAN/STAND auf den echten Stand (falls V16-02 Reste lässt) | S | doc | C | – | V16-02 | Prüfliste im PR: 0 gemergte IDs „offen“ | `STAND.md:1` (Stand 04.10.) |

Audit-Envelopes (M4-R19-02/03/04/07/09) bleiben **nicht** in v1.6.1: das Final hat Naht-Sperre. Sie liegen in v1.7 (R17-25…27, R17-36) und v1.8 (R18-26).

## 3. Abhängigkeitswellen und Nähte

| Welle (release-übergreifend) | Inhalt | Voraussetzung | Naht-Pakete gleichzeitig |
|---|---|---|---|
| A | v1.7-Füllung: Beweis-Gate R17-01, Ratsche, ADRs, Erststart, Diagnose, Vorlagen, `ipc.ts`, Vertragstests | v1.6.1 | 0 |
| B | Tests raus aus den vier Nähten und `workers.rs` (rein) | R17-01 grün, Frage 1 = Ja | 4 + wk |
| C | Ports, Modelle, Migrationsdateien (st-Kette 8, api/mn-Kette 5) | Welle B | 3 |
| D | v1.8: Ports c–e, Projektrahmen, Projekt-Not-Aus, `route()`-Scheiben | v1.7.1, A7 | 3 |
| E | v1.9: Journal, Postfach, Scheduler, Daemon, Wiederanlauf | v1.8.1, Frage 4 | bis 4 |
| F | Betreuter Dauerbetrieb (Nutzer-Arbeit), danach Rampe R20-01…05 | v1.9.1, 4 Wochen | 1 (st) + 1 (api) |

| Release | st | api | mn | pa | wk | an Nähten | ohne Naht |
|---|---|---|---|---|---|---|---|
| v1.7 | 8 | 5 | 5 | 3 | 1 | 19 | 23 |
| v1.8 | 7 | 8 (36 bedingt) | 7 | 3 | 0 | 21 | 12 |
| v1.9 | 8 + 2 (A7) | 5 | 6 | 2 | 6 | 23 (+ 3 nur wk) | 20 |
| v2.0 | 1 | 1 | 0 | 0 | 0 | 2 | 14 |

Kettenlänge je Naht und Minor ≤ 8 (Kapazitäts-Eingabe). Ausnahme v1.9 st: 10 ohne A7 = Ja. Bis zu vier Nähte laufen gleichzeitig, nie zwei Pakete an derselben; ein Paket mit zwei Nähten sperrt beide. Reine Verschiebungen (R17-20/30/35/40/45, R18-20/24/25) und Lockfile-Majors (R17-12) überschreiten 300 Diffzeilen und sind erst startbar, wenn Frage 1 mit Ja beantwortet ist. Der Dauerbetrieb bleibt bis v1.9 aus und eingefroren (`AGENTS.md` „Development loop“); R18-22/23 legen nur den Projektrahmen mit der Vorgabe „keine Autonomie“ an.

## 4. Kapazitätsannahme und Zeit

Beobachtet (Fenster 02.10. 20:12 bis 05.10. 11:46 UTC, 200 PRs ohne Bots): volle Tage etwa 72 PRs, Lead-Zeit Median 1,05 h, 28,5 % der PRs an Nähten, Queue-Lauf Median 12,3 min. **Annahme (Plan, nicht gemessen):** etwa 107 Pakete netto je Woche, nach v1.6.0 etwa 124 bei halbierter Nacharbeit; je Naht etwa 12 je Woche. Die geplanten 16–46 Pakete je Release sind etwa 15–25 % der Zwei-Wochen-Kapazität: **Kapazität begrenzt nicht, Ketten, Drills, Testerzeit und Entscheidungen begrenzen.** Unsicherheit: Fenster nur 3,6 Tage (Rückstau-Spitze); Lane aus Dateipfaden abgeleitet; Codex fehlt laut v1.6.0-Plan bis 11.10., Claude-Wochenlimit unbeobachtet; Reviews hängen am PC, solange der Ollama-Client auf dem Server fehlt.

| Beta-Tag, Wochen nach G1 (v1.5.1 veröffentlicht) | v1.6.0 | v1.7.0 | v1.8.0 | v1.9.0 | v2.0.0 |
|---|---|---|---|---|---|
| optimistisch | 1,5 | 3,5 | 5,5 | 7,5 | 13 |
| realistisch | 2 | 5 | 8 | 11 | 17 |
| vorsichtig | 3 | 7 | 11 | 16 | 23 |

Das Final folgt etwa eine Woche nach seiner Beta (Annahme). v2.0.0 liegt später als im Kapazitäts-Raster (13 Wochen), weil dort die 4 Wochen betreuter Dauerbetrieb vor der Rampe und die Stufe-1-Zeit fehlen; das ist keine Datumszusage.

## 5. Nacharbeit je Release

Alle Zahlen sind Ziele, keine Messwerte; Messung jeden Montag mit `node scripts/dev/bench-weekly.mjs` (BENCH-01 aus v1.6.0; bis dahin die Befehle in `docs/plan/v1.6.0/benchmark.md` Abschnitt 5). Verfehlt eine Zeile zwei Wochenmessungen, kommt sie als Frage in die Inbox und wird nicht still gesenkt.

| Release | Fix-PRs ≤ 72 h | rote Queue-Läufe | Hotfix/Revert | Hebel in diesem Release |
|---|---|---|---|---|
| v1.6.0 | ≤ 8 % | ≤ 8 % | ≤ 1/Woche | Prompting, plan-lint, WIN-01, KI-30 (v1.6.0 Abschnitt 7a) |
| v1.7 | ≤ 8 % halten | ≤ 8 % | ≤ 1/Woche | Verschiebungs-Beweis, Tests raus aus Nähten, Naht-Sperre im Soak |
| v1.8 | ≤ 6 % | ≤ 6 % | ≤ 1/Woche | Port-Tests, Schema-Gleichheit vor Migration, Auftrags-Erzeuger, Abschluss-Vertrag |
| v1.9 | ≤ 5 % | ≤ 5 % | ≤ 1/Woche | eine automatische Fixrunde (R19-07), Queue-Härtung, Bilanz je Klasse |
| v2.0 | ≤ 4 % | ≤ 5 % | ≤ 1/Woche, Revert senkt die Stufe | Auto-Merge nur mit Beleg, Rampe |

## 6. Widersprüche der Eingaben und Entscheidung

| Thema | Scout / Architektur / Kapazität | Entscheidung | Grund |
|---|---|---|---|
| Audit-Envelopes | v1.6.1 / v1.7–1.8 / v1.7 | v1.7 und v1.8 | v1.6.1 ist Soak mit Naht-Sperre (Kapazität, Regel 3) |
| Dauerbetrieb einschaltbar | v1.8 / v1.9 / v1.9 | v1.9 | braucht Ports, Rahmen, Scheduler; Funktionsstopp bis Nutzerentscheid |
| Kern-Crate | – / v1.9 bedingt (D4) / – | nach 2.0 | `Cargo.toml`-Änderung = volle CI, Einfrierfenster widerspricht dem Funktionsstopp, Kopplung (60 Importe) ungelöst |
| Inhalt v2.0 | F1–F3 / Vertrag / „keine neuen Funktionen“ | R20-01…05 (F3 bedingt) plus Doku | die Rampe ist das Versprechen; Abweichung: 1 st-, 1 api-Paket |
| Lizenzpfad | v1.7 Texte, v1.9 Prüfung / D7 vor v1.9 / hart vor v1.8 | Texte v1.7, Anzeige-Prüfung v1.8, sperrt nichts | Pilotnutzer in v1.8.1 brauchen den Pfad |
| Typisierter `CoreError` | – / AM-24 v1.9 / – | ADR-Tor R19-03 | `docs/decisions.md:12-23` (A4): erst mit drittem Transport |
| Stufe-1-Dauer | 4 Wochen / – / – | 2 Wochen (Nutzer legt fest) | 4 Wochen Dauerbetrieb stehen schon vor der Rampe (`docs/PLAN.md:295`) |
| Zeile „Testblock `store.rs`“ | – / 4191 / – | `store.rs:4274` (`mod tests`) | 4191 ist ein `cfg(test) impl Store` |

Verworfen oder nicht verwendet: Scouts PLAN-Zeilennummern (verschoben, ersetzt), Scouts CSP-Befund B2 (nicht benötigt), „SmartScreen-Warnung“ (nicht beobachtet, nur als Vermutung bei R17-11), das Projekte-Konzept `.pa/plan_projects_w5.md` (fehlt im Baum; W5-Pakete stammen aus der ID-Liste `docs/PLAN.md:295` und dem Archiv-Prompt `.pa/archiv/review-prompts/review_prompt_projects_w5_r2.md`, deren Inhalt der Auftrag je Paket zuerst prüft). Umfang von `BootstrapScreen.tsx`, `DiagnosticsPanel.tsx`, `enhance.rs`, `critic.rs` ist nur nach Dateigröße bekannt: R17-05 und R18-06 beginnen mit der Prüfung. Offen an der Basis: Issue #489 „Roter main“ (`gh issue view 489`, OPEN): erst grün, dann neue Arbeit (Regel 8).

## 7. Offene Fragen an den Nutzer (Inbox, jeweils mit Empfehlung)

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Regel 1 (≤ 300 Zeilen) bekommt eine Ausnahme für beweisbar reine Verschiebungen (R17-01) und Lockfile-Majors? | Ja; sonst brauchte allein `api.rs` etwa 20 serielle Pakete, und die Nähte bleiben groß. |
| 2 | E16 Lizenz und Geschäftsmodell, dazu Prüfung der Anbieter-Nutzungsbedingungen für Dauerbetrieb bei zahlenden Nutzern, vor dem v1.7.0-Tag? | Ja, mit rechtlicher Beratung; blockiert R17-09/10, R18-40. |
| 3 | Authenticode-Zertifikat für den Installer kaufen (R17-11)? | Ja, vor v1.7.0; sonst bleibt der Installer ohne diese Signatur (Folge für Tester nicht beobachtet). Geld: Entscheidung des Nutzers. |
| 4 | Funktionsstopp für Continuous mit v1.9 aufheben, Einschalten nur durch Sie, und Zahlen festlegen: Wochen betreut, Schatten-Übereinstimmung, Wochen Stufe 1? | Ja; 4 Wochen betreut, Stufe 1 zwei Wochen, jede Stufe einzeln freigeben. |
| 5 | Nach 2.0 verschieben: Linux/macOS, Cloud-Runner, Kern-Crate, `CoreError`; englische Oberfläche (R19-09) nur bei Markt über den deutschen Sprachraum? | Ja, alles nach 2.0; Englisch nur wenn der Markt es verlangt. |

ADR-Pakete (R17-03 A7, R17-04 A1, R18-01 D2, R19-01 D5, R19-03 A4) legt der Koordinator den Beratern vor und trägt sie in `docs/decisions.md` ein; sie sind keine eigenen Fragen.

## 8. NICHT ABGEDECKT

Kein Build, kein Test, kein Gate des Produktcodes (nur Dokumentation). Größen und Kettenlängen sind Schätzungen; Wellen und Zeiten sind Plan, nicht Messung. Nicht belegt: Umfang bestehender Erststart- und Diagnose-Bausteine, Wirkung der Verschiebungen auf die Nacharbeit, Anbieterkontingent, rechtliche Lage (Lizenz, Nutzungsbedingungen), SmartScreen-Verhalten, Preise. Kein Windows-Beleg. `pa/evidence` und `bench-weekly.mjs` gibt es noch nicht.
