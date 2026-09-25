# DevHQ continuous-development contract

This branch implements the configuration and durable planning foundation.
It does **not** attest a running worker, automatic scheduler, release, or update.
Runtime capability flags are authoritative; `resume` is refused until execution
acceptance exists. Existing manual workers and human verdicts are unchanged.

## Start

From the repository root:

```text
npm run dev:doctor -- --json
npm run dev:setup
npm run hq:live
```

Doctor is read-only. Setup validates `projecta.dev.json`, sets clone-local hooks
if needed, and writes `.pa/HQ-START.md` only when its content changes. It neither
installs dependencies nor starts ProjectA or providers. The defaults in the JSON
are requested policy, not evidence that its runtime stages are implemented.

The core uses `PROJECTA_AGENTS_FILE` when it is an absolute path, or
`agents.json` beside its executable when the override is unset. Invalid explicit
paths are reported and never replaced by a guessed writable location.
HQ asks the running core for that path.
Without a compatible core it shows a labelled preview; writes require an explicit
absolute override. Malformed profile files cannot be overwritten through HQ.

Built-in profiles have one versioned source:
`src-tauri/resources/agent-defaults.json`, embedded into Rust at build time and
read directly by HQ. Rebuild the core after changing these defaults. HQ compares
its normalized-LF SHA-256 with `provenance.builtinManifestSha256` from the runtime.
`defaultsSource: runtime-matched` confirms agreement; `checkout-preview` means
the running build's defaults have not been verified. This is configuration
provenance, not proof of provider availability, billing or tool execution.
Custom overrides retain Rust's replacement and longest-prefix inheritance rules.

## Machine interface

The current `pa` executable uses the local API descriptor and prints compact JSON:

```text
pa hq runtime
pa hq context --project <projectId> --cursor 0
pa hq goals list --project <projectId>
pa hq goals create --project <projectId> --objective "Result" --acceptance "Evidence"
pa hq tasks create <goalId> --objective "Bounded task" --owned src/example.ts --profile codex
pa hq control --project <projectId> --action pause
```

Endpoints are under `/api/hq/v1/`. Context includes goals, tasks, events and a
cursor. Claims/checkpoints require an owner and fencing token; owner labels are
bookkeeping under the existing API credential for the public/manual interface.
Lease expiry does not reclaim work. The internal scoped launch lane below is not exposed through public commands or an enabled scheduler.
Do not bypass a refused claim by changing the database directly.

`pause`, `drain` and `cancel` affect the new continuous planning state, not the
legacy worker dispatcher. The UI describes this boundary explicitly. No running
terminal is killed by these controls.

## Measurement

Lesson feedback requires `npm run hq:lesson -- worked <id> --run <runId>`
(or `failed`). The HTTP feedback body accepts `runId`. Repeating the same
lesson/run/outcome is idempotent; conflicting outcomes are rejected. These are
caller-supplied references, not attested execution records. The website asks for
the run reference; feedback without one is rejected. Historical counts remain.
Cross-process file writers are not serialized;
durable run-attested learning still requires the core evidence service.

`npm run dev:benchmark` lists the fixed twenty-case evaluation contract.
Supply two JSON arrays to compare measured runs:

```text
npm run dev:benchmark -- baseline.json candidate.json
```

Every case needs a unique run ID, evidence reference, measured token count,
elapsed milliseconds, acceptance, review rejections, rework and escaped
regressions. Unknown telemetry is rejected. Fixtures test the comparator only;
they do not count as task performance or provider attestation. No performance
improvement has been measured on this branch.
The comparator always retains the previous policy. A target-met result is
explicitly unverified until the core can validate run and evidence provenance.

## Pending activation gates

The approved full specification remains `.pa/task_continuous_devhq.md`.
Required before unattended operation: verified provider/model/billing adapters,
scoped credentials, root-cycle budgets, launch intent and process reconciliation,
event-driven scheduling, independent candidate-bound reviews, staged signed
delivery, coherent backup/maintenance and packaged recovery drills. A model
recommendation or configuration setting alone cannot satisfy any of these gates.

## Runtime persistence checkpoint

