# V2-RETIRE-0 — Ausbau des alten UI: Inventar und Reihenfolge

Stand 11.10.2026, gegen `origin/main` @ 5ee1126 (`gh pr list` und `git log origin/main` am selben Tag).
Auftrag (Nutzer, 11.10.): Das alte UI soll in ProjectA gar nicht mehr existieren, nicht nur versteckt sein.
Dieses Dokument ist nur Plan und Vorschlag: kein Code, keine Löschung. Planzeilen in `plan.md` trägt Chief ein
(Abschnitt 5). Einordnung: `ia.md` §4 sagt, *wohin* die alten Ansichten wandern; hier steht, *in welcher
Reihenfolge* sie verschwinden.

## 1. Ausgangslage (Belege)

- `App()` (`src/App.tsx:1538`) wählt je nach Schalter D1 (`d1_neue_oberflaeche`, Standard aus,
  `src/flags/featureFlags.ts:82`): aus → `<AppContent />` allein (altes UI), an → `ShellMount` und darin
  `AppContent` mit `routePath` + `onGoalRoute` (`App.tsx:1546`).
- `ShellMount` rendert `AppContent` genau einmal und blendet ihn nur aus (`hidden`), hängt ihn nie ab
  (`src/shell/mount/ShellMount.tsx:17-20, 61`). `routePath` wählt das Ziel über die Basis der Route
  (`src/shell/mount/routing.ts:5-12, 26-31`): Work, Attention, Agents teilen `/leitstand`.
