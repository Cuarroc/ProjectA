# Phase 16 / R3 — Review API + CLI (read-only)

Status: historisch

Repository: `<repo-root>`, branch `main`. Work in the repo root.

This spec is deliberately self-contained: assume no shared project memory and no
prior context. Everything you need is below or in the files named below.

## You change NOTHING

No production code, no tests, no formatting, no commit, no push. Your only write is
your report at `.pa/review_p16_r3.md`. If you find a bug you could fix in two lines:
**do not fix it** — describe it. The coordinator triages and dispatches fixes.

Do **not** run `cargo test`, `cargo build` or `cargo clippy`: only one worker at a
time may compile in this phase, and it is not you. Reading, grepping and reasoning
about the source is the whole job. If a finding would need a compiler run to be
certain, say so as an explicit uncertainty.

## What this project is (short)

ProjectA is a Tauri desktop app that supervises CLI coding agents. A Rust core
(`src-tauri/src/`) owns a SQLite store and spawns agents in git worktrees. It exposes
two external surfaces, and **those two are your scope**:

- **HTTP API** — `src-tauri/src/api.rs`. A small hand-rolled router over a
  `ControlBackend` trait. Used by the bundled CLI and by remote coordinators.
- **CLI** — `src-tauri/src/bin/pa.rs`. A hand-rolled argument parser that talks to
  that HTTP API.

Recent phases added: `learnings` (reviewed lessons appended to a `PLAYBOOK.md`),
`role_variants` (specialised agent profiles, human-approved), a task `queue`, a
`test gate`, and `recommendations` from a scout agent. All of those have routes in
`api.rs` and subcommands in `pa.rs`.

## What to look for

### `api.rs`

- **Routing**: path matching against the documented table in the module header. Are
  there routes the docs promise but the router does not serve, or vice versa? Does a
  trailing slash, an empty segment or a percent-encoded id change which arm matches?
- **Token check**: find how requests are authenticated and check it is applied to
  **every** mutating route, not most of them. Is the comparison constant-time or at
  least not obviously leaky? Can a route be reached before the check?
- **Error paths**: does a bad body produce 400 rather than a panic or a 500? Are ids
  from the path used unvalidated? Does an unknown id give a clear error?
- **Status codes and shapes**: is the response shape of each route what the CLI on
  the other side actually parses?

### `bin/pa.rs`

- **Parsing**: flags that take a value but are given none; a value that looks like a
  flag; repeated flags; unknown subcommands; arguments in an unexpected order.
  A hand-rolled parser is where off-by-one and silent-default bugs live.
- **Usage texts**: does every documented subcommand exist, and does every existing
  subcommand appear in the usage text and the module header? Recent phases added
  `learnings` and `roles` subcommands — check those especially.
- **Error output**: does a failed request print something a human can act on, or does
  it print a raw serde error? Does a non-zero exit code accompany every failure?
- **URL building**: are ids percent-encoded before being put into a path?

## Finding format (required)

Per finding:

- **File:line**
- **Severity**: critical / high / medium / low
- **Evidence**: a code excerpt or a reproducible sequence. No claim without proof —
  if you cannot prove it, write "uncertain, because ...".
- **Suggestion**: what you would change.

**No suggestions without a finding.** A list of general improvement ideas with no
concrete location is worthless for this phase. Five proven findings beat twenty
guesses. Sort by severity, most severe first. Finding nothing critical is a valid
result — say so plainly.

You were chosen as a different model on purpose: report what *you* see, including
things a Claude reviewer might consider normal for this codebase.

## Delivery

1. Write `.pa/review_p16_r3.md`.
2. Also report in prose in your `worker_done`: the most important findings in three
   sentences, plus a count per severity.

No commit, no push. Do not use a blocking `orca orchestration ask` and do not poll
`orca orchestration check` — message delivery is broken in this run and you would
wait forever. The coordinator reaches you through your terminal. For questions use
`orca orchestration send --type escalation`.