Run `npm run dev:continuous-audit -- --json` before considering a rollout. The
command is read-only: it combines the setup doctor with the currently reachable
runtime and emits a versioned JSON report. It exits with status 1 while either
eligibility result is false, so it can be used as a fail-closed CI/preflight
gate; `--help` prints the invocation without probing the machine. Each phase is
`ready`, `blocked`, or `unavailable`; missing provider, scheduler, review,
recovery, or benchmark attestations keep both `continuousEligible` and
`releaseEligible` false. The report also includes every blocked or unavailable
phase and attestation in `blockers`, with stable labels and duplicate reasons
removed, so a downstream agent does not mistake one early gate for the
complete diagnosis. The audit never starts ProjectA or a provider and never
changes the policy.

Rust 1.89 or newer is required for operating-system file locks that release on
process exit; `dev:doctor` checks this floor. Node remains 24 or newer.

`pa hq runs --project <id>` reads durable run/current-candidate/evidence/review records from
`GET /api/hq/v1/runs?projectId=<id>`. These are storage records, not proof that
a worker was launched or that a review has publishing authority. The response
states `executionEnabled: false` and unavailable approval authority.

Each goal root freezes its validated development policy in SQLite. Replans use
that policy and deadline even when projecta.dev.json later changes. Optional
escalation, discovery and autonomous admission limits may be tightened to zero.
The recovery journal module is not yet connected to an installer helper.

Migration 7 adds single-use launch reservations. The trusted Rust launch lane
records worker/worktree identity before creating files, then records the reserved
PTY session before starting its process. Pause, cancellation and deadline are
rechecked at that boundary. `pa hq runs` and agent context include launch records.
Native process exits are recorded for reconciliation, never treated as accepted
task completion. Startup also finds reservations without worker rows. Ordinary
respawn cannot bypass this lane. Unknown processes retain their artifacts and
block replacement launches until reconciliation establishes what happened.

The Rust API now has a scoped agent path. A trusted launcher can issue a
run/owner/fence-bound descriptor with `ApiServer::issue_run_descriptor`; no HTTP
credential-minting route exists. Set `PROJECTA_API_FILE` to that descriptor and
use `pa hq agent context`, `pa hq agent lessons`, `pa hq agent release`,
`pa hq agent candidate --input candidate.json`, `pa hq agent evidence --input
evidence.json`, or
`pa hq agent read-evidence --id <id>`. The trusted launch lane provisions a unique
descriptor outside the worktree; it never overwrites an earlier launch's file.
Credentials expire, are revocable by the launcher, and die on API restart.
Context limits evidence references to 32 and reviews to 16, with total counts.
This service scope is not an OS sandbox for same-user agent processes.

`pa hq agent lessons` returns the bounded lessons already present in the run
briefing and marks them as untrusted guidance with no instruction authority.
`pa hq agent release` returns the run's candidate/evidence/review counts plus an
explicit unavailable delivery state; a scoped worker cannot approve, publish or
promote a release.

All agent commands require a scoped descriptor. Candidate input is
`{"candidateCommit":"<commit>","source":"git rev-parse HEAD","observedAt":<unix-seconds>}`.
Evidence input is
`{"idempotencyKey":"<stable-submission-id>","source":"<observation-source>","observedAt":<unix-seconds>,"candidateCommit":"<commit>","measurement":{"state":"measured","value":<non-null-json>},"payload":<json>}`.
For unavailable measurements use `{"state":"unavailable","reason":"<reason>"}`.
Bind the candidate first; use its exact commit for evidence. Replaying a candidate
returns the original persisted source/time. Reuse an evidence key only for the
same submission. Unknown top-level input fields are rejected. Terminal runs reject writes
with HTTP 409; postmortem reads still require the current task owner/fence.

A reviewer run submits its disposition with `POST /api/hq/v1/agent/review`:
`{"idempotencyKey":"<stable-review-id>","evidenceId":"<implementer-evidence-id>","candidateCommit":"<commit>","disposition":"approved"|"changesRequested","source":"<observation-source>","observedAt":<unix-seconds>}`.
The reviewer is always the run of the scoped credential; the reviewed run is the
owner of the named evidence. The body carries no identity: `reviewerRunId`,
`runId` or any other unknown field is refused with HTTP 400 and nothing is written.
A run reviewing its own candidate, a reviewer from another project, and a reviewer
whose launch route receipt resolves to the same single model vendor as the
implementer's get 403; unknown evidence 404; evidence that is stale or not for
that candidate, and a reused key with a different payload, 409. Without launch
receipts for both runs the vendor cannot be compared: the review is stored with an
`unverified:` attestation instead of being refused. The stored review records both
principals and that attestation; it grants no approval authority
(`approvalEligible` stays false). Which runs may give a `verified` review (the
reviewer dispatch role) is decided by the store, not by this route. There is no
`pa` command for this route yet.

