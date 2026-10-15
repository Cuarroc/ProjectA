# V2-S01d-0 — Glass-Terminal-Fläche: Entwurf und Schnitt

Stand 11.10.2026, gegen `origin/main` @ 4ef2a21 (`git fetch` am selben Tag). Nur Plan: kein Code, keine Änderung an
`docs/PLAN.md`, `plan.md` oder `retire.md` (#1132, offen). Auftrag (Nutzer, 11.10.): Die alte Mitte soll verschwinden.
`retire.md` §2b führt den Terminal-Bereich (Ziel Agents) als **MISSING** und RT-7 als davon blockiert; dieses Dokument
füllt die Lücke V2-S01d. Oberste Regel: **Kein Schritt schließt eine laufende PTY-Sitzung, um sie neu zu öffnen.**

## 1. Ist-Zustand (Belege)

### 1a. Zustand und Handler in `AppContent` (`src/App.tsx`)

| Teil | Beleg | Verhalten |
|---|---|---|
| Sitzungsliste | `App.tsx:210`; Typ `TerminalSession` `src/types.ts:231-245` | ein Eintrag je Tab: `sessionId`, `workerId` (`null` = ad hoc), `projectId`, `kind`, `title`, `exited`, `exitCode` |
| Fokus | `activeSessionId` `App.tsx:211` | immer die fokussierte Sitzung |
| Split | `splitOpen`, `splitSessionId`, `splitPrimary` `App.tsx:212-218` | zwei Spalten; `splitPrimary` sagt, auf welcher Seite der Fokus sitzt, damit Fokuswechsel die Spalten nicht tauscht |
| Wiederherstellen | `restoreWorkerId` `App.tsx:206-207` | beendeter Worker, dessen gespeicherter Puffer gezeigt wird (kein PTY) |
| Exit-Abos | `exitUnlisteners` `App.tsx:326`, `subscribeExit` `:360-384`, `unsubscribeExit` `:386-392`, Abbau beim Unmount `:442-449` | Abo lebt so lange wie die Sitzung, auch ohne Tab |
| Exit-Folge | `markExited` `App.tsx:342-357` | setzt Tab `exited`, Worker auf `exited` und `sessionId: null`, frischt das Board auf — **schreibt in fremden Zustand** (`workers`, Board) |
| Tab lösen | `dropTab` `App.tsx:395-421` | Nachbar bekommt den Fokus; verliert eine Spalte ihre Sitzung oder bleiben < 2, schließt der Split |
| Tab schließen | `handleCloseTab` `App.tsx:428-440` | Worker-Tab: nur lösen, Agent läuft weiter. Ad-hoc-Tab: Abo weg und `killPty` |
| Worker-Tab öffnen | `openWorkerTab` `App.tsx:611-636` | hängt Tab an (falls neu), fokussiert, löscht `restoreWorkerId`, abonniert Exit |
| Aufrufer von `openWorkerTab` | Orchestrator `:645-707`, neuer Worker `:715-737`, Neustart `:740-765` (alter Tab weg), Archiv `:768-789` (Tab weg), Karte `handleOpenCard` `:803-817`, Diff `:820-834`, Fragen-Sprung `:839-852`, `focusWorker` mit Warten auf Nachladen `:857-884`, Scout `:897-909` | jeder Einstieg setzt zusätzlich `goal`/`detailView` |
| Ad-hoc-Sitzung | `openPicker`/`handlePick` `App.tsx:1006-1046` | `spawnPty` mit `INITIAL_COLS/ROWS`, Tab ohne Worker |
| Tab wählen | `handleSelectSession` `App.tsx:1053-1064` | im Split: Wahl der anderen Spalte tauscht nur den Fokus |
| Split umschalten | Inline in `App.tsx:1325-1345` | öffnet auf dem Nachbar-Tab (rechts, sonst links) |
| Ansichtsumschalter | `DETAIL_VIEWS` `App.tsx:122-126`, Leiste `:1350-1388` | Terminal · Diff · Verlauf, nur für echte Worker (`activeWorker` `:1077-1082`) |
| Darstellung | `App.tsx:1390-1476` | Verlauf → `HistoryView`; Diff → `DiffView`; Split → zwei Spalten; sonst eine `TerminalView`; Worker ohne Sitzung → `SessionRestorePanel`; sonst Leerzustand mit `FirstRunChecklist`, „Neuer Worker“, „Ad-hoc-Sitzung“ |

Wann `TerminalView` abhängt: Der Terminal-Zweig ist der `else`-Fall der Ziel-Kette `App.tsx:1212-1316` (Agents und
Review); jeder Wechsel zu Work, Attention, Insights, Settings hängt ihn ab. Zusätzlich ersetzt `!bootstrapReady` den
ganzen Baum (`App.tsx:1112-1122`). `sessions` überlebt beides, weil es in `AppContent` liegt.

Schale heute: `App()` (`App.tsx:1538-1550`) rendert bei D1 `ShellMount`, das `AppContent` genau einmal rendert und nur
mit `hidden` verbirgt (`src/shell/mount/ShellMount.tsx:55-66`). Der neue Leitstand besitzt nur exakt `/leitstand`
(`src/shell/mount/routing.ts:19`); alles darunter ist alte Ansicht (`routing.ts:22-24`). Die Karte „Öffnen“ springt
nur auf `#/leitstand/klassisch` (`src/screens/leitstand/LeitstandRoute.tsx:75`, Knopf `AgentCard.tsx:39`).
Folge: Bei D1 bleibt die alte `TerminalView` auch hinter dem neuen Leitstand gemountet, nur versteckt.

### 1b. Komponenten

- `TabBar` (`src/components/TabBar.tsx:17`): `role="tablist"` mit Pfeiltasten über `handleTablistKey`
  (`TabBar.tsx:36-46`, `src/lib/tabs.ts:37-49`); `Delete` auf einem Tab schließt (`TabBar.tsx:60-73`); Schließen-Knopf
  „Tab lösen“ bzw. „Sitzung schließen“ (`:82`); Split-Knopf mit `aria-pressed` (`:91-107`); „Neue Sitzung“ (`:109-115`).
- `TerminalView` (`src/components/TerminalView.tsx:139`): nur gemountet, solange der Tab aktiv ist (`:134-137`).
  Beim Mount: erst `onPtyOutput` abonnieren, dann `getScrollback` schreiben, gepufferte Teile danach (`:372-406`);
  Eingabe → `writePty` (`:362-364`); Größe → `resizePty` über `ResizeObserver` (`:316-331`, `:366-370`). Abbau
  verzögert gegen einen xterm-Timer (`:408-447`). Strg Umschalt F öffnet die Suche, Strg F bleibt bei der TUI
  (`:291-311`). Kern-Puffer: 1 MiB je Sitzung (`src-tauri/src/pty.rs:38`).
- `SessionRestorePanel` (`src/components/SessionRestorePanel.tsx:28`): liest `getSessionRestore` (`src/lib/ipc.ts:171`),
  zeigt Scrollback und Entwurf, Knopf „Neu starten“ → `onRespawn` (`:91-98`).
- `HistoryView` (`src/components/HistoryView.tsx:42`): `listWorkerMessages` (`ipc.ts:1487`) mit Polling.
- IPC der Fläche: `spawnPty`, `killPty`, `writePty`, `resizePty`, `getScrollback`, `onPtyOutput`, `onPtyExit`
  (`ipc.ts:75-81`), dazu `respawnWorker` `:257`, `archiveWorker` `:252`, `createOrchestrator` `:314`.
- Not-Aus: Kern sperrt neue Sitzungen (`pty.rs:820-823`) und beendet laufende (`src-tauri/src/estop.rs:62`); die UI
  erfährt das je Sitzung über `onPtyExit` → `markExited`. Schalter in der Schale `src/shell/Shell.tsx:74-76`.
- Tastatur global: Befehlspalette fängt Strg K auf `window` ab (`src/shell/header/CommandPalette.tsx:38-45`).

### 1c. Vorhandene Tests, die wandern müssen

`TabBar.test.tsx`, `SessionRestorePanel.test.tsx`, `TerminalView.test.tsx` (u. a. Suche `:315-347`, Abbau `:210-300`),
`App.audit.test.tsx:314` (Tab öffnet nach Nachladen), `:339` (Exit-Abo wird abgebaut), `mount.test.tsx:56` (alte App
bleibt gemountet). Einen eigenen Test für die Reihenfolge Abo → Scrollback → Puffer hat `rg` nicht gefunden; er kommt in
S01d-2 dazu.

## 2. Ziel-UX in der Glass-Schale

**Vorlage ehrlich:** Kein Board zeichnet ein Terminal. Die Fläche folgt den Bausteinen der Boards:
Agentenkarte mit Fuß-Link (`Main.dc.html:428-433`, Link `g.link` `:432`, Werte „Log“, „Verlauf“ `:510, 512`),
Hinweis „Die Antwort geht direkt ins Terminal“ (`Main.dc.html:453`), Leerzustand `.empty` (`:101`, Beispiel `:442`),
Not-Aus und Stopp-Band (`:390`, `:394-398`), Fokusring (`:57`), Sheet als Dialog (`AgentStarten.dc.html:432`, Schließen `:438`).

- **Ort:** eigene Unterroute **`/leitstand/terminal`** (kein dritter Leitstand-Tab; `ia.md` §3 nennt nur Haupt und
  Verlauf). Tiefer Link `/leitstand/terminal/<workerId>` öffnet bzw. fokussiert den Tab dieses Workers. Kein Sheet:
  Sheets sind modal (`aria-modal`, `AgentStarten.dc.html:432`), ein Terminal braucht dauerhaften Fokus und alle Tasten.
- **Karte öffnet:** „Öffnen“ auf der Karte ruft `openWorker(worker)` im Sitzungsspeicher und setzt die Route.
  Worker mit Sitzung → Tab fokussiert; Worker ohne Sitzung → Wiederherstellen-Ansicht. Antwort aus „Braucht dich“
  bleibt im Leitstand und erreicht das Terminal wie heute (Test aus #1049).
- **Kopf der Fläche:** Glass-`Tabs` (`src/design/layout/Tabs.tsx:15`) je Sitzung mit Zustandsmarke (läuft, beendet mit
  Code), Projekt-Chip bei fremdem Projekt; rechts „Teilen“ und „Neue Sitzung“; darunter für echte Worker der
  Umschalter Terminal · Verlauf. „Diff“ wird ein Link nach `/beweise/diff` (S03b), bis dahin nach `/leitstand/klassisch`.
- **Split:** genau zwei Spalten, Regeln unverändert aus `App.tsx:1053-1064` und `:1325-1345`; eine Sitzung nie in
  zwei Spalten.
- **Wiederherstellen:** Inhalt von `SessionRestorePanel` in Glass-Optik; Knopf „Neu starten“ bleibt die einzige
  Aktion, die einen neuen Prozess startet.
- **Leer- und Fehlerzustände:** keine Sitzung → `.empty` mit „Agent starten“ (öffnet das Start-Sheet, bis S02 den alten
  Dialog) und „Ad-hoc-Sitzung“; kein Projekt → Verweis auf den Projektwähler; IPC-Fehler einer `TerminalView`
  (`onError`) → `HonestState` (`src/design/data/HonestState.tsx:27`) über der Fläche statt in der alten `StatusBar`.
- **Not-Aus:** aktiv → „Neue Sitzung“, „Ad-hoc-Sitzung“ und „Neu starten“ gesperrt mit Grund („Not-Aus aktiv“);
  beendete Tabs bleiben lesbar (Scrollback) und tragen den Exit-Code; die Fläche selbst schließt nichts.
- **Fokus und Tastatur:** Tab-Wahl setzt den Fokus ins Terminal; Pfeiltasten und `Delete` in der Tab-Leiste wie heute;
  Strg Umschalt F Suche, Escape schließt sie; Strg F, Strg C usw. gehören der TUI. Globale Kürzel der Schale dürfen
  im fokussierten Terminal keine Taste verbrauchen, die die TUI braucht (Frage 2).

## 3. Besitz des Zustands

**Ein Besitzer:** `SessionProvider` + Hook `useSessions()` in neuem Ordner `src/sessions/`, gemountet in `App()`
**oberhalb** von `ShellMount` und `AppContent` (beide D1-Pfade), innerhalb des äußeren `ErrorBoundary`
(`App.tsx:1541`). Nie in einer Route, nie bedingt gerendert. Inhalt: `sessions`, `activeSessionId`, Split-Zustand,
`restoreWorkerId`, Exit-Abos; Aktionen `openWorker`, `openAdHoc`, `select`, `close`, `drop`, `toggleSplit`,
`showRestore`. Die Logik ist ein reiner Reducer (testbar ohne IPC); IPC nur im Provider.

**Fremder Zustand:** `markExited` schreibt heute in `workers` und das Board (`App.tsx:342-357`). Der Provider schreibt
das nicht selbst, sondern meldet `onSessionExit(sessionId, code)` an Abonnenten; `AppContent` abonniert und setzt seinen
Worker wie bisher. So hat jede Größe genau einen Schreiber.

**Übergabe ohne zweiten Besitzer:** In **einem** Commit (S01d-2) wird der Provider eingehängt **und** die Zustände
`App.tsx:206-218`, `:326`, die Handler `:342-440`, `:1053-1064` und der Split-Inline-Code entfallen in `AppContent`;
`AppContent` liest und schreibt nur noch über `useSessions()`. Es gibt keinen Zwischenstand mit Spiegelung oder
Synchronisation zweier Listen. `openWorkerTab` bleibt als dünner Adapter in `AppContent` (setzt `goal`/`detailView`
und ruft `openWorker`), damit die zehn Aufrufer aus 1a unverändert bleiben.

**Regel ein Betrachter:** Je Sitzung höchstens eine gemountete `TerminalView` (zwei Ansichten auf einem PTY kämpfen um
die Größe, Kommentar `App.tsx:406-407`). Ab S01d-3 rendert der alte Bereich `TerminalView` nur, wenn die alte Ansicht
sichtbar ist (`routePath` beginnt mit `/leitstand/klassisch` oder D1 aus).

**Wiedergabe-Test (Abnahme S01d-2, erweitert in S01d-3):** D1 an, `spawnPty`/`onPtyOutput`/`getScrollback` gemockt.
Sitzung öffnen → Route `/einstellungen` → `/leitstand` → zurück zur Fläche. Erwartet: gleiche `sessionId`, `killPty`
nie aufgerufen, `spawnPty` genau einmal, `getScrollback` bei jedem Wiedereinhängen, Puffer-Teile nach dem Scrollback,
jedes `onPtyOutput`-Abo wieder abgebaut, nie zwei `.xterm` für dieselbe Sitzung im DOM. Derselbe Test mit D1 aus
(Zielwechsel Agents → Settings → Agents).

## 4. Pakete (je ≤ 300 Diff-Zeilen einschließlich Tests)

Gemeinsam: `App.tsx` ist eine serielle Spur mit den RETIRE-Paketen (`retire.md` §4), nie zwei gleichzeitig. Abnahme
immer zusätzlich: `npm run build` Exit 0; `npx vitest run <betroffene Dateien>`; `src/i18n/hardcoded.test.ts` (neue
Texte ins Wörterbuch); `bash scripts/ci/gates.sh lane prepush` Exit 0. PTY-berührender Code = Stufe A.

| Paket | Inhalt | Exklusive Dateien | Vorgänger | Abnahme (zusätzlich) | Stufe |
|---|---|---|---|---|---|
| S01d-1 | Reiner Reducer der Sitzungen (öffnen, wählen, lösen, Split, Wiederherstellen, Exit), noch ohne Verbraucher | neu `src/sessions/sessionReducer.ts` + Test | – | Tests portieren die Regeln aus `App.tsx:395-421`, `:1053-1064`, `:1325-1345` (Nachbar-Fokus, Split schließt, Fokus tauscht nur) | B |
| S01d-2 | `SessionProvider` (IPC, Exit-Abos, `onSessionExit`) in `App()` einhängen; `AppContent` wird Verbraucher (ein Commit) | neu `src/sessions/SessionProvider.tsx` + Test, `App.tsx` | S01d-1; `App.tsx`-Spur frei | Wiedergabe-Test (§3) mit D1 an/aus; `App.audit.test.tsx:314, 339` grün; `rg "useState<TerminalSession" src/App.tsx` leer | A |
| S01d-3 | Route `/leitstand/terminal`: Glass-Tabs, eine `TerminalView`, Leerzustand; alter Bereich rendert nur sichtbar | neu `src/screens/terminal/TerminalRoute.tsx` + Test, `terminal.css`, `shell/mount/routing.ts` (+ Test), `ShellMount.tsx`, `App.tsx` (Betrachter-Regel), `i18n/de.ts` | S01d-2, #1123 gemergt (`routing.ts`) | Wiedergabe-Test über Route; ein `.xterm` je Sitzung; Screenshot geprüft | A |
| S01d-4 | Karte und tiefer Link öffnen die Fläche (`openWorker`); Worker ohne Sitzung → Wiederherstellen | `screens/leitstand/LeitstandRoute.tsx`, `AgentCard.tsx`, `TerminalRoute.tsx`, Tests | S01d-3 | Klick auf Karte fokussiert genau diesen Worker; Sitzungsliste sonst unverändert; ersetzt RT-1c (Hinweis an Chief) | B |
| S01d-5 | Split in der Fläche (zwei Spalten, Fokusregeln) | `TerminalRoute.tsx`, neu `TerminalPanes.tsx` + Test, `terminal.css` | S01d-3 | Split schließt beim Lösen einer Spalte; nie eine Sitzung doppelt; `resizePty` nur aus sichtbaren Spalten | A |
| S01d-6 | Wiederherstellen, Verlauf-Umschalter, Fehler- und Not-Aus-Zustände in Glass | neu `screens/terminal/RestoreView.tsx` + Test, `TerminalRoute.tsx`, `de.ts` | S01d-4 | Not-Aus aktiv sperrt Start und Neustart mit Grund; beendeter Tab zeigt Code; `onError` → `HonestState` | B |
| S01d-7 | Ad-hoc-Sitzung und Tastatur (Tab-Leiste, Fokus ins Terminal, Kürzel-Regel aus Frage 2) | `TerminalRoute.tsx`, `sessions/SessionProvider.tsx`, ggf. `shell/header/CommandPalette.tsx`, Tests | S01d-5, S01d-6, Antwort Frage 2 | Schließen eines Ad-hoc-Tabs ruft `killPty`, eines Worker-Tabs nicht; Pfeile/`Delete`/Strg Umschalt F per Test | A |
| RT-7 | Alte Terminal-Fläche weg: `TabBar` (+ Test, Eintrag in `ALLOWED_UNSTYLED`), `SessionRestorePanel` (Inhalt lebt in `RestoreView`), Terminal-Zweig `App.tsx:1315-1477`; Agents im alten UI verweist auf `/leitstand/terminal` | `TabBar.tsx`, `SessionRestorePanel.tsx`, `App.tsx`, `unstyled-buttons.test.ts` | S01d-1…7, RT-6b–i (`retire.md` §4) | Wiedergabe-Test grün; `rg "TabBar\|SessionRestorePanel" src` leer; `TerminalView.test.tsx`, `xtermFitCompat.test.ts` bleiben grün | A |

Abweichung zu `retire.md` §4: `TerminalView.tsx` wird in RT-7 **nicht** gelöscht, sie ist der Motor der neuen Fläche
(Umzug nach `src/screens/terminal/` höchstens als reiner Verschiebe-Commit). `HistoryView` geht mit RT-6f.

## 5. Risiken und Fragen an den Nutzer

Risiken: (1) S01d-2 ist der heikelste Schnitt (rund 150 Zeilen weg aus `App.tsx` plus Provider); zählt er über 300,
wandert der Exit-Abo-Teil in ein eigenes Paket davor, aber nie eine Spiegelung zweier Listen. (2) #1123 und RT-1a
berühren `routing.ts`; S01d-3 wartet darauf. (3) Bis S01d-3 rendert die versteckte alte Fläche weiter `TerminalView`
hinter dem neuen Leitstand (§1a); das ist heute schon so und harmlos, solange keine zweite Ansicht dazukommt.

**Frage 1 — Wo wohnt das Terminal?**
Frage: Eigene Unterroute `/leitstand/terminal` oder ein Sheet über dem Leitstand?
Empfehlung: Unterroute. Folgen: Zurück-Taste und tiefe Links funktionieren, volle Tastatur ohne Fokusfalle; der
Leitstand ist während des Tippens nicht sichtbar. Umkehrbar: ja, die Fläche ist eine Komponente, ein Sheet kann sie
später einbetten.

**Frage 2 — Wem gehört Strg K, wenn das Terminal den Fokus hat?**
Frage: Die Befehlspalette hört Strg K auf dem ganzen Fenster (`CommandPalette.tsx:38-45`); in Shells heißt Strg K
„Zeile bis zum Ende löschen“. Aus dem Code abgeleitet, nicht beobachtet: im Terminal passiert dann wohl beides.
Empfehlung: Im fokussierten Terminal geht Strg K an die TUI; die Palette erreicht man dort per Klick oder Strg Umschalt K.
Folgen: eine Ausnahme in der Palette (S01d-7). Umkehrbar: ja, eine Bedingung im Tastenhandler.

**Frage 3 — Tabs über Projekte hinweg?**
Frage: Heute bleiben Tabs aller Projekte offen, wenn man das Projekt wechselt (`TerminalSession.projectId`,
`types.ts:238`). Sollen sie in Glass nach dem aktiven Projekt gefiltert werden?
Empfehlung: Alle zeigen, fremde mit Projekt-Chip. Folgen: kein Agent verschwindet aus dem Blick; die Leiste kann voll
werden. Umkehrbar: ja, ein Filter im Reducer, keine Sitzung wird dafür geschlossen.

## 6. NICHT ABGEDECKT

Reiner Doku-Plan. Zeilenbezüge gelten für `origin/main` @ 4ef2a21 und veralten mit #1123, V2-F8-PROJ und RT-1a.
Paketgrößen sind Schätzungen. Das Verhalten von Strg K im Terminal ist abgeleitet, nicht beobachtet. Die
Windows-Hälfte (`#[cfg(windows)]`) betrifft dieses Dokument nicht; sie läuft in der Merge-Queue.
