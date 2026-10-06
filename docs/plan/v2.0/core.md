# Core: die eine App-KI mit Rechten (Entwurf, Teil von Plan v2.0)

Stand 06.10.2026. Der Nutzer hat das Konzept am 06.10. freigegeben. Dieses Dokument beschreibt es; die Pakete (V2-CORE-*, V2-SEC-*) stehen in [`plan.md`](plan.md), Abschnitt 3.9. Das Board dazu, `docs/design/2026-10-ui-v2/glass/Core.dc.html` (1165 Zeilen), liegt jetzt im Repo und wird der Bildschirm „Core“ (V2-S08). Alles hier ist Entwurf: Datei- und Tabellennamen sind Vorschläge, die V2-ARCH-0 (Architektur-Skizze, zwei Fremd-Reviews) festlegt.

## 1. Was der Core ist

ProjectA 2.0 hat **eine** App-KI mit Rechten. Es gibt keinen zweiten Orchestrator neben ihr. Sie trägt drei Hüte:

| Hut | Aufgabe | Heute | Pakete |
|---|---|---|---|
| **Steuerung** | App-Einstellungen, Personas, Trigger, Kontingente, Ausführungsorte | von Hand in `SettingsView` und in Dateien | V2-CORE-1 bis 7 und 9 |
| **Arbeit** | Pakete nehmen, Agenten starten, Reviews fahren, Queue beobachten (der heutige Orchestrator) | `pa-orch` außerhalb des Repos (nicht prüfbar, V2-O0) | V2-O0, die Maschine „Ablauf mit Beweis“ (V2-RUN-1 bis V2-RUN-4, `plan.md` 3.5), V2-DOG-1 |
| **Aufmerksamkeit** | Was erreicht den Nutzer; Fragen gebündelt in ein festes Tagesfenster; Wochenbrief (der heutige Chief of Staff) | `pa-orch`, `QuestionsView` | V2-CORE-AT (enthält den früheren Chief of Staff) |

Ein Hut ist eine Rolle des Core, kein eigener Prozess: dieselbe Regelgrenze (Abschnitt 3), dasselbe Journal (Abschnitt 2), derselbe Not-Aus.

## 2. Ein Schreiber je Einstellung

- Jede Einstellung (jeder Schlüssel) hat genau **einen Besitzer**: Nutzer, Core oder eine Regel im Code. Das Register `settings_owner` (Schlüssel → Besitzer, Bereich, Risikoklasse, Wirkstelle im Code) ist die einzige Liste; ein Schlüssel ohne Eintrag ist nicht änderbar.
- **Hilfs-Agenten ändern nie Einstellungen.** Sie stellen einen **Antrag** (`pa core request`, Schlüssel, neuer Wert, Grund, Beleg). Ein Antrag ist eine Zeile im Journal, keine Änderung.
- **Alle Änderungen laufen durch ein einziges Änderungs-Journal.** Eine Änderung ist ein getypter Eintrag: `key`, `old`, `new`, `reason`, `evidence`, `risk_class`, `rollback` (der Gegenwert und der Befehl, der ihn setzt), dazu Urheber, Zeit und Zustand. Das Journal ist append-only (Vorbild: `store/audit.rs`, Trigger gegen UPDATE/DELETE).
- **Serialisierung:** Anträge auf denselben Schlüssel werden nacheinander entschieden (je Schlüssel eine Warteschlange, Sperre beim Anwenden). Ein zweiter Antrag auf einen Schlüssel, dessen erste Änderung noch in der Probezeit ist, wartet oder wird mit Grund abgelehnt, nie überschrieben.
- Zustände einer Änderung: `beantragt → geprüft → angewendet (Probezeit) → bestätigt | zurückgerollt | abgelehnt`.

## 3. Rechte-Stufen und feste Grenzen (im Code, nicht in der Konfiguration)

Je **Bereich** (Orte, Kontingente und Failover, Personas, Trigger, Benachrichtigungen, App-Wissen, Verbesserungen, Aufmerksamkeit) stellt der Nutzer eine Stufe ein:

| Stufe | Bedeutung |
|---|---|
| **Aus** | der Core rührt den Bereich nicht an |
| **Vorschlagen** | der Core schreibt Anträge mit Diff-Vorschau; der Nutzer bestätigt |
| **Selbst mit Bericht** | der Core ändert, stellt es ins Journal, schreibt einen Bericht und rollt bei schlechter Wirkung zurück |