A missing or invalid projecta.dev.json refuses new goal roots; existing roots
retain their frozen policy. `pa hq tasks checkpoint <id> --status retry --owner
<owner> --fence <n>` requires a resolved failed run for that claim. It keeps file
scopes and counters, opens the next attempt, or terminalizes an exhausted task.
The launch lane is connected internally to the worker/PTY lifecycle, but no
scheduler or public API activates it. Verified provider routing and complete
budgets remain prerequisites. Hard-crash process identity and packaged recovery
drills remain open; a missing in-memory session is not proof of process death.

Pre-migration backups use a verified SQLite snapshot including committed WAL
frames. Recovery journals capture the previous database after maintenance blocks
writes; failures after validation but before write resumption can restore that
binary/database pair. After resumption they can only preserve and quarantine data.

The internal launcher now requires a PreparedRoute selected against the immutable
root policy and existing profile. Migration 8 retains its receipt/expiry; the
worker rechecks profile/policy/freshness before spawning and keeps the selected
model instead of applying the global product-mode overlay. Model argv translation
covers Claude, Codex, Kimi and OpenCode. Claude effort and Codex `low` have argv
translations; Codex low uses `-c model_reasoning_effort="low"`, observed in a
direct native CLI file-tool probe. This is not interactive ProjectA acceptance.
Codex profile effort overrides and named configuration overlays are refused
when low is requested; unrelated assignments (including Windows sandbox choice)
are preserved. Candidate evidence must independently attest the requested effort.
Other Codex efforts remain explicit failures until verified.
Ollama remains a helper. See `.pa/report_continuous_routing.md` for installed CLI
help/auth evidence and its limits. A route receipt records prior observations;
it does not prove which model or billing source this new run actually used.
Legacy launch rows without route receipts remain available for reconciliation,
but the consume transition refuses to start a process without a fresh receipt.
All failures after reservation, including a failed refreshed briefing read, revoke
run credentials and attempt to mark the retained launch for reconciliation.

## Structured task checkpoints

Migration 9 persists append-only checkpoints in the same SQLite database. Save
one with `pa hq agent checkpoint --input checkpoint.json`:

```json
{"idempotencyKey":"run-stable-save-1","expectedRevision":0,"completed":["Inspected the failing case"],"remaining":["Implement and verify the correction"],"failedApproaches":["Describe an attempted approach and why it failed"],"evidenceIds":[]}
```

Use the current `checkpoint.revision` from `pa hq agent context`, or zero when
there is no checkpoint. Reuse the exact input/key after an uncertain response.
Competing saves against one revision cannot overwrite each other: refresh context
after a conflict. A new save uses a new key and the latest revision. Each input
is at most 16 KiB, with at most 32 entries per list and 2048 bytes per entry.

The briefing includes only the latest checkpoint for the current task, including
a predecessor run's checkpoint. `pa hq agent read-checkpoint --revision 1` fetches
an older revision of that same task. Current run/owner/fence authority is required;
old owners cannot read after handoff. Terminal runs cannot save new checkpoints.
`pa hq runs` exposes the same latest task checkpoint and the event cursor records
each new revision. These operations never complete a task or release its claim.

Checkpoint text is agent-reported, unverified data, never policy or proof of task
completion. Evidence IDs are checked against the saving run and invalidation state
when written; a later candidate change can make those references stale. The
checkpoint preserves the original source run and recording time. Old-run evidence
payloads are not exposed through a successor's run-scoped evidence endpoint.

## Project journal changes

For project journal reconciliation, use `pa hq changes --project <id> --cursor <n>`
(`GET /api/hq/v1/changes?projectId=<id>&cursor=<n>`). It returns only events and
read metadata, without repeating goals, tasks or frozen policy/budget snapshots.
Both this route and the full context return `hasMore`. Apply each page, save its
returned cursor, and request the next page while `hasMore` is true. An empty page
retains the supplied cursor. Keep cursors per project and persist them with the
consumer's successfully applied state; retry after an interrupted response.

This reads the existing `continuous_events` journal. It does not claim every
runtime table already emits events or install a background subscriber. Full
state remains available from `hq context`. Supervisor runtime notifications and
its producer audit are described under "Durable policy supervisor". Run-scoped
credentials cannot access this project-wide route.

## Evidence and review pages

Older evidence and review records are available without enlarging the initial
briefing:

