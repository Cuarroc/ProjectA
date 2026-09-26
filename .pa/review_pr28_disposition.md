# PR #28 (CI-04) - review disposition, stage B

Candidate: `f29c6a5` plus the fix commit that follows it (base of the review:
`c28bbf8`, +1 test commit). Author: Claude (Sonnet 5). The port carries the
predecessor repository's review of the same code by two Claude models
(`.pa/review_pr182_*`); that review does not count as independent here.

| Reviewer | Model | Transport | Raw answer |
|---|---|---|---|
| Kilo | `kilo/nvidia/nemotron-3-ultra-550b-a55b:free` | `kilo run`, prompt attached with `-f`, run in an empty scratch directory (read-only, no repository in reach) | `.pa/review_pr28_kilo.md` |

Prompt: `.pa/review_prompt_pr28.md` (context, requirement, review history,
`git diff origin/main...HEAD` without the four ported `.pa/review_*pr182*`
files). One reviewer only (Ollama and OpenCode not used: weekly limit); the
answer is stored unchanged. Every claim was checked against the code, not
against the diff alone. Ids: K = Kilo, numbered as in the answer's own list
(its summary table renumbers them; the body numbers are used here).

## Findings

| ID | Sev (Kilo) | Finding | Disposition |
|---|---|---|---|
| K1 | high | `REPO` is interpolated into the API URL without validation (injection) | **Rejected.** `REPO` reaches the script through an env variable (`${{ github.repository }}`), never through shell text; it is used only as a curl URL argument and quoted `gh --repo` argument. GitHub restricts repository names to `[A-Za-z0-9._-]/...`. No shell parsing of the value happens. |
| K2 | high | JSON payload built with `printf` instead of `jq` | **Rejected.** The only interpolated value is `RUN_ID` (`github.run_id`, numeric, env-passed). `jq` is not guaranteed on the Windows/Git-Bash dev machine where the selftest runs; the repo uses `node` for JSON reading, and there is nothing to escape. |
| K3 | medium | Stale-run check may misbehave on `workflow_dispatch`/schedule because the job `if` does not require `event_name == push` | **Rejected.** `github.sha` on a manual run on `main` is the current main head, so the comparison holds; a manual full run is exactly the documented recovery path (issue text, step 2), and forbidding it would remove the only way to lift the freeze after the CI-02 light push. If main advances during the run, the stale check correctly refuses a re-freeze. |
| K4 | medium | Green without `MERGIFY_TOKEN` closes issues although a freeze may exist (violates delete-before-close) | **Accepted in part.** Closing is intended: without a token the guard never set a freeze (the red path skipped it and the issue is the only signal), and a full green run proves main is green; the job warns loudly. But the closing comment claimed "Freeze aufgehoben" although nothing was checked, which is untrue. Fixed: without token the comment says "Freeze-Status nicht geprueft (MERGIFY_TOKEN fehlt) ... manuell loeschen". Red first: `f29c6a5` (`green-no-token-comment-honest`, `green-no-token-no-false-claim` failed, exit 1), green after the fix. |
| K5 | medium | The `green-no-token` test does not catch K4 | **Accepted** together with K4: the two new assertions above; `green-token-comment-claims-lift` pins the with-token wording. |
| K6 | low | `summary()` uses `"$*"`, so multi-argument summaries collapse into one line | **Accepted, verified real.** `printf '%s\n' "$*"` joins with a space, the `###` heading swallowed the rest of the summary. Fixed with `"$@"`. Red first: `green-summary-one-arg-per-line` failed in `f29c6a5`, green after the fix. |
| K7 | low | `"timezone":"UTC"` unnecessary for an open-ended freeze | **Rejected.** Part of the wire format of the official mergify-cli (verified against its create.rs, see the script header); dropping fields risks API rejection for no gain. |
| K8 | low | Mixed German/English log messages | **Rejected.** Repo convention: code and identifiers English, operator-facing CI messages German. |
| K9 | low | Partial delete success leaves issue open while the queue is unfrozen | **Rejected.** Deliberate fail-safe (S-7/O-6): the job goes red and the issue stays open; a rerun deletes the rest (delete is idempotent, listing shows only remaining freezes). |
| K10 | low | `gh api repos` shim matches any repos call | **Rejected.** Test double for a single call; only `commits/main` is issued. |
| K11 | - | items rated "OK" by Kilo (pipefail, `always()`, permissions, sparse checkout, ci-shape `!=` mutation, curl-fail mock) | No action; nothing to dispose. |

Kilo's verdict was "approve with fixes"; its "check `lane-plan.sh` emits
`run`" hint was verified: `lane-plan.sh` prints `run=true|false` (line 158).

## Evidence after the fix

- `bash scripts/test-main-red-guard.sh` -> exit 0 (63 ok, 0 FEHLER; was exit 1 with 3 FEHLER at `f29c6a5`).
- `bash scripts/test-ci-shape.sh` -> exit 0; `bash scripts/ci/ci-shape.sh` -> exit 0.