**Immer nur Vorschlag, in Rust festgelegt, nicht abschaltbar:** Geld, Rechte (auch die Rechte anderer Agenten und der eigenen Stufe), Sicherheit (dazu gehören die Datenschutz-Einstellungen der Kundenprojekte: Allowlist, Einwilligung, Filter), Löschen, Releases und die **eigene Stufe**. Ein Test erzwingt das: jeder Schlüssel mit diesen Klassen lehnt Selbst-Änderung ab, auch wenn das Register falsch gepflegt ist.

**Vertrauen wächst mit Belegen:** Je Bereich zählt das Journal Änderungen, die die Probezeit ohne Rücknahme bestanden haben. Das Erhöhen der Stufe ist selbst ein Vorschlag an den Nutzer, mit dieser Zahl als Beleg. Der Core erhöht seine Stufe nie.

## 4. Probezeit und Rücknahme

- Jede selbst angewendete Änderung läuft **24 Stunden Probezeit**. Je Schlüsselklasse steht im Register die Messgröße (zum Beispiel freier RAM, Wartezeit in der Queue, Leerlauf-Plätze, Kontingent-Verbrauch, Nacharbeit) und die Toleranz.
- Verschlechtert sich die Messgröße über die Toleranz hinaus oder tritt ein Fehler auf, **rollt der Core automatisch zurück** (der `rollback`-Eintrag) und meldet das im Tagesbericht. Eine Wirkung ohne beobachtete Messgröße zählt nicht: Die Änderung bleibt Vorschlag (Grundsatz „Konfiguration ist kein Beleg“, AGENTS.md).
- Der **Optimierer** schlägt Verbesserungen als **Einwochen-Versuche** vor (eine Änderung, Messgröße, Vergleich mit der Vorwoche, Entscheidung des Nutzers am Ende). Nur Schalter mit belegter Wirkung (D8).

## 5. Fähigkeiten und Abnahmen

| Fähigkeit | Paket | Abnahme (messbar) |
|---|---|---|
| Steuerung per Satz mit Diff-Vorschau | V2-CORE-6 | Ein Satz erzeugt einen getypten Änderungs-Entwurf; Wert außerhalb des Registers wird abgelehnt; die Vorschau zeigt alt und neu |
| Selbstheilung | V2-CORE-5 | RAM unter 1,5 GiB frei: neue Starts gehen auf den Server oder in die Cloud (nur wenn belegt verfügbar); Kontingent nahe am Limit: Failover nach Regel; stehengebliebener Agent: genau eine Meldung. Je Fall ein Test mit Fixture |
| Probezeit und Rücknahme | V2-CORE-3 | Test mit künstlich verschlechterter Messgröße: Rücknahme innerhalb der Probezeit, Journal-Eintrag vollständig |
| Optimierer | V2-CORE-7 | Ein Versuch läuft genau eine Woche, endet mit Vergleich, ändert danach nichts ohne Bestätigung |
| App-Wissen pflegen („Wann was“) | V2-B26 (früher V2-CORE-8) | Nach einer Befehlsänderung von `pa` meldet der Vergleich mit dem Handbuch (V2-B26) die Lücke als Antrag |
| Einstellungen erklären mit Verlauf | V2-CORE-9 | Zu jedem Schlüssel: Besitzer, aktueller Wert, die letzten Journal-Einträge mit Grund |
| Tagesbericht (3 Zeilen) | V2-CORE-9 | Genau drei Zeilen: was geändert, was zurückgenommen, was wartet auf den Nutzer |
| Aufmerksamkeit (Tagesfenster, Wochenbrief) | V2-CORE-AT | Fragen außerhalb des Fensters landen im Sammelkorb; Not-Aus und Sicherheit sind die einzigen Ausnahmen |
| Regelmodus ohne Kontingent | V2-CORE-10 | Ohne Modell-Kontingent arbeitet der Core nach festen Regeln (RAM, Stillstand, Not-Aus, Frist-Erinnerung); er ist nie dunkel. Steht die Stufe „lokal“ bereit (V2-B2b), darf V2-ARCH-0 vorsehen, dass der Core sie nutzt; der Regelmodus bleibt der Boden. Test: Kontingent leer → Regeln greifen, keine Modellanfrage |
| Not-Aus stoppt den Core | V2-CORE-10 | Bei aktivem Not-Aus wendet der Core nichts an, Probezeiten pausieren, Modellanfragen enden; Messung gemeinsam mit der 10-s-Frist (`estop.rs:9`) |