```text
pa hq agent list-evidence
pa hq agent list-evidence --cursor <nextCursor>
pa hq agent list-reviews
pa hq agent list-reviews --cursor <nextCursor>
```

The scoped GET routes are `/api/hq/v1/agent/records/evidence/start` and
`/api/hq/v1/agent/records/reviews/start`; replace `start` with the returned cursor
for another page. No run override or query parameters are accepted. Each page
contains at most 32 metadata records, a total and nullable `nextCursor`. Continue
until it is null. Fetch selected evidence payloads using `read-evidence --id`.
The current run's owner/fence and descriptor are checked on every page.

Migration 11 creates a durable insertion sequence in SQLite and transactionally
indexes subsequent records with insert triggers. A traversal fixes its upper
insertion boundary, so later/backdated arrivals do not displace records. Begin
again without a cursor to include new records. Cursors survive database reopening
and VACUUM; they identify a run and collection but are not credentials. Invalidation
is read freshly on each page: this is a bounded insertion set, not a historical
snapshot. Previously read approvals must still be revalidated before acting.
Raw review identities remain unattested and `approvalEligible` remains explicit.

## Runtime journal producers

`pa hq changes --project <id> --cursor <returned-cursor> --wait-ms 25000`
and the same API query `waitMs=25000` wait for new committed project events.
Existing pages return immediately; an empty page after timeout preserves the
cursor. Drain `hasMore` before waiting again. Only `changes` supports waiting;
0 means an immediate read, and values outside 0..25000 are rejected. The runtime
capability `journalChangesWait` advertises support and limits; older builds may
ignore unknown query parameters, so consumers must check capability first.
The pa CLI performs that check automatically for positive wait requests and
refuses unsupported or smaller advertised limits before sending the wait.

