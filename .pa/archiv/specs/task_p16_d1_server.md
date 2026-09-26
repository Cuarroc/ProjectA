# Task D1: Adversarialer Tester für Phasen 9–15 (Phase 16)

Status: historisch

Du bist ein ADVERSARIALER Tester auf einem Linux-Server. Dein Job ist nicht
reviewen, sondern BRECHEN: schreibe neue Rust-Tests, die die Features der
Phasen 9–15 gezielt zum Fehlschlagen bringen sollen. Was hält = Regressionsschutz.
Was bricht = Befund. Ein roter Test ist ein Ergebnis.

Repo: `/root/wt/d1` (Branch `kimi/d1`, aktuelles main). NUR dieser
Worktree/Branch. NIEMALS main, niemals force-push.

## Harte Regeln (aus der Original-Spec, gelockert nur bei cargo)

- Nur `#[cfg(test)] mod tests`-Blöcke in bestehenden Rust-Dateien erweitern.
  **Jede Produktivcode-Änderung ist verboten.** Ein Test, der nur mit einem
  Produktiv-Fix grün würde, bleibt auskommentiert oder `#[ignore]` — mit
  Begründung im Kommentar und im Bericht.
- Kommentare Englisch. Keine neuen Dependencies. Vorhandene Fixtures und
  `crate::testutil::TempDir` nutzen.
- Cargo-Läufe: frei (eigener Server, eigener Worktree, keine Eskalation nötig).
- Am Ende muss die Suite GRÜN sein: gehaltene Tests laufen normal, Befunde
  sind `#[ignore]`/auskommentiert.

## Angriffsflächen (aus `.pa/task_p16_d1.md`, dort Details)

1. `spawned_by`-Zyklen in `api.rs::build_tree` (Selbstbezug, 2er-/3er-Zyklen;
   der Fix aus `82913cd` promoted ein Zyklus-Mitglied zur Wurzel — beweise
   oder brich das).
2. `pattern_label`-Sonderzeichen (`roles.rs`, `learnings.rs`): `## `-Überschriften,
   Section-Marker `--- PROJEKT-PLAYBOOK ---`, Newlines, Unicode, leer, sehr lang.
3. Playbook-Kappung `learnings.rs::excerpt_from`: exakte Grenze, Bullet >
   Budget, leere Abschnitte, UTF-8-Mehrbyte (Panic mitten im Zeichen?).
4. Merge-Guards `workers.rs::merge_worker`: falsche Spalte, rotes Testgate,
   laufende Session, fehlender Branch — keine Kombination darf durchrutschen.
5. Testgate `testgate.rs`: `gate_result` mit Exit 0/≠0/None/Timeout;
   Debounce bei parallelem Lauf.
6. Critic-Parser `critic.rs::parse_candidates` gegen kaputtes Skill-Output
   (fehlende/vertauschte/überzählige LEARNING/PATTERN-Blöcke).
7. Rollen-Spawn mit `Unsupported`-Profil (`workers.rs`): exakte Meldung;
   nicht-approved, fremdes Basis-Profil, unbekannte Id.
8. Freie Jagd.
9. NEU (dazugekommen, lohnt sich): `plan_reattach` in `workers.rs` — seit
   heute Budget PRO PROJEKT und Retire-statt-Skip (Commit 56c4069). Greife
   die Grenzfälle an: Budget 0, Worker ohne Projekt, created_at-Gleichstand,
   Zusammenspiel paused/missing-worktree.
10. NEU: `claim_recommendation` (`store.rs`) — das Rollback in
    `scout.rs::accept_recommendation`, wenn `insert_queue_entry` scheitert:
    bleibt die Empfehlung retrybar?

## Gates & Abgabe

- `cargo test` muss am Ende grün sein (cargo unter `~/.cargo/bin`),
  `cargo clippy --all-targets -- -D warnings` clean.
- Bericht `.pa/review_p16_d1.md`: pro Befund Datei:Zeile, Schweregrad, Test,
  Ursachenhypothese; plus Liste der gehaltenen Tests. Kopie nach
  `/root/logs/d1-report.md`.
- `git push origin kimi/d1`.
