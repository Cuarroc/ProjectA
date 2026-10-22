# PROJECTA_ABNAHME — documentation rework and side-app stop (DOC-9)

Acceptance report for the order "ProjectA – Zusatz-App stoppen, Dokumentation
und Arbeitsweise verbessern" (received 2026-10-20 21:57Z), section 6. Written by
Root (orchestrator) for external review. All times UTC. Every value names its
source; "reported" means an author/reviewer claim that Root did not observe
itself. Missing measurements are marked **OPEN**. This report does not accept
itself: it lists evidence for an independent reader.

Final measured state: `origin/main` @ `a8357d0c` (2026-10-21 16:42Z).
Follow-up after the external acceptance of 2026-10-21 (§7): final files at
`origin/main` @ `47ddbebc` (2026-10-21 22:22:55Z). Sections 1–5 keep their
original measurement time; §6 rows now point to §7 where the follow-up changed
them.

## 1. Stop of the side app (aufgaben-app / REF-APP-1)

| Place checked | Observed state | When |
|---|---|---|
| PC, ProjectA Dev (`projecta.exe`) database, read-only | project `aufgaben-app` registered; `task_queue` 4 rows `dispatched`; workers 2 archived, 2 exited, live none; continuous tables 0 rows | 21:57–21:59Z |
| PC processes | one orphan `codex app-server` daemon (shared worker home, parent gone) left running — not app-specific, not killed | 21:57–21:59Z |
| Project server (pa-orch queue) | jobs 0, queue 0; no `aufgaben-app`/`REF-APP`/`Durchstich` match in queue/hold/parked/jobs (grep rc=1) or `events.log`; no app worktree; no codex/claude/kimi/cargo/opencode process; crontab without app entry | 21:59:21–28Z |
| AgentsRoom triggers | no REF-APP trigger; unrelated trigger "Kerndoku-Pflege" disabled 22:01:08Z (PLAN/STAND writer collision) | 21:59:14Z |
| App repository | `main` b06d45f == `origin/main`; 4 worker branches 0 commits outside main; no open PRs; last CI green 21:40Z | 21:59:49Z |

Secured: full git bundle of the app repository (verify exit 0), untracked
worktree files, the pa-orch app folder and a copy of the order, with
`SHA256SUMS` (re-checked about 02:3xZ: 4 OK, exit 0). Nothing was deleted.

Changes made: backlog ticket REF-APP-1 (`f5276c87`) set to `pending` with title
prefix `[ABGEBROCHEN – Umfangskorrektur 20.10.]` and tag
`abgebrochen-umfangskorrektur` (22:00:09Z); stop note in the pa-orch app folder
(22:00:17Z); memory notes `lage-jetzt` and `user-standing-permissions` updated.
No ProjectA repository file or commit was needed for the stop.

Remaining uncertainty: the 4 `dispatched` queue rows are not proven terminal;
server `specs/` sub-folders were not searched (grep rc=2); the orphan daemon
was left running; the project is still registered in ProjectA Dev (removing it
is a delete and stays with Elias).

## 2. Target/actual matrix

