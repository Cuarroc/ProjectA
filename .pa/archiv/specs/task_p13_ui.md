# Phase 13 Sub-Task B (Frontend): Merge-Button mit Bestaetigungsdialog

Status: historisch

Repo: `<repo-root>`. React + TypeScript + Vite (Tauri-App).
Phase 12 ist committed (`e608258`), der Tree ist sauber.

## Deine Dateien

Du aenderst **ausschliesslich**:

- `src/components/BoardView.tsx`
- `src/lib/ipc.ts`
- `src/types.ts`
- `src/App.tsx`
- `src/styles.css`

Ein Rust-Worker arbeitet parallel in `src-tauri/**`. Fass **kein**
`src-tauri/`-File an. Wenn du glaubst, eine andere Datei muesse sich aendern:
**melde es, aendere sie nicht.**

## Der Vertrag (steht fest, der Rust-Worker baut exakt dagegen)

- Tauri-Command **`merge_worker`**, Args `{ workerId, removeWorktree }`,
  Rueckgabe: der aktualisierte **`Worker`** (camelCase).
- Fehler kommen als **String** und werden im Dialog **wortwoertlich** angezeigt -
  nicht zusammenfassen, nicht uebersetzen, nicht abschneiden. Der Text enthaelt
  die git-/gh-Ausgabe, etwa bei einem Merge-Konflikt, und genau die braucht der
  Mensch.

Der Command existiert waehrend deiner Arbeit moeglicherweise noch nicht. Das ist
erwartet: `npm run typecheck` und `npm run build` pruefen nur TypeScript.

## Auftrag

### 7. `ipc.ts`

```ts
export async function mergeWorker(workerId: string, removeWorktree: boolean): Promise<Worker>
```

Durch das vorhandene `toWorker` schicken, wie es `respawnWorker` und
`runWorkerTests` vormachen.

### 6. `BoardView.tsx`

**Merge-Button** als **primaere Aktion** in der Karten-Zeile, nur auf Karten in
der Spalte `ready_to_merge`.

- **Deaktiviert**, wenn das Projekt ein `testCommand` hat und
  `card.testStatus !== "pass"`. Tooltip nennt den Grund auf Deutsch,
  z. B. "Tests erst gruen machen". `BoardView` bekommt `testCommand` bereits
  als Prop (seit Phase 12) - nutz die, lad nichts nach.
- **Klick oeffnet einen Bestaetigungsdialog** im Stil von `NewWorkerDialog.tsx`
  (schau ihn dir an und halte dich an dessen Aufbau und Klassen):
  - **PR-Titel**, vorbelegt mit dem Task-Text des Workers.
  - **Checkbox "Worktree nach Merge entfernen"**, Default **aus**.
  - Ein Hinweis, **welcher Weg greift**: PR ueber GitHub, wenn das Projekt ein
    GitHub-Remote hat, sonst lokaler Merge. Das weiss das Frontend aus
    `project.githubRemote` - dafuer brauchst du eine neue schmale Prop
    (z. B. `githubRemote: boolean`), analog zu `testCommand`. Reich **nicht**
    das ganze `Project` durch; begruende die Wahl kurz im Kommentar.
  - **Fehler als rote Zeile im Dialog**, verbatim. Der Dialog bleibt dabei offen,
    damit der Text lesbar bleibt.
  - Waehrend des Merges Buttons deaktivieren (kein Doppelklick).
- **Erfolg** -> Dialog schliessen und Board neu laden; die Karte wandert nach
  `done`, weil der Kern den Worker archiviert.

**Anmerkung zum PR-Titel:** der fixierte Command nimmt nur
`{ workerId, removeWorktree }`. Wenn du den Titel nicht sinnvoll loswirst,
**bau ihn nicht heimlich woanders hin** - zeig ihn als Vorschau/Default an und
**melde in deinem Abschlussbericht**, dass der Titel im aktuellen Vertrag nicht
uebertragen wird. Lieber ein ehrlicher Hinweis als ein stiller Sonderweg.

### `App.tsx`

Merge-Handler bauen (ruft `mergeWorker`), an `BoardView` durchreichen, ebenso
`githubRemote` des aktiven Projekts. Nach Erfolg das Board refreshen, so wie es
die anderen Karten-Aktionen tun.

### `types.ts`

Nur anfassen, wenn du wirklich etwas brauchst - `Worker`, `BoardCard` und
`Project` sollten bereits alles haben (`testStatus`, `githubRemote`).

### `styles.css`

Dialog- und Button-Styles im dunklen VS-Code-Stil des Bestands, **nur vorhandene
CSS-Variablen** statt neuer Hex-Werte. Der Merge-Button ist die primaere Aktion
und darf sich optisch von den anderen Karten-Buttons abheben, ohne aus dem
Board-Stil auszubrechen.

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

Berichte: geaenderte Dateien, wie du `githubRemote` durchreichst, was mit dem
PR-Titel passiert, und beide Gate-Ergebnisse mit Exit-Code.
