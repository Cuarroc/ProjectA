# V2-IA-1 — Informationsarchitektur (Glass UI v2)

Stand: bestätigt gegen `docs/design/2026-10-ui-v2/glass/*.dc.html` und
`plan.md` Abschnitt 3.4. Gemeinsamer Systemblock der Boards (Zeilen 15–229)
ist in allen 25 Dateien identisch (eine Prüfsumme). Dieses Dokument ist die
verbindliche Routen- und Navigationskarte für V2-F8 und alle Bildschirm-Pakete.
Kein Laufzeitcode; sichtbar erst mit V2-F9.

## 1. Navigation (Schale)

Seitenleiste (9 Einträge; Ersteinrichtung liegt **nicht** darin):

| # | Eintrag | Route | Bildschirm |
|---|---|---|---|
| 1 | Leitstand | `/leitstand` | Leitstand |
| 2 | Eingang & Plan | `/eingang/plan` (Default-Tab) | Eingang & Plan |
| 3 | Beweise | `/beweise` | Beweise |
| 4 | Team | `/team` | Team |
| 5 | Automatik | `/automatik` | Automatik |
| 6 | Core | `/core` | Core |
| 7 | Core · Steuerung | `/steuerung` | Core · Steuerung |
| 8 | Gedächtnis | `/gedaechtnis` | Gedächtnis |
| 9 | Einstellungen | `/einstellungen` | Einstellungen |

Zehnte Fläche: **Ersteinrichtung** `/start` — nur beim ersten Start und über
Einstellungen. Befehlspalette (Strg K) sitzt in der Kopfleiste der Schale
(V2-F8), nicht als eigener Seitenleisten-Eintrag. Start-Sheet „Agent starten“
ist ein Sheet des Leitstands und von jedem Bildschirm aus erreichbar (keine
eigene Route).

## 2. Board-Teil → Ziel-Bildschirm

26 Zeilen für 25 Board-Dateien: `Projekteinstellungen.dc.html` erscheint in
zwei Zeilen (Autonomie vs. Rest). Jeder Board-Bereich steht genau einmal.

| Board | Teil | Ziel-Bildschirm | Route |
|---|---|---|---|
| Main | Karten, Filter, „Braucht dich“, Betrieb, Sicherer Start | Leitstand | `/leitstand` |
| TeamLauf | Orchestrator-Chat, Teams, Naht-Spur, Übergaben | Leitstand, Tab Verlauf | `/leitstand/verlauf` |
| Aktivitaet | Protokoll, Wiederholung | Leitstand, Tab Verlauf | `/leitstand/verlauf` |
| AgentStarten | Start-Sheet (Persona, Ort, CLI, Modell, Failover) | Sheet des Leitstands | – |
| Ideen | Ideen-Eingang, Triage | Eingang & Plan, Tab Ideen | `/eingang/ideen` |
| Bugs | Bug-Zustände | Eingang & Plan, Tab Bugs | `/eingang/bugs` |
| Plan | Roadmap, Graph, Board, Entscheidungen | Eingang & Plan, Tab Plan | `/eingang/plan` |
| Beweise | Beweiskette, Gates, Fremd-Review, Queue | Beweise | `/beweise` |
| Diff | Dateibaum, Kommentare, Checkpoints, Rückspulen | Beweise, Tab Diff | `/beweise/diff` |
| Organigramm | Abteilungen, Budgetgrenzen | Team, Tab Organigramm | `/team` |
| Personas | Personas, Vorlagen | Team, Tab Personas | `/team/personas` |
| AgentGenerator | Agenten-Generator | Team, Tab Generator | `/team/generator` |
| Trigger | Trigger, Webhooks | Automatik, Tab Trigger | `/automatik` |
| Befehle | App-Wissen, Befehle (Palette selbst in der Schale) | Automatik, Tab Befehle | `/automatik/befehle` |
| Ablaeufe | Ablauf-Vorlagen und Läufe | Automatik, Tab Abläufe | `/automatik/ablaeufe` |
| Core | Anträge, Journal, Stufen, Tagesbericht, Satz-Eingabe | Core | `/core` |
| Kontingente | drei Fenster, Probe, Failover, Zeugnisse, Kostenbuch | Core · Steuerung, Tab Kontingente | `/steuerung` |
| Verbesserungen | Schalter, 8 Presets | Core · Steuerung, Tab Verbesserungen | `/steuerung/verbesserungen` |
| Projekteinstellungen (Autonomie, Abweichungszähler) | Autonomie je Aufgabenart | Core · Steuerung, Tab Core & Autonomie | `/steuerung/autonomie` |
| Projekteinstellungen (Rest) | Allow/Deny, nur-seriell, Merge-Modus, Ort-Vorgabe, Kundenprojekt-Markierung | Einstellungen, Tab Projekt | `/einstellungen/projekt` |
| Gedaechtnis | Notizen, Lessons, Kontextvorschau | Gedächtnis | `/gedaechtnis` |
| Einstellungen | Allgemein, Darstellung, Updates, Sicherung | Einstellungen, Tabs | `/einstellungen` |
| MCP | MCP-Server, Team-Rechte, Tresor | Einstellungen, Tab MCP & Tresor | `/einstellungen/mcp` |
| Benachrichtigungen | Ereignisarten, Ruhezeit, Handy-Kopplung | Einstellungen, Tab Benachrichtigungen | `/einstellungen/benachrichtigungen` |
| Ersteinrichtung | sechs Schritte | Ersteinrichtung | `/start` |
| Systemkarte | Karte aller Bausteine | kein Bildschirm: Doku (V2-DOC-MAP) | – |

