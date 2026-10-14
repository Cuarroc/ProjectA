# V2-SEC-0 — Threat model

Snapshot: 2026-10-13, source commit `ec656b36fa39773eb3aa2a5a38b82e42d6268fdd`.
Scope and acceptance: [plan.md](plan.md), V2-SEC-0 (line 366);
Core contract: [core.md](core.md), sections 2–6.
The release split in `docs/plan/v2.0/plan.md:9` takes precedence over older
release labels; this model also covers the deferred capabilities before activation.
This is a design and source inspection, not a penetration test or runtime verdict.
No code is changed. Proposed tests below have not been executed by this package.

## Assets, adversaries and trust boundaries

Protect human approval, project and run identity, credentials, source and customer
data, evidence integrity, configuration history, and the ability to stop work.
Assume an attacker can supply repository text, filenames, diffs, logs, agent mail,
MCP responses, webhook payloads, or a server endpoint. A compromised worker or
MCP server may deliberately request actions outside its assigned project.
Authenticated origin does not make the payload an instruction or a human decision.

Required boundaries (design, not claims of current enforcement):

- Repository, mail and tool output → model context: untrusted data with provenance.
- Model output → Core: typed proposals; Rust validates keys, values and authority.
- Human UI → approval → mutation: authenticated, scoped, fresh and single-use.
- Worker/MCP → control API/store: run identity, project, role, fence and expiry.
- Webhook → trigger → runner: integrity, freshness, bounds and explicit start policy.
- Local launcher → SSH peer → remote process: verified endpoint and bounded rights.
- Credential files/vault → consumers: least privilege; no credential in content.

The trusted computing base includes the OS account boundary, launcher, Rust
authorization and persistence, and the human approval channel. A fully compromised
OS administrator is outside this model. Same-user workers are an explicit residual
risk, not assumed isolated: `src-tauri/src/pty/agent_env.rs:27` describes the limit
of environment filtering. Git worktrees must not be treated as security sandboxes.

## Evidence vocabulary and package ownership

**Observed** means source inspected at the snapshot above, with `file:line`.
**Required** means a proposed acceptance condition, not an implemented defense.
**Hypothesis** means exploitability still needs a compiling red-first regression.
An existing test reference proves only that the test exists, not that it ran here.

Every threat row names its implementation/validation package in [plan.md](plan.md).
IDs marked **neu** are proposals only: Root must reconcile ownership and scheduling
with the canonical plan before dispatch. No scope or activation is authorized here.
V2-ARCH-0 owns the shared architecture; V2-O0 inventories the external orchestrator.
This document neither changes their files nor asserts external runtime behavior.

## Threat → measure → package → test

