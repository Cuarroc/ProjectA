# F4-Setup: Runner mit Timeout, Log und Trust

Status: historisch

Repo: `<repo-root>`. **Nicht committen.**

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F4 Setup-Command. Trust-Prädikat steht
in `readiness.rs`; Persistenz der Grants in `store.rs`. Dieses Paket **führt
aus**.

## Nahtstellen-Lane

- `src-tauri/src/setupgate.rs` (neu) — exklusiv
- `src-tauri/src/main.rs` — nur `mod setupgate;` (alphabetisch)
- `src-tauri/src/workers.rs` — `hash_setup_inputs` hierher ziehen und
  `setup_failed` aus dem letzten Lauf lesen (keine Naht)

**Nicht anfassen:** `api.rs`, `store.rs`, `bin/pa.rs`. Letzter Lauf liegt als
JSON neben der DB, nicht in einer neuen Migration.

## Auftrag

1. Setup-Command im Worktree über `crate::proc::command` (Windows: keine
   Konsolenfenster). Shell-Zeile wie `testgate`, Timeout, Prozessbaum-Kill
   über `oneshot::ProcessTree`.
2. Log-Datei schreiben. Timeout-Marker im Log.
3. Ohne passenden Trust-Grant **nicht** starten. Unveränderter Befehl plus
   verändertes Lifecycle-Script ist `Mismatch` — erneut Trust, kein Lauf.
4. Letzten Lauf (ok / timed_out / inputs_hash / base_sha) so ablegen, dass
   `facts_for_merge` `setup_failed` ehrlich setzt.

## Beweismaßstab

Kompilierender roter Test zuerst. Mindestens:

- Timeout tötet den Prozessbaum (Windows: Verzeichnis wieder löschbar)
- Grant fehlt → kein Spawn
- gleicher Befehl, anderes `scripts/lifecycle.cmd` bzw. `.sh` → kein Spawn
- passender Grant, Exit 0 → Log existiert, letzter Lauf ok

## Report

`.pa/report_f4_setup.md`