| Criterion (order §6) | Check method | Observed result | Time | Checker | Evidence |
|---|---|---|---|---|---|
| Side app stopped, nothing restarts it | process/queue/trigger/cron inspection, see §1 | no running app work found; 4 rows not proven terminal | 21:57–22:01Z (20.10.) | Root | §1 |
| Plan shortened to an active masterplan | bytes via `git show <ref>:docs/PLAN.md \| wc -c` | 344768 → 241440 B | 2026-10-21 16:42Z | Root | #1760, #1763, #1778 |
| Native PLAN reader accepts the plan (limit 262144 B) | size precondition `wc -c`; production reader not re-run on final main | 241440 ≤ 262144 (baseline 344768: reader refused, exit 1) | 2026-10-21 16:42Z | Root | DOC-INV-1 baseline; this table |
| Readers/generators still work | `node scripts/plan-check.mjs --offline`; `node --test scripts/lib/{plan-model,hq-parse,roadmap-data}.test.mjs` on final main | plan-check exit 0 (0 findings; offline: PR/age and jobs not checked); node tests exit 0 (76 tests: 75 pass, 1 skipped = symlink test needs a Windows privilege) | 2026-10-21 16:42Z | Root | commands in §2 notes |
| Current tasks, decisions, requirements findable | lossless moves with ID/block identity checks by the authors, reviewed cross-family | 1245 IDs / 143 blocks identical after DOC-1 R2 (reported); history in `docs/archive/` | 01:28–2026-10-21 16:42Z | authors + reviewers | #1760, #1761, #1778 |
| decisions.md is a short index of valid decisions | bytes | 156181 → 35731 B; full journal kept in `docs/archive/decisions-2026-10/journal.md` | 2026-10-21 16:42Z | Root | #1761 |
| Contradictory rules unified | DOC-4 reconcile, reviewed | merged a341e968; DS-F1 HIGH accepted and fixed | 01:46Z | GPT author, DeepSeek/GLM reviewers | #1759 |
| Plan/roadmap show real states and unknown data | DOC-6 roadmap freshness + "unchecked" marking | merged 4cb2622d; follow-up FU-1758-1 open | 00:45Z | reviewers | #1758 |
| KNOWN_ISSUES / STAND shortened with readers intact | bytes | KNOWN_ISSUES 33385 → 16831; STAND 3804 → 3155 | 2026-10-21 16:42Z | Root | #1764 |
| Active doc size and start context compared before/after | bytes, see §3 | done for bytes; tokens **OPEN** | 2026-10-21 16:42Z | Root | §3 |
| Results independently reviewed, bound to the head | reviewer family ≠ author family (OpenAI authors; GLM/DeepSeek/Kimi reviewers) | see PR reports; same-family GPT observers never counted as approval | per PR | Root adjudication | PR bodies `## Report` |
| Delegated work on GPT 6.1 / high | first `turn_context` of each server session | 62 server sessions: 55 `gpt-6.1-sol`, 7 `gpt-6-astra` (allowed ~22:42Z), all `high` | 22:21Z–03:22Z | Stabschef data, Root read | §4 |

Notes: "bytes" are not tokens. A shorter document proves no faster app; no
runtime improvement is claimed.

## 3. Document and context size

Method: `git show <ref>:<file> | wc -c` (bytes) and `wc -l` (lines). Before =
`653db649` (20.10. 22:05Z); after = `a8357d0c`. Both columns were measured
on the same Windows machine at 16:42Z; the 22:05Z server baseline shows 1 B
less per file (same method, different host), so only same-host pairs are
compared.

| File | Before (B) | After (B) |
|---|---|---|
| `AGENTS.md` | 30098 | 30665 |
| `CLAUDE.md` | 3310 | 3310 |
| `STAND.md` | 3804 | 3155 |
| `KNOWN_ISSUES.md` | 33385 | 16831 |
| `docs/PLAN.md` | 344768 | 241440 |
| `docs/decisions.md` | 156181 | 35731 |
| `docs/development/WORKFLOW.md` | 29517 | 29639 |
| `docs/development/CONTINUOUS.md` | 43108 | 43108 |
| `docs/architecture-rules.md` | 5358 | 5358 |
| `docs/plan/v2.0/plan.md` | 157709 | 154192 |
| `docs/plan/v1.6.0/plan.md` | 30237 | 30237 |
| `README.md` | 18043 | 18043 |

Active `docs/**/*.md` without `docs/archive/`: 73 files / 1312897 B →
73 files / 1088793 B (−17 %). The archive (`docs/archive/`, new) holds the moved history
(10 files / 352934 B); it is not loaded at start.

Typical start context (files an agent reads first: `AGENTS.md`, `CLAUDE.md`,
`STAND.md`, memory note `lage-jetzt`): 194408 B → 51552 (lage-jetzt now 14422 B) B.
AgentsRoom memory, the four largest notes (decision-desk,
orchestration-standing-rules, lage-jetzt, user-standing-permissions):
823777 B → 31633 B at DOC-5 acceptance → 56088 B now (regrown by
later appends; see §6).

`AGENTS.md` grew slightly (30098 → 30665 B): DOC-4 reconciled rules instead of
cutting them, and its review fix restored independence wording.

**OPEN (not measured):** token counts, the real start-context consumption of
a harness session, UI/search performance, app runtime.

## 4. AgentsRoom evidence