- Eingehängt ist heute nur der neue Leitstand (`LeitstandRoute`, `ShellMount.tsx:7, 60`; #1067). Alle anderen
  Glass-Bildschirme sind gemergt, aber **nicht eingehängt** (`rg "screens/" src` außerhalb `src/screens` trifft nur
  `ShellMount.tsx:7`). Offen: #1123 (Einstellungen einhängen, Entwurf).
- Der Projektwähler der Schale ist ein gesperrter Platzhalter (`src/shell/Shell.tsx:70`). Der aktive Projekt-Schlüssel
  liegt in `localStorage` (`App.tsx:94, 128-157`); `LeitstandRoute` liest ihn nur (`LeitstandRoute.tsx:15-27`).
- Karte „Öffnen“ im neuen Leitstand springt nur auf `#/leitstand/klassisch`, ohne den Worker zu wählen
  (`LeitstandRoute.tsx:75`, `AgentCard.tsx:39`).
- Die gesamte Sitzungs- und Worker-Logik (`sessions`, Tabs, Split, Projekte, Worker) ist Zustand in
  `AppContent` (`App.tsx:210ff`). Ein Glass-Ersatz dafür existiert nicht und ist **in keinem Paket** von `plan.md`.

## 2. Inventar je alter Teil

Spalten: (1) Was der Nutzer heute tut · (2) Glass-Heimat · (3) Ersatz-Stand (gemergt = PR-Nummer; „Plan“ = Paket in
`plan.md`, noch nicht gebaut; MISSING = kein Paket) · (4) Ausbau-Voraussetzung. „RT-n“ = V2-RETIRE-n (Abschnitt 4).

### 2a. Rahmen (Chrome) von `AppContent`

| Teil (`file:line`) | (1) Nutzer | (2) Heimat | (3) Stand | (4) Voraussetzung |
|---|---|---|---|---|
| `Sidebar` `Sidebar.tsx:50`, gerendert `App.tsx:1127` | Projekt wählen, anlegen, entfernen, GitHub/Skill-Packs verknüpfen, Orchestrator an/aus | Kopfleiste (Projektwähler, `ia.md` §4) + `/einstellungen/projekt` | Wähler: V2-F8-PROJ in Arbeit (kein PR am 11.10., Platzhalter `Shell.tsx:70`). Entfernen, GitHub, Skill-Packs: Plan V2-S10c, MISSING bis dahin. Orchestrator: Plan V2-S01c | RT-1a (Inhalt zieht um), danach je Teil in RT-5 |
| `QueuePanel` `QueuePanel.tsx:23`, `App.tsx:1141` | Auftrag einreihen, Warteschlange ansehen, Eintrag fokussieren | `/leitstand`, Betrieb (S01b) | Anzeige gemergt #1100 (`BetriebPanel.tsx`, nur lesend, nicht eingehängt). Einreihen, Schärfen, Abbrechen: MISSING | S01b-Rest (Einreihen) eingehängt → RT-5b |
| `RecommendationsPanel` `RecommendationsPanel.tsx:57`, `App.tsx:1148` | Scout starten, Empfehlungen annehmen oder verwerfen | Vorschlag `/eingang/ideen` (S04b); `ia.md` nennt sie nicht, `dev-hq.md:36` meint Leitstand | Kern gemergt #1044 (V2-B13 Triage); Bildschirm Plan V2-S04b; Scout-Start MISSING | Chief entscheidet Heimat; S04b eingehängt → RT-5c |
| `LearningsPanel` `LearningsPanel.tsx:43`, `App.tsx:1150` | Lektionen und Rollenvarianten freigeben oder verwerfen | `/gedaechtnis` (S09); Rollenvarianten `/team/personas` | Kern gemergt #1090 (V2-B12); Personas nur lesend #1095 (nicht eingehängt); Freigabe MISSING; S09, V2-H5 Plan | S09 + Freigabe-Paket eingehängt → RT-5d |
| `WebInterfacePanel` `WebInterfacePanel.tsx:20`, `App.tsx:1152` | Browser-Oberfläche starten oder stoppen | Fernansicht (V2-H3/H4/H6, „nach dem Kern“, hinter Schalter); Schalter vermutlich `/einstellungen` | Plan, nichts gebaut | **Entscheidung des Nutzers:** bis H3/H4 behalten (Werkzeuge) oder „entfällt“ → RT-5e |
| `WorkerPanel` `WorkerPanel.tsx:25`, `App.tsx:1155` (nur Agents/Review) | Worker der Liste öffnen, neu starten, archivieren | `/leitstand` Karten | Liste gemergt #1050, eingehängt #1067; Neu starten und Archivieren MISSING (Karte hat nur „Öffnen“) | Karten-Aktionen (RT-1c, RT-6c) → RT-5f |
| `BoardRail` `BoardRail.tsx:47`, `App.tsx:1171` | Karten je Spalte sehen, Worker öffnen, Rail einklappen | `/leitstand` (Karten, Filter) | gemergt #1050, eingehängt #1067 (Ersatz der Anzeige); „Öffnen wählt Worker“ MISSING | RT-1c, dann RT-1d (aus), RT-4a (löschen) |
| `LiveStatus` `LiveStatus.tsx:26`, `App.tsx:1189` | nichts sichtbar; Screenreader hört Ansicht, Fragen, wartende Worker | Schale (eine Live-Region) | MISSING: `rg "aria-live" src/shell src/screens` trifft nur `StopBand.tsx:38` (`role="status"`) | **Ausnahme:** bleibt in RT-1d an (unsichtbar, kein Rahmen); weg erst mit RT-6a (Live-Region in der Schale) |
| `ViewBar` `ViewBar.tsx:31`, `App.tsx:1194` | zwischen Work, Attention, Agents, Review, Insights, Settings wechseln; Neuer Worker; Rail umschalten | Glass-Seitenleiste (Routen); Work/Attention/Agents teilen `/leitstand` | Routen gemergt (#1011, #1039); Wechsel innerhalb `/leitstand` und „Neuer Worker“ MISSING | RT-1b (Klassisch-Leiste), RT-1d, RT-4c (löschen) |
| `ThemeBackdrop` `ThemeBackdrop.tsx:8`, `App.tsx:1115, 1126` | nichts (Stil „klassisch“ rendert nichts; Setter ungenutzt `App.tsx:169`) | Glass-Theme (`data-theme`, #1062 Stilschalter) | gemergt #1062 | RT-1d (aus), RT-4b (löschen) |
| `BootstrapScreen` `BootstrapScreen.tsx:11`, `App.tsx:1116` | Wartebild beim ersten Projekt-Lesen, Wiederholen bei Fehler | Ersteinrichtung `/start` (S11) | gemergt #1070 (Bildschirm), #1076 (API), #1078 (Nacharbeit); nicht eingehängt; Lade-/Fehlerbild MISSING | S11 eingehängt → RT-6e |

### 2b. Ziel-Ansichten (`goal`) und ihre Bausteine

| Teil (`file:line`) | (1) Nutzer | (2) Heimat | (3) Stand | (4) Voraussetzung |
|---|---|---|---|---|
| Work, Dialog: `ConversationView.tsx:34`, `App.tsx:1215` (Orchestrator-Chat) | mit dem Orchestrator schreiben, Rückfragen beantworten | `/leitstand/verlauf` (S01c) | Plan V2-S01c; nichts gebaut | S01c eingehängt → RT-6b |
| `CommandChat` `CommandChat.tsx:38`, `App.tsx:1482` | kurze Nachricht an den Orchestrator aus jeder Ansicht | Kopfleiste oder `/leitstand/verlauf`; Plan nennt `CommandChat.tsx:38` als Quelle (`plan.md:208`) | Plan V2-S01c; MISSING als Leiste außerhalb Verlauf | RT-6b |
| Work, Board: `BoardView.tsx:95`, `App.tsx:1234` | Worker verschieben, Tests laufen lassen, mergen, neu starten, Diff öffnen | `/leitstand` (Karten); Mergen über `/beweise` (Einreihen) | Karten #1050; Tests/Mergen/Verschieben MISSING (S03a Plan: „In die Warteschlange“) | S01a-Rest + S03a → RT-6c |
| Attention: `AttentionInbox.tsx:68`, `QuestionsView.tsx:388`, `App.tsx:1259, 1267` | Fragen beantworten, Blocker und Empfehlungen sehen | `/leitstand` („Braucht dich“) | Fragen gemergt #1049, eingehängt #1067; Blocker/Quota/Merge-Blocker MISSING | Blocker-Paket → RT-6d |
| Agents: `TabBar.tsx:17`, Terminal-Flächen `TerminalView.tsx:139`, Split, `SessionRestorePanel.tsx:28`, `HistoryView.tsx:42` (`App.tsx:1318-1448`) | Terminals ansehen, tippen, Tabs, zwei Spalten, Sitzung wiederherstellen, Verlauf | `/leitstand` (Karte → Terminal) + Sheet S02 | **MISSING**, kein Paket. `TerminalView` kann neu einhängen (Wiedergabe `getScrollback`, `TerminalView.tsx:136`) | Vorschlag V2-S01d „Terminal-Fläche“ (Abschnitt 5) → RT-7 |
| Review: `DiffView.tsx:58`, `App.tsx:1399` | Diff, Kommentare, Setup-Vertrauen, Test, Merge | `/beweise`, `/beweise/diff` (S03a, S03b) | Plan, nichts gebaut | S03a + S03b eingehängt → RT-6f |
| Insights: `InsightsView.tsx:21` (+ `UsageView`, `StatisticsView`, `ActivityView`), `App.tsx:1279` | Kosten, Nutzung, Aktivität | `/steuerung` (S05b), `/leitstand/verlauf` (S01c) | S05a gemergt #1074, #1091 (Kontingente, nicht eingehängt, #1128 offen); S05b Plan | S05b + S01c → RT-6g |
| Settings: `SettingsView.tsx:131` (+ `settings/*`, `ChangelogView`), `App.tsx:1290` | Allgemein, Prompt, Updates, Kategorien, Profile, Wartung | `/einstellungen` und Tabs (S10a–c) | Rahmen + Allgemein gemergt #1068, #1089; Einhängen #1123 offen; MCP/Benachrichtigungen/Projekt Plan S10b/S10c; Profile, Kategorien, Master-Prompt, Wartung: MISSING (nicht im Board) | #1123 + Rest → RT-6h |
| `DiagnosticsPanel` `DiagnosticsPanel.tsx:19`, `App.tsx:1311` | Diagnose exportieren, Logpfad, Absturzhinweis | `/einstellungen` (Allgemein/Sicherung) | MISSING | RT-6h |

### 2c. Dialoge, Leisten, Hilfsteile

| Teil (`file:line`) | (1) Nutzer | (2) Heimat | (3) Stand | (4) Voraussetzung |
|---|---|---|---|---|
| `StatusBar` `StatusBar.tsx:16`, `App.tsx:1491` | Sitzung, Fehlerzeile, Zähler „wartet“, Anbieter-Dialog öffnen | Schale (Kopf, Quota-Glocke #1054) | teilweise (Quota/Not-Aus ja, Fehlerzeile und Sitzungsanzeige MISSING) | mit RT-7 |
| `ProfilePicker` `:29`, `NewWorkerDialog` `:42` (`App.tsx:1504, 1513`) | Ad-hoc-Sitzung oder Worker starten | Start-Sheet (S02) | Plan V2-S02; Vorarbeit B3 #1024, B5 #1112 | S02 → RT-6i |
| `ProviderDialog` `:46`, `GitHubLinkDialog`, `SkillPackDialog` | Anbieter-Schlüssel, GitHub, Skill-Packs | `/einstellungen` (S10a/S10b/S10c) | MISSING (Anbieter), S10c Plan | RT-6h |
| `FirstRunChecklist` `:18` | leere Fläche: nächste Schritte | `/start` (S11) | gemergt #1070 | RT-6e |
| `EmergencyStop` | Not-Aus | Schale (`StopBand`, `Shell.tsx:74, 76`) | gemergt #1054; bleibt in `GeneralTab` | bleibt; nicht Teil des Ausbaus |
| `ErrorBoundary` (`App.tsx:1541` und je Ansicht) | ruhige Fehlerfläche | Teil der Schale | Netz bleibt | bleibt bis RT-9 |

Nicht Teil von `AppContent`, aber zu prüfen: `HistoryView`/`ActivityView` (Heimat `/leitstand/verlauf`, S01c),
`ChangelogView` (Einstellungen, Updates, #1068).

## 3. Erste Stufe: Rahmen aus, wenn `routePath` gesetzt ist

**Was vorher da sein muss.** Ohne Rahmen sind sonst Projekte, Queue, Empfehlungen, Learnings, Web-Interface
und Orchestrator nicht mehr erreichbar. Deshalb:

1. **V2-F8-PROJ** (parallel dispatcht): Wähler listet Projekte, wählt, legt an; schreibt `projecta.activeProjectId`
   **und `AppContent` folgt ohne Neuladen** (Storage-/Eigen-Ereignis, Test). Fehlt das, kommt ein Paket RT-1p davor.
2. **RT-1a Werkzeuge-Fläche:** `Sidebar` samt Queue, Empfehlungen, Learnings, Web-Interface, Orchestrator-Zeilen und
   WorkerPanel ziehen **unverändert** nach `/leitstand/werkzeuge` (Reiter neben Haupt und Klassisch). Der Teil bleibt
   gemountet und wird nur ausgeblendet (`hidden`), damit Entwürfe, Polling und Scout-Rückweg leben.
3. **RT-1b Klassisch-Leiste:** schmale Leiste statt `ViewBar` (Arbeit, Fragen, Agents, Neuer Worker, Zähler), nur auf
   `/leitstand/klassisch*`. Review, Insights, Settings erreicht man über die Glass-Seitenleiste.
4. **RT-1c Karte öffnet Worker:** `onOpen` der Karte wählt den Worker-Tab im alten Teil (Ereignis oder Hash-Parameter)
   statt nur die Route zu wechseln.

**Wohin meanwhile:** Queue, Empfehlungen, Learnings, Web-Interface und die Orchestrator-Zeilen liegen in „Werkzeuge“;
der Orchestrator-Dialog bleibt in „Klassisch → Arbeit“, die `CommandChat`-Leiste unten wie heute.

**RT-1d** schaltet dann nur bei gesetztem `routePath` ab: Sidebar-Spalte, `BoardRail`, `ViewBar`, `ThemeBackdrop`;
`LiveStatus` bleibt (Ausnahme oben). Der Pfad ohne Schale (`routePath` fehlt) bleibt bis RT-3 unverändert.

## 4. Ausbau-Reihenfolge (je ≤ 300 Diff-Zeilen, einschließlich Tests)

Gemeinsam für jedes Paket: `App.tsx` ist eine serielle Spur (nie zwei RETIRE-Pakete gleichzeitig; kein Naht-Paket nach
AGENTS.md, aber die Hauptdatei aller Konflikte). Abnahme immer: `npm run build` Exit 0; betroffene Vitest-Dateien
grün (`npx vitest run <Dateien>`); `src/i18n/hardcoded.test.ts` (scannt nur `src/design`, `shell`, `flags`, `screens`,
`i18n`; neue Texte in `src/shell/mount/` gehören ins Wörterbuch); `src/unstyled-buttons.test.ts` (beim Löschen von
`TabBar.tsx` und `DiagnosticsPanel.tsx` den Eintrag in `ALLOWED_UNSTYLED` mitlöschen); Löschpakete löschen die
Komponenten-Tests mit und tragen Verschiebungen im PR-Text ein. Wo ein Glass-Ersatz denselben Test braucht
(z. B. `QueuePanel.switch.test.tsx` → Betrieb), wandert der Test zuerst (rot am Alten, grün am Neuen).

| Paket | Inhalt | Exklusive Dateien | Vorgänger | Abnahme (zusätzlich) |
|---|---|---|---|---|
| RT-1a | Werkzeuge-Fläche (Abschnitt 3) | `App.tsx`, `shell/mount/routing.ts`, `screens/leitstand/LeitstandRoute.tsx` (Reiter), `i18n/de.ts`, `mount.test.tsx`, `routing.test.ts` | #1123 gemergt (`routing.ts`) | Reiter erscheint; Sidebar bleibt gemountet; Test: Entwurf im Orchestrator-Feld überlebt Reiterwechsel |
| RT-1b | Klassisch-Leiste (3 Ziele, Neuer Worker, Zähler) | neu `shell/mount/ClassicBar.tsx` + Test, `App.tsx`, `de.ts` | RT-1a | Wechsel Work/Attention/Agents ohne `ViewBar`; Neuer Worker öffnet Dialog |
| RT-1c | Karte → Worker-Tab | `screens/leitstand/LeitstandRoute.tsx`, `AgentCard.tsx`, `App.tsx` (`handleOpenCard`-Anschluss), Tests | RT-1b | Test: Klick auf Karte wählt genau diesen Worker; Sitzungsliste unverändert |
| RT-1d | Rahmen aus bei `routePath` | `App.tsx`, `shell/mount/mount.css` | RT-1a–c, V2-F8-PROJ (mit Folge-Test) | Test: bei `routePath` kein `.sidebar`, `.board-rail`, `.view-bar`; ohne `routePath` unverändert; Screenshot Leitstand |
| RT-2 | D1 Standard an (Schalter-Standard, Migration gespeicherter Wahl) | `flags/featureFlags.ts`, Test | RT-1d; **D1 entschieden 11.10.: ja, mit v2.0** | Ja liegt vor (11.10.); jederzeit zurückschaltbar ([Entscheid](../../decisions.md#2026-10-11---v20-schnitt-hülle--leitstand-d1-standard-an-verlauf-in-v21)) |
| RT-3 | Pfad ohne Schale entfernen: `App()` nur noch `ShellMount`, `routePath` Pflicht, `PreviewToggle` und Schalter-Zweig weg | `App.tsx`, `flags/*`, `shell/mount/PreviewToggle.tsx`, `EinstellungenScreen.tsx` (Abschnitt), Tests | RT-2 | `App.test.tsx`, `App.audit.test.tsx` auf Schale umgestellt; Schalter-Test angepasst |
| RT-4a | `BoardRail` + `railOpen`-Zustand löschen | `BoardRail.tsx`, `App.tsx`, `styles.css` (Rail-Regeln) | RT-3 | `sidebar-layout.test.ts` angepasst |
| RT-4b | `ThemeBackdrop` + `themeStyle` löschen | `ThemeBackdrop.tsx` (+ Test), `App.tsx`, `lib/settings.ts` (Stil-Leser) | RT-3 | `styles-theme-api.test.ts` grün |
| RT-4c | `ViewBar` löschen (Klassisch-Leiste bleibt) | `ViewBar.tsx` (+ Test), `App.tsx` | RT-3 | `goals.test.ts` grün |
| RT-5a | Sidebar: Projektteil | `Sidebar.tsx` (Teil), Tests | RT-3, V2-F8-PROJ, S10c (Entfernen/GitHub/Skill-Packs) | Projekt anlegen, wählen, entfernen im Glass-Pfad per Test |
| RT-5b | `QueuePanel` | `QueuePanel.tsx` + 2 Tests | RT-3, S01b-Rest (Einreihen) eingehängt | Tests nach Betrieb verschoben |
| RT-5c | `RecommendationsPanel` | Datei + 2 Tests | RT-3, S04b eingehängt, Heimat entschieden | Scout-Start im Glass-Pfad |
| RT-5d | `LearningsPanel` | Datei + 2 Tests | RT-3, S09 + Freigabe eingehängt | Lektion freigeben im Glass-Pfad |
| RT-5e | `WebInterfacePanel` | Datei + Test | RT-3, H3/H4 **oder** Nutzerentscheid „entfällt“ | Entscheidung im PR-Text |
| RT-5f | `WorkerPanel`, Orchestrator-Zeilen, `Sidebar.tsx` selbst | Dateien + Tests, `styles.css` | RT-5a–e, S01c (Orchestrator), Karten-Aktionen | `sidebar-layout.test.ts` entfällt |
| RT-6a | Schalen-Live-Region, `LiveStatus` löschen | `shell/Shell.tsx`, `LiveStatus.tsx` (+ Test) | RT-3 | Satz wie `statusSentence`, Test gegen Kopie |
| RT-6b | Orchestrator-Dialog, `CommandChat`, `ConversationView` | 3 Dateien + Tests | S01c eingehängt, RT-3 | Chat-Zustand (`useOrchestratorChat`) wandert mit |
| RT-6c | `BoardView` | Datei + Test | S01a-Rest, S03a | Aktionen Tests/Mergen/Verschieben im Glass-Pfad |
| RT-6d | `AttentionInbox`, `QuestionsView` | Dateien + 3 Tests | Blocker-Paket (S01a), RT-3 | Antwort erreicht Terminal (Test aus #1049 bleibt) |
| RT-6e | `BootstrapScreen`, `FirstRunChecklist` | Dateien + Test | S11 eingehängt | Frischprofil-Test |
| RT-6f | `DiffView`, `HistoryView` | Dateien + 4 Tests | S03a, S03b, S01c | Kommentare, Setup-Vertrauen im Glass-Pfad |
| RT-6g | `InsightsView`, `UsageView`, `StatisticsView`, `ActivityView` | Dateien + 5 Tests | S05b, S01c | Summenprobe wie `plan.md:215` |
| RT-6h | `SettingsView`, `settings/*`, `DiagnosticsPanel`, `ProviderDialog`, `ChangelogView` | Dateien + Tests (aufteilen, < 300 Zeilen je Paket) | S10a–c eingehängt, Lücken (Profile, Kategorien, Master-Prompt, Wartung) | Liste aller Schalter vorher/nachher (wie S10a) |
| RT-6i | `ProfilePicker`, `NewWorkerDialog` | Dateien + 2 Tests | S02 | Start-Lauf mit beobachtetem Modell |
| RT-7 | Terminal-Fläche: `TabBar`, `TerminalView`, `SessionRestorePanel`, Split, Sitzungszustand aus `AppContent` | `TabBar.tsx`, `TerminalView.tsx`, `SessionRestorePanel.tsx`, `App.tsx` | **V2-S01d (Vorschlag)**, RT-6b–i | Sitzungen überleben (Abschnitt 6); `TerminalView.test.tsx`, `xtermFitCompat.test.ts` wandern |
| RT-8 | Reste: `AppContent` leer, `lib/goals.ts`, `useAttentionBlockers`/`useQuestions`-Aufrufer, tote `styles.css`-Regeln | `App.tsx`, `lib/*`, `styles.css` (in Scheiben) | RT-5f, RT-6a–i, RT-7 | `rg` nach den gelöschten Namen leer; `hardcoded-baseline.json` schrumpft |
| RT-9 | `ErrorBoundary`-Netz in die Schale, `App.tsx` nur noch Eingang | `App.tsx`, `shell/*` | RT-8 | `ErrorBoundary.test.tsx` grün |

Das Ja zu RT-2 gilt für D1 mit Rückschaltmöglichkeit. Der spätere Vorschlag RT-3, den Schalter und den Rückweg
zu entfernen, ist davon nicht gedeckt; seine Freigabe muss diese Grenze vorher auflösen.

Große Dateien (`BoardView` 968, `DiffView` 955, `SettingsView` 1050, `styles.css` 7077 Zeilen): reine Löschungen zählen als
Diff, deshalb jeweils eigenes Paket oder Scheibe; zählt ein Paket über 300, teilt Chief vor dem Dispatch.

## 5. Vorgeschlagene Planzeilen (für Chief; `plan.md` nicht geändert)

V2-RETIRE-1a, 1b, 1c, 1d, 2, 3, 4a, 4b, 4c, 5a, 5b, 5c, 5d, 5e, 5f, 6a, 6b, 6c, 6d, 6e, 6f, 6g, 6h, 6i, 7, 8, 9
(Frontend, Stufe B, kein Naht-Paket). **Fehlende Glass-Pakete, ohne die RT-5/6/7 nicht enden:**

- V2-S01d Terminal-Fläche im Leitstand (Tabs, Split, Wiederherstellen, Karte → Terminal; zieht den Sitzungszustand aus `AppContent`).
- V2-S01b-2 Auftrag einreihen, schärfen, abbrechen (Ersatz für `QueuePanel`-Eingabe).
- V2-S01a-4 Karten-Aktionen (neu starten, archivieren, verschieben) und Blocker/Quota in „Braucht dich“.
- V2-S09-2 / V2-S07b-2 Freigabe von Lektionen und Rollenvarianten.
- V2-S10d Rest der Einstellungen (Profile, Kategorien, Master-Prompt, Wartung, Diagnose, Anbieter).
- D1 Standard an (RT-2): entschieden 11.10.: ja, mit v2.0; Ja liegt vor (11.10.), jederzeit zurückschaltbar.
  Offen bleiben Web-Interface (behalten bis Fernansicht oder „entfällt“) und Heimat der Empfehlungen.

## 6. Sitzungen (PTY) bleiben am Leben

Regel für jedes Paket: Der Zustand `sessions` und die Hooks, die Sitzungen öffnen und schließen, bleiben in genau
einer `AppContent`-Instanz, die **nie bedingt gerendert** wird (nur `hidden`, wie `ShellMount.tsx:17-20, 61`). PTY-Prozesse
laufen im Kern weiter; `TerminalView` kann neu einhängen und spielt `getScrollback` wieder ein (`TerminalView.tsx:136`).
Je Paket:

- **RT-1a/1b/1c/1d:** keine Zeile an `sessions`, `TabBar`, `TerminalView`; die Sidebar und die Klassisch-Leiste sind
  Geschwister des Terminal-Bereichs. Test: Sitzung offen, Reiter wechseln, zurück → gleiche `sessionId`, kein `killPty`.
- **RT-2/3:** `AppContent` wird nur einmal und ohne Route-Bedingung unter `ShellMount` gerendert; Test „keeps the old app mounted behind a route
  without an old view“ (`mount.test.tsx:56`) bleibt grün und bekommt eine Sitzungsprüfung.
- **RT-4/5/6:** löschen nur Teile, die keine Sitzungen halten; `rg "setSessions|sessions" src/App.tsx` vorher/nachher im PR-Text.
- **RT-7:** Sitzungszustand zieht in einen Hook/Speicher **oberhalb** der Routen (nicht in eine Route); erst wenn der
  neue Besitzer dauerhaft gemountet ist und die Wiedergabe getestet, entfällt der Zustand in `AppContent`. Nie zwei Besitzer gleichzeitig
  und nie ein Schritt, der Sitzungen schließt, um sie neu zu öffnen.

Ehrliche Grenze: `TerminalView` wird heute schon beim Wechsel von Agents zu Work neu eingehängt (`App.tsx:1316-1431`,
der Terminal-Zweig ist ein `else`); das ist erprobt (Wiedergabe), die PTY-Prozesse sind davon nicht betroffen.

## 7. NICHT ABGEDECKT

Reiner Doku-Plan: Zeilenbezüge und PR-Nummern stammen aus `origin/main` @ 5ee1126 und können durch parallele PRs
(#1123, V2-F8-PROJ, #1128) veralten. Größen der Pakete sind Schätzungen. Wie V2-F8-PROJ den aktiven Projekt-Schlüssel
an `AppContent` weitergibt, ist nicht beobachtet (Paket läuft parallel).
