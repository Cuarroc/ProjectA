# Review-Disposition PR #16 (DF-15b / KI-27), Stufe A: grok + sonnet

Kandidat: Branch `claude/df-15b`, geprüft `fd14dec` (Merge-Base `c60f267`), nach
Umsetzung `ca48038`. Autor: kimi (Worker). Reviewer: grok (xAI, `grok.exe
--prompt-file`, Plan-Modus, nur lesen) und Claude Sonnet (`claude -p --model
sonnet`, Tools nur Read/Grep/Glob) — beide nicht die Modellfamilie des Autors.
Ollama und OpenCode waren für diesen Auftrag gesperrt (Wochenlimit). Das
frühere Paar (glm-5.2, qwen2.5-coder) und seine Dispositionen G1–G3/Q1–Q20
stehen im PR-Text; beide Reviewer dieser Stufe bestätigen die dortigen
Ablehnungen (G1, Q1, Q2, Q4) ausdrücklich oder widersprechen nicht.

## Reviews

- `.pa/review_pr16_grok.md` — Urteil *freigeben mit Auflagen*: 2 mittlere, 1
  niedriger Befund. Prompt: `.pa/review_prompt_pr16.md` (voller Diff
  `c60f267..fd14dec`).
- `.pa/review_pr16_claude-sonnet.md` — Urteil *freigeben mit Auflagen*: R1
  (mittel), R2 (niedrig–mittel), R3/R4 (niedrig) plus ein Hinweis zum
  Index-Kommentar. Gleicher Prompt.

## Verifikation vor der Disposition

- `development_runs.rs` (`agent_run_context`) leitete `effectiveState` nur aus
  `delivery.state` und `launch.state` ab — bestätigt: bei einer DF-15a-Zeile mit
  gehaltener Reservierung meldete das Briefing „released", während `tokens` und
  die Kostenquittung (`started_receipt`, „reservation retained") die Haltung
  zeigten.
- Einziger Produktionsaufruf des Releases war `commit_native_undelivered_exit`
  (Replay-Zweig); `reconcile_interrupted_development_launches` (Start) fasste
  die Zeilen nicht an — bestätigt. „Der Replay-Zweig gibt DF-15a-Zeilen frei"
  gilt daher nur, wenn ein Host den Exit nochmals einreicht.
- `store/continuous.rs:522/583/661`: `max_attempts_per_task` und das
  Root-Attempt-Budget werden beim Claim erhöht, unabhängig vom Ausgang des Runs
  — bestätigt (R1).
- `reserve_development_tokens` (`development_budget.rs`, Guard
  `r.status='intent'`) verhindert eine zweite Reservierung für einen Run, dessen
  Launch `exited_undelivered` ist (Run ist danach `reconciling`) — bestätigt.
- `record_development_delivery_enqueued` prüfte nur `state='started'`;
  Aufrufer: `workers.rs` (PTY-Pfad, erzeugt nie `exited_undelivered`) — bestätigt
  (R4, heute unerreichbar).

## Dispositionen

| ID | Quelle | Schwere | Befund | Disposition |
|---|---|---|---|---|
| G1 | grok | mittel | `effectiveState: released_undelivered` erscheint auch, solange die Reservierung noch `started` ist (DF-15a-Zeile); Briefing und Quittung widersprechen sich | angenommen: `effectiveState` nur, wenn die Implementation-Reservierung des Runs `cancelled` ist. Rot `2d83b3a`, Fix `ca48038` |
| G2 | grok | mittel | Kein Weg, DF-15a-Zeilen zu befreien, wenn kein Host den Exit nochmals einreicht; KI-27-Text behauptet es | angenommen: `reconcile_interrupted_development_launches` ruft den Sweep `release_undelivered_runs` (dieselbe Guard-SQL pro Kandidat, idempotent, ein Event je Freigabe). KI-27 nennt Replay und Start-Abgleich. Rot `2d83b3a`, Fix `ca48038` |
| G3 | grok | niedrig | `CONTINUOUS.md` (Zeilen 517, 551) und `STAND.md` (107) widersprechen dem Ledger dieses Pakets | angenommen: Ausnahme „bewiesener `exited_undelivered`-Exit" in beiden Absätzen von `CONTINUOUS.md`; `STAND.md` KI-27 aktualisiert (`ca48038`) |
| R1 | sonnet | mittel | Freigegebenes Budget entfernt die implizite Bremse gegen einen Crash-Loop-Provider | abgelehnt mit Beleg: die Wiederholungsgrenze ist unabhängig vom Token-Budget — `max_attempts_per_task` (Claim, `continuous.rs:522`) und das Root-Attempt-Budget (`:583/:592`) zählen jeden Claim, egal wie der Run endet; Test `continuous.rs:1233` (drei Versuche, dann `TASK_FAILED`). Kein neuer Code |
| R2 | sonnet | niedrig–mittel | Kein Backfill für DF-15a-Zeilen; `started_receipt`-Zweig „retained" nur noch für solche Zeilen korrekt | angenommen mit G2; Kommentar am `started_receipt`-Zweig (`development_usage_receipt.rs`) benennt, wann er noch erreicht wird (`ca48038`) |
| R3 | sonnet | niedrig | Event nur bei tatsächlicher Freigabe, `effectiveState` unabhängig davon abgeleitet — Journal und Ableitung können abweichen | angenommen, durch G1 gelöst: beide folgen jetzt derselben Tatsache (Reservierung `cancelled`); das Event schreibt der Writer selbst (`release_undelivered_run_tokens`), jeder Aufrufer (Exit-Commit, Replay, Start-Sweep) journalisiert genau einmal |
| R4 | sonnet | niedrig | Späte Enqueue-Meldung nach der Freigabe nicht abgewehrt (heute unerreichbar) | angenommen: `record_development_delivery_enqueued` weist einen Run mit Launch `exited_undelivered` ab; Doku am Docstring. Rot `2d83b3a`, Fix `ca48038` |
| R5 | sonnet | Hinweis | Index-Kommentar (G3 der Vorstufe) soll den echten Guard `r.status='intent'` nennen | angenommen: Kommentar an `development_implementation_budget` nennt `reserve_development_tokens` und den `reconciling`-Status (`ca48038`) |

## Red → Green

- Rot (`2d83b3a`, Windows, `cargo test --bin projecta <name>`, `CARGO_BUILD_JOBS=1`, Slot `projecta-c`): 
  - `a_legacy_undelivered_row_is_not_reported_released_and_startup_frees_it` → **Exit 101** (Assertion „a still-held reservation is not reported as released")
  - `a_late_enqueue_after_an_undelivered_exit_is_rejected` → **Exit 101**
- Grün (`ca48038`): `undelivered` 9 passed, `delivery` 41 passed (1 ignoriert),
  `reconcile` 5 passed (1 ignoriert), `development_budget` 24 passed,
  `usage_receipt` 7 passed — jeweils **Exit 0**. Volle Bahn `prepush` siehe
  PR-Text.

Nach `ca48038` liegt kein offener Befund aus diesem Review vor.