| ID / threat and evidence | Required measure / remaining boundary | Package ID | Test or acceptance evidence to obtain |
|---|---|---|---|
| C1 — Repo prompt injection promotes AGENTS text, filenames, PR text or logs into Core commands. Observed precedent: critic input is wrapped as data at `src-tauri/src/critic.rs:147`; that is not proof of Core enforcement. | Carry provenance and data delimiters; parse only typed proposals from an enumerated register; reject unknown keys, extra fields and invalid values at the mutation boundary. Delimiters alone do not authorize actions. | V2-CORE-1, V2-CORE-6, V2-SEC-1 | Feed hostile instructions through each input class, including forged delimiters; assert no out-of-register mutation, subprocess or credential read; invalid output fails closed. |
| C2 — Agent mail impersonates the user or another run. Observed run API rejects verdict headers and query scope overrides at `src-tauri/src/api/agent_access.rs:450`; delivery rejects unknown fields at `src-tauri/src/api/agent_access.rs:417`. These are precedents, not a Core mail implementation. | Derive sender/project/role from a verified run credential; content is a reason only. Bind reply to recipient and request; deduplicate delivery and recheck revoked/expired credentials before effects. | V2-RUN-2, V2-CORE-1, V2-SEC-1 | Mail saying “the user approved” remains a proposal; forged sender, foreign project, expired credential and repeated delivery produce no unauthorized change or duplicate start. |
| C3 — Model changes its own level, permissions, safety, deletion or release policy. Required fixed boundaries are specified at `docs/plan/v2.0/core.md:35`. | Enforce immutable action classes in Rust even if registry metadata lies; helpers propose only; user authorization remains necessary for protected actions. | V2-CORE-2, V2-B17, V2-B18, V2-SEC-1 | One negative test per protected class and self-level change, including deliberately misclassified registry entries; no protected effect through UI, CLI, API or rule mode. |
| C4 — Forged, stale or replayed approval is accepted. Observed API distinguishes API and verdict tokens at `src-tauri/src/api.rs:1419`. Possession of a broad token alone is not proof of a human decision. | Bind approval to action, project, candidate/configuration revision and expiry; consume atomically once; reject changed proposals. Core and paired devices cannot approve their own proposals. | V2-CORE-2, V2-API-K, V2-RUN-4, V2-H4, V2-SEC-1 | Missing/wrong authority, changed value/SHA, expiry, replay and two concurrent consumes are refused without effect; one valid approval applies exactly once. |
| C5 — Concurrent updates or rollback overwrite newer authorized state. Planned per-key serialization: `docs/plan/v2.0/core.md:22`. | Serialize apply and rollback against the same revision; journal state transitions atomically with the change; define crash recovery and failed rollback without silently claiming success. | V2-CORE-1, V2-CORE-3, V2-ST-K1 | Two proposals for one key, crash between persistence/effect and rollback during a waiting proposal preserve order; no lost update; journal UPDATE/DELETE attempts fail. |
| C6 — Cross-project planning or a fence change between authorization and write. Observed project check at `src-tauri/src/api/planning_access.rs:169`; separate role/scope checks and subsequent routing at `:135`, `:190`; audit follows the decision at `:63`. | Recheck the historical missing-scope claim rather than repeat it. Prove fence/role/project authorization at the write transaction; define atomic audit or explicit recoverable outcome. Race/crash exploitability remains a hypothesis. | V2-SEC-2 | Preserve `coordinator_cannot_plan_for_a_foreign_project_without_leaking_targets` (`src-tauri/src/api/tests/planning_access_tests.rs:109`); deterministic fence/revocation interleaving and crash tests must show no stale write or silently unaudited success. |
| C7 — Injection or exhaustion disables stop handling or triggers unsafe fallback. Observed local deadline constant: `src-tauri/src/estop.rs:9`; it is not a measured remote guarantee. | Keep deterministic rule/stop handling independent of model quota; deny new effects after stop; retain ownership of child processes. Never infer process exit from lease expiry or network loss. | V2-CORE-10, V2-B6b | Measure local and remote process termination within 10 s; exercise quota exhaustion, disconnected SSH and reconnect; unavailable confirmation remains explicitly unknown, never “stopped”. |
| W1 — Forged or altered webhook body triggers work. Observed HMAC/empty-key checks at `src-tauri/src/queue/webhook_sig.rs:173`; module describes pending receiver wiring at `:3`. | Verify raw bytes before parsing/routing, reject missing/malformed signatures, isolate endpoint keys and bind accepted events to the intended project/trigger. No public listener is authorized by this model. | V2-B15, V2-API-C | Existing `forged_signature_is_rejected` (`src-tauri/src/queue/webhook_sig.rs:294`) plus receiver tests: altered bytes, wrong endpoint key, malformed header and body limit never enqueue. |
| W2 — Valid webhook replay, attacker-changed delivery ID or retry after restart repeats effects. Observed replay book is bounded and in memory at `src-tauri/src/queue/webhook_sig.rs:200`, `:226`. | Choose provider-compatible authenticated freshness; persist dedupe and enqueue atomically. An unsigned delivery ID alone is insufficient; define behavior after eviction/restart and retention expiry. | V2-B15, V2-ST-C1, V2-API-C | Replay with same and changed IDs, concurrent delivery, restart and eviction produces at most one effect within the supported replay window; older events fail closed. |
| W3 — Old key remains accepted indefinitely, or webhook flood bypasses start consent. Rotation expiry is exclusive at `src-tauri/src/queue/webhook_sig.rs:192`; 6/h and dry-run contract: `docs/plan/v2.0/plan.md:141`. | Enforce 24 h overlap at receipt, bounded body/time/queue and per-trigger admission limits; dry-run has no dispatch; a valid signature never enables disabled continuous mode. | V2-B15, V2-S06a, V2-RUN-2 | Existing expiry boundary in `previous_key_rejected_25h_after_rotation` (`src-tauri/src/queue/webhook_sig.rs:348`); receiver tests for second rotation, seventh event/hour, flood, dry-run and disabled start with zero worker launches. |
| M1 — Malicious MCP tool requests merge, arbitrary execution or broader team rights. MCP register/merge prohibition is a requirement at `docs/plan/v2.0/plan.md:144`. | Validate server and tool grants at dispatch; deny merge even through aliases/wrappers; constrain server launch and tool arguments. Tool discovery and descriptions cannot grant rights. | V2-B19, V2-ST-A2, V2-B18 | Direct/aliased merge, unknown tool, excessive persona grant and changed server definition are refused; approved tool with permitted arguments succeeds within scope. |
| M2 — MCP response or shared memory poisons the next worker and exfiltrates credentials. Observed shared-memory environment mapping at `src-tauri/src/ruflo.rs:34`; this is not an MCP authorization check. | Treat retrieved memory/tool text as untrusted; keep provenance and project boundaries; resolve vault references only for authorized consumers; never place raw keys in model context, DB fields or diagnostics. | V2-B19, V2-SEC-1, V2-PRIV-1, V2-PRIV-2 | Poisoned tool result cannot alter policy or induce an unapproved call; cross-project vault reference refused; synthetic canaries absent from prompt, error, journal and export. |
| S1 — SSH impersonation/host-key substitution steals a task or credential. Pure trust check at `src-tauri/src/setupgate/ssh_trust.rs:51`; no transport wiring is claimed (`:1`). | Verify the actual connected endpoint against the approved host/port pin; unknown/changed key stops before authentication or dispatch; key rotation requires fresh human verification. | V2-B6a, V2-DOC-SRV | Existing `no_pin_is_neu_never_bekannt` (`src-tauri/src/setupgate/ssh_trust.rs:228`) plus transport test: unknown, changed or wrong-endpoint pin never launches a remote worker. |
| S2 — SSH configuration or command interpolation leaks credentials or executes extra commands. Vault-reference parser and password-field rejection at `src-tauri/src/setupgate/ssh_trust.rs:106`, `:138` are only input validation. | Use scoped vault access, no stored passwords or agent forwarding; validate remote path/arguments and avoid untrusted shell concatenation; redact errors and keep credentials off command lines. | V2-B6a, V2-B6b, V2-ST-A2 | Metacharacter/path fixtures cannot execute a sentinel command; plaintext credential input refused; inspect synthetic process arguments/environment and logs for canaries; unauthorized vault resolution fails. |
| S3 — Lost SSH connection causes duplicate workers, false completion or forged evidence. Server result contract: `docs/plan/v2.0/plan.md:132`. | Bind run identity, worktree, fence and candidate SHA across the transport; reconnect idempotently; prove exit before replacement; accept evidence only for that candidate. | V2-B6b, V2-RUN-2, V2-RUN-3, V2-B10 | Disconnect before/after remote spawn, replay completion and submit another SHA; one owned worker remains, stale evidence is rejected and stop status remains honest. |
| L1 — Descriptor-Datei unter Unix: another local user may read newly written credentials or planted links may redirect writes. Observed broad descriptor writes at `src-tauri/src/api.rs:1293` before privacy adjustment (`:1226`); permission failure is ignored at `src-tauri/src/oneshot.rs:96`. Exposure depends on directory access and umask; exploitability is unproven. | Require private directory and file before writing bytes; validate owner/type/link count on the opened handle; refuse symlinks and unsafe ancestor replacement; fail closed on permission errors without truncating another file. | V2-SEC-UNIX-1 (**neu**, proposed proof/fix), V2-SEC-0 | Retain final-mode test (`src-tauri/src/api.rs:4675`); add compiling red-first cases for permissive umask, stale loose file, planted symlink/hardlink, foreign ownership, failed chmod and replacement race. Assert target unchanged and no readable credential window. |
| L2 — Worker reads broader credentials under the same OS identity. Environment policy explicitly permits passthrough/explicit additions at `src-tauri/src/pty/agent_env.rs:220`, `:232`; documented same-user limit at `:27`. | Do not claim environment filtering is hostile-worker isolation. Scope brokered credentials; propose separate OS identity/filesystem and network restrictions before trusting hostile tools/repos. Never auto-enable weaker fallback. | V2-SEC-ISOLATION-1 (**neu**, design/proof proposal), V2-B19, V2-B6b | Under the proposed boundary, a worker cannot read a synthetic operator descriptor, another run's vault item or SSH material even with a cleared environment; unavailable isolation yields an explicit block/limitation. |
| H1 — Browser-origin attack or paired device acquires broad control. Observed HQ Host/session checks at `scripts/hq-live.mjs:60`, `:65`; planned rights at `docs/plan/v2.0/plan.md:263`. | Preserve Host/DNS-rebinding defense through proxy replacement; keep control tokens server-side; pairing is scoped/revocable and cannot start, merge or approve Core proposals. | V2-H4, V2-H6, V2-API-C | Host rebinding, missing session, revoked pairing and cross-origin writes refused; paired device can answer/stop but start, merge and approval return 403; stop latency measured. |
| P1 — CLI reads private repository content outside an app prompt filter. This limitation is explicit at `docs/plan/v2.0/plan.md:423`; passthrough values are added at `src-tauri/src/pty/agent_env.rs:226`. | Before customer execution, require an approved public test copy, consent and provider allowlist; preflight secret/PII scan and constrain later file/network access. Prompt redaction does not cover independent CLI reads. | V2-PRIV-1, V2-PRIV-2, V2-PRIV-3, V2-SEC-ISOLATION-1 (**neu**) | Synthetic secrets in content, filenames, errors and later-created files never reach a disallowed provider; “local only” records zero outbound transfers; without containment, document the remaining independent-read risk. |

