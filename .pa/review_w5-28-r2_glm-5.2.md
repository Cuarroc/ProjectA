# Review: w5-28-r2 — glm-5.2

- Autor des Artefakts: kimi-k3 (W5-28 worker)
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-25 14:16 UTC, Dauer 39 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_w5-28-r2.md` (7263 Zeichen)

## Roh-Urteil des Reviewers

Here is the review of the delta. 

### F1 (high): false-PASS on non-array or short api answer
**Fixed.** `runtime-proof.mjs` now propagates `null` for non-arrays instead of coercing to `[]`, and `evaluateProof` in `runtime-proof-lib.mjs` explicitly checks `Array.isArray` and verifies the length against `phase1?.seeded`. 

### F2 (medium): retention considered every directory under the proof root
**Fixed.** `selectRunsToDelete` now filters `runNames` against `RUN_NAME_PATTERN`, meaning directories like `keepme` will be ignored and not returned for deletion. The regex matches the `runStamp` format correctly.

### F3 (medium): window-shot -TargetPid fell back to title matching
**Not fixed.** The author added a check using `Write-Error` in `scripts/window-shot.ps1` (line 50-52). However, in PowerShell, `Write-Error` is a non-terminating error by default. It writes to the error stream but does **not** halt script execution. Execution simply continues to the next line (line 55), where `$proc` (which is still `$null`) falls back to title matching exactly as before:
```powershell
if (-not $proc) { $proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
```
To actually fix this, the author must use a terminating error, such as `throw "..."` or `exit 1` (or `Write-Error -ErrorAction Stop`), inside the `if (-not $proc)` block.

### F4 (low): global Alt keystroke
Not applicable, intentionally kept.

### New bugs / side effects
- **Low:** In `runtime-proof.mjs`, the mapping `entries.map((entry) => ({ id: entry.id, status: entry.status }))` will throw a `TypeError` if the API returns an array containing `null` (e.g., `[null]`). Since the goal is to treat garbage as a failure rather than a crash, it might be safer to default to `null` for the whole array if elements are malformed, or use optional chaining inside the map. This is an edge case, but it would turn a clean proof failure into a script crash.
