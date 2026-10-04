# Architecture rules

The canonical architecture patterns ProjectA code already follows. Each rule
names one "do" example at a repo-relative `file:line` and one "don't".
Reviews check these rules (AGENTS.md, "Reviews and advisors"); the
architecture drift gate `scripts/ci/architecture-drift.mjs` (package ARCH-G2,
may not exist yet) enforces them mechanically. Known, deliberate exceptions
are named at the end.

1. Rust/SQLite owns runtime authority.
   - Do: persist runtime state through `Store`
     ([`src-tauri/src/store.rs:996`](../src-tauri/src/store.rs#L996)).
   - Don't: create an HQ-side scheduler, task database, claim ledger, or
     budget ledger.

2. HQ is a client and proxy.
   - Do: reach runtime state through the authenticated Control API
     ([`scripts/hq-live.mjs:381`](../scripts/hq-live.mjs#L381)).
   - Don't: read or write `projecta.db` from Node or browser code.

3. Keep SQL inside the store boundary.
   - Do: place queries in `store.rs` or `store/*.rs`
     ([`src-tauri/src/store/development_plan.rs:207`](../src-tauri/src/store/development_plan.rs#L207)).
   - Don't: issue production SQL from API, worker, UI, or HQ modules.

4. Transport adapters do not own behavior.
   - Do: call a shared domain function from both Tauri and `ControlBackend`
     ([`src-tauri/src/main.rs:1081`](../src-tauri/src/main.rs#L1081)).
   - Don't: independently reproduce the same validation and state transition.

5. Use one error vocabulary.
   - Do: prefix missing/refused failures with `ERR_UNKNOWN` or `ERR_REFUSED`
     ([`src-tauri/src/errors.rs:9`](../src-tauri/src/errors.rs#L9)).
   - Don't: invent a new transport-specific wording for an existing condition.

6. Serialize database read-modify-write at transaction start.
   - Do: acquire `BEGIN IMMEDIATE` through the store write helper
     ([`src-tauri/src/store/continuous.rs:938`](../src-tauri/src/store/continuous.rs#L938)).
   - Don't: read under a deferred transaction and race another writer.

7. Use process-local locks only for process-local state.
   - Do: use the review-evidence Tokio mutex while only the app writes SQLite
     ([`src-tauri/src/store.rs:1007`](../src-tauri/src/store.rs#L1007)).
   - Don't: treat an in-process mutex as cross-process exclusion.

8. Spawn ordinary child processes through `proc::command`.
   - Do: use `crate::proc::command("git")`
     ([`src-tauri/src/proc.rs:39`](../src-tauri/src/proc.rs#L39)).
   - Don't: call `std::process::Command::new` in production modules.

9. Keep the native capture exception isolated.
   - Do: keep held-image/CreateProcessW work in the `projecta_capture`
     library ([`src-tauri/Cargo.toml:27`](../src-tauri/Cargo.toml#L27)).
   - Don't: duplicate native lifecycle or resource verification in the app
     binary.

10. Keep configuration in the layer matching its lifetime.
    - Do: use environment variables for bootstrap
      ([`src-tauri/src/main.rs:3186`](../src-tauri/src/main.rs#L3186)), SQLite
      for mutable settings
      ([`src-tauri/src/store.rs:3541`](../src-tauri/src/store.rs#L3541)), and
      `agents.json` for profile definitions
      ([`src-tauri/src/profiles.rs:284`](../src-tauri/src/profiles.rs#L284)).
    - Don't: add a second persisted source for the same setting.

11. Use the atomic file-write owner.
    - Do: call `fsutil::write_atomic`
      ([`src-tauri/src/fsutil.rs:21`](../src-tauri/src/fsutil.rs#L21)).
    - Don't: invent another temp-name, flush, or replace sequence.

12. Keep browser and Tauri transport calls behind typed wrappers.
    - Do: use `src/lib/ipc*` and HQ's authenticated API helper
      ([`src/lib/ipc.ts:139`](../src/lib/ipc.ts#L139)).
    - Don't: scatter raw `invoke`, `listen`, or authenticated `fetch` calls.

13. Emit typed events from an owning subsystem.
    - Do: expose frontend listeners through `ipc.ts`
      ([`src/lib/ipc.ts:2072`](../src/lib/ipc.ts#L2072)).
    - Don't: create free-form event names or payloads in feature components.

14. PTY sessions are process-local.
    - Do: rebuild session bindings on respawn
      ([`src-tauri/src/store.rs:923`](../src-tauri/src/store.rs#L923)).
    - Don't: present a restored scrollback buffer as a live PTY.

15. The remote board remains read-only.
    - Do: accept authenticated GET routes
      ([`src-tauri/src/web_interface.rs:478`](../src-tauri/src/web_interface.rs#L478)).
    - Don't: add mutation routes to the remote-board server.

16. One desktop process owns the database, dispatcher, and descriptor.
    - Do: keep the single-instance plugin first
      ([`src-tauri/src/main.rs:3464`](../src-tauri/src/main.rs#L3464)).
    - Don't: add a second lockfile or process-local scheduler.

## Known exceptions

- Encrypted session buffers are filesystem-backed, not SQLite
  ([`src-tauri/src/sessionpersist.rs:39`](../src-tauri/src/sessionpersist.rs#L39));
  rule 1 still holds for authoritative runtime state, and a restored buffer is
  scrollback, not a live PTY (rule 14).
- Provider credentials live in a file-backed vault, not SQLite
  ([`src-tauri/src/providers.rs:608`](../src-tauri/src/providers.rs#L608)).
- Native Windows capture spawns through `CreateProcessW`, not `proc::command`
  ([`src-tauri/src/process_capture/windows_process.rs:269`](../src-tauri/src/process_capture/windows_process.rs#L269));
  it stays inside the `projecta_capture` library (rule 9).
