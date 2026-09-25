# Review: Phase-7.3-Merge auf Agent-Capabilities-Basis (Review-only)

Status: historisch

Repo-Root: `<repo-root>`, Branch `phase-7.3-usage` (HEAD = Merge-Commit).
Du bist Reviewer. **Keine Dateien aendern, kein git commit.** Findings als Prosa im Abschlussbericht.

## Hintergrund

Zwei Entwicklungslinien wurden zusammengemergt, beide vorher einzeln gruen:

1. **Agent-Capabilities** (`claude/agent-capabilities`): `AgentProfile.caps`-Deskriptor
   (`capabilities.rs`), lifecycle-getriebene Hook-Settings + `worker_file`-API (`hooks.rs`),
   Orchestrator-Systemprompt via Caps (`workers.rs`), Dialekt-Umbau (`status.rs`:
   `classify_output(&Dialect, ..)`, `StatusEngine::set_dialects`, `WorkerState.dialect`),
   Skills-Flag-Gating, enhance-Runner aus Registry.
2. **Phase 7.3 Usage-Anzeige** (`Cuarroc/usage-u1-core` + `Cuarroc/usage-u2-ui`, beide
   committed): `ProviderOverview.usage: ProviderUsage | null` (camelCase), Quellen =
   Claude-Statusline-Route (`POST /statusline/<worker_id>` in `hooks.rs`/`api.rs`),
   OpenRouter `GET /api/v1/key`, Ollama lokal, OmniRoute best-effort; `pa providers`
   Usage-Spalte; ProviderDialog mit Usage-Bars (`src/`).

Der Merge (git ort) lief **konfliktfrei** — das heisst nicht, dass er semantisch korrekt
ist. Beide Seiten haben `hooks.rs`, `status.rs`, `main.rs` angefasst. `cargo test`
(248 gruen), clippy `-D warnings`, cargo build, npm typecheck/build sind auf dem
gemergten Stand bereits gruen.

## Deine Aufgabe

1. **Merge-Stellen semantisch pruefen.** Lies die gemergten Dateien `src-tauri/src/hooks.rs`,
   `src-tauri/src/status.rs`, `src-tauri/src/main.rs`, `src-tauri/src/providers.rs`,
   `src-tauri/src/api.rs`, `src-tauri/src/bin/pa.rs` und vergleiche mit den beiden Eltern:
   `git diff claude/agent-capabilities Cuarroc/usage-u1-core -- <datei>` zeigt, was die
   7.3-Seite relativ zu unserer Basis geaendert hat (Vorsicht: zeigt auch, was die
   Capabilities-Seite relativ zur 7.3-Basis aenderte — lies den Diff richtigrum).
   Pruefe konkret:
   - `hooks.rs`: Funktionieren Statusline-Verdrahtung (7.3) und Lifecycle-Caps/worker_file
     (Capabilities) nebeneinander? Wird `settings_json` von beiden Seiten konsistent
     erweitert (kein ueberschriebener Key, keine doppelte Route)?
   - `status.rs`: Nutzt das 7.3-Usage-Parsing die neue Dialekt-Architektur korrekt
     (oder umgeht es sie versehentlich)? Greifen `classify_output`/`quota_line`/
     `parse_context_usage` und das 7.3-Parsing an denselben Stellen konsistent?
   - `main.rs`: Beide Verdrahtungen (set_dialects, statusline-Route, Provider-Commands)
     vorhanden, nichts doppelt, nichts verloren?
2. **Spec-Konformitaet.** Lies `.pa/task_cfc1785a2c19.md` (die Phase-7.3-Spec inkl. der
   BEFUNDE-Sektion unten) und pruefe jeden IMPLEMENT-Punkt gegen den Code: Model,
   Quellen a-e, Hard Constraints (kein Keychain-/Credentials-Zugriff, keine undokumentierten
   Endpunkte), Fail-soft, Surfaces, Tests. Liste, was fehlt oder abweicht.
3. **Frontend.** Lies `src/lib/providers.ts`, `src/lib/ipc.ts`, `src/types.ts`,
   `src/components/ProviderDialog.tsx`, `src/styles.css`: Wire-Shape camelCase konsistent
   mit dem Rust-Serde-Output? Unknown-Usage wird als Gedankenstrich gerendert, nie als 0%?
4. **Lies niemals `.pa/secrets.json`** (enthaelt Keys; gitignored, nicht dein Befund).

## Abschlussbericht (als worker_done body)

- Verdict: `merge ok` oder `Probleme gefunden`
- Pro Finding: Datei:Zeile, Schwere (blocker/sollte/kosmetisch), kurze Beschreibung
- Spec-Abdeckung: Tabelle erfuellt/teilweise/fehlt pro IMPLEMENT-Punkt
- Explizit: Was du NICHT geprueft hast

---
ORCA-LIFECYCLE: Du bist Orca-Worker fuer task_dda9178acde5. Bei Fertigstellung melde GENAU
EINMAL: orca orchestration send --type worker_done --subject "Phase 7.3 Merge-Review" --body
"<Bericht>" --task-id task_dda9178acde5 --outcome succeeded --json. Bei Blockern:
orca orchestration ask --question "<frage>" --json. Danach idle.
