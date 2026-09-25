<div align="center">
  <img src="assets/banner.svg" alt="ProjectA — The Agentic Terminal" width="100%" />
  <br />
  <p><strong>One task is one agent in one git worktree — ProjectA runs a whole fleet of them, side by side.</strong></p>
  <p>
    <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-v1.4.1-22d3ee?style=flat-square&labelColor=0d1117" alt="Version v1.4.1" /></a>
    <img src="https://img.shields.io/badge/platform-Windows-8b949e?style=flat-square&labelColor=0d1117&logo=windows&logoColor=white" alt="Platform: Windows" />
    <img src="https://img.shields.io/badge/Tauri-2-34d399?style=flat-square&labelColor=0d1117&logo=tauri&logoColor=white" alt="Tauri 2" />
    <img src="https://img.shields.io/badge/Rust-core-a78bfa?style=flat-square&labelColor=0d1117&logo=rust&logoColor=white" alt="Rust core" />
    <img src="https://img.shields.io/badge/React_18_·_TypeScript-frontend-22d3ee?style=flat-square&labelColor=0d1117&logo=react&logoColor=white" alt="React 18 + TypeScript" />
  </p>
</div>

---

## What is ProjectA?

ProjectA is an **agentic terminal**: a Tauri 2 desktop app that runs a fleet of parallel CLI coding agents — `claude`, `kimi`, `codex`, `opencode`, `ollama` — side by side. Every task gets its own agent in its own git worktree, with its own PTY session, and every delivery into that session is verified before it counts. A live kanban board shows who is working, who is stuck and who is waiting on you; diffs are reviewed in the app and line comments land back in the agent's terminal. Coordinating agents drive the whole fleet through a token-guarded API and their own bridge CLI, `pa`.

## The fleet today — v1.4.1

| Area | What you get |
| --- | --- |
| **Terminals & fleet** | PTY sessions with xterm.js tabs and splits, git-worktree isolation per task, SQLite persistence, echo-verified task delivery |
| **Delivery guard** | Tasks, questions and `worker send` pass a delivery guard: it waits for a readiness marker, verifies the echo in the scrollback and retries Enter; only a proven delivery appears in the history, and failure leaves a system note with the next step. Folder-trust dialogs are answered automatically — for Codex, the staged start chain (hooks review) gets Enter only once the selector visibly sits on the safe option |
| **Orchestration** | Task queue with dispatcher, orchestrator and scout agents, conversation-first UI with the board as a rail, blocking decisions via `pa ask` — agents ask, you answer straight into their terminal |
| **Review & merge** | Unified diff view with line comments, merge/push pipeline with test gates, pull requests via `gh`. Pre-merge tests run in a disposable merge-candidate tree; approval binds the object IDs, the merge tree and the diff it actually saw |
| **Dev-HQ** | Machine interface HQ v1 inside the app — `pa hq runtime`, `pa hq context --project <id>` — plus the Dev-HQ website at `npm run hq:live` (port 4173): static pages generated from STAND.md and the specs (Now, Map with the package DAG, Proof with the evidence matrix, Next, Sources, Lessons) plus the Live view on the running app |
| **Prompting & learning** | Dialogic prompt sharpening — vague tasks produce questions, not guesses — skill packs per project, and a learning loop whose playbook entries require a human verdict |
| **Providers & cost** | Provider registry with encrypted key vault (DPAPI), optional OmniRoute routing with quota telemetry, per-profile budget stops |
| **Packaging & updates** | Signed NSIS installer (plus MSI) for Windows; the release builder requires signed host manifests, and auto-updates arrive over the public mirror at [Cuarroc/ProjectA-updates](https://github.com/Cuarroc/ProjectA-updates) |
| **Operations** | Runtime logs with visible panic reporting, data retention, per-project statistics, daily digests, and a read-only board you can open on your phone |

The full release history lives in the [changelog](CHANGELOG.md); what deliberately stays open is documented, with a reason per line, in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## The vision

**You steer the fleet — you don't type in it.** ProjectA is built toward a workflow where the conversation with the orchestrator is the main surface and the human spends their time on decisions, reviews and direction, while the agents handle the typing.

Continuous mode — the fleet dispatching follow-up work on its own — exists in the codebase but stays switched off, fail-closed, until its acceptance gates are proven. It is not a feature yet; it is a promise with a checklist.

## Quick start

**Requirements:** Node.js 24+, the Rust toolchain (1.89+, for crash-released journal locks) and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/). Optional, each degrading gracefully when absent: `gh` for pull-request status, a local OmniRoute on `:<omniroute-port>` for routing and quota telemetry.

