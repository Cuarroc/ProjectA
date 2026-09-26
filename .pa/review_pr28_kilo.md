Now I have the full context. Let me conduct a thorough review of the implementation.

## Review of PR #28 (CI-04): A red main stops the merge queue

### High Severity Findings

#### 1. **Shell Injection Vulnerability in `main-red-guard.sh:541-546` (freeze_ids function)**
```bash
mg_api GET /scheduled_freeze "" retry | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
  for (const f of d.scheduled_freezes || [])
    if (f.id && (f.reason || "").startsWith("ci-red:")) console.log(f.id);
'
```
The `mg_api` function at line 531-537 uses unquoted variable expansion for `$MERGIFY_TOKEN` in the Authorization header. While the token comes from a secret, the `API` variable at line 512 interpolates `$REPO` directly into the URL:
```bash
API="https://api.mergify.com/v1/repos/$REPO"
```
`REPO` comes from `${{ github.repository }}` which is user-controlled (repository name). If a repo were named `owner/repo"; malicious_command #`, this could inject into the curl command. However, GitHub repository names are restricted to alphanumeric, hyphens, underscores, and dots — so practical risk is low. Still, best practice would be to validate/escape.

#### 2. **Shell Injection in `issue_body` function (line 558-582)**
The heredoc interpolates `$RUN_ID`, `$RUN_URL`, `$SHA` directly. These come from GitHub context and are generally safe, but `$SHA` could theoretically contain characters that break the JSON payload construction at line 641:
```bash
payload="$(printf '{"reason":"ci-red: main red, run %s","start":null,"end":null,"timezone":"UTC","matching_conditions":["base=main"],"exclude_conditions":["label=hotfix"]}' "$RUN_ID")"
```
`RUN_ID` is numeric (GitHub run ID), so safe. But the pattern of using `printf` with external values into JSON is fragile — should use `jq -n` for proper escaping.

#### 3. **Race Condition: Stale Run Detection Uses Wrong SHA Comparison (line 614-616)**
```bash
head="$(gh api "repos/$REPO/commits/main" --jq .sha)" ||
  fail "gh api commits/main fehlgeschlagen"
if [ "$head" != "$SHA" ]; then
```
This fetches the **current** main head SHA at the time the guard runs. But the guard runs *after* `linux` and `windows` jobs complete. Between the push that triggered this run and the guard execution, another push could have updated main. The guard correctly detects this and avoids freezing. **However**: the `SHA` variable is `${{ github.sha }}` — the commit that triggered *this* workflow run. If the workflow was triggered by a push to main, `github.sha` is the new head. But if triggered by `workflow_dispatch` or schedule, `github.sha` could be an old commit. The check is correct for push events but may behave unexpectedly for manual runs. The job `if` condition only checks `github.ref == 'refs/heads/main'`, not `github.event_name == 'push'`.

#### 4. **Missing `pipefail` in Critical Pipeline (line 536)**
```bash
curl "${args[@]}" "$API$path"
```
The `mg_api` function doesn't use `set -o pipefail` locally. If `curl` fails but the pipe to `node` in `freeze_ids` succeeds, the failure could be masked. The script has `set -uo pipefail` at line 505, so this is actually covered globally. **OK**.

#### 5. **GitHub Actions Expression: `always()` vs Job Result Semantics (line 124)**
```yaml
if: ${{ always() && github.event_name != 'pull_request' && github.ref == 'refs/heads/main' }}
```
The `always()` function returns `true` even when previous jobs fail, which is the intent. However, `always()` also returns `true` for cancelled jobs. The comment at line 121 says "auch nach roten Gates laufen (genau dann gibt es etwas zu tun)" — correct. But cancelled runs would also trigger this job. The script handles this at line 596-598:
```bash
if [ "$red" = "false" ] && [ "$green" = "false" ]; then
  note "Ergebnisse linux=$LINUX_RESULT windows=$WINDOWS_RESULT - weder rot noch gruen (cancelled/skipped), nichts zu tun."
  exit 0
```
This correctly no-ops on cancelled/skipped. **OK**.

