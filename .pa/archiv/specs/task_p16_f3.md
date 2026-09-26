# Phase 16 / Fix 3 — max_workers bekommt einen Schreiber

Status: historisch

Repo: `<repo-root>`, Branch `main`, HEAD `526c60c`. Im Repo-Root,
kein Worktree. **Nicht committen, nicht pushen, nicht mergen.**

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/main.rs`
- `src/components/SettingsView.tsx`
- `src/lib/ipc.ts`
- `src/types.ts`

**Nicht anfassen:** `store.rs`, `workers.rs`, `queue.rs`, `diff.rs`, `gh.rs`,
`scout.rs`, `testgate.rs` (Fix 1) und `api.rs` (Fix 2) — beide arbeiten parallel.

## Das Problem

Der Dispatcher liest `projects.max_workers` (`queue.rs:109`) und faellt sonst auf
einen Standard zurueck. Die Spalte existiert, und `store.set_project_max_workers`
existiert ebenfalls (`store.rs:944`) — aber **nichts ausserhalb der Tests ruft sie
je auf**. Das Limit ist damit faktisch nicht einstellbar: eine Einstellung, die es
auf dem Papier gibt und in der Anwendung nicht.

## Was zu tun ist

Das Vorbild steht direkt daneben: `set_project_test_command` ist genau derselbe Fall
und schon vollstaendig verdrahtet — Tauri-Command in `main.rs:470`, ipc-Wrapper in
`ipc.ts:229`, Feld in den Projekt-Einstellungen. Bau `max_workers` analog.

### `main.rs`

    #[tauri::command]
    async fn set_project_max_workers(
        store: State<'_, Store>,
        project_id: String,
        max_workers: Option<i64>,
    ) -> Result<(), String>

ruft `store.set_project_max_workers(&project_id, max_workers)`. In
`generate_handler!` eintragen. Halte dich in Aufbau und Fehlerbehandlung exakt an
`set_project_test_command` daneben.

### `ipc.ts`

    export function setProjectMaxWorkers(projectId: string, maxWorkers: number | null): Promise<void>

`null` bedeutet ausdruecklich "kein projekteigenes Limit, nimm den Standard" — nicht
0. Das ist ein echter Unterschied: `Some(0)` heisst laut den Tests in `queue.rs:425`
"starte gar nichts". Kommentiere das an der Funktion, sonst setzt es jemand falsch.

### `types.ts`

Falls der `Project`-Typ `maxWorkers` noch nicht fuehrt, ergaenze
`maxWorkers: number | null`, passend zur serde-Form von `Option<i64>`.

### `SettingsView.tsx`

Ein Feld **neben dem Test-Kommando**, im selben Projekt-Abschnitt:

- Beschriftung deutsch, z. B. „Maximale Worker" mit einer kurzen Erlaeuterung, dass
  leer den Standard bedeutet.
- Zahleneingabe, leer erlaubt (→ `null`). Negative Werte ablehnen. `0` ist erlaubt
  und **muss** als „keine Worker starten" erkennbar sein, nicht als „unbegrenzt" —
  wenn du es nicht sauber beschriften kannst, nimm einen kurzen Hinweistext unter
  dem Feld.
- Speichern ueber `setProjectMaxWorkers`, danach den Projektzustand neu laden.
  Optimistisches Setzen ist erlaubt, muss aber bei einem Fehler zuruecksprigen und
  den Fehler sichtbar machen — wie die anderen Felder dort.

## Konventionen

Kommentare **Englisch**, alle **UI-Strings Deutsch**, keine neuen Dependencies, keine
Test-Infra im Frontend, Rust-Tests inline falls du welche brauchst. Stil strikt wie
die Nachbarschaft. Kein `npm run tauri dev`.

## Gates

    npm run typecheck
    npm run build

Die Frontend-Gates sind billig, lauf sie ruhig zwischendurch.

Fuer die Rust-Seite: **frag mich vor jedem cargo-Lauf per
`orca orchestration send --type escalation` um das GO** — es baut nur ein
Rust-Worker gleichzeitig, und Fix 1 und Fix 2 sind auch dran. Immer
`CARGO_BUILD_JOBS=2`, **niemals `CARGO_PROFILE_*`**. Kein blockierendes `ask` und
kein Pollen von `orca orchestration check` — die Delivery haengt, ich erreiche dich
ueber dein Terminal.

## Abschluss

Kein Commit. `worker_done` mit 3 Saetzen: was gebaut, Gates, was offen.
