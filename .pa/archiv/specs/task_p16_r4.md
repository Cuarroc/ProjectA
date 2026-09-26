# Phase 16 / R4 — Review Sicherheit (read-only)

Status: historisch

Repository: `<repo-root>`, branch `main`. Work in the repo root.

This spec is deliberately self-contained: assume no shared project memory and no
prior context.

## You change NOTHING

No production code, no tests, no formatting, no commit, no push. Your only write is
your report at `.pa/review_p16_r4.md`. Found a one-line fix? **Do not apply it** —
describe it. The coordinator triages and dispatches.

Do **not** run `cargo test`, `cargo build` or `cargo clippy`: only one worker at a
time may compile in this phase, and it is not you. `npm run typecheck` / `npm run
build` are fine if you need them.

## Context you need

ProjectA is a Tauri desktop app that supervises CLI coding agents. Relevant recent
machinery, all in `src-tauri/src/`:

- `learnings.rs` — after a finished agent run, a critic distils short "learnings".
  A human approves them, and an approved learning is **appended to `PLAYBOOK.md`** in
  the project root. An excerpt of that file is then **prepended to the task prompt of
  every new agent**, between the literal markers `--- PROJEKT-PLAYBOOK ---` and
  `--- TASK ---`.
- `roles.rs` — three approved learnings on one pattern propose a "role variant" whose
  `system_prompt_addition` is, after human approval, **injected into an agent's system
  prompt** via `workers.rs`.
- `critic.rs` / `oneshot.rs` — run a headless `claude` CLI over a bundled skill and
  parse its stdout.
- `api.rs` — HTTP API with a token check. `web_interface.rs` — renders Markdown.

## What to look for

### 1. Prompt injection (the core question)

Text flows from an agent's own output into a *later* agent's instructions:

    agent output -> critic -> learning -> [human approve] -> PLAYBOOK.md
                 -> playbook excerpt -> next agent's prompt

and similarly into a role variant's system prompt. Trace that path concretely and
ask:

- Can learning text contain the marker strings `--- PROJEKT-PLAYBOOK ---` or
  `--- TASK ---` and thereby forge a section boundary, so that attacker-controlled
  text appears to be the *task* rather than the playbook?
- Can it break out of the `## Allgemein` / `## Profil: <id>` Markdown section
  structure in `PLAYBOOK.md` — e.g. by containing its own `## ` heading — and so
  land in a section it was never approved for?
- Does the human review actually see what will be injected, or can the stored text
  differ from what was shown?
- Same questions for `system_prompt_addition` in a role variant.

Judge severity honestly: a human approves each learning, which is a real mitigation.
Say where that mitigation holds and where it does not.

### 2. Markdown rendering / XSS

Commit `365b75d` fixed an XSS by introducing an allow-list in the Markdown renderer.
Find that renderer (start at `web_interface.rs`) and check the fix is still intact and
has not been regressed or bypassed since — attribute injection, `javascript:` URLs,
nested/malformed tags, raw HTML passthrough.

### 3. API token handling

- Where does the token come from, how is it stored, and is it ever logged, echoed in
  an error, or written to a file?
- Is the check applied to every mutating route?
- Comparison timing.

### 4. SQL

Every query in `store.rs` must bind its parameters. Look for any place a value is
formatted into a query string instead. Note that some `SELECT` column lists *are*
built by string interpolation from a constant — that is fine; what matters is whether
any **value** ever reaches SQL unbound.

### 5. Process and file handling

Child processes with a timeout (`testgate.rs`, `oneshot.rs`), temp directories, and
per-worker files under the app data dir: anything world-writable, predictable enough
to be pre-created by another user, or left behind with secrets in it?

## Finding format (required)

Per finding:

- **File:line**
- **Severity**: critical / high / medium / low
- **Evidence**: a code excerpt or a reproducible sequence. No claim without proof —
  otherwise write "uncertain, because ...".
- **Suggestion**: what you would change.

**No suggestions without a finding.** Do not pad the report with generic security
advice that is not tied to a location in this code. Sort by severity.

Be calibrated: this is a local single-user desktop app that deliberately runs coding
agents with broad permissions. "An agent can run code" is the product, not a
vulnerability. What matters is a boundary that is *claimed* and does not hold —
above all the human review step between an agent's output and a future agent's
instructions.

## Delivery

1. Write `.pa/review_p16_r4.md`.
2. Also report in prose in your `worker_done`: the most important findings in three
   sentences, plus a count per severity.

No commit, no push. Do not use a blocking `orca orchestration ask` and do not poll
`orca orchestration check` — message delivery is broken in this run. The coordinator
reaches you through your terminal. For questions use
`orca orchestration send --type escalation`.
