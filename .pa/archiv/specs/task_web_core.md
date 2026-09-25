# Phase 8: Web-Interface (localhost) — Core

Status: historisch

Repo: `<repo-root>`, Branch `main`. FILE OWNERSHIP: NUR `src-tauri/**`. Ein paralleler Worker besitzt `src/**`. Nicht committen.

## Ziel

ProjectA startet einen lokalen HTTP-Server, der die Landing Pages aller Projekte über `http://localhost:<port>` im Browser erreichbar macht. Nur localhost, kein Auth nötig (Bindung an 127.0.0.1).

## IMPLEMENT

1. `src-tauri/src/web_interface.rs` (neu):
   - `pub struct WebInterfaceState` mit `port: u16`, `shutdown_tx: Option<oneshot::Sender<()>>`.
   - `pub fn start_web_interface(store: Arc<Store>, port: u16) -> Result<u16, String>`:
     - Bindet `127.0.0.1:<port>`; wenn Port 0, vom OS zuweisen lassen, gewählten Port zurückgeben.
     - Startet einen Thread mit `std::net::TcpListener` (Muster wie `api.rs`, aber simpler — kein Token).
     - Jede Connection parsed GET-Pfad und liefert:
       - `GET /` → HTML-Index mit Projektliste (Name + Link zu `/project/<id>`).
       - `GET /project/<id>` → gerenderte Landing Page des Projekts:
         - Projektname als `<h1>`, repoPath als kleiner Link, dann `landing_page_markdown` durch `render_markdown` in HTML.
         - Falls kein Markdown hinterlegt: Hinweis, dass die Seite im Design-Studio bearbeitet wird.
       - `GET /health` → `{"ok": true}`.
       - Sonst → 404 Plain-Text.
     - Header: `Content-Type: text/html; charset=utf-8` (bzw. `application/json` für `/health`).
     - Shutdown über `tokio::sync::oneshot`: Sender im State gespeichert; `stop_web_interface` sendet Signal, Loop beendet sich nach `accept()`-Timeout (max 200 ms) oder dem nächsten Request.
   - `pub fn stop_web_interface(state: &mut WebInterfaceState) -> Result<(), String>`.
   - `pub fn web_interface_status(state: &WebInterfaceState) -> Option<u16>` (aktiver Port oder `None`).
   - Minimaler Markdown→HTML-Renderer in der gleichen Datei oder `src-tauri/src/markdown.rs`: Unterstützt `#`, `##`, `###`, Leerzeilen→`<p>`, `**bold**`, `*italic*`, `- ` Listen, `[text](url)`, Zeilenumbrüche. Keine externe Dependency.

2. `src-tauri/src/store.rs`:
   - Falls nötig, `get_project` für `/project/<id>` nutzen. Bereits vorhanden.
   - Stelle sicher, dass `list_projects` den neuen `landing_page_markdown`-Wert zurückgibt (wurde vom Design-Studio-Worker hinzugefügt).

3. `src-tauri/src/main.rs`:
   - Tauri-State: `WebInterfaceState` als `Mutex<WebInterfaceState>` initialisieren.
   - Commands:
     - `start_web_interface(port: u16) -> Result<u16, String>`
     - `stop_web_interface() -> Result<(), String>`
     - `web_interface_status() -> Option<u16>`
   - In `generate_handler!` eintragen.

4. Tests:
   - Markdown-Renderer in Rust testen (alle genannten Elemente).
   - `WebInterfaceState` Round-Trip (start → status → stop → status None), ohne echten Port-Check oder mit `port: 0`.
   - API-Route-Test optional (nur wenn einfach machbar ohne Threading-Flakiness).

## VERIFY

```bash
cd src-tauri && CARGO_BUILD_JOBS=2 cargo test && CARGO_BUILD_JOBS=2 cargo clippy --all-targets -- -D warnings && CARGO_BUILD_JOBS=2 cargo build
```

---
ORCA-LIFECYCLE: Du bist Orca-Worker. Task-ID und Dispatch-ID werden dir mitgeteilt. Bei Fertigstellung (alle Checks grün) GENAU EINMAL:
`orca orchestration send --type worker_done --subject "Phase 8 web core done" --body "<3 Sätze>" --task-id <TASK_ID> --dispatch-id <DISPATCH_ID> --outcome succeeded --json`. Bei Blockern: `orca orchestration ask --question "<frage>" --json`. Danach idle.
