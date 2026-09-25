# Task P18: Phase 18 — Budget-Stop + Stuck-Diagnose + Daily Digest

Status: historisch

Du bist ein Entwicklungs-Worker auf einem Linux-Server. Repo: `/root/wt/p18`
(Branch `kimi/p18`, aktuelles main). NUR dieser Worktree/Branch. NIEMALS
main, niemals force-push.

## Kontext

ProjectA (Tauri 2, Rust-Kern `src-tauri/src/`, React `src/`) orchestriert
KI-Agenten. Phase 18 baut das Budget-Block-Modell, das Phase 19 (OmniRoute-
Failover) später über `quota.is_blocked` liest — die Schnittstellen sauber
halten.

- Plan (verbindlich): `docs/superpowers/plans/2026-08-27-budget-stuck-digest.md`
- Handover: `HANDOVER.md` (Phase-16-Stand, Fehler-Vokabular aus Batch E in
  `workers.rs`, async-Dispatcher-Muster aus Batch A in `queue.rs`)

## Feature A — Budget-Stop

- Settings-Keys `budget.<profile_id>.five_hour_pct` / `.seven_day_pct`
  (`get_setting`/`set_setting` in `store.rs`).
- Neues Modul `src-tauri/src/budget.rs`: `BudgetWatcher { store, engine, quota }`,
  `check_once(now)` rein testbar; liest `engine.provider_usage(profile_id)`;
  bei Überschreitung `quota.note_blocked(...)` (Dispatcher skippt dann schon,
  `queue.rs`).
- Laufende Worker pausieren: `Store::take_session` + `AgentControl::kill`,
  neue Spalte `paused_reason TEXT` via `add_missing_column`
  (`WORKER_COLUMNS`, `insert_worker`, `into_worker` mitziehen); Rückweg über
  `respawn_worker`.
- Events: `record_status_event` mit neuem `SRC_BUDGET` +
  `workers::log_message`.
- Treiber-Thread `budget::start(...)` (60 s, Muster `queue.rs` Dispatcher-
  Thread), Start in `.setup` nach `init_quota` (`main.rs`).
- CLI `pa budget list|set` (`pa.rs`), API `GET/PUT /api/budgets` (`api.rs`),
  UI: `UsageView.tsx` Budget-Zeile + `SettingsView.tsx` (nur additiv).

## Feature B — Stuck-Diagnose

- Thread `stuck::start` (60 s): `git status --porcelain=v1 -uno` +
  `rev-parse HEAD` je Running-Worker via `spawn_blocking`;
  `engine.note_git_activity(worker_id, fingerprint)`; neue Felder
  `last_git_change` im `WorkerState`.
- `STUCK_AFTER` (Default 10 min, Setting `stuck.after_minutes`) in `tick_at`
  → `needs_you` mit deutschem Grundtext.
- Exit-ohne-Ergebnis: `mark_session_exited` — Git-Fingerprint seit Spawn
  unverändert → MSG_SYSTEM + Event.
- Kein UI nötig (`BoardView.tsx` zeigt `attention_reason` schon). Tests
  deterministisch über das `tick_at`-Muster.

## Feature C — Daily Digest

- Neues Modul `src-tauri/src/digest.rs`: Thread stündlich, schreibt
  `<repo>/.pa/memory/digests/YYYY-MM-DD.md` (Marker gegen Doppel-Läufe,
  atomar tmp+rename); `render_digest(...)` rein getestet. Quellen:
  `engine.board()`, `status_events`, `list_messages`,
  `QuotaTracker::snapshot`.
- API `GET /api/projects/<id>/digests[/<date>]`, `pa digest list|show`,
  Setting `digest.enabled`. UI: ein simpler Button/View reicht (fetch-on-view).

## CCUI2-Ergänzungen (aus dem Plan, gleiche Phase)

- Atomare Budget-Reservation im Enqueue (Dispatcher).
- `preflight.rs` mit Fingerprint+TTL vor dem Spawn.
- Whitespace-sichere Chunking-Regel, falls roher Output persistiert wird.

## Regeln

- TDD wo sinnvoll; pro Feature eigene Commits (A, B, C, CCUI2), Englisch,
  erklärend.
- Gates vor Push: `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `cargo build` (`src-tauri/`, cargo unter `~/.cargo/bin`);
  `npm install && npm run typecheck && npm run build` (Repo-Root).
- Bericht `.pa/report_p18.md` + Kopie nach `/root/logs/p18-report.md`,
  dann `git push origin kimi/p18`.
- API-Routen-Fehler: 4xx für Aufrufer-Fehler (Batch-B-Idiom), nicht 500.
- Kein Refactor außerhalb des Pakets.
