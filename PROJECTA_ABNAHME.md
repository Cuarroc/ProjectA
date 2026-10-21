# PROJECTA_ABNAHME — documentation rework and side-app stop (DOC-9)

Acceptance report for the order "ProjectA – Zusatz-App stoppen, Dokumentation
und Arbeitsweise verbessern" (received 2026-10-20 21:57Z), section 6. Written by
Root (orchestrator) for external review. All times UTC. Every value names its
source; "reported" means an author/reviewer claim that Root did not observe
itself. Missing measurements are marked **OPEN**. This report does not accept
itself: it lists evidence for an independent reader.

Final measured state: `origin/main` @ `a8357d0c` (2026-10-21 16:42Z).

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
| Native reader on final main not executed | precondition only (size) | Stabschef | run `development_plan` cargo tests on server | reader check | PC build budget |
| DOC-3 remainder (v2 plan beyond DOC-3a) | plan still 154 kB | Stabschef | slice after DOC-9 | DOC-3 | sequenced after DOC-1b |
| Memory notes regrew (31633 → 56088 B) | larger start context again | Root/Stabschef | trim `lage-jetzt` / permissions appends | DOC-5 follow-up | normal operation adds text |
| FU-2A-SUFFIX, FU-2C-CONCEAL (tier A), FU-1772-GLOB | pre-existing MEDIUMs, gate usability | Stabschef | dispatch after merges | own reviews | new packages |
| FU-1758-1 roadmap fetch evidence | roadmap freshness wording | Stabschef | dispatch after DOC-9 | own review | blocked by DOC-9 |
| Side app: 4 `dispatched` rows, orphan daemon, project registration | small; nothing runs | Elias (delete) / Root | read-only re-check | §1 | deletion needs Elias |
| HQ snapshot run after rework | DevHQ data may be stale | Root | `npm run hq` on main | — | not run |
