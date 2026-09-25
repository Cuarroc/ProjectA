# Task P19a: Phase 19 T1 + T2 — Routing-Funnel + OmniRoute-Profilset

Status: historisch

Du bist ein Entwicklungs-Worker auf einem Linux-Server. Repo: `/root/wt/p19a`
(Branch `kimi/p19a`, aktuelles main). NUR dieser Worktree/Branch. NIEMALS
main, niemals force-push.

## Kontext

ProjectA (Tauri 2, Rust-Kern `src-tauri/src/`, React `src/`) orchestriert
KI-Agenten. Phase 19 bindet OmniRoute (selbst-gehosteter LLM-Router, läuft auf
`127.0.0.1:<omniroute-port>` sowohl auf dem Desktop als auch via SSH-Reverse-Tunnel vom
Server aus erreichbar) als optionalen Router ein. Phase 18 (Budget/Stuck/Digest)
läuft parallel auf einem anderen Worktree — vermeide konzeptionelle Änderungen
an `queue.rs`/Block-Modell (T4 kommt später).

- Plan: `docs/superpowers/plans/2026-08-27-omniroute-optimale-nutzung.md`,
  Abschnitte T1 und T2 (lesen!).
- OmniRoute ist bereits als Probe im Kern (`src-tauri/src/omniroute.rs`),
  Key-Spiegelung existiert.

## T1 — `env` in Profilen + Routing-Funnel

- `AgentProfile` + `ProfileOverride` in `src-tauri/src/profiles.rs` um
  `#[serde(default)] env: BTreeMap<String, String>` erweitern. Merge-Logik
  der Override-Datei `agents.json` anpassen, Tests analog zu den bestehenden
  Override-Tests (`profiles.rs:313-336`).
- Neues Modul `src-tauri/src/routing.rs`:
  - `pub fn spawn_env(profile: &AgentProfile, repo_path: &Path, worker_id: &str)
    -> Vec<(String, String)>`
  - Ergebnis = `ruflo::agent_env(repo_path, worker_id)` (bestehend) **merged**
    mit `profile.env` (neu). `profile.env` überschreibt gleichnamige Keys.
- Ersetze die **vier** aktuellen Direktaufrufe von `ruflo::agent_env` in
  `src-tauri/src/workers.rs` durch `routing::spawn_env`. Finde sie per Grep:
  `ruflo::agent_env(Path::new(&project.repo_path), &worker_id)` und Varianten.
- Tests: Profil mit `env` in `agents.json` spawnt mit gesetzten Variablen
  (Test über `FakeAgents`/Fixtures wie in `workers.rs:983`); Profil ohne `env`
  verhält sich 1:1 wie heute; TempDir-Tests für `routing::spawn_env`.

## T2 — OmniRoute-Profilset ausliefern

- `agents.json`-Vorlage unter `src-tauri/resources/agents-omniroute.json`
  (oder direkt in `resources/agents.json` ergänzen, falls diese existiert —
  prüfe und entscheide dokumentiert im Bericht). Beispiel-Vorlage aus dem
  Plan:

```jsonc
[
  { "id": "claude-omni", "name": "Claude via OmniRoute (auto/coding)",
    "command": "claude",
    "args": ["--model", "auto/coding"],
    "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:<omniroute-port>",
             "ANTHROPIC_AUTH_TOKEN": "projecta-local" } },
  { "id": "codex-omni", "name": "Codex via OmniRoute (auto/cheap)",
    "command": "codex",
    "env": { "CODEX_HOME": ".pa/codex-home" } },
  { "id": "opencode-free", "name": "OpenCode free (keyless)",
    "command": "opencode",
    "args": ["-m", "oc/big-pickle"] }
]
```

- `claude-omni` muss die gleichen Capabilities wie das eingebaute `claude`
  bekommen. In `profiles.rs` gibt es eine Same-Id/Cap-Vererbung — weil
  `claude-omni` eine neue id ist, würde es sonst „cautious defaults" erhalten.
  **Entscheide und setze um:** entweder in der Vorlage vollständige `caps`
  mitliefern, ODER die Vererbungslogik so erweitern, dass `claude-omni` als
  Variante von `claude` erkannt wird (z. B. Prefix-Match). Test absichern.
- Codex braucht `CODEX_HOME` + generierte `config.toml` (`base_url`,
  `wire_api="responses"`). Schreibe diese in `routing.rs` beim Spawn in
  `<worktree>/.pa/codex-home/config.toml` (gitignored, nur wenn Profil `codex`
  und `CODEX_HOME` in env gesetzt ist).
- README/Handover: Abschnitt „OmniRoute-Profile" (Vorlage, wie zu aktivieren,
  Abo-Warnung: `claude-omni` verlässt den Claude-Abo-Pfad und läuft über
  API/Free-Provider).

## Regeln

- TDD: jede neue Funktion mit einem Test, der vorher rot war.
- Gates VOR Push: `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `cargo build` (in `src-tauri/`, cargo unter `~/.cargo/bin`); falls Frontend
  oder JSON-Resourcen angefasst: `npm install && npm run typecheck && npm run build`.
- Commit-Messages: Englisch, konventionell.
- Bericht `.pa/report_p19a.md` + Kopie nach `/root/logs/p19a-report.md`,
  dann `git push origin kimi/p19a`.
- Keine Änderungen an `queue.rs`/Dispatcher-Block-Logik (das ist T4, kommt nach
  Phase 18).
