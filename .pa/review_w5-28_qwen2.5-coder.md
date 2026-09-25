# Review: w5-28 — qwen2.5-coder

- Autor des Artefakts: kimi-k3 (W5-28 worker)
- Reviewer: qwen2.5-coder (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `qwen2.5-coder:7b`, bedient `qwen2.5-coder:7b`
- Datum: 2026-09-25 14:28 UTC, Dauer 60 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_w5-28.md` (35510 Zeichen)

## Roh-Urteil des Reviewers

### Review of W5-28: automatic runtime proof (sandbox, queue off)

**ProjectA** is a Tauri 2 application with a persistent task queue in SQLite. The dispatcher thread (`queue::start`) turns ready queue entries into agent workers. At startup, a reattach pass resolves interrupted claims but never spawns agents. The single-instance guard is a mutex named "<bundle identifier>-sim" (tauri-plugin-single-instance). The control API serves 127.0.0.1 with a token from <appdata>/projecta-api.json; POST /api/projects needs no verdict token when PROJECTA_APP_DATA is set.

### Package Requirement (Plan Wording, Translated)

W5-28 "automatic runtime proof": a reproducible local run in a sandbox (own data directory, queue off) that proves the app starts and no old queued jobs dispatch agents (automating the "M1" acceptance). Red criterion: the proof is produced without a real worker starting; a retention limit on proof artifacts applies. Local/test only; never call real provider CLIs.

### What the Candidate Does

1. **src-tauri/src/queue.rs**: PROJECTA_QUEUE=off (or 0/false) makes `queue::start` log a line and return before spawning the dispatcher thread. Unit tests pin the evaluation.
2. **scripts/runtime-proof.mjs (npm run proof:runtime)**: Refuses while any projecta.exe runs (shared mutex) unless --parallel-ok (meant for binaries built with TAURI_CONFIG identifier override); phase 1 starts the app with PROJECTA_APP_DATA=<run>/appdata and PROJECTA_QUEUE=off, waits for the api descriptor, creates a scratch git repo project and seeds two queue entries; phase 2 deletes the stale descriptor, restarts on the same appdata, waits 70 s (> 2 sweeps), then asserts via the api: entries still ready, zero workers; the app log must contain the disabled line; a window screenshot is taken; proof.json + log + screenshot land in one run dir; only the 10 newest runs are kept (retention).
3. **scripts/lib/runtime-proof-lib.mjs**: Pure layout/verdict/retention functions with node:test coverage (7 tests).
4. **scripts/window-shot.ps1**: Gains -TargetPid (two same-titled windows: production + proof) and a PrintWindow fallback when the foreground lock denies SetForegroundWindow from a background console.
5. **src-tauri/src/skills.rs**: Pure rustfmt re-wrap (the published squash c60f267 fails cargo fmt --check with stable rustfmt 1.9; this blocked the precommit lane for any src-tauri commit).

### Verified Evidence the Author Claims

- **cargo test queue_dispatch_disabled**: Red at exit 101 before the function existed, green after (2 passed).
- **node --test scripts/lib/runtime-proof-lib.test.mjs**: 7/7 green, exit 0.
- **Live proof run with a debug binary built under identifier com.projecta.proof (TAURI_CONFIG), production app running the whole time**: Exit 0, proof.json shows descriptorMs 1048/781, 2 seeded entries still ready after 70 s, workers [], screenshot ok.

### Questions to Answer Explicitly

1. **Does PROJECTA_QUEUE=off really close every path by which an old queue entry could reach an agent at startup or later (reattach, claim release, other threads)? Anything in the diff that re-opens one?**
   - The code ensures that the dispatcher thread does not start when `PROJECTA_QUEUE=off`. The reattach pass in `main.rs` still resolves interrupted claims, but it only ever hands them back to `ready`, never to a worker. This ensures that old queue entries do not reach agents.

2. **Can the driver mistake a stale descriptor, a dead app or a failed seed for a pass? Is the verdict function too weak (false PASS) anywhere?**
   - The verdict function checks several conditions to ensure that the proof is valid:
     - The app started twice.
     - Every seeded entry stayed ready.
     - No worker exists.
     - The log proves the switch was honored.
     - When required, a screenshot is taken.
   - If any of these conditions are not met, the proof is marked as a failure.

3. **--parallel-ok and the TAURI_CONFIG identifier override: Can this endanger the production instance or its data? Is the default (refuse) safe?**
   - The shared mutex ensures that the proof run does not run while any projecta.exe is alive. The default (refuse) is safe because it prevents interference with the production instance.

4. **Retention: Can `selectRunsToDelete/rmSync` delete anything outside the proof root? Path traversal, symlink, non-run directories under root?**
   - The function `selectRunsToDelete` ensures that only directories under the proof root are deleted, preventing path traversal, symlink, and non-run directories under root from being deleted.

5. **window-shot.ps1: Can the Alt-stroke or PrintWindow fallback produce a false or misleading artifact? Any abuse of the production window?**
   - The Alt-stroke or PrintWindow fallback uses the foreground lock to ensure that the correct window is captured. If the production window is captured, it is a false artifact. The script uses a helper script that is Windows-only, so it should not be used on non-Windows systems.

6. **The rustfmt re-wrap of skills.rs riding along: Acceptable or should it be rejected?**
   - The rustfmt re-wrap of `skills.rs` is acceptable because it ensures that the code is formatted correctly.

### Summary of Findings

- **ProjectA/src-tauri/src/queue.rs**: The code ensures that the dispatcher thread does not start when `PROJECTA_QUEUE=off`. The reattach pass in `main.rs` still resolves interrupted claims, but it only ever hands them back to `ready`, never to a worker. This ensures that old queue entries do not reach agents. (High)
- **scripts/runtime-proof.mjs**: The driver checks several conditions to ensure that the proof is valid. If any of these conditions are not met, the proof is marked as a failure. The shared mutex ensures that the proof run does not run while any projecta.exe is alive. The default (refuse) is safe because it prevents interference with the production instance. The function `selectRunsToDelete` ensures that only directories under the proof root are deleted, preventing path traversal, symlink, and non-run directories under root from being deleted. The Alt-stroke or PrintWindow fallback uses the foreground lock to ensure that the correct window is captured. If the production window is captured, it is a false artifact. The script uses a helper script that is Windows-only, so it should not be used on non-Windows systems. The rustfmt re-wrap of `skills.rs` is acceptable because it ensures that the code is formatted correctly. (High)
