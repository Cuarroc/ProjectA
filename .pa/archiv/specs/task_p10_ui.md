# Phase 10 Sub-Task B (Frontend): Chat-Leiste `CommandChat`

Status: historisch

Repo: `<repo-root>`. React + TypeScript + Vite, Tauri-App.
Phase 9 ist committed (`ffe6af4`), der Tree ist sauber.

## Deine Dateien

Du aenderst **ausschliesslich** diese vier:

- `src/components/CommandChat.tsx` (**neu**)
- `src/App.tsx`
- `src/lib/ipc.ts`
- `src/styles.css`

Ein zweiter Worker sitzt **parallel im Rust-Kern** (`src-tauri/**`). Fass **kein**
`src-tauri/`-File an und **nicht** `src/types.ts` (du brauchst es nicht, siehe
unten). Wenn du glaubst, eine andere Datei muesse sich aendern: melde es,
aendere sie nicht.

## Der IPC-Vertrag (steht fest, der Rust-Worker baut exakt dagegen)

- Tauri-Command: **`send_to_orchestrator`**
- Args: `{ projectId, text }`
- Return: ein `Worker` (camelCase) - **der Orchestrator**, den der Kern
  wiederverwendet oder neu gestartet hat.

Der Command existiert waehrend deiner Arbeit moeglicherweise **noch nicht**.
Das ist erwartet: `npm run typecheck` und `npm run build` pruefen nur
TypeScript, nicht ob der Rust-Command registriert ist. Baue dagegen, ohne zu
warten.

## Auftrag

### 6. `ipc.ts`

```ts
export async function sendToOrchestrator(projectId: string, text: string): Promise<Worker>
```

Genau im Stil von `createOrchestrator` (ipc.ts:166) - `invoke<RawWorker>` und
durch das vorhandene `toWorker` schicken, damit `kind` normalisiert wird.

### 7. `CommandChat.tsx` (neu)

Eine fixierte Eingabeleiste **unten im Main-Bereich, direkt ueber der
`StatusBar`**, immer sichtbar wenn ein Projekt aktiv ist.

- **Eingabe + Senden-Button.** `Enter` sendet, `Shift+Enter` macht eine neue
  Zeile (also ein `textarea`, kein `input`). Leerer/nur-Whitespace-Text sendet
  nicht. Waehrend des Sendens Eingabe und Button deaktivieren, damit kein
  Doppelversand entsteht; danach das Feld leeren und den Fokus behalten.
- **Aufklappbarer Verlauf darueber.** Quelle: `listWorkerMessages(orchestratorId)`
  - Muster **exakt** wie `HistoryView.tsx` (Polling-Intervall als Konstante,
  IPC-Fehler beim Pollen schlucken, aelteste Nachricht zuerst, Auto-Scroll nur
  wenn der User schon unten ist). Ein eigener leiser Empty-State statt eines
  roten Blocks, wenn noch nichts da ist.
  Die Orchestrator-Id kommt aus dem `Worker`, den `sendToOrchestrator`
  zurueckgibt - **merke sie dir im State**. Vor dem ersten Senden gibt es noch
  keine; dann bleibt der Verlauf leer bzw. der Aufklapper zeigt den Empty-State.
  Erfinde **keine** Suche ueber `kind === "orchestrator"` in einer Worker-Liste,
  die dir nicht gehoert.
- **Nach erfolgreichem Senden** den Verlauf neu laden.
- **Kein aktives Projekt**: Leiste deaktiviert mit kurzem deutschem Hinweistext.
- **Fehler** aus dem Command als kurze Fehlerzeile im Panel (nicht als Toast,
  nicht via `alert`), die beim naechsten erfolgreichen Senden verschwindet.

### 8. `App.tsx`

- `handleSendToOrchestrator` (aktuell ca. `App.tsx:636-651`) ruft **nicht mehr**
  `writePty` mit selbst gesuchtem Orchestrator, sondern den neuen Command.
  Der bisherige Fehler `"Kein laufender Orchestrator — erst den Orchestrator starten."`
  **entfaellt ersatzlos** - find-or-create erledigt das jetzt im Kern.
- Nach erfolgreichem Senden `refreshBoardRef.current()` aufrufen (ein neu
  gestarteter Orchestrator muss sofort auf dem Board erscheinen).
- **Die Signatur von `onSendToOrchestrator` bleibt gleich**
  (`(projectId: string, text: string) => Promise<void>`), damit der
  Sidebar-Toggle (`Sidebar.tsx`, wird von dir **nicht** angefasst) weiter passt.
- `CommandChat` im Main-Bereich **direkt vor `<StatusBar ...>`** (ca. `App.tsx:943`)
  einhaengen und mit dem aktiven Projekt versorgen (`activeProjectId`).

### 9. `styles.css`

Im vorhandenen dunklen VS-Code-Stil, Klassen **alle mit Praefix `command-chat`**.
Nutze die vorhandenen CSS-Variablen/Farben statt neuer Hex-Werte, damit die
Leiste nicht wie ein Fremdkoerper wirkt. Die Leiste darf den Terminal-Bereich
nicht ueberlappen, und der aufgeklappte Verlauf braucht eine begrenzte Hoehe
mit eigenem Scroll.

## Konventionen

- Kommentare **Englisch** und sie erklaeren das **WARUM**; **UI-Strings Deutsch**,
  wie im Bestand.
- **Keine neuen Dependencies.** Keine neue Test-Infrastruktur - das Frontend hat
  bewusst keine, fuege keine hinzu.
- Halte dich an den Stil der umstehenden Komponenten (Props-Interface oben,
  `export default function`, `useCallback`/`useEffect` wie in `HistoryView.tsx`).

## Verboten

- **Keine Git-Mutationen** (`git add/commit/checkout/stash/restore`). Der Mensch commitet.
- **Kein `npm run tauri dev`** - das startet die App und blockiert. `typecheck`
  und `build` reichen als Nachweis.
- Keine `src-tauri/`-Dateien, kein `src/types.ts`, kein `Sidebar.tsx`.

## Gate

Im Repo-Wurzelverzeichnis:

```
npm run typecheck
npm run build
```

Beide muessen **gruen** sein. Pipe das Ergebnis nicht durch `tail`, ohne den
Exit-Code separat zu pruefen - sonst maskiert die Pipe einen Fehlschlag.

## Fertig

Berichte: geaenderte/neue Dateien, wie der Verlauf an die Orchestrator-Id kommt,
und beide Gate-Ergebnisse mit Exit-Code.
