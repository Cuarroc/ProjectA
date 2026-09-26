# Review disposition SETUP-09 (scripts/review/run-local.sh)

Author: Claude (Sonnet 5). Reviewers: GLM 5.2 (Z.ai) and Kimi K3 (Moonshot)
via Ollama Cloud, sent with the runner under review (`run-local.sh`,
dogfooding). Candidate = the commits named per round; later commits
invalidate the earlier round for the changed lines.

| Round | Reviewer | Candidate | Protocol |
|---|---|---|---|
| r1 | glm-5.2 | 3d9502a | `review_setup-09_glm-5.2.md` (prompt `review_prompt_setup-09.md`) |
| r1 | kimi-k3 | 3d9502a | no verdict: no answer within 290 s (own short `REVIEWER_TIMEOUT_S`); protocol discarded, repeated as r2 |
| r2 | kimi-k3 | 9aa71bd | `review_setup-09-r2_kimi-k3.md` |
| r2 | glm-5.2 | e216dca | `review_setup-09-r2_glm-5.2.md` (prompt `review_prompt_setup-09-r2.md`) |

Protocol edit: the `Prompt:` line of the three protocols carried an absolute
worktree path (user name). It was cut to the repo-relative path by hand; the
sha256 and the rest are untouched. Found by the author, fixed in the tool
(default out dir is now relative, test 12). The kimi r2 prompt was overwritten
by the glm r2 run (different candidate); its sha256 in the protocol
(4655c52345d45bfe) belongs to the 9aa71bd prompt.

Not reviewed after r2: commit "hermetic missing-kilo test" (test-only, 5 lines), and the relative-path change (small; author-checked by test 12).

## r1 - glm-5.2 (approve with conditions)

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| G1 | medium | kilo timeout relies on `timeout`; absent on macOS -> no limit, silently | accepted, 9aa71bd: `gtimeout` fallback and a warning |
| G2 | low | `stat_text`/`log_text` git calls unchecked | accepted, 9aa71bd |
| G3 | low | no test for the kilo timeout branch (rc 124) | accepted, 9aa71bd (test 10) |
| G4 | low | no test for `REVIEW_MAX_DIFF_CHARS` | accepted, 9aa71bd (test 10) |
| G5 | low | `cp` of the prompt unguarded | accepted, 9aa71bd |
| G6 | low | `sed ... \| tail` masks the sed status | rejected: the status that matters (kilo `rc`) is captured separately; the gate `no-masked-output` concerns `$GITHUB_OUTPUT` writes |

## r2 - kimi-k3 (approve with conditions)

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| K1 | medium | empty `"${timeout_cmd[@]}"` fails under `set -u` on bash < 4.4 | accepted, e216dca: no array in the wrapper; test with `REVIEW_KILO_TIMEOUT_S=0` |
| K2 | medium | kilo is an agent; prompt injection through the diff | accepted in part, e216dca: `--agent ask` (edit/write denied, no `--auto`), docs name the residual risk and point untrusted PRs to the Ollama path. Observed with a real free model: `--agent ask` answers normally |
| K3 | low | two tags of one model collide on the protocol name | accepted, e216dca (test: llama3-8b / llama3-70b; same model twice refused) |
| K4 | low | unguarded `rev-parse FETCH_HEAD` could review the wrong target | accepted, e216dca (no red test: the failure cannot be provoked after a successful fetch) |
| K5 | low | `ollama.com:443` skips the key check | accepted, e216dca (host component match, test) |
| K6 | low | default kilo models unverifiable | accepted in part, e216dca: docs record that both were listed by `kilo models kilo` on 2026-09-26 and how to override |
| K7 | low | lockfile-only change reported as "no changes" | accepted, e216dca (own message, test) |

## r2 - glm-5.2 on e216dca (approve with conditions)

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| G7 | low | `sed ... \| tail` masks the sed status (repeat of G6) | rejected, reason as G6 |
| G8 | low | "kilo fehlt" test not hermetic when kilo sits next to git/python | accepted, test skips loudly in that case |

## Additional, not counted as a review

`kilo` with `stepfun/step-3.7-flash:free` reviewed the branch twice (real runs
of `--via kilo`). Findings on the first run: stale literal in the secret-canary
assertion (already fixed before this run was made; the run saw the earlier
commit), `OLLAMA_HOST=https://ollama.com` in a test "hits the network" (false
positive: the key check dies before any request, asserted by test 5), Bearer
format not asserted (accepted, fixed), log-count regex unreadable (accepted,
fixed). Second run: `--author` untested, `out_dir` writability, prompt says
`$base...` in PR mode (cosmetic, fixed) - the rest rejected as speculative.
