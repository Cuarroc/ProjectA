# Product

<!-- impeccable:product-schema 1 -->

> Scope: this file is the Impeccable product schema **for the Dev-HQ** (the
> project's own cockpit), not a description of ProjectA as a product — for
> that see `README.md`. Quotations marked *historical* cite an earlier German
> `AGENTS.md`; the current `AGENTS.md` is English and phrases these rules
> differently.

## Platform

web

## Users

Two readers, one of them not human.

**The operator (primary, single).** One expert who wrote or co-wrote the repo's
own documentation. Knows the vocabulary cold — Nahtstellen, Lanes, serial locks,
F-package IDs, the Beweismaßstab. Needs density and recall, not onboarding. No
explainers, no tooltips, no first-run guidance.

**The agents (mandated).** The earlier `AGENTS.md` (*historical*, §"Pflicht:
das Dev-HQ ist dein Cockpit") required every agent working this repo to use the
Live view as its primary window onto fleet, queue, capacity, providers and
recommendations. Today `AGENTS.md` ("Start with current evidence") names the
DevHQ website as the human cockpit and `pa hq runtime` / `pa hq context` as the
agents' path to the same backend.
**Confirmed by the operator (2026-09-09): back then, the agents almost never
actually did.** The mandate existed; the adoption did not.

**Cause established (2026-09-09, verified in source; historical finding).** The
mandated path cost four steps: know the Live server is running → fetch an HTML
page → scrape `<meta name="hq-session">`, a token minted per process by
`randomBytes(24)` (`scripts/hq-live.mjs:59`) and served only inside that HTML →
only then call `/__hq/*`, which rejected any request without it
(`hq-live.mjs:75-77`, `hq_forbidden_session`). The competing path cost one:
`pa` already exposed the same nine surfaces — `board`, `queue`, `questions`,
`quota`, `usage`, `providers`, `recommendations`, `status`, `workers` — with no
server, no token and no scraping.

The agents were not disobeying. The mandate was fighting gravity. This was a
product problem to solve with a machine-reachable path, not a compliance
failure to enforce, and no visual redesign addressed it.

**Resolved (v1.4.0, 2026-09-15).** HQ v1 now runs productively in the
installed app, and the machine-reachable path exists: agents use
`pa hq runtime` and `pa hq context --project <id>` — no HTML scraping, no
`hq-session` token (apiVersion 1; documented in `.pa/HQ-START.md` and
`AGENTS.md`). The four-step browser path remains the human cockpit; it is no
longer the agents' only door.

No other audience. Not a team tool, not a public artifact.

## Product Purpose

ProjectA is an agentic terminal: a Tauri desktop app running a fleet of parallel
CLI coding agents, one task = one agent = one git worktree. *"You steer the
fleet — you don't type in it."*

DEV-HQ is the surface for working **on the project itself** rather than in it. It
exists so neither the operator nor an agent has to re-derive state that is
already known — earlier `AGENTS.md` (*historical*): *"Ein Agent, der stattdessen manuell `pa`-Kommandos
zusammenklickt oder den Zustand errät, tut doppelte Arbeit, die das HQ schon
anzeigt."*

**Confirmed direction (operator, 2026-09-09):** the intended job is larger than
reporting. DEV-HQ should be where the operator, working *together with an AI*,
orchestrates the work — fleet, tasks, and the composition of agent teams. See
Capabilities below.

Success = the operator opens one surface, sees what is true, and acts from it;
and an agent reaches the same truth without a browser.

## Positioning

The mechanism a neighbouring dashboard could not truthfully copy: **every claim
carries its source, and the tool holds itself to the project's own evidence
standard.** Earlier `AGENTS.md` (*historical*): *"Ein Fund ohne roten Test ist
eine Behauptung. Ein Fund mit rotem Test ist eine Tatsache."* — today: "A bug
claim needs a compiling, failing regression test." Concretely — findings are typed FACT vs
CLAIM; every input file is listed with its SHA-256; estimates state their basis
and a range rather than one confident number.

Second differentiator: it encodes the repo's **collision model**. The four
Nahtstellen (`api.rs`, `main.rs`, `store.rs`, `bin/pa.rs`) may be touched by only
one worker at a time, and the HQ derives from that which spec is startable and
which is locked behind whom.

## Operating Context

- Local only, `127.0.0.1:4173`. Modern Chromium, 1280×800 and wider, local
  fonts. No SEO, no social previews, no cold visitor. Committed to git as the
  versioning mechanism, not as a publishing channel.
- Two modes: a **static snapshot** generated from `STAND.md` + `.pa/task_*.md`
  that works with no app running, and a **Live** view proxying the loopback
  Control API.
- The surrounding ritual: `STAND.md` is read first every session; gates run
  locally and in CI on pushes to `main` and on pull requests (installer
  builds only on `v*` tags), exit codes unmasked; `main` is merged by the
  Mergify merge queue; diffs over 300 lines
  or touching a Nahtstelle need two independent AI reviews with a logged
  disposition; every session appends to `.pa/ACTIVITY.md`.
- Work happens across many concurrent git worktrees with a shared stash stack.

## Capabilities and Constraints

**Today.** Seven numbered Live sections (signals · insights · desk · agents ·
memory · machine · controls) plus six static pages (Now, Proof, Map, Next,
Sources, Lessons). Ranked act/watch/note signals; fleet, queue, review,
recommendations; capacity, providers, usage, activity; a known-error memory with
a confidence ladder; an 11-check machine setup helper; whole-project time/token
estimates with stated bases.

**Confirmed target capability — agent teams as an organisation.** The operator
wants to compose named teams with designated jobs, the way a company has
departments: Review, Debug, Coding, Testing, UI/UX, Orchestrator/Manager,
Advisor, and more. Each team carries a **template**: recommended models, effort
level, skills, hooks and tools. Today's Agent-teams card is far smaller than
this — it writes agent profiles to `agents.json`, and its `team` field only
groups profiles visually while the Rust core ignores it.

**Known constraints on that ambition:**

- The app delivers skill packs only to 3 of 5 built-in providers
  (`src-tauri/resources/agent-defaults.json`: `claude` → Convention, `kimi` →
  Flag `--skills-dir`, `opencode` → ConventionAt `.agents/skills` (probe
  W1-18b, 2026-09-25: `opencode debug skill --pure` lists a canary from
  `.agents/skills`, evidence in the W1-18b PR text);
  `codex`, `ollama` → `unsupported`. Whether Codex picks up `.agents/skills`
  on its own stays open: its re-probe is deferred until the CLI rate limit
  ends (after 2026-09-30). A team template promising "skills" cannot yet
  deliver them on two providers.
- Harness properties are a Rust enum, not data. Making them configurable is
  already an accepted roadmap item (`docs/decisions.md`, 2026-09-09,
  Multi-Harness) with a spec at `.pa/task_multi_harness.md` (status
  `entwurf`). Its deferral was lifted on 2026-09-23 (`docs/PLAN.md`); the
  technical order stays F-CORE-3 → F6 → Multi-Harness. Team templates overlap
  this work and must not fork it.
- Per-project cost attribution is capped: `usage_events` has no project
  dimension and OmniRoute's ledger knows neither session nor client
  (`KNOWN_ISSUES.md` KI-5). Money cannot be honestly attributed per project.

**Hard technical constraints.** The API token never reaches the browser; the
verdict token is requested only for explicit human verdict actions and lives in
tab memory. The static path must keep working with no app running. No build
step. Served MIME types are limited to `.css .html .js .json .svg .woff2`. The
HQ must not reproduce the product UI's F2 goals or Variant B.

## Brand Commitments

Name: **Dev-HQ** (also DEV-HQ) within ProjectA. Voice: terse, evidential,
German in repo documentation and English in the HQ interface itself. No logo
beyond a typographic `HQ` mark.

## Evidence on Hand

Real, in-repo, usable as design content — nothing needs inventing:

- `docs/dev-hq/data.json` — the specs with lanes and serial owners, typed
  findings, the package DAG and a SHA-256 hash per source file (regenerated on
  every merge, so no fixed counts here).
- `docs/dev-hq/lessons.json` — real known-error entries.
- `scripts/lib/hq-visual.browser.mjs` — a realistic mock Control API (2 workers,
  queue, questions, quota, budgets, usage, providers, recommendations).
- `.pa/ACTIVITY.md` — the real session journal; `.pa/review_*.md` — real dual
  reviews.

**Absences that must not be fabricated:** no user testimonials, no benchmarks,
no pricing, no customers, no deployment claims. The lessons memory has never
received a single feedback vote, so all confidence figures are genuinely empty.

## Product Principles

1. **Every claim carries its path.** Nothing may be believable here without its
   source reachable.
2. **Uncertainty is shown, not flattened.** A range with a stated basis beats a
   confident single number.
3. **The tool obeys the standard it reports.** Unreviewed and undocumented is
   unfinished, including for the HQ itself.
4. **Reaching the truth must not require a browser.** A mandated cockpit that
   agents cannot cheaply consume has failed, however good it looks.
5. **Density over hand-holding.** One expert reader who knows the vocabulary.

## Accessibility & Inclusion

No product-specific standard is recorded in `AGENTS.md`. The enforceable floor
lives in `scripts/contrast-check.mjs` — WCAG 2.1 AA, 4.5:1 text and 3:1
non-text, both colour schemes — but it gates only `src/styles.css`; the HQ's own
stylesheet is currently ungated, has no light mode and no `prefers-contrast`
support. `prefers-reduced-motion` is honoured in both. Keyboard access is a
stated contract on the Live view (`/` `f` `r` `?` `Esc`).
