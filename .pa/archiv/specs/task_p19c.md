# Task P19c: Phase 19 T4 + T5 + T6 — Failover, Free-Policy, Doku

Status: historisch

Du bist ein Entwicklungs-Worker auf einem Linux-Server. Repo: `/home/worker/wt/p19c`
(Branch `kimi/p19c`, aktuelles main). NUR dieser Worktree/Branch. NIEMALS
main, niemals force-push.

## Kontext

ProjectA (Tauri 2, Rust-Kern `src-tauri/src/`, React `src/`). Auf main sind
bereits: Phase 18 (Budget-Stop über `quota.is_blocked`, `paused_reason`),
Phase 19 T1+T2 (`routing.rs`-Funnel, `agents-omniroute.json`-Vorlage) und die
Combo-Vorlage `src-tauri/resources/omniroute-combos.json`. Parallel läuft T3
(Usage-Ledger) auf einem anderen Branch — fasse `omniroute.rs` nur für T5
minimal an und erwarte einen Merge-Konflikt dort als normal.

- Plan: `docs/superpowers/plans/2026-08-27-omniroute-optimale-nutzung.md`,
  Abschnitte T4, T5, T6 (lesen).

## T4 — Quota-/Budget-Failover im Dispatcher

- `AgentProfile` + `ProfileOverride` um `fallback: Option<String>` (Profil-id).
- `queue.rs::dispatch_project`: ist `entry.profile_id` geblockt
  (`quota.is_blocked` — deckt Quota UND Phase-18-Budget ab), durchläuft der
  Dispatcher die Fallback-Kette (max. Tiefe 2, Zyklenschutz A→B→A bricht
  sauber ab). Fallback-Spawn loggt MSG_SYSTEM
  „umgeleitet: <profil> → <fallback> (Quota)".
- Free-Profile aus T2 (`claude-omni`, `opencode-free`) sind die natürlichen
  Fallback-Ziele.
- Tests mit dem vorhandenen `FakeLauncher`-Muster in `queue.rs`:
  geblockt+fallback ⇒ Fallback spawnt; geblockt ohne fallback ⇒ bleibt
  `ready`; Zyklus ⇒ sauberer Abbruch.

## T5 — ToS-sichere Free-Policy + Provider-Übersicht

- `resources/omniroute-combos.json` existiert bereits (von einem anderen
  Worker, Combo `projecta-free`). Baue darauf auf: ProviderDialog/UsageView
  zeigen Free-Tier-Restquoten aus `/api/free-tier/summary`, hinter Auth;
  Badge „via OmniRoute" an gerouteten Profilen (Profil hat
  `ANTHROPIC_BASE_URL`/`OMNIROUTE_BASE_URL` in env).
- Degradierung: ohne Login/Token ehrlich „Login fehlt" statt erfundener Daten.

## T6 — Doku + Gates

- README-Abschnitt „OmniRoute-Routing" ergänzen (Failover-Verhalten, Whitelist,
  Abo-Warnung schon vorhanden — prüfen statt doppeln).
- `pa`-Kommandoliste + IPC-Tabelle aktualisieren, falls T4/T5 neue
  Kommandos/Commands bringen.
- KEINE Änderungen an STATUS.md/HANDOVER.md (macht der Koordinator).

## Regeln

- TDD wo sinnvoll; Dispatcher-Tests mit gesehenem Rotlauf.
- Gates VOR Push: `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `cargo build` (`src-tauri/`, cargo unter `~/.cargo/bin`,
  TMPDIR=/home/worker/testtmp falls /tmp klemmt);
  `npm install && npm run typecheck && npm run build` (Repo-Root).
- Commit-Messages: Englisch, konventionell.
- Bericht `.pa/report_p19c.md` im Worktree (reicht — Koordinator holt ihn),
  dann `git push origin kimi/p19c`.
