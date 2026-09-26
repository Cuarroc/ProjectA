# Task P17: Phase 17 W1 Teil 3 + W2 + W3 (Fern-Board)

Status: historisch

Du bist ein Entwicklungs-Worker auf einem Linux-Server. Repo: `/root/wt/p17`
(Branch `kimi/p17`, basiert auf aktuellem main). Du arbeitest NUR in diesem
Worktree, auf diesem Branch. NIEMALS main anfassen, niemals force-pushen.

## Kontext

ProjectA ist eine Tauri-2-App (Rust-Kern `src-tauri/src/`, React-Frontend
`src/`), die KI-Agenten orchestriert. Phase 17 ist das „Fern-Board": das
eingebaute Web-Interface (`src-tauri/src/web_interface.rs`) soll das
Kanban-Board und die Learnings read-only aufs Handy bringen.

- Plan: `docs/superpowers/plans/2026-08-27-fern-board.md` (lesen!)
- Handover-Kontext: `HANDOVER.md` Punkt 3
- W1 Teile 1+2 sind FERTIG auf main: Token-Gate (`authorized()`,
  Setting `web_interface.token`) und die vier Routen `/board`, `/board.json`,
  `/project/<id>/board`, `/project/<id>/learnings` — getestet gegen das
  Fake-Backend-Muster (`FakeBoard` in den Tests).

## Die exakte Lücke (W1 Teil 3)

Das Trait `LandingPages` (`web_interface.rs:94`) ist nicht `pub`, und
`impl LandingPages for Store` (`web_interface.rs:125`) überschreibt nur
`projects`/`project`/`access_token` — `board()` und `learnings()` bleiben auf
dem Default `None`, also antworten die Board-Routen produktiv mit 404 (der
Test `a_backend_without_board_data_has_no_board_routes` belegt das).

Zu tun:

1. **Neuer `BoardBackend`** `{ store: Arc<Store>, engine: Arc<StatusEngine> }`,
   der `LandingPages` voll implementiert:
   - `board(project_id)`: `block_on(store.list_workers(project_id))` →
     `engine.board(&workers)` → Mapping auf `BoardRow` (Felder siehe
     `web_interface.rs:61-73`; `age_seconds` aus `worker.created_at`).
     Projektnamen aus `store.list_projects()`. Projekt-übergreifendes
     `/board` = UNION über alle Projekte.
   - `learnings(project_id)`: `block_on(store.list_learnings(Some(project_id), None))`,
     pending zuerst (`LEARNING_PENDING`/`APPROVED`/`REJECTED` in `store.rs`).
2. **Signatur:** `start_web_interface` bekommt Zugriff auf die
   `Arc<StatusEngine>` (Tauri-Command in `main.rs:525-536` bekommt
   `engine: State<'_, Arc<StatusEngine>>` und baut den `BoardBackend`).
   `spawn_server` nimmt schon `Arc<dyn LandingPages>` — Trait ggf. `pub`
   machen. Die App-Verdrahtung in `main.rs` (Setup-Kette) entsprechend.
3. **`web_interface.bind`-Setting** (Default `127.0.0.1`, `0.0.0.0` für WLAN)
   — `spawn_server` bindet aktuell hart auf `Ipv4Addr::LOCALHOST`. Setting
   lesen wie `web_interface.token` es tut.
4. **Tests:** echte Integration gegen `TempDir`-Store + `StatusEngine::default()`
   — ein Worker erscheint auf `/board.json` mit Spalte und ggf.
   `attention_reason`; Learnings pending-zuerst über die echte Route.
   Das Fake-Backend-Muster bleibt bestehen.

## W2 (Phone-Frontend) und W3 (Wiring/Doku)

- W2: Board-Seite handy-tauglich — Viewport-Meta, Cards unter 700 px,
  Auto-Refresh (30 s, Mini-Fetch auf `/board.json` oder Meta-Refresh),
  Leerzustände. Alles inline im eingebetteten Stylesheet (`html_document`).
- W3: `WebInterfacePanel.tsx` verlinkt `/board`; README-Abschnitt Fern-Board
  (Token setzen, bind, URL am Handy). KEINE Änderungen an STATUS.md/HANDOVER.md
  — das macht der Koordinator.

## Regeln

- TDD wo sinnvoll; jeder neue Pfad hat einen Test, der vorher rot war.
- Gates VOR dem Push, im Worktree: `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `cargo build` (in `src-tauri/`), `npm install && npm run typecheck && npm run build`
  (Repo-Root). Alle müssen Exit 0 haben. Cargo ist unter `~/.cargo/bin`.
- Commit-Messages: Englisch, konventionell, erklärend (Stil der Historie).
- Abschluss: Bericht `.pa/report_p17.md` im Worktree (was, wo, Test-Beweise,
  bekannte Grenzen) und `git push origin kimi/p17`.
- Der `.pa/`-Ordner ist gitignored — den Bericht zusätzlich nach
  `/root/logs/p17-report.md` kopieren.
- Keine Produktiv-Geheimnisse, keine neuen Dependencies ohne Kommentar im Bericht.
