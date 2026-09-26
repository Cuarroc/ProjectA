# Task D1-Fix: die zwei D1-High-Befunde produktiv beheben

Status: historisch

Du bist ein Entwicklungs-Worker auf einem Linux-Server. Repo:
`/home/worker/wt/d1fix` (Branch `kimi/d1fix`, aktuelles main). NUR dieser
Worktree/Branch. NIEMALS main, niemals force-push.

## Kontext

Der adversariale Tester D1 hat zwei High-Befunde gefunden, die als
`#[ignore]`-Tests auf main liegen (Bericht `.pa/review_p16_d1.md` — falls im
Worktree nicht vorhanden, die Befunde stehen unten vollständig). Dein Job:
Produktivcode-Fixes, die diese Tests grün machen (Test attribute `#[ignore]`
entfernen), ohne die Regeln des ursprünglichen Befunds zu verwässern.

### D1-F1 — Prompt-Injection durch `pattern_label`

- Ort: `src-tauri/src/roles.rs` `fallback_text` (um Zeile 207), Test
  `roles::tests::a_pattern_label_cannot_inject_prompt_structure` (um Zeile 651).
- Befund: ein `pattern_label` mit Newline, `--- TASK ---`-Marker oder
  `## `-Überschrift wird verbatim in die `system_prompt_addition` einer
  Rollen-Variante interpoliert. Damit kann ein Learning-Text die Prompt-
  Struktur einer künftigen Rolle umschreiben.
- Erwarteter Fix: das Label sanitizen, BEVOR es in Prompt-Text landet —
  auf eine Zeile flatten, Section-Marker (`--- ... ---`-Muster) und
  Markdown-Überschriften neutralisieren, Länge kappen. Schau dir an, wie
  `name_from_pattern` die Anzeige-Namen normalisiert, und ziehe die
  Sanitizing-Regeln an einer gemeinsamen Stelle zusammen (oder dokumentiere,
  warum bewusst zwei). Der Batch-E-Kontext (Section-Marker-Ablehnung) steht
  in `.pa/report_p16_e.md`, falls zugänglich.
- Der Test muss ohne `#[ignore]` grün werden.

### D1-F2 — Testgate-Debounce ist nicht atomar

- Ort: `src-tauri/src/testgate.rs` `run_test_gate_if_due` (um Zeile 148),
  Test `testgate::tests::parallel_automatic_triggers_start_exactly_one_gate`
  (um Zeile 600).
- Befund: zwei parallele Aufrufe lesen beide den Worker, bevor einer
  `TEST_RUNNING` schreibt → beide starten das Gate.
- Erwarteter Fix: atomares Claim-Muster wie `Store::claim_recommendation`
  (`store.rs`): ein konditionales UPDATE (`... SET test_status = 'running'
  WHERE id = ? AND (test_status IS NULL OR test_status != 'running')`),
  `rows_affected == 1` gewinnt. Der Verlierer startet nicht. Schau dir
  `release_test_status` und den Reattach-Pfad an, damit das Claim nicht mit
  dem Aufraeumen kollidiert.
- Der Test muss ohne `#[ignore]` grün werden.

## Regeln

- TDD: erst die `#[ignore]`-Tests aktivieren und ROT sehen, dann fixen.
- Keine weiteren Produktiv-Änderungen als die zwei Fixes. Falls du beim
  Fixen neue Befunde findest: nur dokumentieren, nicht fixen.
- Gates VOR Push: `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `cargo build` (`src-tauri/`, cargo unter `~/.cargo/bin`,
  TMPDIR=/home/worker/testtmp falls /tmp klemmt).
- Commit-Messages: Englisch, erklärend. Ein Commit pro Fix ist ok.
- Bericht `.pa/report_d1fix.md` im Worktree, dann
  `git push origin kimi/d1fix`.