| Owner | Role | Effective model / effort | How verified |
|---|---|---|---|
| Root (`…2zrodi`) | priority, adjudication, acceptance | `claude-opus-5-5[1m]` (SessionStart hook); effort unknown | harness hook output |
| Stabschef (`…63zow9`) | sole DOC coordinator, dispatch | `gpt-6.1-sol` / high | parsed `turn_context` (01:07, 01:50, 02:59Z) |
| PC worker `…h3xpaj` | SIZE-BUDGET-GATE (#1772) | `gpt-6.1-sol` / high | parsed `turn_context` |
| PC worker `…j4tybd` | DOC-7 author | `gpt-6.1-sol` / high | self-report only |
| Chief, `…on8l6v`, `…k4585y`, `…7539zr` | supervision, read-only checks, records | configured `gpt-6.1-sol`; **not verified** | directory configuration only |
| 62 server sessions (pa-orch queue) | UMSETZEN / NACHBESSERN / REVIEWEN / BELEGEN | 55 `gpt-6.1-sol`, 7 `gpt-6-astra`, all high | first `turn_context` per session |
| Review pair legs (Ollama Cloud GLM 5.3, DeepSeek 4.1) | cross-family reviews | protocol-reported model; effort not exposed | 44 + 8 protocol rows |

Slots: server 12 approved light slots, event-accounted peak 10/12 at 00:11:25Z
(lower bound from `events.log`, not a continuous measurement; reason for the 2
idle slots unobserved). Server cargo: max 4 under a RAM/load rule; sampled 2.
PC: max 3 cargo builds (2 when tight); observed at most 2 (reported), at least
2 overlapping PC owners. Execution places: Windows PC (AgentsRoom consoles),
Linux project server (pa-orch queue), GitHub Actions + Mergify.
Limits: Claude was blocked for delegated work by order (GPT-only); the Ollama
review lane ran under an existing review-only budget; no quota or cap was raised.

## 5. Problem and solution log

| Problem | Cause / hypothesis | Failed attempts | Solution | Cross-check |
|---|---|---|---|---|
| codex brake blocked all GPT starts | stale `codex-week` state, fail-closed | — | Elias lifted it 22:29Z; cron line commented with backup | later starts observed |
| Accidental PC `cargo test` 22:17Z | backticks in a heredoc ran a command | — | quoted heredocs | no repeat seen |
| Ollama review race | two reviews in one shared checkout | identical 9101 B prompts | one worktree per PR | later prompts distinct |
| Review diff limit for pure moves | run-local limit 250000 chars | review refused | `REVIEW_MAX_DIFF_CHARS=400000` for moves only | reviews ran |
| Estimated timestamps in 6 PR bodies (#1759–#1764) and 3 mails | **Root error**: times written from memory | — | corrected 01:38:04Z from `date -u` | rule: times only from `date -u` |
| Typed SHA | **Root error** | — | MISMATCH guard caught it 01:36:03Z | SHAs only from `gh` |
| #1761/#1759 merged before required DOC-8 | **Root error**: Mergify does not keep bundle order | — | `priority` label, DOC-8 merged 01:57:32Z, provenance comments 02:05:27Z | bounded proof at 112adba8 |
| GLM 600 s timeout | transport timeout | one run | rerun; DOC-1b GLM leg left as NO REVIEW (tier C) | not counted as approval |
| DOC-7 author stuck | old SSH session, missing `node_modules`, mail cap 12 | — | fresh session, `npm ci`, cap 48 | merged #1764 |
| Windows junction test timed out (120 s) | PowerShell junction creation | run 39499932947 | #1765 without PowerShell | 12–15 s → 0.05–0.12 s (reported); CI 39520113157 green |
| #1756/#1757 HIGH findings in round 2 | design gaps | two rounds | SPLIT into #1766 (2a-v2) and #1769 (2c-v2) | Root MERGE decision 15:03Z |
| #1766 residual MEDIUM (2048/8192 suffix window) | pre-existing on main (BELEGEN job 03:22Z) | — | merged; follow-up FU-2A-SUFFIX | tier A follow-up |
| #1769 residual MEDIUM (concealment) | pre-existing on main (BELEGEN job 03:22Z) | — | merged; follow-up FU-2C-CONCEAL | tier A follow-up |
| 2a start delayed 17m20s after approval | **Root/coordination delay** | — | disclosed | — |
| One cargo build started at load 13.83 (2c) | guard not applied | — | later runs guarded | recorded as violation |
| Root idle 03:31Z → 15:01Z (11.6 h) | **Root error**: no orchestrator cycle ran | — | context restart 15:05Z | integrations waited, nothing broke |
| PLAN 96 B under reader limit | DOC-8 rows filled the reserve | — | PLAN write freeze, DOC-1b (#1778) | 241440 B |

## 6. Remaining points

| Point | Impact | Owner | Next step | Pending acceptance | Why open |
|---|---|---|---|---|---|
| Token / start-context / UI measurement | size savings proven only in bytes | Root | measure one real session start | §3 OPEN | no instrumentation |
| Native reader on final main | — | — | done: PASS at `47ddbebc` (§7, A3) | external re-check | — |
| DOC-3 remainder (v2 plan beyond DOC-3a) | — | — | done: Option B, #1791 → `b375265b` (§7, A2); dated text outside Option B stays | external re-check | — |
| Memory notes regrew (31633 → 56088 B) | larger start context again | Root | `lage-jetzt` trimmed ~42k → ~4.1k chars (§7, item 4); `user-standing-permissions` (21,055 B) not trimmed | DOC-5 follow-up | permissions note not yet trimmed |
| FU-2A-SUFFIX, FU-2C-CONCEAL (tier A), FU-1772-GLOB | — | Stabschef | FU-2A #1785 → `b07bc2a6`, FU-2C #1786 → `4ccc4a05` merged; FU-1772-GLOB only on a real brief | own reviews | GLOB not needed yet |
| FU-1758-1 roadmap fetch evidence | — | — | A1b #1793 → `0f3e2ea9` merged with an explicit limit (§7, A1) | external re-check | limit cannot be closed from local Git evidence |
| Side app: 4 `dispatched` rows, orphan daemon, project registration | small; nothing runs | Elias (delete) / Root | read-only re-check | §1 | deletion needs Elias |
| HQ snapshot run after rework | DevHQ data may be stale | Root | `npm run hq` on main | — | not run |

## 7. External acceptance follow-up (2026-10-21)

Source: the external acceptance by ChatGPT/Codex at `213d29a3` (file
`ProjectA_Externe_Abnahme_2026-10-21.md`, SHA-256
`a77370b7adfb85ae16ebedd01c24b4434f776b8576529536a5e70e976afe13d3`, kept
outside the repository). Its verdict: the measured cuts are accepted; the
overall acceptance is not. Each row goes finding → change → counter-check.
Only separate agents count as review. GLM-5.3 and DeepSeek-v4.1-flash are
foreign families; the GPT-6.1 observers ran in separate sessions but belong to
the author's family and never count as the independent review. Final files:
`origin/main` @ `47ddbebc`. Nothing in this section accepts itself; the
external re-check decides.

| Finding | Change | Counter-check | State |
|---|---|---|---|
| A1 false roadmap freshness (`scripts/roadmap-data.mjs`) | #1789 closed unmerged after round 2 (Root SPLIT, branch kept @`636c85e9`) → A1b #1793, head `8ca2d9b2` → merge `0f3e2ea9` (21:48:39Z) | #1789 R1 @`f3da5d97`: DeepSeek reject, GLM conditional; R2 @`636c85e9`: a Root R1 instruction (date configured fetches) let a transient `-c` override show a false fresh → SPLIT. A1b: plain/configured fetch → UNKNOWN; dated only for an explicit main fetch with its own branch record and reflog event. A1b R1 @`566c296a`: DeepSeek reject (transient `insteadOf`), GLM conditional → one fix round: the newest same-name main record of ANY URL blocks older evidence; dates before 2001 or after "now" → UNKNOWN; both `insteadOf` forms red on `566c296a`, green on `8ca2d9b2`. R2 @`8ca2d9b2`: GLM approve with conditions, DeepSeek request changes, GPT observer request changes. Root decision after the last round: merge with an explicit limit (table in the #1793 PR text) | merged; external re-check OPEN. **Limit:** a deliberate transient `url.<X>.insteadOf` rewrite to a DIFFERENT repository whose path differs from origin only by `.git` leaves byte-identical local Git evidence (measured: FETCH_HEAD, reflog, ref file, config), because Git strips `.git` from the FETCH_HEAD description. Such a fetch can still be dated fresh; no local reader can tell. Known gap (static, GLM-R2-F3): a rewrite fetch that updates the ref and then fails before writing FETCH_HEAD. There is no universal "never false fresh" claim. |
| A1 old "only fail-safe" disposition of #1758 | Retracted in the PR texts of #1789 and #1793 | GLM R2 confirmed the retraction is present | done in text |
| A2 PLAN rows vs delivery | DOC-3 Option B (Root decision 18:20Z): #1791 → `b375265b` (19:43:47Z). PLAN reconciliation #1790, head `b8abda0f` → `47ddbebc` (22:22:55Z) | #1791: GLM and DeepSeek approve with conditions; four moved blocks byte-exact (3140/2370/4993/3011 B, SHA-256 match), 235 `parsePlan` entries and 128 nine-column rows identical. #1790: a separate check found two stale rows (FU-1758-1, SIZE-BUDGET-GATE), fixed in one round; Root delta check at `b8abda0f`; author reports 38 DEVFLOW rows byte-identical, 40 decision projections identical, `prepush` exit 0 | merged; external re-check OPEN |
| A2 the missed DOC-3-before-DOC-9 order | Recorded in PLAN: the order was missed; the DOC-9 report (#1783, `213d29a3`) was delivered and merged, which is not the external acceptance | — | recorded, not undone |
| A2 dated text outside the Option-B blocks (v2 plan §3.13, §3.15 E10, §§4/4b tables of 06.10, some §10 rows) | Not moved: Option-B boundary with a retained-contract note | GLM F2 / DeepSeek info in #1791 | OPEN for the re-check |
| A3 native reader on the final files | First proof at `213d29a3` (provisional). Rerun at `47ddbebc` by a different GPT-6.1 session: unchanged `Store::import_project_development_plan` → `guidance::read` → `parse_plan` → Store projection on the real `docs/PLAN.md` (245,849 B, SHA-256 `5212a28d…2eddaa`), isolated new test DB, no app start | 38 DEVFLOW packages `DF-00`…`DF-37` against an independent oracle; revision 1, reimport stays 1, stale revision rejected, close/reopen identical; 13 reader boundary cases identical to the first proof; reader/parser/Store files byte-identical to the first proof. FU-1758-1 and DOC-3 rows are present in the stored source but outside this parser's DEVFLOW scope Evidence: [docs/abnahme/2026-10-21/a3-native-reader.md](docs/abnahme/2026-10-21/a3-native-reader.md) | PASS (bounded); the rows of the nine-column Z1–Z4 tables are not part of this projection |
| A4 side-app restart safety | No DB write. Source proof: `dispatched` rows are not selected or released at startup or on automatic retry. PC read-only 18:25Z: 4 workers (2 archived, respawn refused), 0 development launches/runs, no update-recovery file. AgentsRoom ticket f5276c87 pending, unassigned, no board-action or ship trigger. Server: no executable job | Root disposition 18:32Z: closed within these bounds Evidence: [docs/abnahme/2026-10-21/a4-stop-safety.md](docs/abnahme/2026-10-21/a4-stop-safety.md) | Residuals: a human can manually respawn the 2 exited workers; which source commit built the installed binary 1.6.6 is UNKNOWN |
| Item 4 provenance of later model/review grants | Relayed user decisions (no exportable chat log): Root on Claude, delegated agents incl. reviewers GPT-6.1/high (order 2026-10-20 21:56Z); GPT-6 Astra allowed (~22:42Z, chat); the existing Ollama credit for reviews only, no top-up (amount not published) (relay 22:54:03Z); OpenAI context size left automatic (relay 23:12:21Z); Codex may use its full weekly quota | — | stated with limits: "about" times are Root's reading of the chat |
| Item 4 context/slot snapshot | Start files at `origin/main`: AGENTS.md 30,665 B, CLAUDE.md 3,310 B, STAND.md 3,155 B, PLAN 245,849 B at `47ddbebc` (read in parts). Memory `lage-jetzt` had regrown to ~42k chars; trimmed to ~4.1k chars at 20:31Z, the full previous text kept byte-for-byte as a backup; `user-standing-permissions` (21,055 B) not trimmed | Token count UNKNOWN (no instrumentation). Server 4/12 slots busy at 18:09Z; PC 1.4 GB free RAM at 18:09Z, so no PC builds | stated; permissions note still long |