## 6. Sicherheit (Stufe A, zwei Fremd-Reviews)

Der Core liest Text, den Dritte beeinflussen können, und darf Einstellungen ändern. Das ist die Stelle, an der ein Angreifer Hebel bekommt.

| Bedrohung | Maßnahme (in Code und Test) |
|---|---|
| **Prompt-Injection aus Repo-Inhalten** (AGENTS.md, PR-Texte, Dateinamen, Logs eines fremden Repos) | Fremdtext wird eingehüllt und als unvertraut markiert (Muster von W5-00b, `docs/PLAN.md`: ✓ #18); die Modellausgabe wird nie ausgeführt, sondern nur in einen getypten Änderungs-Entwurf mit erlaubten Schlüsseln und Wertebereichen gelesen. Aktionsmuster aus „Später“ (`docs/PLAN.md`): das Modell wählt aus einer nummerierten Liste erlaubter Änderungen, die der Code aus dem Register erzeugt |
| **Injection über Agenten-Post** | Ein Antrag trägt die geprüfte Identität des Absenders (Run-Credential, `api/agent_access.rs`), nie eine Selbstauskunft im Text; Text im Antrag ist Begründung, nie Befehl |
| **Freigabe-Umgehung** | Bestätigung nur über einen vom Nutzer authentifizierten Kanal (das App-Fenster). Ein gekoppeltes Gerät darf nur antworten und stoppen, nie bestätigen (V2-H4). Der Core bestätigt nie seine eigenen Anträge; Anträge auf Geld, Rechte, Sicherheit, Löschen, Releases oder die eigene Stufe führen nie zu Selbst-Änderung |
| **Schlüssel- und Datenabfluss** | Der Core sieht Schlüssel nur als `tresor://`-Verweis; Berichte und Journal laufen durch den Secret-Scan (`scripts/ci/secret-scan.sh`) |
| **Kundendaten bei KI-Aufrufen** (Kundenprojekte) | Datenschutz-Schleuse V2-PRIV-1 bis 3 (`plan.md` 3.12): Allowlist, Protokoll, Filter; der Core ändert sie nie (Klasse „Sicherheit“) |
| **Eskalation über Reihenfolge** | Serialisierung je Schlüssel; Rücknahme stellt den alten Wert wieder her, auch wenn zwischendurch ein Antrag wartet |

Tests (V2-SEC-1): ein präpariertes Repo mit Injektionstext erzeugt keinen Änderungs-Eintrag außerhalb des Registers; ein Antrag mit „der Nutzer hat zugestimmt“ im Text bleibt Antrag; jede feste Grenze aus Abschnitt 3 hat einen roten Test; das Bedrohungsmodell (V2-SEC-0) benennt Core, Webhooks, MCP, SSH und Agentenpost gemeinsam.

## 7. Wo es lebt (Skizze, bestätigt oder geändert durch V2-ARCH-0)

- Neue Module, keine Logik in den Nahtstellen: `src-tauri/src/core/` (Register, Journal, Antrags-Warteschlange, Stufen, Probezeit, Regelmodus). Persistenz in `store/core.rs`, Routen in `api/core_routes.rs`, Befehle in `main.rs`; in den Nahtdateien stehen nur Verdrahtungszeilen (V2-ARCH-1).
- Ereignisfluss: Agent oder Nutzer → Antrag → Prüfung (Register, Grenzen, Serialisierung) → Entscheidung (Nutzer oder Stufe „Selbst“) → Anwenden → Probezeit mit Messung → bestätigt oder Rücknahme → Journal, Tagesbericht.
- Besitz der Einstellungen anderer Pakete: Persona-Rechte (V2-B17), Orte (V2-B5), Failover (V2-B2a), Trigger (V2-B15), Verbesserungs-Presets (V2-B20) tragen ihren Besitzer im Register; sie schreiben nicht an V2-CORE-1 vorbei.

## 8. Reihenfolge

V2-ARCH-0 und V2-SEC-0 (Doku, vor Welle 1) → V2-CORE-1, 2, 4 (Kern ohne Datenbank) → V2-ST-K1 (Tabellen) → V2-CORE-3, 10 → V2-API-K, V2-MN-K → V2-CORE-5, 6, 9, AT → V2-S08 (Bildschirm) → V2-CORE-7 (nach dem Kern-Release erlaubt, vor 2.x gebaut). V2-SEC-1 läuft vor dem ersten „Selbst mit Bericht“.
