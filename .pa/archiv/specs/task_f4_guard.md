# F4-Guard: Merge-Preflight ohne Pin-Bypass

Status: historisch

Repo: `<repo-root>`. **Nicht committen, nicht pushen, nicht
mergen.**

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F4. Schließt **F0-2** und **F0-3** am
Merge-Pfad. Ultragoal: `G007-f4`.

## Nahtstellen-Lane

`workers.rs` ist **keine** der vier Nahtstellen. Dieses Paket besitzt
`workers.rs` (Merge-Preflight und die bestehenden Merge-Tests) und läuft nach
`.pa/task_f4_readiness.md`. Persistenz darf fehlen: ungebundenes Evidence ist
stale. Wenn `.pa/task_f4_persist.md` schon da ist, Facts aus der Platte lesen.

Nicht `api.rs` / `store.rs` / `main.rs` / `bin/pa.rs` anfassen.

## Warum

`merge_worker_with_effects` prüft die Board-Spalte, und `set_override` setzt
die frei (F0-2). Der Testgate greift nur bei gesetztem `test_command` und ein
Pass verfällt nie (F0-3). Der Plan: Dirty/Running/Stale/Conflict hart
verweigern; ein Pin umgeht nichts.

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/workers.rs` — `merge_worker` / `merge_worker_with_effects`
  und deren Tests

`readiness.rs` nur aufrufen. `status.rs` nicht umbauen (Pin bleibt Anzeige).

## Auftrag

1. Vor jedem Merge `readiness::evaluate` + `merge_preflight` auf gemessenen
   Facts. Die Board-Spalte `COL_READY_TO_MERGE` ist **kein** ausreichender
   Beleg mehr. Ein Pin darf weder Readiness setzen noch einen Blocker umgehen.

2. Facts mindestens: Lifecycle/Session, Dirty (git), Merge-Tree-Sonde,
   gespeichertes oder fehlendes Test-/Approval-Evidence, offene Kommentare.
   Ungebundener `test_status='pass'` → `tests_stale`.

3. Ablehnung nennt die Blocker und den nächsten Schritt, nicht nur die Spalte.

4. Bestehende Merge-Tests umdrehen, wo sie den Pin als Freigabe missbrauchen:
   ein geparkter Pin ohne Evidence merget **nicht**. Die lokalen Git-Merge-
   Erfolgspfade brauchen echtes Evidence-Set (in-memory reicht, wenn Persistenz
   noch nicht verdrahtet ist).

5. Worktree-Prune nach erfolgreichem Merge nur wenn der Aufrufer es setzt
   (`remove_worktree`); nie implizit.

## Beweismaßstab

Rote-dann-grüne Tests in `workers.rs`:

- Pin + fehlendes Git / Conflict / Dirty / Running → Merge verweigert
- Pass ohne SHA → verweigert (F0-3)
- Pin allein → verweigert (F0-2)
- vollständiges ready-Set → Merge wie bisher (lokales Repo)

## Gates

```text
cargo test workers::tests::merg
cargo test readiness::
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## Report

`.pa/report_f4_guard.md`.
