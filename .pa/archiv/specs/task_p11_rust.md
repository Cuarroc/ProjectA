# Phase 11 Sub-Task A (Rust): Board-State um Hierarchie erweitern

Status: historisch

Repo: `<repo-root>`, Rust-Kern in `src-tauri/`.
Phase 10 ist committed (`ab7706f`), der Tree ist sauber.

## Deine Dateien

Du aenderst **ausschliesslich**:

- `src-tauri/src/status.rs`
- `src-tauri/src/main.rs`

Ein zweiter Worker sitzt **parallel im Frontend** (`src/**`). Fass **kein**
`src/`-File an. **`api.rs`, `bin/pa.rs`, `web_interface.rs` und `store.rs`
bleiben ebenfalls unberuehrt** - das ist bewusst so geschnitten (siehe
"Blast-Radius" unten), nicht vergessen. Wenn du glaubst, eine dieser Dateien
muesse sich doch aendern: **melde es, aendere sie nicht.**

`store.rs` brauchst du aller Voraussicht nach nicht: `Worker` traegt seit
Phase 9 bereits `spawned_by`, `kind` und `task`.

## Ist-Zustand (nachlesen, nicht raten)

- `status.rs:99` `WorkerBoardState { worker, column, attention_reason, pr_url, context_usage }`.
- `status.rs:800` `StatusEngine::board(&self, workers: &[Worker]) -> Vec<WorkerBoardState>`.
- `main.rs:731` Tauri-Command `get_board_state` ruft
  `store.list_workers(project_id)` und gibt `engine.board(&workers)` zurueck.
  **Wichtig: `list_workers` liefert auch archivierte Worker** - genau deshalb
  laesst sich ein Label auch dann noch aufloesen, wenn der Koordinator schon
  archiviert oder beendet ist.
- Queens tragen den Task-Text `format!("Queen: {domain}")` (vgl. `workers::queen_task`).

## Auftrag

### 1. Neue Typen in `status.rs`

```rust
/// Who ordered this worker, resolved from `spawned_by` for the board badge.
pub struct ControlledBy { pub worker_id: String, pub kind: String, pub label: String }

/// One coordinator of a project, for the board's banner row.
pub struct CoordinatorInfo {
    pub worker_id: String, pub kind: String, pub label: String,
    pub status: String, pub session_id: Option<String>,
}

/// The board: the cards plus the coordinators steering them.
pub struct BoardState { pub cards: Vec<WorkerBoardState>, pub coordinators: Vec<CoordinatorInfo> }
```

Alle drei `Serialize` **camelCase** (`workerId`, `sessionId`, ...), wie der
Bestand. Doc-Kommentare im Stil der Datei: sie erklaeren das **WARUM**.

### 2. `WorkerBoardState` bekommt `controlled_by: Option<ControlledBy>`

`None` heisst: vom Menschen gestartet (kein `spawned_by`, oder der genannte
Controller ist nicht auffindbar).

### 3. Reine Mapping-Funktionen (das Herz der Aufgabe)

Beides **pub**, **rein** (keine `&self`, kein Lock, keine Zeit) und damit
direkt testbar:

```rust
pub fn controlled_by(worker: &Worker, all: &[Worker]) -> Option<ControlledBy>;
pub fn coordinators(all: &[Worker]) -> Vec<CoordinatorInfo>;
```

- **Label-Regeln** (eine gemeinsame Helferfunktion, nicht zweimal geschrieben):
  - `KIND_ORCHESTRATOR` -> `"Orchestrator"`
  - `KIND_QUEEN` -> die Domaene, also der Task-Text **ohne** das Praefix
    `"Queen: "`; fehlt das Praefix, nimm den Task-Text wie er ist.
  - sonst (inkl. Scout) -> kurzer Task-Text (auf eine sinnvolle Laenge
    gekuerzt, Kuerzungsregel im Kommentar begruenden).
- `coordinators` liefert alle **nicht-archivierten** orchestrator/queen/scout-
  Worker. Reihenfolge stabil (die Eingabereihenfolge ist schon nach
  `created_at, id` sortiert - verlass dich darauf und schreib das hin).
