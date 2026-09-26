# Phase 12 Sub-Task B (Frontend): Test-Badge, Tests-Button, Test-Kommando in Settings

Status: historisch

Repo: `<repo-root>`. React + TypeScript + Vite (Tauri-App).
Phase 11 ist committed (`9b4a2c2`), der Tree ist sauber.

## Deine Dateien

Du aenderst **ausschliesslich**:

- `src/types.ts`
- `src/lib/ipc.ts`
- `src/components/BoardView.tsx`
- `src/components/SettingsView.tsx`
- `src/App.tsx`
- `src/styles.css`

Parallel arbeiten zwei Worker im Rust-Kern (`src-tauri/**`). Fass **kein**
`src-tauri/`-File an. Wenn du glaubst, eine andere Datei muesse sich aendern:
**melde es, aendere sie nicht.**

## Der Vertrag (steht fest, der Rust-Worker baut exakt dagegen)

Neue Tauri-Commands:

- **`set_project_test_command`**, Args `{ projectId, command }` mit
  `command: string | null` (null loescht das Gate), Rueckgabe: nichts.
- **`run_worker_tests`**, Args `{ workerId }`, Rueckgabe: der aktualisierte
  **`Worker`** (camelCase).

Erweiterte Nutzlasten:

- Board-Karte bekommt `testStatus: "pass" | "fail" | "running" | null` und
  `testedAt: number | null` (Unix-Sekunden). `null` bei `testStatus` heisst
  **nie gelaufen**.
- Projekt bekommt `testCommand: string | null`. Es kommt aus derselben
  Projekt-Nutzlast wie `githubRemote` - der Rust-Typ flacht `Project` ein, du
  musst also nichts Neues laden.

Die Commands existieren waehrend deiner Arbeit moeglicherweise noch nicht. Das
ist erwartet: `npm run typecheck` und `npm run build` pruefen nur TypeScript.
Baue gegen den Vertrag oben, ohne zu warten.

## Auftrag

### 9. `types.ts`

- `BoardCard` um `testStatus` und `testedAt` (Typen wie oben). Fuer den
  Status-Wert einen eigenen exportierten Union-Typ anlegen, nicht dreimal
  inline wiederholen.
- `Project` um `testCommand: string | null`.

### 12. `ipc.ts`

- `runWorkerTests(workerId): Promise<Worker>` - durch das vorhandene `toWorker`
  schicken, wie es `respawnWorker` vormacht.
- `setProjectTestCommand(projectId, command: string | null): Promise<void>`.
- `RawBoardCard` und `toBoardCard` um die beiden neuen Felder; fehlt etwas im
  Payload, faellt es defensiv auf `null` zurueck - so wie der Bestand es mit
  `contextUsage` haelt. Projekt-Mapping um `testCommand` analog.

### 10. `BoardView.tsx`

- **Test-Badge** in der vorhandenen `board-card-chips`-Zeile:
  bestanden / fehlgeschlagen / laeuft / nie gelaufen, mit den Zeichen
  Haken, Kreuz, Kreis-Pfeil und Gedankenstrich. `title` nennt Zeitpunkt und
  Kommando, soweit bekannt.
- **"Tests"-Button** in den Karten-Aktionen, ruft `runWorkerTests(worker.id)`.
  Waehrend des Laufs deaktiviert (kein Doppelstart), danach Board neu laden.
  Der Button erscheint **nur, wenn das Projekt ein `testCommand` hat**.
- Dafuer muss `BoardView` das aktive Projekt kennen. Heute bekommt es nur
  `hasProject: boolean` (BoardView.tsx ca. Zeile 29) und die Wiring-Stelle ist
  `App.tsx:852`. Ergaenze eine **schmale** Prop (z. B. `testCommand: string | null`)
  statt das ganze Projekt durchzureichen, wenn das reicht - entscheide und
  begruende es kurz im Kommentar.
- Fehler aus dem Command als kurze Zeile in der Karte bzw. im vorhandenen
  Fehlerkanal, **nicht** als `alert`.

### 11. `SettingsView.tsx`

Neuer Abschnitt im passenden Tab (die Tabs sind
`"allgemein" | "masterprompt" | "agenten"`, SettingsView.tsx Zeile 18 -
**allgemein** ist der richtige Ort). Zeigt das Test-Kommando des aktiven
Projekts und laesst es aendern (`setProjectTestCommand`). **Leeres Feld = kein
Gate** (sendet `null`). Hinweistext auf **Deutsch**: was das Kommando tut, und
dass es beim Anlegen eines Projekts automatisch erkannt wird.

`SettingsView` bekommt heute nur `profiles` (App.tsx:879) - reich das aktive
Projekt bzw. dessen Test-Kommando plus einen Aenderungs-Callback nach.

### 6. `styles.css`

Badge- und Abschnitts-Styles im dunklen VS-Code-Stil des Bestands, **nur
vorhandene CSS-Variablen** statt neuer Hex-Werte. Praefixe im Stil der
Nachbarschaft (`board-card-` bzw. `settings-`).

## Konventionen

- Kommentare **Englisch** (WARUM, nicht WAS); **UI-Strings Deutsch**.
- **Keine neuen Dependencies**, keine Test-Infrastruktur (das Frontend hat
  bewusst keine).
- Stil der umstehenden Komponenten.

## Verboten

- **Keine Git-Mutationen.** **Kein `npm run tauri dev`** - das startet die App
  und blockiert. Keine `src-tauri/`-Dateien.

## Gate

Im Repo-Wurzelverzeichnis:

```
npm run typecheck
npm run build
```

Beide gruen; Exit-Code separat pruefen, nicht durch `tail` maskieren.

## Fertig

Berichte: geaenderte Dateien, welche Prop du fuer das Test-Kommando gewaehlt
hast und warum, und beide Gate-Ergebnisse mit Exit-Code.
