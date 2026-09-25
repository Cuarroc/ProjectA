# Phase 16 / R2 — Review Frontend + IPC-Vertraege (read-only)

Status: historisch

Repo: `<repo-root>`, Branch `main`. Im Repo-Root.

## Du aenderst NICHTS

Kein Produktivcode, keine Tests, keine Formatierung, kein Commit. Deine einzige
Schreiboperation ist dein Bericht unter `.pa/review_p16_r2.md`. Findest du einen
Einzeiler-Bug: **fix ihn nicht**, beschreib ihn. Ich triagiere und dispatche.

`npm run typecheck` und `npm run build` darfst du laufen lassen — die sind billig und
stoeren niemanden. `cargo` **nicht**.

## Dein Scope

Der Vertrag zwischen Rust und Frontend, und der Frontend-State.

### 1. serde ↔ TypeScript, ueber ALLE neuen Typen

Geh jeden Typ einzeln durch und vergleiche die Rust-Definition mit `types.ts` **und**
mit der Normalisierung in `lib/ipc.ts`:

`Worker`, `BoardCard`, `BoardState`, `Learning`, `RoleVariant`, `QueueEntry`,
`Project`, `AgentProfile`, `Recommendation`.

Worauf es ankommt:

- Heisst jedes Feld auf beiden Seiten gleich? Die Rust-Structs tragen
  `#[serde(rename_all = "camelCase")]` — ein Feld, das TypeScript in snake_case
  erwartet, kommt zur Laufzeit als `undefined` an und faellt in keinem Typecheck auf.
- Ist `Option<T>` auf der TS-Seite wirklich `T | null` und nicht `T | undefined`
  oder `T`? Ein vergessenes `| null` ist ein Laufzeitfehler, den `tsc` nicht sieht.
- Sind neue Rust-Felder in `types.ts` ueberhaupt angekommen? Phase 15 hat
  `AgentProfile.enabled` ergaenzt, Phase 16 ergaenzt gerade `role_variant_id` an
  `Worker` und moeglicherweise `maxWorkers` an `Project` — pruef besonders die.
- Machen die `to<Typ>()`-Normalisierer in `ipc.ts` das Richtige mit kaputten Daten?
  Filtern sie zu viel weg (ein Eintrag verschwindet still) oder zu wenig?
- Stimmen die **Tauri-Command-Namen und Argumentnamen** zwischen `invoke(...)` in
  `ipc.ts` und `#[tauri::command]` in `main.rs`? camelCase auf beiden Seiten. Ein
  Tippfehler hier ist ein Laufzeitfehler ohne Compilerwarnung.

### 2. Frontend-State

`App.tsx`, `CommandChat.tsx`, `BoardView.tsx`, `LearningsPanel.tsx`,
`NewWorkerDialog.tsx`, `SettingsView.tsx`.

- Stale-Closure-Fehler in `useCallback`/`useEffect`: fehlende oder zu breite
  Dependency-Arrays.
- Polls, die einen laufenden Benutzer-Edit ueberschreiben (das `LearningsPanel` haelt
  bewusst per-id-Drafts — haelt das wirklich?).
- Nicht abgeraeumte Intervalle/Listener beim Unmount oder Projektwechsel.
- Optimistische Updates ohne Rollback bei Fehler.
- Zustaende, die nach einer fehlgeschlagenen Aktion haengen bleiben (`busy`, das nie
  zurueckgesetzt wird).
- Fehler, die geschluckt statt angezeigt werden.

## Befund-Format (verbindlich)

Pro Befund:

- **Datei:Zeile**
- **Schweregrad**: kritisch / schwer / mittel / niedrig
- **Beweis**: Code-Ausschnitt oder reproduzierbarer Ablauf (welcher Klick, welcher
  Zustand, was passiert dann). Keine Vermutung ohne Beleg — sonst „unsicher,
  weil ..." dazuschreiben.
- **Vorschlag**: was du aendern wuerdest.

**Keine Vorschlaege ohne Befund.** Kein allgemeines „man koennte hier refactoren".
Lieber fuenf belegte Befunde als zwanzig Stilmeinungen. Sortiere nach Schweregrad.

Ein Vertragsbruch zwischen Rust und TS ist mindestens **schwer**, auch wenn er heute
zufaellig nicht auffaellt — genau diese Klasse sieht kein Gate.

## Abgabe

1. Datei `.pa/review_p16_r2.md` schreiben.
2. Zusaetzlich als Prosa in `worker_done`: die wichtigsten Befunde in 3 Saetzen, plus
   Anzahl je Schweregrad.

Kein Commit, kein Push. Kein blockierendes `ask`, kein Pollen von
`orca orchestration check` — die Delivery haengt; ich erreiche dich ueber dein
Terminal. Rueckfragen per `orca orchestration send --type escalation`.
