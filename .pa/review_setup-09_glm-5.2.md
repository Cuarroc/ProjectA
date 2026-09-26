# Review setup-09 - glm-5.2

- Status: ok
- Reviewer: glm-5.2 (kind ollama)
- Model requested: glm-5.2:cloud
- Model reported: glm-5.2
- Author of the candidate: claude
- Prompt: .pa/review_prompt_setup-09.md (35541 chars, sha256 32666a2bd937f6c3)
- Time: 2026-09-26T14:27:02Z

---

## Findings

**F1** — medium — `scripts/review/run-local.sh:236-237`
The kilo timeout relies on the external `timeout` binary. If `timeout` is absent (notably macOS without coreutils), `timeout_cmd=()` stays empty and `kilo run` executes with no timeout at all, despite `REVIEW_KILO_TIMEOUT_S` being set. A hung kilo process blocks the reviewer indefinitely. The script silently degrades instead of warning or falling back (e.g., `gtimeout`, or a background-kill pattern). The test suite only runs on Linux where `timeout` exists, so this gap is invisible in CI.

**F2** — low — `scripts/review/run-local.sh:196-197`
`stat_text` and `log_text` are not error-checked (`|| die …`), unlike `diff_text` one block above which is. If either git invocation fails (e.g., transient fs issue, corrupted FETCH_HEAD after a partial fetch), the prompt is written with empty commit/stat sections and the review proceeds against an incomplete picture. Inconsistent with the sibling `diff_text` guard.

**F3** — low — `scripts/test-review-local.sh`
No test covers the kilo timeout path (`rc -eq 124`). The code in `run-local.sh` has a distinct branch for this (lines ~280-284) producing a "failed" protocol with a timeout-specific message, but it's never exercised. A regression in that branch (wrong comparison, broken message) would go unnoticed.

**F4** — low — `scripts/test-review-local.sh`
No test covers `REVIEW_MAX_DIFF_CHARS` enforcement. The script rejects oversized diffs with exit 2 (run-local.sh ~190-193), but the test suite never creates a diff large enough to trigger it. A broken comparison or off-by-one would be silent.

**F5** — low — `scripts/review/run-local.sh:250`
`cp "$prompt_file" "$work/prompt.md"` is unguarded. If it fails (e.g., disk full, permission issue), kilo receives an empty or absent prompt file, and the "empty answer" branch fires with a misleading error message ("kilo answered with an empty text") rather than the real cause.

**F6** — low — `scripts/review/run-local.sh:282`
`errtext="$(sed … | tail -n 15)"` pipes through `tail`, which masks the exit code of `sed`. While the `sed` exit code is not operationally critical here (it's text cleanup of an error log), it conflicts with the repo's stated rule against `| tail` masking. The `2> /dev/null` on `sed` already swallows the file-not-found case, so `tail` is the only unguarded pipe segment.

## Verdict

approve with conditions

The change is well-structured, the test suite is thorough for the happy and most error paths, and the secret-handling test (canary key) is good. The conditions are: (1) add a fallback or warning when `timeout` is unavailable so kilo can't hang silently on macOS (F1), and (2) add a test for the `rc -eq 124` timeout branch (F3). The remaining findings are minor robustness gaps.
