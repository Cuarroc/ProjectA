# Task omniw1a — OmniRoute-Integration W1a: Attribution-Kern (Zugangsdaten, Ledger, Spawn)

Status: historisch

Du arbeitest im Worktree `~/wt/omniw1a` (Branch `omni/w1a`, Basis: aktueller
`origin/main` — W0 ist bereits gemergt). Gesamtplan:
`docs/superpowers/plans/omniroute-integration.md` (W1). Dieser Task ist der
Rust-Kern der Attribution; UI/CLI folgen in W1b durch den Integrator.

## Was W0 dir bereits liefert (in `src-tauri/src/omniroute.rs`)

- `parse_call_logs` + `CallLogRow` (id, ts, api_key_name, session_tag,
  combo_name, tokens in/out/cache/reasoning/compressed, raw) — Fixture:
  `src-tauri/testdata/omniroute/call-logs.json`.
- Management-Fehlerklassen (`UsageError::{Unauthorized, BusyRateLimited,
  Timeout, Offline, Unreadable}`), `get_authorized` (Option-Vertrag),
  Version in der Probe.

## Aufgaben

1. **Ledger-Ingestion auf call-logs umstellen** (`omniroute.rs` + `store.rs`):
   - Poll künftig `GET /api/usage/call-logs?limit=200` statt `/api/usage/logs`
     (Pipe-Parser und Pfad als Fallback behalten, falls die Route 404 gibt).
   - `usage_events` erweitern: Spalten `worker_id TEXT NULL`,
     `api_key_name TEXT NULL`, `session_tag TEXT NULL`, `combo_name TEXT NULL`.
     Migration in `store.rs` (Schema-Version beachten — lies den vorhandenen
     Migrationsmechanismus und folge ihm exakt).
   - Dedup ab jetzt über die OmniRoute-`id` (stabil, vom Router vergeben)
     statt FNV-Hash der Rohzeile. Einmaliger Wechsel: im Kommentar begründen;
     `INSERT OR IGNORE` bleibt das Prinzip. Alte Zeilen behalten ihre
     Hash-Ids — kein Re-Import, kein Datenverlust.
2. **Pro-Worker-Gateway-Keys** (`routing.rs`, `workers.rs`, `store.rs`):
   - Beim Worker-Spawn (nur wenn das Profil über OmniRoute routet, d. h. die
     Spawn-Env eine OmniRoute-Base-URL trägt): ein Gateway-API-Schlüssel pro Worker,
     Name `pa-<worker_id>`. **Vertrag zuerst live verifizieren:** die genaue
     Route (`POST /api/keys` vs. `/api/api-keys`) und Payload-Form gegen die
     Instanz über den Tunnel (127.0.0.1:<omniroute-port>) oder anhand des CLI-Codes
     (`omniroute tokens create` im npm-Paket) klären und im Bericht
     dokumentieren. Minimal-Scopes. Der volle Key geht nur in die Prozess-Env;
     in SQLite nur `worker_id, key_prefix, omni_key_id, created_at, revoked_at`
     (neue Tabelle `omni_worker_keys`). Nie in Logs, nie ins Repo.
   - Injection: `OMNIROUTE_API_Schlüssel` in `spawn_env`; Codex-`config.toml`
     behält `env_Schlüssel = "OMNIROUTE_API_Schlüssel"`; Claude-Profile:
     `ANTHROPIC_AUTH_TOKEN = <worker-key>` statt `projecta-local`.
   - Revoke beim Archivieren eines Workers (`workers.rs` archive-Pfad):
     `DELETE` auf die Key-Route, best effort, danach `revoked_at` setzen.
   - Alles fail-soft: OmniRoute offline oder Schlüssel-Mint schlägt fehl → Spawn
     läuft wie heute weiter (bisheriges Token/Verhalten), Warnung ins Log.
3. **Session-Tag:** Codex-`config.toml` bekommt
   `http_headers = { "x-omniroute-session-id" = "<worker_id>" }` im
   Provider-Block (Codex unterstützt `http_headers` — verifiziert in der
   installierten Version; wenn die TOML-Form anders lautet, anpassen und im
   Bericht belegen). Claude: `ANTHROPIC_CUSTOM_HEADERS` Env
   (`x-omniroute-session-id: <worker_id>`) — Format gegen die installierte
   Claude-Version verifizieren. OpenCode: prüfen, dokumentieren, ggf. offen
   lassen (Pro-Worker-Key trägt die Attribution).
4. **Attribution:** `attribute()` in `omniroute.rs` ersetzen: Zeile →
   `worker_id` per `api_key_name` = `pa-<worker_id>` (Mapping-Tabelle) oder
   `session_tag` = `<worker_id>`; Fallback wie heute (Modell-String → Profil)
   für Altlasten. `worker_id` → Projekt ableitbar (workers-Tabelle).

## Grenzen

- Nahtstellen `api.rs`, `main.rs`, `bin/pa.rs` sind **tabu** (W1b).
- Frontend tabu. Keine neuen Dependencies.
- `cargo fmt` ist repoweit angewandt — `cargo fmt --check` muss grün sein.

## Verifikation (rot zuerst, alles selbst)

- Rot: Fixture-Test — zwei Call-Log-Zeilen mit verschiedenen `apiKeyName`
  (`pa-wk-a`, `pa-wk-b`) müssen zwei verschiedenen `worker_id`s zugeordnet
  werden; schlägt fehl, bevor die Mapping-Logik existiert.
- Rot: Migrationstest — alte `usage_events`-Zeilen überleben, neue Spalten
  sind NULL, Dedup über `id` verhindert Doppel-Import.
- `export PATH="$HOME/.cargo/bin:$HOME/bin:$PATH"; export TMPDIR="$HOME/testtmp"`
- `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`.

## Bericht

`BERICHT.md` im Worktree: Vertrag der Key-Routen (was du live gefunden hast,
mit Request/Response-Form), Rot-Nachweise (echte Fehlerausgabe), Gate-
Exit-Codes, Annahmen aus dem Plan bestätigt/widerlegt. Commit auf `omni/w1a`,
Push `origin omni/w1a` (origin = server-lokales bare-Repo).
