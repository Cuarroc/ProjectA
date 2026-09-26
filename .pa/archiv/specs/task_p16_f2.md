# Phase 16 / Fix 2 — build_tree: spawned_by-Zyklen duerfen keine Knoten verschlucken

Status: historisch

Repo: `<repo-root>`, Branch `main`, HEAD `526c60c`. Im Repo-Root,
kein Worktree. **Nicht committen, nicht pushen, nicht mergen.**

## Deine Datei (EXKLUSIV)

- `src-tauri/src/api.rs`

**Sonst nichts.** `store.rs`, `workers.rs`, `queue.rs`, `diff.rs`, `gh.rs`,
`scout.rs`, `testgate.rs` gehoeren Fix 1; `main.rs` und das Frontend gehoeren Fix 3.
Beide arbeiten parallel.

## Das Problem

`build_tree` (ab `api.rs:302`) verspricht im Doc-Kommentar, jeden Worker genau einmal
auszugeben — der Test heisst sogar
`build_tree_shows_every_worker_exactly_once`. Bei einem `spawned_by`-Zyklus stimmt
das nicht: zeigen A und B mit `spawned_by` aufeinander, ist keiner von beiden eine
Wurzel, und beide verschwinden samt ihrer Kinder aus dem Baum. Das Board zeigt dann
stillschweigend weniger Worker, als es gibt.

Ein Zyklus ist im Normalbetrieb nicht vorgesehen, aber `spawned_by` ist laut
`api.rs`-Doc ausdruecklich *"the caller's own declaration ... not a security
boundary"* — ein Koordinator kann also einen Zyklus behaupten, versehentlich oder
nicht. Ein Baum, der daraufhin Knoten verliert, ist die schlechteste Reaktion.

## Was zu tun ist

1. Zyklen erkennen. Ein Knoten, der ueber `spawned_by` in einen Zyklus zeigt, wird
   wie eine **eigene Wurzel** ausgegeben, statt zu verschwinden. Seine Kinder haengen
   normal darunter.
2. Die Invariante wieder herstellen: **jeder Worker erscheint genau einmal** — nicht
   null Mal, nicht doppelt. Auch bei einem Selbstbezug (`spawned_by == id`), bei
   einem Zweierzyklus und bei einer laengeren Kette A→B→C→A.
3. Endlosschleifen sind ausgeschlossen: die Traversierung muss auch bei einem Zyklus
   terminieren. Nutze eine `visited`-Menge, kein Rekursionslimit.
4. Den Doc-Kommentar an die Wahrheit anpassen: er soll sagen, dass ein Zyklus zu
   eigenstaendigen Wurzeln fuehrt, und **warum** (ein behaupteter Zyklus ist ein
   Bedienfehler, kein Grund, Arbeit unsichtbar zu machen).

Waehle die Wurzel eines Zyklus deterministisch — etwa der Knoten mit der kleinsten
Id oder der frueheste `created_at` —, damit die Ausgabe zwischen zwei Aufrufen nicht
springt. Begruende die Wahl im Kommentar.

## Tests (Pflicht)

Ergaenze die vorhandenen `build_tree`-Tests um:

- Selbstbezug: `spawned_by == id` → der Worker ist eine Wurzel, erscheint einmal.
- Zweierzyklus A↔B → beide erscheinen, keiner verschwindet.
- Dreierzyklus A→B→C→A, plus ein Kind an C → alle vier erscheinen genau einmal.
- Zyklus **plus** intakter Rest im selben Projekt → der intakte Teil sieht
  unveraendert aus.
- Ein Determinismus-Test: derselbe Input, zweimal gebaut, gleiche Wurzelreihenfolge.

Der bestehende Test `build_tree_shows_every_worker_exactly_once` muss unveraendert
gruen bleiben.

## Konventionen

Kommentare/Doc-Comments **Englisch**, UI-Strings Deutsch, keine neuen Dependencies,
Rust-Tests inline. Kein `npm run tauri dev`.

## Gates

    cd src-tauri && CARGO_BUILD_JOBS=2 cargo test
    cd src-tauri && CARGO_BUILD_JOBS=2 cargo clippy --all-targets -- -D warnings

**Immer** `CARGO_BUILD_JOBS=2`. **Niemals `CARGO_PROFILE_*`**. **Frag mich vor jedem
cargo-Lauf per `orca orchestration send --type escalation` um das GO** — es baut nur
ein Rust-Worker gleichzeitig. Kein blockierendes `ask`, das kommt bei mir nicht an;
poll auch nicht `orca orchestration check`, die Delivery haengt. Ich erreiche dich
ueber dein Terminal.

Fehler aus fremden Dateien wortgetreu an mich, nicht selbst reparieren — Fix 1 baut
parallel an `store.rs`/`workers.rs` und kann die Crate zeitweise rot machen.

## Abschluss

Kein Commit. `worker_done` mit 3 Saetzen: was gebaut, Gates, was offen.
