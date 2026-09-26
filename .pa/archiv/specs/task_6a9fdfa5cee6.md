Status: historisch

Phase 7.1 Rust core for ProjectA (Tauri 2 'agentic terminal', repo root <repo-root>). Existing src-tauri modules: pty, profiles, store, worktree, workers, status, hooks, gh, enhance, omniroute, quota, api, skills, submit_guard, queue, bin/pa. FIRST read workers.rs (create_orchestrator pattern with kind column), store.rs (migrations), api.rs, main.rs. FILE OWNERSHIP: ONLY src-tauri/**. A parallel worker owns src/**. Do NOT git commit.

IMPLEMENT (Phase 7.1: scout agent + repo triage):
1. New table recommendations (migration, tolerate existing): id TEXT PK, project_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT, rationale TEXT NOT NULL, effort TEXT, status TEXT NOT NULL DEFAULT 'new' ('new'|'accepted'|'dismissed'), created_at INTEGER NOT NULL.
2. New src-tauri/src/scout.rs:
   - create_scout(project_id) -> Worker: kind='scout', no worktree (cwd = project repo root), profile 'claude', system prompt via --append-system-prompt (German): it is a research scout for the project; it analyzes the repo and researches the internet (WebSearch/WebFetch) for libraries/repos/tools that could unlock features or optimize the project; it writes each recommendation via the control API (POST /api/recommendations) or — simpler — instruct it to append JSON lines to a file .pa-scout.jsonl in the repo root and have the app watch/ingest that file (choose the simpler robust option, document it).
   - triage_repos(project_id, urls: Vec<String>) -> Worker: spawns a scout-kind worker whose task lists the given repo URLs to evaluate: for each, fetch the repo (README), judge usefulness + feasibility for ProjectA, write one recommendation entry per repo with verdict.
   - list_recommendations(project_id) -> Vec<Recommendation>; set_recommendation_status(id, status) -> () ('accepted'/'dismissed').
   - accept_recommendation(id) -> QueueEntry: creates a task_queue entry from the recommendation (enqueues the integration work), marks recommendation 'accepted'.
3. Control API: add GET/POST /api/recommendations (+ accept endpoint) mirroring the commands, and pa subcommand `scout triage --project <id> <url...>` + `recommendations list [--project <id>]`.
4. Tests: recommendations CRUD, triage worker creation has no worktree and kind scout, accept creates queue entry and flips status, jsonl ingest parsing if you chose that route.
VERIFY: cargo test, cargo clippy --all-targets -- -D warnings, cargo build. All green.

---
ORCA-LIFECYCLE: Du bist Orca-Worker für task_6a9fdfa5cee6, Dispatch ctx_1a88e6f5fca2. Bei Fertigstellung (alle Checks grün) melde GENAU EINMAL: orca orchestration send --type worker_done --subject "Phase 7.1 scout core done" --body "<3 Sätze>" --task-id task_6a9fdfa5cee6 --dispatch-id ctx_1a88e6f5fca2 --outcome succeeded --json. Bei Blockern: orca orchestration ask --question "<frage>" --json. Danach idle.