```sh
npm ci
npm run dev:setup   # clone-local hooks (.githooks) + .pa/HQ-START.md — without it dev:doctor stays red
npm run tauri dev   # the desktop app — this is the real thing
```

`npm run dev` serves the UI alone on `http://localhost:1420` for styling work; the IPC commands only exist inside the Tauri runtime.

Checks: the gate list lives in exactly one place, `scripts/ci/gates.sh`. Run `bash scripts/ci/gates.sh --list` to see it and `bash scripts/ci/gates.sh lane prepush` before pushing (`lane precommit` is the fast loop the git hook runs). CI runs the same lanes on pushes to `main` and on pull requests; details in [docs/ci-lokal.md](docs/ci-lokal.md).

## For agents and Dev-HQ

Agents coordinate through the machine interface, not the HTML:

```sh
pa hq runtime                    # what the running app exposes
pa hq context --project <id>     # project context for this worktree
npm run dev:doctor -- --json     # read-only setup diagnosis
npm run dev:setup                # installs clone-local hooks (.githooks), writes .pa/HQ-START.md
npm run dev:agent-check          # is this machine ready for an agent? (--json available)
```

The human cockpit is the Dev-HQ website: `npm run hq:live`, then `http://localhost:4173`. One implementation task, one agent, one git worktree — the coordination protocol is [AGENTS.md](AGENTS.md); how each provider (Claude Code, Codex, OpenCode, Kimi Code, the Ollama reviewers) is set up is in [docs/setup/](docs/setup/README.md).

Pull requests: one PR per package, opened early as a draft and pushed after every green step; it is marked ready once report, review disposition and the `NICHT ABGEDECKT` block are in. `main` is merged through the Mergify merge queue (`.mergify.yml`, [docs/setup/mergify.md](docs/setup/mergify.md)); only the coordinator may merge by hand, as an emergency exception when the queue hangs or Mergify is down.

## Documentation

| File | What it carries |
| --- | --- |
| [CHANGELOG.md](CHANGELOG.md) | Every release, newest first |
| [AGENTS.md](AGENTS.md) | The protocol agent instances coordinate through |
| [CLAUDE.md](CLAUDE.md) | Repo guidance for Claude Code sessions |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Known limitations, each with its reason |
| [STAND.md](STAND.md) | Short: where we stand, next step, active specs |
| [STATUS.md](STATUS.md) | History of the build up to v1.4.0 |
| [TRIAGE.md](TRIAGE.md) | Closed triage of evidence findings (history) |
| [PRODUCT.md](PRODUCT.md) | Product schema of the Dev-HQ (users, purpose, principles) for design work |
| [docs/development/WORKFLOW.md](docs/development/WORKFLOW.md) | The full operating reference: architecture, releases, environment gotchas |
| [docs/dev-hq/](docs/dev-hq/) | Dev-HQ: design, bugs, lessons and the live site |
| [docs/MASTERPLAN.md](docs/MASTERPLAN.md) | Pointer only: replaced by docs/PLAN.md |
| [docs/ERLEDIGT.md](docs/ERLEDIGT.md) | Finished packages with PR and merge commit |
| [docs/PLAN.md](docs/PLAN.md) | The only plan: milestones M1–M4, parked and cut work, decision inbox |
| [docs/hilfe/](docs/hilfe/glossar.md) | Beginner help in German: glossary of 30 terms, cheat sheet of 20 commands, the `frag-mich` skill |
| [docs/setup/](docs/setup/README.md) | Agent setup per provider, reviewers, Mergify, permission proposal |
| [docs/ci-lokal.md](docs/ci-lokal.md) | Running the gate lanes locally (Windows, WSL2) |
| [docs/decisions.md](docs/decisions.md) | Dependency and architecture decisions: what, why, when to reverse |
| [docs/plugin-matrix.md](docs/plugin-matrix.md) | Tauri plugins and capabilities the app uses, and why |
| [docs/agents-json.md](docs/agents-json.md) | The `agents.json` profile format |

---

<div align="center">
  <sub>Built with Tauri 2 · Rust · React · xterm.js — and a fleet of agents.</sub>
</div>