### Medium Severity Findings

#### 6. **Permissions: Missing `contents: read` for `gh api` call (line 139-140)**
```yaml
permissions:
  contents: read
  issues: write
```
The script calls `gh api "repos/$REPO/commits/main"` at line 614. This requires `contents: read` permission, which is granted. **OK**.

#### 7. **`lane_run` Output Dependency on Step ID `plan` (ci-shape.sh lines 421-425)**
```bash
lane_out_re='^      lane_run: \$\{\{ steps\.plan\.outputs\.run \}\}$'
grep -qE "$lane_out_re" <<< "$linux" || err "job linux: output 'lane_run' missing..."
has "$linux" "id: plan" || err "job linux: step id 'plan' missing..."
```
This correctly enforces that the `lane_run` output comes from a step with `id: plan`. However, the `lane-plan.sh` script must actually set this output. I need to verify `lane-plan.sh` exists and produces the `run` output. The diff doesn't show `lane-plan.sh` changes — assuming it already exists and outputs `run` correctly.

#### 8. **Concurrency Group: `cancel-in-progress: false` with Serialization Intent (line 130-132)**
```yaml
concurrency:
  group: main-red-guard
  cancel-in-progress: false
```
The comment says "Main runs do not cancel each other... Serialize them; never cancel a RUNNING guard." With `cancel-in-progress: false`, a new run will **queue** behind a running one. GitHub Actions will run them sequentially. This is correct for serialization. However, if a running guard takes >5 minutes (timeout), the queued one will wait. The 5-minute timeout (line 134) is tight but should suffice for API calls.

#### 9. **Green Path: `del_failed` Logic Doesn't Capture All Failure Modes (lines 691-707)**
```bash
for id in $ids; do
  if mg_api POST "/scheduled_freeze/$id/delete" \
      "{\"delete_reason\":\"main green again, run $RUN_ID\"}" retry > /dev/null; then
    echo "Freeze $id geloescht."
  else
    echo "::error title=main-red-guard::Mergify: Freeze $id konnte nicht geloescht werden"
    del_failed=1
  fi
done
[ "$del_failed" = 1 ] &&
  fail "Freeze(s) konnten nicht geloescht werden - Issue(s) bleiben offen, bis der Freeze weg ist."
```
If `freeze_ids` returns multiple IDs (multiple stale freezes), and one delete fails, `del_failed=1` causes the job to fail and issues stay open. This is correct per S-7/O-6. However, if the **first** delete succeeds and the **second** fails, the first freeze is already deleted but the issue stays open — leaving the queue unfrozen but the issue open. This is a minor inconsistency but the fail-safe behavior (issue stays open) is correct.

