Status: historisch

Phase 7.3 usage display for ProjectA (Tauri 2 'agentic terminal', repo root <repo-root>). Existing src-tauri: pty, profiles, store, worktree, workers, status, hooks, gh, enhance, omniroute, quota, api, skills, submit_guard, queue, scout, providers, bin/pa. FIRST read providers.rs, quota.rs, hooks.rs, api.rs, bin/pa.rs. FILE OWNERSHIP: src-tauri/** and src/**; if a second worker runs in parallel, split at that boundary. Do NOT git commit.

GOAL: one place that shows, for every provider this machine can reach, how much of its allowance is used right now. Phase 7.2 gives only `connected` + `quotaState` (ok/blocked/unknown) — binary, no numbers, and quota.rs derives even that from terminal-output heuristics. This task adds real numbers where a legitimate source exists, and an honest "unknown" everywhere else.

IMPLEMENT:
1. Model. Extend ProviderOverview with `usage: ProviderUsage | null` (camelCase on the wire, as in Phase 7.2). ProviderUsage = { percent: f32|null, used: String|null, limit: String|null, windowLabel: String, resetsAt: i64|null, source: 'hook'|'api'|'local'|'heuristic', observedAt: i64 }. `usage: null` means unknown — never fabricate a number, never render unknown as 0. `connected`, `quotaState` and `usage` stay independent facts, as `connected`/`quotaState` already do.

2. Sources, in descending order of confidence:
   a. claude — the statusline stdin channel. Claude Code hands its `statusLine` command a JSON payload on stdin. Extend hooks.rs `settings_json()` (line ~227) to emit a `statusLine` entry alongside the existing hooks, pointing at the same loopback receiver with a new route POST /statusline/<worker_id>. Same per-worker settings file, same port, same rule that the user's own ~/.claude/settings.json is never read or written. Expected fields — VERIFY against a live payload from a running worker BEFORE building on them: .rate_limits.five_hour.used_percentage, .rate_limits.five_hour.resets_at, .rate_limits.seven_day.{used_percentage,resets_at}, .context_window.context_window_size, .context_window.current_usage.{input_tokens,cache_creation_input_tokens,cache_read_input_tokens}, .model.display_name. If the installed Claude Code version does not send `rate_limits`, log once and leave usage null. Do not scrape the terminal as a substitute.
   b. openrouter — GET https://openrouter.ai/api/v1/key with `Authorization: Bearer <key from KeyVault>`. Response carries limit, limit_remaining, usage, usage_daily, usage_weekly, usage_monthly, is_free_tier. percent = usage/limit only when limit is non-null; when limit is null report used without a percent.
   c. ollama — local, no allowance. Report usage with source 'local' and a windowLabel saying so; this is a known answer, not an unknown one.
   d. omniroute — probe the local router (omniroute.rs DEFAULT_PORT <omniroute-port>) for a usage/stats route. If it exposes none, usage stays null. Do not invent an endpoint.
   e. codex, kimi, opencode — no known source. See step 3.

3. Research before coding 2e. Use the Phase 7.1 scout, or read the installed CLIs' own config and docs, to determine whether codex / kimi / opencode expose usage locally — a config or state file, a usage subcommand, or a documented endpoint. Write the finding into this task file. Implement only what is actually verified; where nothing is found, usage stays null and the existing heuristic quotaState remains the only signal for that provider.

4. HARD CONSTRAINTS. Do NOT read OAuth tokens from the OS keychain or from ~/.claude/.credentials.json, and do NOT call undocumented endpoints behind a spoofed User-Agent. (nilbuild/claude-statusline does exactly this as its fallback — evaluated and rejected: undocumented, breaks silently when the beta header rotates, and reaches into credentials ProjectA has no business reading.) Permitted sources are the sanctioned statusline channel and documented APIs using keys the user stored in the vault.

5. Fail-soft, per the house rule that only writes may fail. Every usage probe is bounded (reuse the 5s spawn + try_wait + kill pattern already in providers.rs); any error, timeout, 404 or HTML error page reads as usage: null. Remote calls (openrouter) are cached and refreshed no more often than ~60s. Nothing runs on the UI thread — stay off-thread as get_provider_overview already does.

6. Surfaces. GET /api/providers carries usage. `pa providers` gains a compact usage column and still never prints a key. Frontend: extend the existing ProviderDialog (src/components/ProviderDialog.tsx, opened via the status-bar plug icon since 60a8efd) — per provider row add a usage bar with percent and reset time next to the existing connected/quota display. Unknown usage renders as an em dash, never as 0%.

7. Tests: usage serialization (camelCase; null vs. present), openrouter percent math including limit=null and is_free_tier, statusline payload parse including a payload with no rate_limits, a provider with no source staying null, an api.rs integration test for the extended wire shape, and a pa render test.

VERIFY: cargo test, cargo clippy --all-targets -- -D warnings, cargo build, npm run typecheck, npm run build. All green.

CONTEXT: Phase 7.2 is complete on main — core (providers.rs, KeyVault, get_provider_overview/set_provider_key/delete_provider_key/has_provider_key, GET /api/providers, `pa providers`) at 4ba4c27, ProviderDialog UI at 60a8efd. Verified 211 lib + 17 pa tests, clippy -D warnings clean, tsc + vite build green.

---
BEFUNDE (2026-08-27, Koordinator — Schritt 1 + 3 der Spec):

1. Statusline-Payload LIVE VERIFIZIERT (Claude Code 2.1.246, echte TUI ueber
   eine --settings-Datei mit statusLine-Kommando, Payload-Kopie im
   Session-Scratchpad als statusline-payload-verified.json):
   - rate_limits.five_hour.{used_percentage: number, resets_at: unix_secs} — vorhanden
   - rate_limits.seven_day.{used_percentage, resets_at} — vorhanden
   - context_window.context_window_size — vorhanden (1000000)
   - context_window.current_usage — KANN NULL SEIN (frische Session!); zusaetzlich
     gibt es context_window.used_percentage / remaining_percentage direkt (auch nullable)
   - model.display_name — vorhanden
   Parsing defensiv halten: jedes Feld einzeln optional, fehlendes rate_limits
   -> einmal loggen, usage null.

3. Recherche codex/kimi/opencode (lokal gesichtet):
   - opencode: `opencode stats` existiert, liefert aber nur historischen
     Verbrauch (Sessions/Tokens/Kosten aus der lokalen DB), KEINE
     Kontingent-Grenze und KEIN maschinenlesbares Format (nur ASCII-Tabellen,
     kein --json). Kein Allowance-Begriff -> usage bleibt null.
   - codex: kein usage-Subcommand; ~/.codex/ enthaelt auth.json/config/
     sessions, keine dokumentierte Usage-Datei. -> usage bleibt null.
   - kimi: kein usage/quota-Flag; ~/.kimi-code/ ohne Usage-Artefakt.
     -> usage bleibt null.
   Fuer alle drei bleibt quotaState (Heuristik) das einzige Signal.
