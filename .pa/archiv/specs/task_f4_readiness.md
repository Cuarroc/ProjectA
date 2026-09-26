# F4-Readiness: Lifecycle und Blocker als reine Rust-Logik

Status: historisch

Repo: `<repo-root>`. **Nicht committen, nicht pushen, nicht
mergen.** Ein Mensch fährt die Gates und committet.

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F4 und §5 „Review Readiness".
Verträge: `.pa/report_f0.md` §2. Ultragoal: `G007-f4`, `--plan-id
sanierungsplan-rev9`.

## Nahtstellen-Lane

Dieses Paket **besitzt keine** der vier Nahtstellen. Die einzige erlaubte
Änderung an `main.rs` ist die eine Zeile `mod readiness;` (alphabetisch zwischen
`quota` und `redact`). Alles andere an `main.rs`, `api.rs`, `store.rs` oder
`bin/pa.rs` ist ein falscher Schnitt — melde es.

Geht **vor** `.pa/task_f4_persist.md` und `.pa/task_f4_authority.md`. Parallel zu
F1-Frontend und F3, sobald deren Dateien disjunkt bleiben.

## Warum

Readiness ist heute ein Board-Wort: eine Spalte im Prozessspeicher, ein
Handpin, ein `test_status='pass'` ohne SHA. Der Plan trennt Lebenszyklus und
Blockaden und bindet Test, Konflikt und Freigabe an ein Evidence-Tupel. Ohne
diese Engine als reine Funktion bleibt jeder Merge-Guard eine Behauptung.

F0-2 und F0-3 werden hier als Logik geschlossen (Pin zählt nicht; ungebundener
Pass ist stale). F0-1 (Verdict-Token am Merge) gehört zu
`.pa/task_f4_authority.md`. Persistenz gehört zu `.pa/task_f4_persist.md`.

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/readiness.rs` — Typen, `evaluate`, Merge-Tree-Sonde,
  Trust-Hash, Merge-Preflight
- `src-tauri/src/main.rs` — **nur** `mod readiness;`

**Nicht anfassen:** `api.rs`, `store.rs`, `bin/pa.rs`, `workers.rs`,
`status.rs`, `testgate.rs`, alles unter `src/`. `proc.rs` nur aufrufen
(`crate::proc::command`), nicht ändern. Git in Produktion nie über
`Command::new`.

**Achtung Bauumgebung:** Setze **kein** `CARGO_PROFILE_*`.

## Auftrag

1. Lifecycle und Readiness als getrennte Achsen:

   ```text
   Lifecycle: queued | running | exited | archived | merged | failed
   Readiness: unknown | blocked | ready
   ```

2. `blockers[]` mehrwertig, Codes exakt:

   `agent_running | dirty | setup_failed | tests_stale | review_stale |
   changes_requested | comments_open | base_changed | conflicting |
   git_unsupported`

   Jeder Blocker trägt Nachricht und **nächsten sicheren Schritt**. Eine
   Prioritätsfunktion darf nur die Anzeige sortieren, nie die gespeicherte
   Menge kürzen. Mehrere Blocker bleiben gleichzeitig sichtbar.

3. Evidence-Tupel, unveränderlich gebunden:

   ```text
   code = { worker_head_sha, base_tip_sha, merge_tree_oid }
   test = { code, verification_policy_hash }
   approval = { code, acceptance_hash, reviewed_by, approval_source }
   ```

   Ändert sich HEAD **oder** Base, sind Test, Konfliktbeleg und Freigabe stale.
   Policy-Wechsel verfällt nur den Test; Akzeptanzwechsel verfällt nur die
   Freigabe. `approval_source` ist `desktop | verdict_token | unverified`.
   `unverified` zählt nie als Freigabe. Ein Approval darf nicht auf ein anderes
   Tupel übertragen und nach `changes_requested` nicht wiederverwendet werden.

4. Merge-Kandidat ausschließlich über
   `git merge-tree --write-tree <base-tip> <worker-head>`. Git fehlt, der
   Befehl scheitert oder das Ergebnis ist nicht eindeutig: `blocked` mit
   `git_unsupported` oder `conflicting`. Dateinamen-Overlap ist kein Grünbeleg.
   Die Sonde läuft in Tests gegen echte Temp-Repos (`testutil::init_repo`).

5. `ready` nur bei beendetem Agenten, sauberem Worktree, grünem Setup/Test für
   denselben Merge-Tree, konfliktfreiem Merge-Tree, null offenen Kommentaren,
   gültigem Trust und positiver menschlicher Freigabe (`desktop` oder
   `verdict_token`) für dasselbe Evidence-Set. Sonst `blocked` oder `unknown`
   (unvollständig gemessen) — **nie** ein Legacy-Pass ohne SHA als `ready`.

6. Board-Pin ist Anzeige. `evaluate` und `merge_preflight` lesen ihn nicht.
   Dirty, Running, Stale, Conflict, fehlendes Git hart verweigern, mit konkretem
   nächsten Schritt.

7. Setup-Trust als reine Funktion: Grant umfasst kanonische Repo-Identität,
   normalisierten Befehl, Base-SHA und Hash deklarierter ausführbarer Inputs
   (Manifest, Lock, Lifecycle-Script). Unveränderter Befehl mit verändertem
   Script fordert erneut Trust. Timeout/Prozessbaum-Kill der Ausführung selbst
   liegt in Persistenz/Gate, nicht hier — hier nur das Trust-Prädikat und
   `setup_failed`.

8. `merge_preflight` gibt `Ok(())` nur bei `readiness == ready`; sonst die
   Blocker-Zeilen. Das ist der Vertrag, den Guard und API später aufrufen.

## Beweismaßstab

Kompilierender **roter** Test zuerst, dann grün. Jeder Readiness-Zustand und
jeder Blocker-Code hat einen Regressionstest. Namentlich:

- neuer Worker-HEAD oder Base-Tip macht Test, Konflikt und Freigabe stale
- mehrere Blocker gleichzeitig
- Merge-Tree-Konflikt vs. sauberer Tree (echte git-Repos)
- `changes_requested` verlangt neue Freigabe; altes Approval zählt nicht
- Pin + Dirty + Running blockt trotzdem
- ungebundener `pass` (kein SHA) ist `tests_stale` (F0-3)
- Trust: gleicher Befehl, anderes Lifecycle-Script → erneut fragen
- `unverified` kann keine Freigabe prägen

## Gates

```text
cargo test readiness::
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

Exit-Codes ungemaskiert lesen. Volle `cargo test`-Suite nicht blockierend,
aber die neuen Tests müssen in ihr bestehen.

## Report

`.pa/report_f4_readiness.md`: rote-dann-grüne Befehle mit Exit-Codes, die
Blocker-Matrix, was bewusst nicht persistiert wurde.