**Prüfung:** `ls docs/design/2026-10-ui-v2/glass/*.dc.html` → 25 Dateien;
Tabelle oben → 26 Zeilen; Dateinamen ohne Suffix decken jede Zeile ab
(Projekteinstellungen doppelt). Systemkarte hat keine App-Route.

## 3. Tabs je Bildschirm

| Bildschirm | Tabs / Flächen | Pakete (Orientierung) |
|---|---|---|
| Leitstand | Haupt, Verlauf; Sheet Agent starten | S01a, S01b, S01c, S02 |
| Eingang & Plan | Plan, Ideen, Bugs | S04a, S04b |
| Beweise | Haupt, Diff | S03a, S03b |
| Team | Organigramm, Personas, Generator | S07a, S07b |
| Automatik | Trigger, Befehle, Abläufe | S06a, S06b |
| Core | eine Fläche | S08 |
| Core · Steuerung | Kontingente, Verbesserungen, Core & Autonomie | S05a–c |
| Gedächtnis | eine Fläche | S09 |
| Einstellungen | Allgemein/Darstellung/Updates/Sicherung, MCP & Tresor, Benachrichtigungen, Projekt | S10a–c |
| Ersteinrichtung | sechs Schritte | S11 |

## 4. Ablösung des alten UI

Ziel: altes UI so früh wie möglich durch die Glas-Schale ersetzen (V2-F8/F9).
Alte Ansichten können **unverändert** im neuen Shell-Rahmen wohnen, bis ihr
eigenes Screen-Paket sie ersetzt. Kein Feature-Schalter fürs Fundament; sichtbar
erst mit V2-F9.

| Alte Ansicht | Heute (Rev-9) | v2-Route / Fläche | Unverändert in neuer Schale bis … |
|---|---|---|---|
| Work | Goal `work` (Dialog + Board) | `/leitstand` | S01a / S01b |
| Attention | Goal `attention` (Fragen, Blocker) | `/leitstand` („Braucht dich“) | S01a |
| Agents | Goal `agents` (Terminals, Sessions) | `/leitstand` + Sheet `/` Start | S01a, S02 |
| Review | Goal `review` (Diff, Readiness, Merge) | `/beweise` und `/beweise/diff` | S03a / S03b |
| Insights | Goal `insights` (Kosten, Usage, Aktivität) | `/steuerung` (Zeugnisse) und `/leitstand/verlauf` | S05b, S01c |
| Settings | Goal `settings` | `/einstellungen` (+ Tabs) | S10a–c |
| Board-Rail | `BoardRail` neben jeder Ansicht | in Leitstand integriert (Karten/Filter) | S01a |
| Sidebar-Panels | Projektliste, Orchestrator-Panel | Kopfleiste (Projektwähler) + Leitstand-Verlauf | F8, S01c |

**Früh einziehen (F8/F9):** Work, Attention, Agents und Settings können als
Inhaltspanels hinter den neuen Routen `/leitstand` und `/einstellungen` liegen,
ohne Optik-Rewrite — nur Rahmen, Not-Aus und Navigation wechseln. Review und
Insights folgen, sobald Beweise bzw. Steuerung Daten liefern; bis dahin bleiben
sie als Panel unter der neuen Route erreichbar. Board-Rail und Sidebar-Panels
verschwinden als eigene Chrome-Teile, sobald die Schale steht; ihre Inhalte
wandern in Leitstand bzw. Kopfleiste.

## 5. Regeln für Folgepakete

- Neue UI-Pakete nennen Route und Tab aus dieser Datei; keine Parallel-Navigation.
- Boards bleiben Komponenten- und Inhaltsquelle; Abweichungen im Screen-PR.
- Systemkarte → nur `docs/plan/v2.0/systemkarte.md` (V2-DOC-MAP), keine Route.
- Routenregister und Seitenleiste baut V2-F8 nach Abschnitt 1.
