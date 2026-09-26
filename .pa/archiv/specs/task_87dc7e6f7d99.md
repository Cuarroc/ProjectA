Status: historisch

Phase 7.2 Rust core for ProjectA (Tauri 2 'agentic terminal', repo root <repo-root>). Existing src-tauri: pty, profiles, store, worktree, workers, status, hooks, gh, enhance, omniroute, quota, api, skills, submit_guard, queue, scout, bin/pa. FIRST read quota.rs, omniroute.rs, store.rs, main.rs. FILE OWNERSHIP: ONLY src-tauri/**. A parallel worker owns src/**. Do NOT git commit.

IMPLEMENT (Phase 7.2: provider vault + overview):
1. New src-tauri/src/providers.rs:
   - Provider registry (static): id, name, kind ('subscription'|'api_Schlüssel'|'local'), probe instructions. Providers: claude (subscription, probe: `claude --version` + auth state via `claude auth status` if it exists, else presence), codex (probe codex binary + ~/.codex/auth.json exists), opencode (probe binary + config), ollama (probe http://127.0.0.1:11434/api/version), omniroute (probe http://127.0.0.1:<omniroute-port>), kimi (probe binary), openrouter (api_Schlüssel, presence of stored Schlüssel).
   - Key vault: store API keys in app_data_dir/provider-keys.json (plain json with note; file perms best-effort). NEVER in the repo. Commands: set_provider_key(provider_id, key), delete_provider_key(provider_id), has_provider_key(provider_id) -> bool.
   - get_provider_overview() -> Vec<ProviderOverview> where ProviderOverview = { id, name, kind, connected: bool, detail: String|null (e.g. version, plan hint), quota_state: 'ok'|'blocked'|'unknown' (joined from QuotaTracker), blocked_until: number|null, omni_route_online: bool }.
   - If OmniRoute is online: write/update its provider config with the stored credentials (best effort, tolerate unknown API shape — log and continue).
2. Control API: GET /api/providers mirror. pa subcommand: `providers`.
3. Tests: registry completeness, key vault roundtrip (temp dir), overview join logic with mocked probes.
VERIFY: cargo test, cargo clippy --all-targets -- -D warnings, cargo build. All green.

---
ORCA-LIFECYCLE: Du bist Orca-Worker für task_87dc7e6f7d99, Dispatch ctx_86f4c17ccebd. Bei Fertigstellung (cargo test + clippy + build grün) melde GENAU EINMAL: orca orchestration send --type worker_done --subject "Phase 7.2 provider core done" --body "<3 Sätze>" --task-id task_87dc7e6f7d99 --dispatch-id ctx_86f4c17ccebd --outcome succeeded --json. Bei Blockern: orca orchestration ask --question "<frage>" --json. Danach idle.
