# Fix: Phase-7.3 Review-Findings (Fix-Worker)

Status: historisch

Repo-Root: `<repo-root>`, Branch `phase-7.3-usage`. Du fixt die
Findings aus dem Merge-Review. **Am Ende NICHT committen** — der Koordinator reviewt und
committet. Lies niemals `.pa/secrets.json`.

Die vier Findings sind verifiziert, die Fixes sind vorgegeben. Arbeite sie der Reihe nach
ab, jeweils mit Tests (TDD: betroffenen Test zuerst auf die korrekte Wire-Form umstellen =
rot, dann fixen = gruen).

## Fix 1 (Blocker) — OpenRouter-Envelope, `src-tauri/src/providers.rs`

Die echte Antwort von `GET https://openrouter.ai/api/v1/key` ist unter `data` genestet:

```json
{ "data": { "limit": 20.0, "usage": 3.71, "limit_remaining": 16.29, "is_free_tier": false } }
```

Aktuell parst `OpenRouterResponse` (Zeile ~707) flach → nie Zahlen. Fix:
- Neuer Envelope-Typ `struct OpenRouterEnvelope { data: Option<OpenRouterResponse> }`;
  `parse_openrouter_body` parst den Envelope, `data: None` oder unlesbar → `None`.
- **Tests:** die bestehenden OpenRouter-Tests benutzen flache Fake-Payloads — auf die
  genestete Form umstellen (das ist der Beweis, dass der Fix real ist).
- **Sollte 2 gleich mit:** die Werte sind USD-Credits, keine Tokens. `used`/`limit` fuer
  openrouter als Dollar formatieren (z.B. `$3.71`), nicht ueber `format_token_count`
  ("…Tokens"). Kleine separate `format_credits`-Funktion; Token-Formatierung bleibt fuer
  die Statusline-Zahlen (andere Stelle).

## Fix 2 (Blocker) — Statusline `current_usage`, `src-tauri/src/status.rs`

Der live-verifizierte Payload (Spec-BEFUNDE in `.pa/task_cfc1785a2c19.md`):
`context_window.current_usage` ist **null ODER ein Objekt**
`{input_tokens, cache_creation_input_tokens, cache_read_input_tokens}` — jedes Feld
einzeln optional. Aktuell ist es `Option<f64>` (Zeile ~885): ein Objekt dort laesst die
**ganze Payload-Deserialisierung** fehlschlagen → Claude-Usage still verloren
(Fail-soft-Verletzung).

Fix:
- `struct CurrentUsage { input_tokens: Option<f64>, cache_creation_input_tokens: Option<f64>, cache_read_input_tokens: Option<f64> }`
  (snake_case serde), `current_usage: Option<CurrentUsage>`.
- `context_window_usage`: used = Summe der vorhandenen Felder; alle fehlend → `None`.
- **Tests:** ein Test mit der Objekt-Form (summiert korrekt), einer mit
  `"current_usage": null` (→ `used: None`, Rest der Payload wird trotzdem geparst —
  percent/resets_at bleiben), einer ganz ohne `context_window`.

## Fix 3 (kritisch, vom Review als "sollte" eingestuft) — statusLine-Shape, `src-tauri/src/hooks.rs`

Claude Code erwartet `statusLine` als **Top-Level-Key** neben `hooks`, als
`{ "type": "command", "command": "..." }` — nicht als Eintrag im hooks-Array-Wrapper.
Aktuell (Zeile ~320) steht es im hooks-Map → Claude Code ignoriert es → es kommen nie
Payloads an.

Fix in `settings_json`: statusLine aus der hooks-Map raus, als Top-Level-Feld:

```rust
json!({
    "hooks": Value::Object(hooks),
    "statusLine": { "type": "command", "command": statusline_command }
})
```

- **Test** `the_generated_settings_wire_every_event_to_this_worker` (und jeder andere, der
  die Shape prueft) umstellen: statusLine top-level asserten, hooks-Map enthaelt genau die
  4 HOOK_EVENTS.

## Fix 4 (Kosmetik, wenn billig)

- `providers.rs` ~763/765: doppelter Kommentar — einen streichen.
- `src/lib/ipc.ts`: Fallback-Source "heuristic" fuer unbekannte source-Werte pruefen —
  wenn der Wire `source` immer aus dem Rust-Enum kommt, Fallback auf "local" oder das
  Feld ehrlich durchreichen; kleinste korrekte Aenderung.
- `src-tauri/src/bin/pa.rs`: Usage ohne percent (limit=null) soll Fenster-Label zeigen,
  keinen Gedankenstrich — das aktuelle Verhalten mit der Spec abgleichen
  (".pa/task_cfc1785a2c19.md" Punkt 6: unknown = Gedankenstrich; vorhanden ohne Prozent =
  used + windowLabel). Nur anpassen, wenn es der Spec widerspricht.

## VERIFY (alle gruen, dann STOPP — nicht committen)

```bash
cd src-tauri && CARGO_BUILD_JOBS=2 cargo test && CARGO_BUILD_JOBS=2 cargo clippy --all-targets -- -D warnings && CARGO_BUILD_JOBS=2 cargo build
cd .. && npm run typecheck && npm run build
```

---
ORCA-LIFECYCLE: Du bist Orca-Worker fuer task_cd1287c64eb0, Dispatch ctx_ec8cd3f9e49f.
Bei Fertigstellung (alle VERIFY-Checks gruen) GENAU EINMAL:
orca orchestration send --type worker_done --subject "Phase 7.3 Review-Fixes done" --body
"<3 Saetze: was gefixt, Testergebnisse, was offen>" --task-id task_cd1287c64eb0
--dispatch-id ctx_ec8cd3f9e49f --outcome succeeded --json. Bei Blockern:
orca orchestration ask --question "<frage>" --json. Danach idle.
