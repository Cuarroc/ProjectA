Status: historisch

Phase 7.2 frontend for ProjectA (Tauri 2 'agentic terminal', repo root <repo-root>). Existing: Sidebar (projects, QueuePanel, RecommendationsPanel), BoardView, StatusBar (quota summary + omniroute dot), ipc.ts, dark minimal styles. A parallel worker extends src-tauri — do NOT touch it. Do NOT git commit. FIRST read src/lib/ipc.ts, src/components/StatusBar.tsx, src/components/SkillPackDialog.tsx (dialog pattern).

The Rust side is implementing IN PARALLEL (code against this contract):
- invoke('get_provider_overview') -> Array<{ id: string, name: string, kind: 'subscription'|'api_key'|'local', connected: boolean, detail: string|null, quotaState: 'ok'|'blocked'|'unknown', blockedUntil: number|null, omniRouteOnline: boolean }>
- invoke('set_provider_key', { providerId, key }) -> void
- invoke('delete_provider_key', { providerId }) -> void
- invoke('has_provider_key', { providerId }) -> boolean

IMPLEMENT (Phase 7.2: provider overview UI):
1. New "Provider" dialog (opened from a button in the StatusBar, e.g. a plug icon): lists all providers as rows: name, kind badge (Abo/API-Key/Lokal), connection dot (green connected/gray not), quota state chip, detail line, blockedUntil formatted when blocked.
2. For kind 'api_key' providers: password input + "Speichern"/"Entfernen" buttons (set_provider_key / delete_provider_key); show "Key hinterlegt" when has_provider_key (never display the key itself).
3. Header line: OmniRoute status (online/offline) + hint that stored credentials feed OmniRoute routing.
4. Refresh on open + every 30s while open; Escape/backdrop closes. Reuse the SkillPackDialog patterns. Dark minimal style.
VERIFY: npm run typecheck, npm run build — both green.

---
HINWEIS: Du bist Worker in Orca. Task-ID: task_8e052cc82e76, Dispatch: siehe deine Orca-Umgebung. Wenn fertig (typecheck + build grün), melde dich mit: orca orchestration send --type worker_done --subject "Phase 7.2 provider UI done" --body "<3 Sätze>" --task-id task_8e052cc82e76 --outcome succeeded --json — falls das fehlschlägt (capability), beende einfach deinen Turn.
