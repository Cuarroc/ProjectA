# Task P19b: Phase 19 T3 — Usage-Ledger aus OmniRoute

Status: historisch

Du bist ein Entwicklungs-Worker auf einem Linux-Server. Repo: `/home/worker/wt/p19b`
(Branch `kimi/p19b`, aktuelles main). NUR dieser Worktree/Branch. NIEMALS
main, niemals force-push.

## Kontext

ProjectA (Tauri 2, Rust-Kern `src-tauri/src/`, React `src/`) trackt bisher nur
eigenes Quota-Parsing. OmniRoute (selbst-gehosteter Router auf
`127.0.0.1:<omniroute-port>`, vom Server via Tunnel erreichbar) liefert echte Usage-Logs.
Dieses Task holt diese Logs regelmäßig ab und speichert sie als Ledger.

- Plan: `docs/superpowers/plans/2026-08-27-omniroute-optimale-nutzung.md`,
  Abschnitt T3.
- Management-API `/api/usage/logs` ist login-gated; ein Token liegt root-only
  unter `/home/worker/specs/omniroute.env` (falls dein Worktree darauf zugreifen
  kann: `source /home/worker/specs/omniroute.env` in deiner Shell, aber nicht in
  Code einchecken). Für Tests muss das Token gemockt werden.

## Aufgaben

1. **Auth in `omniroute.rs`:**
   - Vault-Eintrag für OmniRoute-Login (Provider-Registry `providers.rs`
     erweitern, Key-Name `omniroute-management` o.ä.).
   - `omniroute.rs`: `login()` holt JWT vom Management-API `/api/auth/login`
     (oder welches Endpunkt das Token annimmt — verifiziere per curl) und
     cached es im `OmniRoute`-State. 401 ⇒ degradieren (nur online/offline,
     niemals hart fehlschlagen).
   - Der Token aus der Env-Datei ist der initiale Wert; fehlt er, wird 401
     behandelt.

2. **Poll-Thread:**
   - Neuer Thread in `omniroute.rs` (Muster `queue.rs:213-230` Dispatcher-
     Thread), der alle 5 Minuten `/api/usage/logs` abruft.
   - Neue Tabelle `usage_events` (`store.rs` `STATEMENTS`-Append):
     `id, ts, profile_id, model, provider, tokens_in, tokens_out, cost_usd,
     raw_json`. Dedup-Index auf `id`.
   - `Store::insert_usage_event` / `Store::list_usage_events`.

3. **Attribution:**
   - Soweit der CLI den `X-OmniRoute-Session-Id`-Header mitschickt (Claude
     hat `ANTHROPIC_CUSTOM_HEADERS`), versuche `profile_id` aus dem Session-
     Header zuzuordnen. Sonst bleibe ehrlich auf Profil-Ebene (d. h.
     `profile_id` ist das aktive Profil des Spawns, nicht Worker-genau).
   - Wenn Session-Header-Nutzung nicht verlässlich möglich ist: dokumentiere
     das im Bericht und im Code-Kommentar.

4. **API / CLI / UI:**
   - API: `GET /api/projects/<id>/usage` (oder `/api/usage` falls projekt-
     übergreifend — entscheide und dokumentiere).
   - CLI: `pa usage` (letzte N Zeilen, heute, gesamt).
   - UI: `UsageView.tsx` neue Sektion „OmniRoute-Kosten" mit echten
     Tokens/USD statt nur Prozent.

5. **Tests:**
   - Gefakter HTTP-Server im Muster von `omniroute.rs:204-246` (wenn vorhanden)
     oder ein WireMock-ähnlicher Test: 200 liefert Usage-Zeilen, 401 testet
     Degradierung, Dedup testen.
   - `cargo test` grün, `clippy -D warnings` clean.

## Regeln

- TDD: Poll-Thread und Store-Funktionen mit Tests abdecken.
- Gates VOR Push: `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `cargo build` in `src-tauri/`; bei UI: `npm run typecheck && npm run build`.
- Commit-Messages: Englisch, konventionell.
- Bericht `.pa/report_p19b.md` + Kopie nach `/home/worker/logs/p19b-report.md`,
  dann `git push origin kimi/p19b`.
- Keine Änderungen am Dispatcher/Failover (T4, kommt nach Phase 18).
- Kein echter Management-Token ins Repo.
