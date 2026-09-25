# Dev HQ

The Live workspace uses the approved B/C design with five keyboard-accessible
tabs: Übersicht, Agenten-Teams, Statistiken, Belege and System. Panels scroll
independently; changing tabs preserves form drafts. Arrow keys, Home and End
switch tabs. Existing `/` and `f` shortcuts reveal their target panel.

Teams group executable profiles. Purpose, role, effort and tools are saved as
briefing metadata; actual invocation remains controlled by command, arguments
and environment. Metadata does not automatically change provider capabilities
or runtime effort. Check the profile-file warning before expecting the app to
load an override.

Statistics offer 7/14/30-day commit windows from Git. Usage remains the actual
available ledger, not simulated historical token data. Local profiles, lessons
and repository statistics remain usable when the Control API is unavailable.

The generated pages remain safe to open directly from `index.html`. They read
the checked-in snapshot in `data.js` and never require the ProjectA process.

For the operator/agent workspace, start ProjectA first and run:

```text
npm run hq:live
```

Then open `http://127.0.0.1:4173/live.html`. The local Node server regenerates
the snapshot, serves the HQ, and proxies `/__hq/api/*` to the loopback Control
API. It reads the API descriptor locally, so the API token is not sent to the
browser. The verdict token is requested only for explicit human verdict
actions such as merging a ready worker and is held in memory by the tab.

Set `HQ_PORT` to use another local port or `PROJECTA_API_DESCRIPTOR` when
ProjectA uses a non-default app-data directory.

## Every agent uses this, not just the human

Any agent working in this repo should treat the Live view as its primary
window onto the fleet, queue, quota/budget capacity, usage, provider vault
status and open recommendations — see `AGENTS.md`'s "Pflicht: das Dev-HQ ist
dein Cockpit" section. Found a bug in the HQ itself? Log it in
`docs/dev-hq/BUGS.md` (append-only, template at the top) **and** queue a real
fix task (Human Controls → "task to queue", or `POST /api/queue`) so it
actually gets picked up — a log entry without a queued task is only an
observation.

## Agent teams

The Live view's **Agent teams** card manages custom agent profiles. Creating or
editing one writes `agents.json` next to the running ProjectA executable (the
official override file; set `PROJECTA_AGENTS_FILE` to point elsewhere). The
dispatcher calls `load_profiles()` on every sweep, so a saved profile is
spawnable without restarting the app. Queue a task against it via the profile
selector next to the queue input, or the profile's **Queue task** button.

Id rule: `lowercase-dashes` only, and a `<base>-<suffix>` id like
`claude-review` inherits that agent's capabilities (hooks, system prompt,
readiness marker). An unrelated id gets the cautious defaults. The optional
`team` field only groups profiles in the HQ; the Rust core ignores unknown
fields. Enable/disable stays with the desktop app's settings — the HQ proxy
deliberately does not write the live database.

## Setup helper

The Live view opens with a **Setup helper** that checks this machine: Node,
`node_modules`, git and the hooks path, the Control API descriptor and whether
the API actually answers, the `agents.json` location, the Rust toolchain, GTK/
WebKit dev libraries (Linux), a Chromium for the browser tests and the spec
gate. Every red or amber row carries the command that fixes it; **Copy fix
commands** collects the shell-ready ones. The same data is at
`GET /__hq/setup` for scripts.

## The desk (Live page layout)

Seven numbered sections, top to bottom: **01 What matters now** (the one paper
well: signals ranked act → watch → note, each with an "open" that jumps to the
worker, question or card), **02 Insights**, **03 Desk** (fleet, queue, review,
recommendations in the main column; attention, capacity, providers, usage,
activity in the rail), **04 Agents**, **05 Memory**, **06 Machine** (the setup
helper) and **07 Controls**. Keyboard: `/` search memory, `f` filter fleet,
`r` refresh, `?` help, `Esc` closes panels.

## Insights: whole-project time and tokens

`POST /__hq/insights` (the Live page posts its already-loaded fleet, quota,
budgets, providers, questions, queue and usage payloads) answers with:

- **Time invested** — the larger of two bases, both shown: git sittings
  (commits ≤ 90 min apart form one sitting, plus 30 min lead-up each) and
  journal sessions from `.pa/ACTIVITY.md` × 45 min. Range = min … sum.
- **Tokens consumed** — the OmniRoute usage ledger when it is reachable and
  larger; otherwise a heuristic spelled out on the figure: changed lines
  (generated files excluded) × 10 tokens × 6 read/write ratio, with a
  0.5×–2× range. The ledger, when present, is the floor.
- **Cost** — reported ledger cost, or "no ledger".
- **Change volume**, a weekday × hour heatmap of commits (UTC), and the
  ranked signals for section 01.

## Statistics

`GET /__hq/stats` (rendered under "What the numbers say") measures commits per
day for the last 14 days, authors of the last 30 days, the test surface (Rust
`#[test]` count, frontend/node test files), evidence classes from the
snapshot, spec lanes and locks, the fleet distribution and the lesson memory.

## Lessons — the known-error memory

`docs/dev-hq/lessons.json` is the checked-in memory of what broke while
developing, why, and the fix that worked. It gets better the more agents
use it, in four ways:

1. **Search before you debug.** `npm run hq:lesson -- search "<error text>"`,
   the Lessons card in Live, or the static `lessons.html` (works from the
   snapshot, no app needed). Query tokens are highlighted; sort by relevance,
   most seen, most recent or best confidence.
2. **Report back after applying a fix.** `npm run hq:lesson -- worked <id>` or
   `failed <id>` (Live: **Fix worked** / **Didn't help**). Every vote is a
   sighting, and the share of "worked" becomes the lesson's confidence. Badges:
   `new` → `recurring` (seen ≥ 3×) → `proven` (≥ 2 worked, ≥ 60 %);
   `disputed` when failures outnumber successes; `stale` when a single sighting
   is older than 90 days.
3. **Refine instead of overwrite.** `npm run hq:lesson -- refine <id> --fix "…"
   [--cause "…"] [--note "…"]` (Live: **Refine fix**) replaces the fix and keeps
   the previous one in an append-only `history`, so a wrong fix is never lost,
   only superseded.
4. **The memory comes to the error.** Live matches every worker's attention
   reason, failing test status or last error against the memory and shows the
   known fix on the fleet row (`POST /__hq/lessons/match`). **Related** lists
   neighbours by shared tags and symptom words; **Copy brief** /
   `npm run hq:lesson -- brief "<query>"` renders a markdown block
   (`GET /__hq/lessons/brief?q=`) an orchestrator can paste into a worker prompt.

Adding: `npm run hq:lesson -- add --symptom "…" --cause "…" --fix "…" --tags a,b
--source <report>` or the "Add a lesson" form. Symptom+cause pairs are
deduplicated by id, so re-adding a known lesson just counts it again. The file
is written only by the proxy, the CLI or the generator's read; commit it with
the fix it belongs to. `HQ_LESSONS_FILE` points at a different file (tests do).
