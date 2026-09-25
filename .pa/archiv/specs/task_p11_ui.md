# Phase 11 Sub-Task B (Frontend): Koordinatoren-Banner + Karten-Badges

Status: historisch

Repo: `<repo-root>`. React + TypeScript + Vite (Tauri-App).
Phase 10 ist committed (`ab7706f`), der Tree ist sauber.

## Deine Dateien

Du aenderst **ausschliesslich**:

- `src/types.ts`
- `src/lib/ipc.ts`
- `src/lib/board.ts`
- `src/lib/useBoard.ts`
- `src/components/BoardView.tsx`
- `src/App.tsx`
- `src/styles.css`

Ein zweiter Worker sitzt **parallel im Rust-Kern** (`src-tauri/**`). Fass **kein**
`src-tauri/`-File an. Wenn du glaubst, eine andere Datei muesse sich aendern:
**melde es, aendere sie nicht.**

## Der IPC-Vertrag (steht fest, der Rust-Worker baut exakt dagegen)

Der Tauri-Command **`get_board_state`** gibt neu **nicht mehr ein Array**, sondern
ein Objekt zurueck:

```jsonc
{
  "cards": [
    { "worker": {...}, "column": "working", "attentionReason": null,
      "prUrl": null, "contextUsage": null,
      "controlledBy": { "workerId": "wk-1", "kind": "queen", "label": "Backend-API" } // oder null
    }
  ],
  "coordinators": [
    { "workerId": "wk-2", "kind": "orchestrator", "label": "Orchestrator",
      "status": "running", "sessionId": "sess-1" }   // sessionId darf null sein
  ]
}
```

`controlledBy === null` heisst: **vom Menschen gestartet**. `label` ist bei
Queens die Domaene (schon ohne `"Queen: "`-Praefix), beim Orchestrator
`"Orchestrator"`, sonst ein gekuerzter Task-Text - **du kuerzt nichts nach.**

Der Command existiert waehrend deiner Arbeit moeglicherweise noch in der alten
Form. Das ist erwartet: `npm run typecheck`/`npm run build` pruefen nur
TypeScript. Baue gegen den Vertrag oben, ohne zu warten.

## Auftrag

### 3. `types.ts`

- `WorkerKind` (heute `"worker" | "orchestrator"`) um `"queen"` und `"scout"`
  erweitern.
- `Worker` um `spawnedBy: string | null`.
- `BoardCard` um `controlledBy: ControlledBy | null` mit
  `ControlledBy = { workerId: string; kind: WorkerKind; label: string }`.
- Neu `CoordinatorInfo = { workerId: string; kind: WorkerKind; label: string;
  status: WorkerStatus; sessionId: string | null }`.

### `ipc.ts`

- `toWorkerKind` (ipc.ts:118) bildet heute **alles ausser `"orchestrator"` auf
  `"worker"`** ab - deshalb sehen Queens und Scouts im Frontend wie gewoehnliche
  Worker aus. Das ist der eigentliche Bug dieser Phase: erweitere die Abbildung
  auf `"queen"` und `"scout"`. Der Fallback fuer **unbekannte** Werte bleibt
  `"worker"` - der bestehende Kommentar ueber der Funktion sagt warum, und der
  Grund gilt weiter.
- `RawWorker`/`toWorker` um `spawnedBy` (fehlt es im Payload, `null`).
- `getBoardState` gibt neu das Objekt zurueck (Karten + Koordinatoren) statt
  `BoardCard[]`. `RawBoardCard`/`toBoardCard` um `controlledBy` erweitern,
  Koordinatoren analog defensiv mappen (`kind` durch `toWorkerKind`).

### `useBoard.ts`

`BoardState` um `coordinators: CoordinatorInfo[]` erweitern und aus der neuen
Antwort fuellen. Achtung: der `worker:status`-Event-Pfad aktualisiert heute nur
`cards` - lass die Koordinatoren dabei unangetastet stehen (der naechste Poll
zieht sie nach) und begruende das im Kommentar.

