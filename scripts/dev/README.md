# scripts/dev

Read-only helpers for the people and agents working on ProjectA. None of them
changes repository or GitHub state. Each one keeps machine access in a single
`collect()` function with injected probes, so its test (in `scripts/lib/`) runs
without the real tools and without a network.

| Script | Command | What it answers |
|---|---|---|
| `agent-setup-check.mjs` | `npm run dev:agent-check [-- --json]` | Is this machine ready for an agent to work on ProjectA? (`docs/setup/README.md`) |
| `status-report.mjs` | `npm run dev:status [-- --out <file>]` | What is done today, what is running, what does the user decide? |

## status-report.mjs

Reads GitHub through `gh` (open PRs with checks, PRs merged today, the latest
CI runs on `main`) and prints a short German markdown overview with three
sections and at most 25 lines:

- **Fertig** — PRs merged today (local day, `Europe/Berlin` on the user's machine).
- **Läuft** — drafts (one tally line), PRs with running checks, green PRs waiting for or sitting in the merge queue.
- **Du entscheidest** — a red `main` first, then PRs with red checks, a conflict,
  the `do-not-merge` / `dequeued` label, and one line for Dependabot PRs. A
  failed `gh` call shows up here too, never silently.

Mergify's own `mergify/merge-queue/*` PRs are plumbing and are not listed.
Longer lists are cut with "… und N weitere"; titles are shortened, the reason a
PR is listed is not.

```sh
npm run dev:status                          # to stdout
npm run dev:status -- --out .pa/STATUS.md   # to a file (parent folders are created)
```

Exit code: `0` report written, `1` `gh` could not be read completely (the report
is still written and names what is missing) or the report file could not be
written (a clean error on stderr, no crash), `2` bad arguments.

It needs `gh` on `PATH` and logged in (`gh auth status`); it makes three read
calls (`gh pr list` twice, `gh run list` once) and spends no money. The test is
`scripts/lib/dev-status-report.test.mjs`, part of `npm run test:hq`.