- `controlled_by` loest **auch gegen archivierte/beendete** Controller auf:
  das Badge darf nicht verschwinden, nur weil die Queen fertig ist.

### 4. `board()` fuellt `controlled_by`

`StatusEngine::board` loest das Feld aus **derselben** `workers`-Slice auf, die
es bekommt. Fuer `get_board_state` ist das die vollstaendige Projektliste, also
korrekt. **Die Signatur bleibt `board(&self, workers: &[Worker]) -> Vec<WorkerBoardState>`.**

Wichtiger Nebeneffekt, den du **im Doc-Kommentar festhalten musst**:
`main.rs:1022` (`ApiBackend::worker_state`) ruft `board(&[worker])` mit einem
einzelnen Worker; dort bleibt `controlled_by` zwangslaeufig `None`, weil der
Controller nicht in der Slice steckt. Das ist akzeptiert - `pa worker status`
zeigt keine Badges - aber es soll nicht stillschweigend passieren.

### 5. `main.rs`: nur der Tauri-Command

`get_board_state` gibt neu `BoardState` statt `Vec<WorkerBoardState>` zurueck:
Karten aus `engine.board(&workers)`, Koordinatoren aus
`status::coordinators(&workers)`. Doc-Kommentar ueber dem Command (der die
Rueckgabe heute beschreibt) mitziehen.

**Blast-Radius bewusst klein:** `ControlBackend::board` und die Route
`GET /api/board` bleiben **unveraendert** bei `Vec<WorkerBoardState>`. Damit
bleiben `api.rs`, `bin/pa.rs` und `web_interface.rs` aussen vor. Aendere die
Trait-Signatur **nicht**.

### 6. Tests (inline `#[cfg(test)] mod tests`, Stil des Bestands)

Mindestens:
1. Employee mit `spawned_by` auf eine laufende Queen -> `controlled_by` traegt
   deren Id, `kind == "queen"` und die **Domaene** als Label (nicht "Queen: X").
2. Employee ohne `spawned_by` -> `None`.
3. `spawned_by` zeigt auf eine **archivierte/beendete** Queen -> `Some`, Label
   weiterhin aufgeloest. (Ausdruecklich gefordert.)
4. `spawned_by` zeigt auf eine **unbekannte** Id -> `None`.
5. Orchestrator-Label ist `"Orchestrator"`; ein Queen-Task ohne `"Queen: "`-
   Praefix faellt auf den rohen Task-Text zurueck.
6. `coordinators` nimmt orchestrator/queen/scout auf, laesst gewoehnliche
   Worker weg, ueberspringt archivierte, und traegt `session_id` durch.

## Konventionen

- Kommentare/Docs **Englisch**, sie erklaeren das **WARUM**, nicht das WAS.
- Fehler als `Result<_, String>`. **Keine neuen Dependencies.**
- Minimaler Diff, kein Refactoring "bei der Gelegenheit".

## Verboten

- **Keine Git-Mutationen** (`git add/commit/checkout/stash/restore`). Der Mensch commitet.
- **Kein `npm run tauri dev`**.
- Keine `src/`-Dateien, kein `api.rs`, `bin/pa.rs`, `web_interface.rs`, `store.rs`.

## Gate

In `src-tauri/`:

```
cargo test
cargo clippy --all-targets -- -D warnings
```

Beide **gruen**. Pipe das Ergebnis **nicht** durch `tail`, ohne den Exit-Code
separat zu pruefen - sonst maskiert die Pipe einen Fehlschlag.

Bei `.rmeta`/`0xc000012d`/`STATUS_STACK_BUFFER_OVERRUN`: mit
`CARGO_BUILD_JOBS=2` erneut. **Setz dabei niemals `CARGO_PROFILE_*`-Variablen**
- die aendern den Profil-Fingerprint und erzwingen einen kompletten
Dependency-Rebuild (~400 Crates), was auf dieser Maschine Stunden kostet.

## Fertig

Berichte: geaenderte Dateien, die exakten Signaturen der beiden Mapping-
Funktionen, die Namen deiner Tests und beide Gate-Ergebnisse mit Exit-Code.
