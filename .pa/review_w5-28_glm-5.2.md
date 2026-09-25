# Review: w5-28 — glm-5.2

- Autor des Artefakts: kimi-k3 (W5-28 worker)
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-25 13:52 UTC, Dauer 80 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_w5-28.md` (35510 Zeichen)

## Roh-Urteil des Reviewers

## Findings

### 1. Verdict false-PASS when the API returns a non-array or empty entries — HIGH

`scripts/runtime-proof.mjs:185-186`:

```js
proof.phase2.entries = (Array.isArray(entries) ? entries : []).map((entry) => ({ id: entry.id, status: entry.status }));
proof.phase2.workers = Array.isArray(workers) ? workers : [];
```

`scripts/lib/runtime-proof-lib.mjs:48-51`:

```js
for (const entry of phase2?.entries ?? []) {
    if (entry.status !== 'ready') failures.push(`queue entry ${entry.id} left ready: ${entry.status}`);
}
```

The verdict iterates over `phase2.entries` and only checks that *each present* entry is `ready`. It never asserts that the two entries seeded in phase 1 are still *present* in phase 2. If the API returns `200` with a non-array body (e.g. `null`, `{}`, or an empty array due to a project-ID mismatch, a DB issue, or a serialization bug), `proof.phase2.entries` becomes `[]`, the for-loop body never runs, and the verdict passes with zero entries and zero workers — exactly the condition the proof is meant to exclude.

The same applies to `workers`: a non-array response is silently coerced to `[]`.

**Fix:** the verdict should assert `phase2.entries.length >= phase1.seeded` (or exactly equal), and should flag a non-array API response as a failure rather than coercing it away. The test suite (`runtime-proof-lib.test.mjs`) likewise only mutates an existing entry's status; it never tests the empty-entries case, so the gap is invisible to the tests.

---

### 2. Retention deletes arbitrary directories under the proof root — MEDIUM

`scripts/runtime-proof.mjs:215-218`:

```js
const siblings = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
for (const old of selectRunsToDelete(siblings, options.keep)) {
  rmSync(join(root, old), { recursive: true, force: true });
}
```

`selectRunsToDelete` sorts *all* directory names lexicographically and returns everything past index `keep`. If the proof root is shared or accidentally pointed at a directory containing non-run subdirectories (e.g. `--root /home/user`), those subdirectories sort before timestamped run dirs and are deleted first once the total exceeds `keep`.

There is no validation that a name matches the `runStamp` pattern (`/^\d{4}-\d{2}-\d{2}T...Z$/`) before it is eligible for deletion.

**Fix:** filter `siblings` to names matching the run-stamp pattern before passing to `selectRunsToDelete`.

---

### 3. `window-shot.ps1 -TargetPid` fallback can photograph the production window — MEDIUM

`scripts/window-shot.ps1:48-50`:

```powershell
if ($TargetPid -gt 0) { $proc = @($candidates | Where-Object { $_.Id -eq $TargetPid }) | Select-Object -First 1 }
if (-not $proc) { $proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
```

If the proof app's WebView2 window hasn't been created yet by the time the screenshot is taken (the driver calls `takeScreenshot` immediately after the 70 s settle, but window creation latency is not guaranteed), the `$TargetPid` filter finds no match and the script falls back to exact-title match, which can select the production window running alongside. The resulting PNG is a valid file, so `existsSync(layout.screenshot)` is `true` and the verdict records `screenshot.ok = true` — a misleading artifact presented as evidence.

**Fix:** when `-TargetPid` is provided and no matching candidate is found, error out instead of falling back to title-based selection.

---

### 4. Global Alt keystroke in `window-shot.ps1` — LOW

`scripts/window-shot.ps1:60-61` injects a global Alt press/release via `keybd_event` to bypass the foreground lock. This is sent to the foreground thread's keyboard queue and could interfere with user input on a machine where someone is typing during a proof run. Low impact in a CI context, but worth noting for interactive use.

---

### 5. `PROJECTA_QUEUE=off` coverage — no finding (answers the question)

The switch is checked at the top of `queue::start` (`src-tauri/src/queue.rs:500-508`) before the dispatcher thread is spawned. The startup reattach pass in `main.rs` runs independently but only resets interrupted claims to `ready` — it never spawns workers. No other thread path in the diff re-opens a dispatch route. The log line requirement in the verdict independently confirms the switch was honoured. This is sound.

---

### 6. `--parallel-ok` default — no finding (answers the question)

The default (refuse when any `projecta.exe` is alive) is safe. With `--parallel-ok` and a production binary (same identifier), the single-instance mutex would prevent the second instance from starting, causing a descriptor timeout and a failed proof — not a data-safety issue. With a proof binary (distinct identifier), the mutex name differs, `PROJECTA_APP_DATA` is sandboxed, and ports are ephemeral. No shared state with production.

---

### 7. rustfmt re-wrap of `skills.rs` — no finding (answers the question)

The change is a pure formatting re-wrap that fixes `cargo fmt --check` with stable rustfmt 1.9. No semantic change, unblocks the precommit lane. Acceptable to ride along.
