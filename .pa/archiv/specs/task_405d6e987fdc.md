Status: historisch

Phase 6.5 for ProjectA (Tauri 2 'agentic terminal', repo root <repo-root>). Bugfix + robustness in the Rust core. FIRST read src-tauri/src/pty.rs, workers.rs, status.rs, skills.rs and main.rs. FILE OWNERSHIP: ONLY src-tauri/**. Do NOT git commit (coordinator commits after verification).

CONTEXT/BUG: When ProjectA creates a worker (create_worker) it spawns the agent CLI in a PTY, but the worker's task prompt is not reliably delivered: TUI agents (Claude Code, Codex) sometimes accept the pasted text into their input box without submitting it (we observed this repeatedly in production: prompt visible in the input line, agent never starts). Manually pressing Enter unblocks it.

IMPLEMENT:
1. Initial task delivery: on create_worker, after spawning the agent PTY, wait for TUI readiness (idle output for ~3s after first output burst, or max 30s), then write the worker's task text followed by \r into the PTY. Skip for orchestrator kind (has its own prompt flow) — or include it, your call; document the choice.
2. Submit-guard loop: after the task write, watch the session. If NO new output arrives for 15s after the write (prompt likely sitting unsubmitted), send \r again. Retry with backoff 15s/30s/60s, max 3 attempts. Log each attempt into status_events (kind 'submit_guard'). If all attempts produce no activity, set worker column to needs_you with attention_reason 'Submit fehlgeschlagen — bitte manuell Enter im Terminal'.
3. Design the guard as a small state machine (per loop-engineering patterns: explicit states IdleWatching/Retrying(n)/Delivered/Escalated), cancel it when real output arrives, on session exit, or on archive_worker.
4. Keep it profile-agnostic (works for claude, codex, any TUI). No new heavyweight dependencies.
5. Tests: the guard's decision logic as pure functions over a scripted output timeline (activity -> Delivered; silence x3 -> needs_you; output after 2nd retry -> Delivered, no 3rd retry). Use fake clocks/channels, no real PTY needed.
VERIFY: cargo test, cargo clippy --all-targets -- -D warnings, cargo build. All green.

---
ORCA-LIFECYCLE: Du bist Orca-Worker für task_405d6e987fdc, Dispatch ctx_505d468969d2. Wenn die Spec vollständig abgearbeitet ist und cargo test + clippy + build grün sind, melde GENAU EINMAL: orca orchestration send --type worker_done --subject "Phase 6.5 submit-guard done" --body "<3 Sätze: was gebaut, was gefunden, was offen>" --task-id task_405d6e987fdc --dispatch-id ctx_505d468969d2 --outcome succeeded --json. Bei Blockern: orca orchestration ask --question "<frage>" --json. Danach idle gehen.
