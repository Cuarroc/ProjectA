# Task P20: Phase 20 — Statistik-Tab

Status: historisch

Du bist ein Entwicklungs-Worker auf einem Linux-Server. Repo:
`/home/worker/wt/p20` (Branch `kimi/p20`, aktuelles main). NUR dieser
Worktree/Branch. NIEMALS main, niemals force-push.

## Kontext

ProjectA (Tauri 2, Rust-Kern `src-tauri/src/`, React `src/`). Auf main liegen
bereits: Budget/Stuck/Digest (Phase 18), der env-Routing-Funnel (19 T1+T2) und
das Usage-Ledger `usage_events` (19 T3, Tabelle + Poll-Thread). Der Digest
(Phase 18 C) nutzt `stats.rs` als gemeinsame Aggregations-Schicht, falls die
Phase-18-Arbeit das schon so angelegt hat — prüfe `digest.rs` und baue darauf
auf statt parallel zu aggregieren.

- Plan: `docs/superpowers/plans/2026-08-27-statistik-tab.md` (verbindlich, lesen).

## S1 — Core

- Neue Tabelle `sessions (id, worker_id, started_at, ended_at, exit_code)`,
  geschrieben aus `Store::bind_session` und `mark_session_exited`
  (Migration per STATEMENTS-Append).
- Neues Modul `src-tauri/src/stats.rs` mit reinen Funktionen:
  `project_overview`, `token_usage` (liest `usage_events` als Option —
  fehlende/leere Tabelle ist kein Fehler), `session_stats`,
  `activity_timeline`, `completion_estimate` (dokumentierte Gewichtungs-Matrix).
- Tauri-Command `get_project_stats` (in `main.rs` registrieren),
  API `GET /api/projects/<id>/stats`, CLI `pa stats`.

## S2 — UI

- `StatisticsView.tsx` + ViewBar-Segment (`ViewBar.tsx`, `types.ts` MainView).
- Kacheln: Token, Sessions, Fertigstellung, Aktivität; 10-s-Polling.
- Ehrlichkeit: „nicht gemessen" statt erfundener Token-Zahlen, wenn
  `usage_events` leer ist.

## S3 — Doku + Gates

- README-Abschnitt Statistik-Tab; Roadmap-Zeile 20 als done markieren.
- KEINE Änderungen an STATUS.md/HANDOVER.md (macht der Koordinator).

## Regeln

- TDD für die reinen Funktionen (Fixtures über TempDir-Store).
- Gates VOR Push: `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `cargo build` (`src-tauri/`, cargo unter `~/.cargo/bin`,
  TMPDIR=/home/worker/testtmp); `npm install && npm run typecheck &&
  npm run build` (Repo-Root).
- Commit-Messages: Englisch, konventionell; pro Stufe (S1/S2/S3) ein Commit.
- Bericht `.pa/report_p20.md` im Worktree, dann `git push origin kimi/p20`.