Rust lazily starts one observer shared by Store clones. It uses a dedicated
read-only SQLite connection and compares `PRAGMA data_version` on that same
connection every 250ms while consumers wait. Only a changed database version
causes a journal high-water read; a changed journal cursor or health state wakes consumers.
Healthy observers skip database probes without subscribers; failed observers
continue recovery checks. Pool closure ends the task and Store teardown aborts it.
This is deterministic database reconciliation, with no model calls. SQLite's
[data_version contract](https://www.sqlite.org/pragma.html#pragma_data_version)
also covers commits from other connections/processes. No read transaction is held
while sleeping, so the observer does not pin a WAL snapshot across waits.

The API allows eight concurrent waits within its existing 64-connection cap;
additional waits receive 503 while immediate changes and other control routes
keep their connection capacity. Authentication and project checks precede waiting;
single-run credentials cannot acquire project-wide subscriptions. Database/watch
failures return errors, never fresh empty success. Consumers retry with backoff
and retain their last cursor across outages. A deterministic service should own
repeated waits and only invoke a model for actionable work; do not use an agent
turn to poll on empty timeout pages. The background supervisor is still pending.

Migration 12 emits `development_run`, `development_candidate`,
`development_evidence`, `development_review` and `development_launch` notices
for inserted or meaningfully changed records. Each notice is committed atomically
with its record and contains JSON in `detail`: `version: 1`, `action`, `runId`
and `recordId`. Source text, evidence payloads, route settings and session details
remain behind their existing authorized reads. These are invalidation notices:
refetch current state; do not treat them as complete row deltas or approvals.
Existing journal kinds can still contain plain text.
Every inserted journal event now stamps its project's context timestamp centrally
in SQLite, including the existing checkpoint/budget producers and migration resync.
This preserves any recorded commit/run identity; freshness is not attestation.

Idempotent retries and run timestamp-only lock updates emit no new notice.
Candidate changes invalidate evidence and reviews in the same transaction and
produce notices for the affected records. Existing checkpoint and token-budget
producers remain in place. This covers current insert/update paths in those five
runtime tables; no deletion/reparenting protocol or in-process subscriber is
introduced. Future retention or ownership-move code must extend the contract.

Upgrading a project with existing runs emits one `runtime_resync` notice with
`schemaVersion: 12`. Consumers must refresh its runtime snapshot: earlier changes
were not journaled and must not be reconstructed from invented historical events.
Persist only returned cursors per project and drain `hasMore` pages before waiting.
The policy supervisor below consumes these notices. Execution scheduling and
operational acceptance remain open; waiting reads do not enable continuous mode.

## Durable policy supervisor

Schema 13 records a per-project acknowledged journal cursor and root-level
exhaustion checkpoints. The app installs one deterministic Rust background task.
It checks enabled and draining projects after journal notifications, waiting at
most 30 seconds between successful reconciliation batches. Database contention
or slow operations can delay a batch. With no eligible projects it
only scans control state every five seconds. It never enables a project, invokes
a model, starts or terminates workers, reclaims leases, merges or releases.

Each reconciliation obtains SQLite writer ownership before reading control,
cursor, frozen root policy and current run/task budgets. It drains 200-event pages
and commits its cursor together with any resulting root block and journal notice.
A failed transaction acknowledges nothing. Repeated notices, concurrent checks
and restart cannot create a second exhaustion checkpoint for the same root.

Expired deadlines, exhausted measured token allowances, exceeded total reserved
plus measured tokens, missing legacy token allowances, and failed final attempts
block the admitted root and its open descendants. A running final attempt remains
owned. Claims, scope locks, process/session identities and runs are retained for
reconciliation; expiry alone cannot authorize replacement work. Already blocked
roots receive a checkpoint without inventing an original failure cause.

The project context's `supervisor` field includes its last successful cursor/time,
last error/time, and up to 32 stored block checkpoints with explicit truncation.
Each checkpoint contains bounded task/run references, claim fences, checkpoint
revisions and recorded token balances. Read referenced records for further detail.
Caller-supplied owner/worker labels are limited to 256 characters with explicit
`claimOwnerTruncated` / `workerIdTruncated` flags; canonical records stay intact.
`recorded` is historical SQLite evidence, not a current service-health attestation.
Missing observations are `unavailable`; errors preserve the last successful cursor.
An observer failure is shown as degraded health while the authoritative store
still reconciles and acknowledges successful checks. Notifications are wake hints.
The `policyLimitSupervisor` capability explicitly reports `startsWorkers: false`.
Continuous execution, provider acceptance and automatic delivery remain disabled.

### Producer audit and runtime notifications (W2-06)

Supervisor state has exactly two Rust writers, both in `store/supervisor.rs`
and both requiring a `SupervisorAuthority` that only the background task holds:
`supervise_project` (cursor, observation, block checkpoints and the
`supervisor_blocked`, `supervisor_health` and `supervisor_audit` events) and
`supervisor_error` (last error). Other code cannot construct the authority, so it
cannot write supervisor state. SQLite itself has no writer identity: a raw SQL
write is not prevented. Only journal events are audited (below); direct writes to
the cursor table `continuous_supervisor` or the checkpoint table
`continuous_supervisor_blocks` are not detected.

Every supervisor journal entry names its producer (`policy_supervisor`) and its
authority. Block checkpoints carry `blockedBy`: the supervisor's own blocks read
`{"producer":"policy_supervisor","authority":"frozen_root_policy"}`. A root that
another producer already blocked, today token settlement in
`development_budget`, reads `{"producer":"unattested","authority":null}`; the
supervisor does not invent that cause. Health changes that used to be silent
now leave one `supervisor_health` event (`action` `degraded` or `recovered`) per
transition, without the error text. A persisting failure writes nothing more.

While draining its page the supervisor attests each `supervisor_*` event. A
`supervisor_blocked` event is attested only by a stored checkpoint with the same
project, root, reason and timestamp; health and audit events need the producer
stamp and a known action. An unattested event leads to one `supervisor_audit`
event (`finding: unattested_supervisor_event`, `eventCursor`) in the same
transaction and changes no goal. The shape check is not a signature: a forged
event with a matching stamp is not detected.

A lost checkpoint (raw SQL, a second process, a migration bug) does not turn the
supervisor's own block into a foreign one. When a blocked root has no checkpoint,
the supervisor looks at the latest `supervisor_blocked` event for that root. Only
that event counts, because an older one cannot explain the current block. It is
evidence only if all of these hold:

- it lies behind the acknowledged cursor, so an earlier pass attested it;
- it carries the producer stamp and a known reason;
- no `supervisor_audit` names it, and every audit row is readable (an
  unreadable one might have named it);
- its reason still holds now (for example the deadline is still exhausted);
- the root goal has not changed since the event (`updated_at` is not later than
  the event).

Then the checkpoint is restored from that event with the original reason,
timestamp and `restoredFromEventCursor`, and no second event, notice or audit is
written. Otherwise the rule is fail-closed: the root is recorded and announced
as `already_blocked` with `blockedBy` `unattested`. If the checkpoint vanished
before its event was attested, that event is also audited.

The restore is only tried for a root that is still blocked. If the same incident
also reset the goal to `open`, the block was lifted. The supervisor then decides
afresh and announces the new block, even if the reason is the same. The residual
risk is a raw SQL write that blocks a reopened root again without changing
`updated_at` while the old reason still holds. Such a block would be restored
as the supervisor's own. This is the same shape-check limit as for forged journal
events.

After each commit the app emits the Tauri event `supervisor:notification`
(`onSupervisorNotification` in `src/lib/ipc.ts`) once per change: `blocked`
(project, root, reason code), `degraded`, `recovered` or `audit` (finding,
event cursor). A reconciliation that changes nothing emits nothing; a rolled
back transaction emits nothing. Payloads hold ids and fixed codes only; error
text and checkpoints stay behind the authorized context read. The codes are
closed enums in Rust (`BlockReason`, `AuditFinding`). `reason` is one of
`already_blocked`, `deadline_exhausted`, `token_allowance_unavailable`,
`token_budget_exhausted` or `task_attempts_exhausted`, and `finding` is
`unattested_supervisor_event`. `onSupervisorNotification` drops any payload with
another kind or code. A reconciliation that fails is always recorded, with the
last error and a degraded health transition, including while the observer
itself is failing. The inbox does not
render them yet, and a stalled supervisor task (no pass at all) is not detected.

## Team assignments

`pa hq tasks assign <taskId> --team development --role implementer --assignee
<owner> --expected-revision 0` creates a durable assignment. Read it with
`pa hq tasks assignment <taskId>`; update it using the returned revision before
the first claim. API equivalents are GET/POST `/api/hq/v1/tasks/<id>/assignment`.
The POST body is closed-schema JSON with `teamId`, `role`, `assignee` and
`expectedRevision`. Team and role must exist in the goal's frozen policy.
Labels are trimmed, limited to 128 characters and reject control characters.

Schema14 records assignment revisions without inventing assignments for existing
tasks. `null` means unassigned. Project context task rows and scoped run briefings
read the same assignment alongside their task/claim snapshot. Assignment notices
carry task ID and revision so journal consumers can refetch authoritative state.

Assignment changes and claims serialize before reading. A different assigned
owner cannot claim the task. Once any attempt starts, assignment changes are
refused, including after a retry releases its claim; attempts and budgets are
never reset. Repeating the exact committed revision request is read-only and
returns the prior result even after claim. Failed journal writes roll back the
assignment, and stale revisions return HTTP409. Unknown fields return HTTP400.

Integrator claims share one lane across projects in the same Store. All roles
also obey the existing worker, dependency, deadline and attempt gates. This is
coordination bookkeeping: the owner label is not independently authenticated
identity, reviewer assignment is not review attestation, and integrator assignment
does not authorize merge or release. Scoped worker credentials can read their
assignment through their briefing but cannot call assignment-management routes.
The runtime capability reports `teamAssignments.approvalAuthority: false`.
Actual role-specific dispatch, independent review collection and the operational
integration/release service still require acceptance before continuous activation.

## Dependency states

The scoped run briefing also supplies `task.dependencyState` alongside the
unchanged dependency ID list. Its ordered items contain only the prerequisite ID,
stored status and update time, scoped to the current task's project. Missing or
cross-project records appear identically as `unavailable`; no prerequisite prompt,
credentials or evidence payload is exposed. All items share the briefing's SQLite
read snapshot and source timestamp. `recorded` describes database state, not a
verified review or runtime-health attestation.

`satisfied` is true only when every dependency has been included and is stored as
`completed` (also true for an empty list). The summary includes at most 64 items;
`total`, `limit` and `truncated` make omitted states explicit. A truncated, missing,
failed, cancelled or unknown dependency never produces `satisfied: true`. This is
read context, not launch authority: claims and launches still enforce their own
transactional checks. These fields reach the normal scoped API/CLI context and
the existing launch briefing through the same store method.

## Root token accounting

Migration 10 shares token capacity across a root and all replans. `projecta.dev.json`
initially limits a root to 200,000 tokens and protects 40,000 for reviews and
verification; these allocation limits are distinct from the provider's quota
reserve. Existing frozen roots without `tokens` receive no implicit allowance.
The HQ context's root policy entries and scoped run briefing include `tokens`:
recorded consumption, pending reservations, remaining capacity and `usageState`.
`measuredTokens` is only the sum of stored receipts; incomplete coverage
(`no_receipts`, `partial`) must not be presented as a complete observed cost.

Trusted services reserve before model work using `reserve_development_tokens`.
Planning, context, discovery, review and verification consume their reservation
with `start_development_tokens`; implementation binds a run and is consumed by
the existing launch transaction. Reuse allocation keys only for identical input.
Cancel only before start. `settle_development_tokens` requires final trusted
usage for nonworker operations. Workers use `settle_development_run_tokens`
with the reservation's run and exact exited session. Identity checks share the
settlement transaction and also apply to idempotent replay. A mismatched or
absent binding cannot release a worker reservation. Missing
receipts remain reserved indefinitely for reconciliation. Neither a timeout nor
a process exit implies zero consumption. Measured exhaustion or overdrawn
allocations block the root; actual overruns are recorded without hiding usage.
These writers are not exposed to agent credentials. Provider receipt collection,
supervisor integration and the unconnected streaming path still gate autonomous
operation (native capture limits: see "Native capture streaming limits").

`usageState` names why a root has no complete measurement: `no_allowance`
(frozen root without `tokens`), `no_receipts`, `partial` or `measured`.

### Per-run cost receipt and its provenance

Every run in the development records snapshot carries `usage`, its cost
receipt. It never says a bare `unavailable`; each state names its provenance:

- `measured`: the ledger settled a trusted provider receipt. `tokens`, and
  `provenance` with `source` and `observedAt`. `measurement` is `live` (with
  `collector`) only for the Codex collector's own source; any other trusted
  receipt says `trusted_receipt`. A settled row without tokens or source is
  `unclassified`, never measured.
- `rejected`: a collector exists but refused the capture, with a named
  `reason` (for example `capture is truncated before a final newline`). The
  reservation is retained; nothing settles.
- `not_reported`: no trusted collector exists for the adapter and transport.
  `reason` starts with `not reported by adapter:` and says what is missing;
  `provenance` names provider and transport. The reservation is retained.
- `pending` (not launched, still running, or an exited native Codex run whose
  capture is not committed yet), `cancelled`, `not_reserved`, and
  `unclassified` for capture results recorded before this format or stored
  unreadably.

Each receipt also carries `ledgerState` and `reservedTokens` (`null` and `0`
without a reservation). Only `measured`
settles; any other state keeps the entire reservation, as above.

Collectors per adapter (W2-03a):

| Adapter | Source | Collector |
|---|---|---|
| Codex, native `codex exec --json` | final `turn.completed` usage from process-owned stdout | `codex-exec-json-v1`, input plus output; cached and reasoning counts are checked subsets; nonzero cache-write counts are rejected |
| Codex over the interactive PTY | none | `not_reported` |
| Kimi | the PTY status line shows `context: N% (X/1M)`, i.e. context-window occupancy, not billed usage | `not_reported` |
| OpenCode | no recorded status-line bytes exist yet (only a prose smoke note) | `not_reported`; needs a `PROJECTA_PTY_TRACE_DIR` probe |
| Claude | the `statusLine` hook reports account-wide rate windows (live quota), not per-run tokens | `not_reported` |
| Ollama | no per-run collector | `not_reported` |

The native capture result stores the same receipt under `usage`, and the
`development_capture_completed` event carries its `usageState`. A capture
result committed before this format still replays unchanged: the stored
legacy body is kept, never rewritten. It has no capture digest, so that
match covers binding, exit and token total only; the ledger replay still
compares the stored digest and fails closed on different bytes. A legacy `unavailable` body shows as
`unclassified` in the run receipt.

## Discovery admission

Migration 15 persists scan reservations per project and UTC calendar day. The
trusted coordinator reserves with `reserve_discovery_scan(goal, operation_key)`
before scanning; the goal must belong to an open, admitted, unexpired root in an
enabled project. Frozen root policy bounds the count (default two, zero disables).
Descendants and replacement roots share the project's already consumed slots.
Each operation key is unique across days for that project: a repeated call is
rejected, including after a lost response or restart. Failed/abandoned scans do
not refund capacity. A backwards clock blocks new admissions until it catches up.

The existing project context exposes `discovery`: today's reserved count, the
two most recent reservations, observation time, UTC day and clock-regression
state. These are admission records; execution and usage explicitly remain
unavailable. Reservation and journal notification commit together. The module
cannot start a process, settle tokens, create a goal or enable continuous mode.
Model-assisted discovery still requires the root's separate token reservation
and a verified provider route.

W2-05 adds the deterministic store scan: `run_discovery_scan(goal, operation_key)`
reserves the permit and scans in one writer transaction. It reads up to 64 open,
unclaimed tasks of the admitted root in creation order and dispatches each ready
one to its W2-04 role (assignment, or implementer when unassigned, both checked
against the frozen root policy) within the free per-project worker slots and the
global integration lane. Others are skipped with a stable reason:
`attempts_exhausted`, `dependencies_pending`, `dependencies_unreadable`,
`role_refused`, `worker_capacity_exhausted`, `integration_capacity_exhausted`.
The result is a `discovery_dispatched` journal event committed with the permit;
a failed scan keeps no slot. Context adds `dispatchState` per recent permit and
`latestDispatch`. A dispatch is intent: nothing is claimed, launched or spawned,
`executionState` stays unavailable, and claim and launch re-validate everything.
Automatic dispatch behind `startsWorkers` (W2-06) and pre-goal discovery remain
open; no caller runs the scan yet.

## Task guidance

Scoped run context now adds `guidance` from the project's current working tree:
root and owned-path ancestor `AGENTS.md` files, plus up to four matching lessons
from `docs/dev-hq/lessons.json`. This is also included in the existing worker
launch briefing. SQLite records and files are distinct observations: guidance
has its own timestamp, per-file SHA-256 and `candidateBinding: unavailable`.
It does not claim to describe the candidate or worker worktree revision.

Rules are limited to 24 candidate files and 2,048 characters per excerpt; input
paths/depth and source files are bounded too. `fetchRequired`/`truncated` signal
when the agent must read more applicable rules before implementation. Lessons
use deterministic word overlap in task objective/paths, with symptom/tag weights
and ID tie-breaks. Hits, repeated feedback and recency do not increase confidence.
Lesson outcomes stay `unverified`; source hints are data and are never followed.
Guidance cannot expand instruction, policy, credential or approval authority.

Readers verify the opened file handle remains within the canonical project,
reject nonregular/oversized/invalid files, and run outside the SQLite transaction.
Run authority is checked again after file collection. Missing project metadata
and unreadable lessons remain explicitly unavailable. Windows and Linux have
handle-identity readers; other platforms report file identity unavailable.
Verified lesson-to-run outcome linkage remains an open acceptance item.

## Shared claim capacity

All projects using the authoritative database share a maximum of two running
continuous claims. Each project's frozen lower limit still applies. Count and
claim happen in one serialized transaction. Pausing a project, restarting the
app or expiring a lease cannot reclaim a slot; only a resolved terminal task
transition can release it. This bounds persisted claims, not arbitrary external
processes. Physical-memory admission reduces new capacity to one below2GiB or15%
available and zero below512MiB or5%; unknown/invalid readings allow at most one.
Existing claims remain held. Windows uses GlobalMemoryStatusEx; Linux uses
MemAvailable from /proc/meminfo. Context effectiveLimits.hostAdmission exposes
the live sample separately from database event timestamps. Unit tests use
explicit sensor fixtures; native collection has its own observation test.
Operational role scheduling and CPU/GPU/container resource handling remain
open; all claimed task roles count conservatively toward this ceiling.

## Native capture streaming limits

Every bounded native capture (`process_capture`, host and parent) enforces
three limits in its pipe loop: the launch deadline and two limits decided by
the pure `stream_guard` module, the output byte limit and, since W2-08a, a
no-progress window.
Output exactly at the byte limit is admitted; one byte more aborts with
`capture output exceeded byte limit`, and an overflowing total counts as over
the limit. A live process that emits no stdout/stderr byte for 15 minutes
(`NO_PROGRESS_LIMIT`; silence reaching the window exactly aborts) ends with
`capture stalled without output progress`. The parent's window over the host
is longer by `HOST_GRACE_MS`, so the host reports the provider's stall itself.
Each abort retires the whole kill-on-close job and the input writer before the
error returns, the same confirmed cleanup as the deadline; an unconfirmed
cleanup stays a reconciliation error. Output events already handed to the
observer and checkpoints already acknowledged are never withdrawn, but an
aborted capture is never a completed or delivered one. Native tests drive a
real silent fixture (stall reason, partial output observed, PID retired), a
steady trickle longer than the window (completes) and a flood over the byte
limit. The window is a code constant, not a policy or launch-protocol field;
TUI/PTY sessions are unaffected. CPU, job-memory and container limits for the
provider job are not enforced yet (W2-08b).