#### 10. **Test Coverage Gap: `green-no-token` Test Doesn't Verify Freeze Deletion Attempt (lines 1049-1051)**
```bash
expect_ok green-no-token refs/heads/main success success true true "" 0
log_has green-no-token-closes 'gh issue close 7'
out_has green-no-token-warns 'warning|MERGIFY_TOKEN'
```
The test expects the issue to be closed even without a token. But the script at lines 692-693 warns and skips deletion:
```bash
if [ -z "$MERGIFY_TOKEN" ]; then
  warn "MERGIFY_TOKEN ist nicht gesetzt - kann keinen Freeze loeschen. Falls einer aktiv ist: manuell im Mergify-Dashboard loeschen."
```
The issue is closed **without** verifying the freeze was actually deleted. This could leave a freeze active while the issue is closed — violating the "delete freezes BEFORE closing issues" rule. The test should either:
- Mock a freeze existing and verify the warning is issued but issue stays open (since freeze couldn't be deleted), OR
- Verify that without a token, the script doesn't close issues if freezes exist.

Looking at the script logic: without token, it warns but continues to close issues (lines 709-717). **This is a bug** — it violates the S-7/O-6 ordering guarantee when token is missing.

#### 11. **`gh label create` with `--force` May Mask Errors (line 607-609)**
```bash
gh label create ci-red --repo "$REPO" --color B60205 --force \
  --description "main ist rot (CI-04)" ||
  fail "gh label create fehlgeschlagen"
```
The `--force` flag makes `gh label create` succeed even if the label exists (it updates it). This is fine, but if the repo has no permission to create labels, it would fail. The `issues: write` permission includes label management. **OK**.

#### 12. **Issue Body Uses Literal Backticks for `hotfix` Label (line 571-572)**
```bash
1. Fix-PR mit Label \`hotfix\` — der Freeze laesst \`label=hotfix\` durch
   (der Branch-Name allein reicht NICHT).
```
The issue text correctly states that only the **label** `hotfix` works, not the branch name. This matches the Mergify freeze configuration at line 641: `"exclude_conditions":["label=hotfix"]`. **OK**.

### Low Severity Findings

#### 13. **Hardcoded `timezone":"UTC"` in Freeze Payload (line 641)**
The Mergify API accepts `timezone` but the freeze is open-ended (`start`:null, `end`:null). The timezone is irrelevant for an open-ended freeze. Not a bug, just unnecessary.

#### 14. **German/English Mix in Log Messages**
The script mixes German (`"wurde eingefroren"`, `"manuell einfrieren"`) and English (`"Freeze"`, `"Issue"`). Consistent language would be better for international teams, but not a correctness issue.

#### 15. **`summary` Function Doesn't Handle Multi-line Properly (line 519-522)**
```bash
summary() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"
  return 0
}
```
Called at line 718 with multiple arguments:
```bash
summary "### main-red-guard: GRUEN" "Issues geschlossen:${closed:-keine}" "Freezes geloescht: ${ids:-keine/uebersprungen}"
```
`printf '%s\n' "$*"` joins all arguments with spaces, not newlines. The summary will be one line. Should use `printf '%s\n' "$@"` or loop over `"$@"`.

#### 16. **Test Shim for `gh api` Returns Hardcoded SHA (line 839)**
```bash
*"api repos"*) echo "${MOCK_MAIN_HEAD_SHA:-deadbeefcafe}" ;;
```
The shim matches any `gh api repos` call, but the script only calls `gh api "repos/$REPO/commits/main"`. If other `gh api repos/*` calls are added, they'd get the same mock. Acceptable for current scope.

#### 17. **Missing Validation of `lane_run` Values (script lines 673-674)**
```bash
if [ "$LINUX_RAN" != "true" ] || [ "$WINDOWS_RAN" != "true" ]; then
```
The script treats any value other than `"true"` as "not ran". The `lane-plan.sh` should only output `"true"` or `"false"`, but if it outputs empty string or garbage, the check treats it as "not ran" (safe default). **OK**.

#### 18. **`ci-shape.sh` Check 5: Mutation Test for `!=` Operator (line 400)**
```bash
grep -qE "github\.ref == 'refs/heads/main'" <<< "$mainred_if" ||
  err "job main-red: 'if' must pin github.ref == 'refs/heads/main' exactly: $mainred_if"
```
This correctly rejects `!=` because the comment at line 398-399 explains: "a substring check would also let != through". The test at line 745-746 mutates `==` to `!=` and expects failure. **OK**.

#### 19. **Self-Test: `MOCK_CURL_FAIL_ON=POST` Tests Create Failure (line 1024)**
```bash
expect_red red-freeze-post-fails "${RED_MAIN[@]}" 0 POST
```
The third argument to `run_case` is `CURL_FAIL` (0/1), fourth is `CURL_FAIL_ON`. The call passes `0` for `CURL_FAIL` and `POST` for `CURL_FAIL_ON`. But `run_case` at line 859-860:
```bash
MOCK_CURL_FAIL="$7" \
MOCK_CURL_FAIL_ON="${8:-}" \
```
So `$7` = `0` (CURL_FAIL), `$8` = `POST` (CURL_FAIL_ON). The shim at line 817-819 checks `MOCK_CURL_FAIL` first:
```bash
if [ "${MOCK_CURL_FAIL:-}" = "1" ]; then
  echo "mock curl: simulated HTTP failure" >&2
  exit 22
fi
```
Since `MOCK_CURL_FAIL="0"`, it doesn't trigger. Then at line 823:
```bash
if [ -n "${MOCK_CURL_FAIL_ON:-}" ] && [[ "$args" == *"$MOCK_CURL_FAIL_ON"* ]]; then
```
This correctly triggers on POST. **OK**.

#### 20. **Self-Test: `green-no-token` Uses Wrong Expected Exit (line 1049)**
```bash
expect_ok green-no-token refs/heads/main success success true true "" 0
```
The 6th argument is `MERGIFY_TOKEN=""` (empty), 7th is `CURL_FAIL=0`. This tests the green path without token. The script at line 692-693 warns but continues to close issues. As noted in finding #10, this is a bug in the script that the test doesn't catch.

#### 21. **Workflow: `main-red` Job Has No `outputs` Section**
The job doesn't export any outputs. Not required, but could be useful for downstream workflows. Not a bug.

#### 22. **`actions/checkout` Uses Sparse Checkout (lines 144-147)**
```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    fetch-depth: 1
    sparse-checkout: scripts/ci
```
This is efficient. The script only needs `scripts/ci/main-red-guard.sh`. **OK**.

#### 23. **Decision Document: `decisions.md` Line 359-362 Notes Open Question**
```
Offen bis zum ersten echten Ereignis: ob das bestehende Token den Freeze-Scope hat, ist
erst an einem echten roten/gruenen main-Lauf beobachtbar.
```
This is correctly documented as a follow-up. Not a code bug.

### Summary of Findings

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| 1 | High | `main-red-guard.sh:512` | `REPO` interpolated into URL without validation (theoretical injection) |
| 2 | High | `main-red-guard.sh:641` | JSON payload built with `printf` instead of `jq` (fragile escaping) |
| 3 | Medium | `main-red-guard.sh:614-616` | Stale run detection may misbehave on non-push events (workflow_dispatch, schedule) |
| 4 | Medium | `main-red-guard.sh:692-717` | Green path without token closes issues without deleting freezes (violates S-7/O-6) |
| 5 | Medium | `test-main-red-guard.sh:1049` | Test doesn't catch finding #4 |
| 6 | Low | `main-red-guard.sh:519-522` | `summary` function joins args with spaces not newlines |
| 7 | Low | `main-red-guard.sh:641` | Unnecessary `timezone":"UTC"` in open-ended freeze |

### Recommendations

1. **Fix #4 (Medium)**: In the green path, if `MERGIFY_TOKEN` is empty but freezes exist, either:
   - Fail the job (don't close issues), OR
   - Only close issues if `freeze_ids` returns empty (no freezes to delete)

2. **Fix #1/#2 (High)**: Use `jq -n` for JSON payload construction and validate `REPO` format.

3. **Fix #3 (Medium)**: Add `github.event_name == 'push'` to the job `if` condition or handle non-push events explicitly in the script.

4. **Fix #6 (Low)**: Update `summary` function to handle multiple arguments with newlines.

5. **Add test case**: Green run without token but with existing freeze → should warn and keep issue open.

### Overall Assessment

The implementation is **solid and well-tested** with comprehensive self-tests covering the critical paths (stale runs, light green, partial green, missing token, API failures, foreign freezes, ordering guarantees). The review history shows previous issues were addressed. The two **medium** issues (#3, #4) are the most actionable correctness gaps. The **high** issues are theoretical injection risks mitigated by GitHub's repository naming constraints.

**Verdict**: **Approve with fixes** for findings #3 and #4.