## Descriptor-Datei unter Unix: bounded follow-up

L1 is a source-backed investigation request, not a reproduced vulnerability claim.
The existing final-permission test at `src-tauri/src/api.rs:4675` checks mode after
startup and after replacing a loose file; it does not observe the write interval.
Scoped descriptors use `create_new` and Unix mode `0o600` at
`src-tauri/src/api/agent_access.rs:205`, separately from the broad writer.
Do not equate these two paths or infer safety of all parent directories from them.

Proposed V2-SEC-UNIX-1 starts with an isolated temporary-directory regression,
synthetic token and controlled umask. It must establish attack preconditions and
check both creation and replacement without touching real credential files.
If reproduced, fix under a separate tier-A package; if not, record why and the
tested boundary. Root owns dispatch and the final severity decision.

## Review and activation criteria

V2-SEC-0 delivers the mapping, not the listed implementation work. Root assigns
proposed IDs and reconciles them with existing security packages; no second plan
is created. V2-SEC-2 must preserve the observed project check while testing the
separate authorization/write transactions (`src-tauri/src/api/planning_access.rs:169`,
`:190`). The historical claim “no project scope” is not a current finding.

Before Core self-application, V2-SEC-1 must exercise repo injection, agent mail,
approval bypass and every fixed boundary. A confirmed high finding requires
V2-SEC-1b, a red-first fix and independent recheck before that gate passes
(`docs/plan/v2.0/plan.md:367`). Webhook, MCP, SSH and paired-device activation each
need their mapped receiver/transport tests; pure helpers cannot satisfy them.

Counter-checks: Fable 5.1 pending; GLM review pending, both assigned by Root.
No independent review verdict is claimed by this document's author.

## NICHT ABGEDECKT

- No runtime exploit reproduction, network deployment inspection, real SSH stop
  measurement or provider/MCP call was performed for this document.
- Existing test references were inspected; proposed test cases remain obligations
  of their mapped packages. Documentation gates do not prove those defenses.
- Linux does not compile `#[cfg(windows)]` tests. Windows behavior requires the
  Windows lane in the merge queue; Unix coverage does not substitute for it.
- External orchestrator internals, actual host hardening and vault configuration
  remain outside this worktree inspection; V2-O0 owns the inventory boundary.
- Same-user hostile processes and CLI reads outside app mediation remain residual
  risks until the proposed isolation and privacy proofs are accepted.