### `board.ts`

Hier gehoert alles hin, was **reine Darstellungslogik** ist, damit `BoardView`
schlank bleibt: das Icon je `WorkerKind` (**◆** Orchestrator, **♛** Queen,
**🔍** Scout) und der Badge-Text (`◆ Orchestrator` / `♛ <Label>` / `● du` bei
`controlledBy === null`). Als kleine reine Funktionen, im Stil der vorhandenen
`COLUMN_LABELS`/`isBoardColumn`.

### 4. `BoardView.tsx`

- **Koordinatoren-Banner ueber den Spalten**: eine Chip-Zeile, pro Koordinator
  ein Chip mit Icon, Label und Live-Statuspunkt (**dieselben `status-dot`-
  Klassen wie die Karten**, nicht neu erfinden).
  - Chip mit `sessionId` -> klickbar, ruft `onOpenCoordinator(coordinator)`.
  - Chip **ohne** `sessionId` -> deaktiviert, `title="Keine live Session"`.
  - Keine Koordinatoren -> Banner faellt ganz weg (kein leerer Streifen).
- **Karten-Badge** in der bestehenden `board-card-chips`-Zeile, Text wie oben
  aus `board.ts`. `title` traegt die Kette, soweit bekannt (z. B.
  `"gesteuert von ♛ Backend-API"`), bei `null` der Hinweis, dass du selbst
  gestartet hast.
- **Filter erweitern**: heute filtert die Spaltenlogik `worker.kind !== "orchestrator"`.
  Neu fallen **auch `queen` und `scout`** aus den Spalten - sie leben im Banner.
  Such die Stelle und zieh sie sauber nach (eine Helferfunktion "ist Koordinator"
  ist besser als drei verkettete `!==`).

### 5. `App.tsx`

- `onOpenCoordinator`: oeffnet bzw. fokussiert den Terminal-Tab wie
  `openWorkerTab` (App.tsx:385). Der Handler bekommt eine `CoordinatorInfo`, der
  vorhandene `openWorkerTab` erwartet einen `Worker` - such den Worker in der
  vorhandenen `workers`-Liste. **Pruefe zuerst, ob `listWorkers` Koordinatoren
  ueberhaupt liefert**; falls nicht, melde es und loese es dokumentiert (nicht
  raten).
- `sessionTitle` (App.tsx:378) kennt heute nur `ORCHESTRATOR_PREFIX = "◆ Orchestrator"`
  (App.tsx:63). Ergaenze ein Queen-Praefix nach demselben Muster, sodass ein
  Queen-Tab **`♛ Queen · <Domaene>`** heisst. Die Domaene steht im Task-Text
  hinter `"Queen: "`.
- Banner an `BoardView` durchreichen (`coordinators` aus `useBoard`).

### 6. `styles.css`

Banner- und Badge-Styles, Klassenpraefix **`coord-`** bzw.
**`board-card-controller`**, dunkler VS-Code-Stil wie der Bestand, **nur
vorhandene CSS-Variablen** statt neuer Hex-Werte. Das Banner darf die Spalten
nicht ueberlappen und muss bei vielen Chips umbrechen statt zu ueberlaufen.

## Konventionen

- Kommentare **Englisch** (WARUM, nicht WAS); **UI-Strings Deutsch**.
- **Keine neuen Dependencies**, keine Test-Infrastruktur (das Frontend hat
  bewusst keine).
- Stil der umstehenden Komponenten (Props-Interface oben, `export default function`).

## Verboten

- **Keine Git-Mutationen**. **Kein `npm run tauri dev`.** Keine `src-tauri/`-Dateien.

## Gate

Im Repo-Wurzelverzeichnis:

```
npm run typecheck
npm run build
```

Beide **gruen**; Exit-Code separat pruefen, nicht durch `tail` maskieren.

## Fertig

Berichte: geaenderte Dateien, wie `onOpenCoordinator` an den `Worker` kommt,
und beide Gate-Ergebnisse mit Exit-Code.
