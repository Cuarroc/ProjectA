Status: historisch

Phase 7.1 frontend for ProjectA (Tauri 2 'agentic terminal', repo root <repo-root>). Existing: Sidebar (projects + QueuePanel), BoardView, WorkerPanel, NewWorkerDialog, ipc.ts. A parallel worker extends src-tauri — do NOT touch it. Do NOT git commit. FIRST read src/lib/ipc.ts, src/components/Sidebar.tsx, src/components/QueuePanel.tsx.

The Rust side is implementing IN PARALLEL (code against this contract):
- invoke('triage_repos', { projectId, urls: string[] }) -> Worker (scout session)
- invoke('create_scout', { projectId }) -> Worker
- invoke('list_recommendations', { projectId }) -> Array<{ id, projectId, title, url: string|null, rationale, effort: string|null, status: 'new'|'accepted'|'dismissed', createdAt: number }>
- invoke('set_recommendation_status', { id, status }) -> void
- invoke('accept_recommendation', { id }) -> QueueEntry (enqueues the work)

IMPLEMENT (Phase 7.1: recommendations UI + repo triage input):
1. New sidebar section "Empfehlungen" (collapsible, below QueuePanel): recommendation cards with title, verdict/rationale (truncated), effort badge, url link; actions: "Übernehmen" (accept_recommendation -> enqueues, show feedback) and "Ablehnen" (dismiss). Poll list_recommendations every 15s for the active project.
2. "Repos prüfen" input at the top of the section: textarea (one URL per line) + "Bewerten" button -> triage_repos; show the spawned scout worker as a link (focus its terminal). Also a "Scout starten" button (create_scout) for free-form research.
3. New-count badge on the section header. Empty state text. Dark minimal style, no new deps.
VERIFY: npm run typecheck, npm run build — both green.

---
ORCA-LIFECYCLE: Du bist Orca-Worker für task_bc63045c24aa, Dispatch ctx_9da3f95ebe6e. Bei Fertigstellung (typecheck + build grün) melde GENAU EINMAL: orca orchestration send --type worker_done --subject "Phase 7.1 recommendations UI done" --body "<3 Sätze>" --task-id task_bc63045c24aa --dispatch-id ctx_9da3f95ebe6e --outcome succeeded --json. Bei Blockern: orca orchestration ask --question "<frage>" --json. Danach idle.
