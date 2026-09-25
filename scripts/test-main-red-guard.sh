#!/usr/bin/env bash
# Self-test for scripts/ci/main-red-guard.sh (CI-04).
#
# CI-04: a red run on main must open an issue (label `ci-red`, run ID in the
# body) and freeze the Mergify queue; a green run that actually ran BOTH
# lanes must lift the freeze and close the issue. This test pins that
# contract - including the failure modes that must NOT silently pass:
#   - a "light" green push (lanes skipped by lane-plan.sh) is no green
#     proof and must not unfreeze - and neither is a push where only ONE
#     lane really ran (review PR #182, sonnet S-6 / opus O-1);
#   - a light/partial push with an open ci-red freeze/issue must point at
#     the manual full run (`gh workflow run ci.yml`) - the merge push after
#     the hotfix is light by design (review PR #182, S-1 / O-3);
#   - the issue text must carry the ACTUAL freeze state, never claim a
#     freeze that was skipped or failed (review PR #182, S-3);
#   - a stale red run (its SHA is no longer the main head) must comment,
#     not freeze (review PR #182, S-5 / O-5);
#   - a freeze whose reason does not start with the marker must survive
#     the green sweep (review PR #182, S-4);
#   - the freeze is deleted BEFORE the issue is closed (review PR #182,
#     S-7 / O-6);
#   - without MERGIFY_TOKEN the issue is still opened and the freeze is
#     skipped with a warning (degraded, not red - the same pattern as the
#     Test-Insights upload in ci.yml);
#   - a failing freeze API call WITH a token is loud (exit 1) - for the
#     list, the create AND the delete path (review PR #182, S-4 / O-9);
#   - any ref that is not main is a no-op (double guard next to the job `if`).
#
# `curl` and `gh` are replaced by PATH shims that log every call to $MOCK_LOG
# and answer from $MOCK_FREEZES_JSON / $MOCK_ISSUES_JSON /
# $MOCK_MAIN_HEAD_SHA. No network, no secret, no real issue.
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SUT="${MAIN_RED_GUARD_SCRIPT:-$HERE/scripts/ci/main-red-guard.sh}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/main-red-guard.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0

if [ ! -f "$SUT" ]; then
  echo "FEHLER: $SUT fehlt (Red-first: Implementierung folgt)"
  exit 1
fi

# --- PATH shims ------------------------------------------------------------
mkdir -p "$tmp/bin"

cat > "$tmp/bin/curl" <<'SHIM'
#!/usr/bin/env bash
# one log line per call, even when a payload carries newlines
printf '%s\n' "curl $*" | tr '\n' ' ' >> "$MOCK_LOG"
echo >> "$MOCK_LOG"
args="$*"
if [ "${MOCK_CURL_FAIL:-}" = "1" ]; then
  echo "mock curl: simulated HTTP failure" >&2
  exit 22
fi
# selective failure: MOCK_CURL_FAIL_ON=POST fails every POST (create),
# =delete only the delete calls, =scheduled_freeze also the GET list
if [ -n "${MOCK_CURL_FAIL_ON:-}" ] && [[ "$args" == *"$MOCK_CURL_FAIL_ON"* ]]; then
  echo "mock curl: simulated failure on '$MOCK_CURL_FAIL_ON'" >&2
  exit 22
fi
case "$args" in
  *"/delete"*) echo '{}' ;;
  *"POST"*) echo '{"id":"frz_new","reason":"created"}' ;;
  *) cat "$MOCK_FREEZES_JSON" ;;
esac
SHIM

cat > "$tmp/bin/gh" <<'SHIM'
#!/usr/bin/env bash
printf '%s\n' "gh $*" | tr '\n' ' ' >> "$MOCK_LOG"
echo >> "$MOCK_LOG"
case "$*" in
  *"api repos"*) echo "${MOCK_MAIN_HEAD_SHA:-deadbeefcafe}" ;;
  *"issue list"*) cat "$MOCK_ISSUES_JSON" ;;
  *"issue create"*) echo "https://example.test/issues/99" ;;
esac
exit 0
SHIM

chmod +x "$tmp/bin/curl" "$tmp/bin/gh"

# --- case runner -----------------------------------------------------------
# case_run <name> <git_ref> <linux_result> <windows_result> <linux_ran>
#          <windows_ran> <token> <curl_fail> [curl_fail_on] [main_head_sha]
# freezes/issues answers come from $tmp/freezes.json / $tmp/issues.json,
# which each case writes first. Assertion of the log is left to the case.
run_case() {
  local name="$1"; shift
  : > "$tmp/log"
  MOCK_LOG="$tmp/log" \
  MOCK_FREEZES_JSON="$tmp/freezes.json" \
  MOCK_ISSUES_JSON="$tmp/issues.json" \
  MOCK_CURL_FAIL="$7" \
  MOCK_CURL_FAIL_ON="${8:-}" \
  MOCK_MAIN_HEAD_SHA="${9:-deadbeefcafe}" \
  PATH="$tmp/bin:$PATH" \
  GIT_REF="$1" LINUX_RESULT="$2" WINDOWS_RESULT="$3" \
  LINUX_RAN="$4" WINDOWS_RAN="$5" \
  MERGIFY_TOKEN="$6" GH_TOKEN="fake" \
  RUN_ID="424242" RUN_URL="https://example.test/runs/424242" \
  SHA="deadbeefcafe" REPO="owner/repo" \
  bash "$SUT" > "$tmp/out" 2>&1
}

expect_ok() { # name ...
  local name="$1"; shift
  if run_case "$name" "$@"; then
    echo "ok   $name (exit 0)"
  else
    echo "FEHLER $name: exit != 0"
    sed 's/^/    /' "$tmp/out"
    fails=$((fails + 1))
  fi
}

expect_red() { # name ...
  local name="$1"; shift
  if run_case "$name" "$@"; then
    echo "FEHLER $name: exit 0, erwartet Fehler"
    sed 's/^/    /' "$tmp/out"
    fails=$((fails + 1))
  else
    echo "ok   $name (laut rot)"
  fi
}

log_has() { # name pattern
  if grep -qE -- "$2" "$tmp/log"; then
    echo "ok   $1"
  else
    echo "FEHLER $1: Muster '$2' fehlt im Aufrufprotokoll:"
    sed 's/^/    /' "$tmp/log"
    fails=$((fails + 1))
  fi
}

log_lacks() { # name pattern
  if grep -qE -- "$2" "$tmp/log"; then
    echo "FEHLER $1: Muster '$2' darf nicht im Aufrufprotokoll stehen:"
    sed 's/^/    /' "$tmp/log"
    fails=$((fails + 1))
  else
    echo "ok   $1"
  fi
}

# log_before name pattern1 pattern2 — first match of pattern1 must precede
# first match of pattern2 in the call log.
log_before() {
  local n1 n2
  n1="$(grep -nE -- "$2" "$tmp/log" | head -1 | cut -d: -f1)"
  n2="$(grep -nE -- "$3" "$tmp/log" | head -1 | cut -d: -f1)"
  if [ -n "$n1" ] && [ -n "$n2" ] && [ "$n1" -lt "$n2" ]; then
    echo "ok   $1"
  else
    echo "FEHLER $1: '$2' (Zeile ${n1:-keine}) nicht vor '$3' (Zeile ${n2:-keine}):"
    sed 's/^/    /' "$tmp/log"
    fails=$((fails + 1))
  fi
}

out_has() { # name pattern
  if grep -qE -- "$2" "$tmp/out"; then
    echo "ok   $1"
  else
    echo "FEHLER $1: Muster '$2' fehlt in der Ausgabe:"
    sed 's/^/    /' "$tmp/out"
    fails=$((fails + 1))
  fi
}

# Args for run_case beyond the name:
#   GIT_REF LINUX_RESULT WINDOWS_RESULT LINUX_RAN WINDOWS_RAN
#   MERGIFY_TOKEN CURL_FAIL [CURL_FAIL_ON] [MAIN_HEAD_SHA]
#   (freezes/issues via files)
RED_MAIN=(refs/heads/main failure success true true mut-fake)
RED_WINDOWS=(refs/heads/main success failure true true mut-fake)
GREEN_MAIN=(refs/heads/main success success true true mut-fake)
PARTIAL_MAIN=(refs/heads/main success success true false mut-fake)

# --- 1. red, nothing open: issue + freeze, both carry the run ID -----------
echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
echo '[]' > "$tmp/issues.json"
expect_ok red-fresh "${RED_MAIN[@]}" 0
log_has red-fresh-creates-label 'gh label create .*ci-red'
log_has red-fresh-creates-issue 'gh issue create .*--label ci-red'
log_has red-fresh-issue-has-run-id 'gh issue create .*424242'
log_has red-fresh-creates-freeze 'curl .*POST .*scheduled_freeze'
log_has red-fresh-freeze-has-run-id 'curl .*ci-red:.*424242'
log_has red-fresh-freeze-scoped-main 'base=main'
log_has red-fresh-freeze-hotfix-exception 'label=hotfix'
# the issue reports the freeze only because it really happened (S-3)
log_has red-fresh-issue-states-freeze 'gh issue create .*wurde eingefroren'

# --- 2. red, already open: comment instead of duplicate, no second freeze --
echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
echo '[{"number":7}]' > "$tmp/issues.json"
expect_ok red-duplicate "${RED_MAIN[@]}" 0
log_lacks red-duplicate-no-new-issue 'gh issue create'
log_has red-duplicate-comments 'gh issue comment '
log_has red-duplicate-comment-states-freeze 'gh issue comment .*eingefroren'
log_lacks red-duplicate-no-second-freeze 'curl .*POST .*scheduled_freeze'

# --- 3. green, both lanes ran: freeze deleted BEFORE the issue is closed ---
echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
echo '[{"number":7}]' > "$tmp/issues.json"
expect_ok green-unfreeze "${GREEN_MAIN[@]}" 0
log_has green-unfreeze-deletes 'curl .*POST .*scheduled_freeze/frz1/delete'
log_has green-unfreeze-closes-issue 'gh issue close 7'
log_before green-unfreeze-order 'curl .*scheduled_freeze/frz1/delete' 'gh issue close 7'

# --- 3b. green, foreign freeze present: only the marker freeze is deleted --
echo '{"scheduled_freezes":[{"id":"frzX","reason":"manual maintenance freeze"},{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
echo '[{"number":7}]' > "$tmp/issues.json"
expect_ok green-foreign-freeze "${GREEN_MAIN[@]}" 0
log_has green-foreign-deletes-ours 'curl .*POST .*scheduled_freeze/frz1/delete'
log_lacks green-foreign-keeps-theirs 'frzX/delete'

# --- 4. green, but both lanes skipped (light push): NO unfreeze, and with --
# --- an open freeze/issue the notice points at the manual full run --------
echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
echo '[{"number":7}]' > "$tmp/issues.json"
expect_ok green-light refs/heads/main success success false false mut-fake 0
log_lacks green-light-no-delete 'curl .*POST .*delete'
log_lacks green-light-no-close 'gh issue close'
out_has green-light-says-why 'light|leicht|nicht gelaufen|skipped|run=false'
out_has green-light-dispatch-hint 'workflow run ci\.yml|workflow_dispatch'

# --- 4b. green, only ONE lane ran: still no green proof (S-6/O-1) ----------
expect_ok green-partial "${PARTIAL_MAIN[@]}" 0
log_lacks green-partial-no-delete 'curl .*POST .*delete'
log_lacks green-partial-no-close 'gh issue close'
out_has green-partial-dispatch-hint 'workflow run ci\.yml|workflow_dispatch'

# --- 5. cancelled run: no-op ------------------------------------------------
expect_ok cancelled-noop refs/heads/main cancelled success true true mut-fake 0
log_lacks cancelled-noop-no-issue 'gh issue (create|comment)'
log_lacks cancelled-noop-no-freeze 'curl .*POST'

# --- 6. red without MERGIFY_TOKEN: issue yes, freeze skipped with warning, -
# --- and the issue must NOT claim a freeze that never happened (S-3) -------
echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
echo '[]' > "$tmp/issues.json"
expect_ok red-no-token refs/heads/main failure success true true "" 0
log_has red-no-token-creates-issue 'gh issue create'
log_lacks red-no-token-no-curl 'curl'
out_has red-no-token-warns 'warning|MERGIFY_TOKEN'
log_lacks red-no-token-no-freeze-claim 'gh issue create .*wurde eingefroren'
log_has red-no-token-issue-honest 'gh issue create .*manuell'

# --- 7. red, freeze API fails WITH token: loud red, issue still written ----
echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
echo '[]' > "$tmp/issues.json"
expect_red red-freeze-api-fails "${RED_MAIN[@]}" 1
log_has red-freeze-api-fails-issue 'gh issue create'

# --- 7b. red, only the freeze POST fails: loud red, honest issue (O-9) -----
expect_red red-freeze-post-fails "${RED_MAIN[@]}" 0 POST
log_has red-freeze-post-fails-issue 'gh issue create .*NICHT'

# --- 7c. red, but the SHA is no longer the main head: comment, no freeze ---
echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
echo '[{"number":7}]' > "$tmp/issues.json"
expect_ok red-stale-sha "${RED_MAIN[@]}" 0 "" ffff0000aaaabbbb
log_has red-stale-checks-head 'gh api .*commits/main'
log_lacks red-stale-no-freeze 'curl .*POST'
log_lacks red-stale-no-new-issue 'gh issue create'
log_has red-stale-comments 'gh issue comment '

# --- 7d. red on the windows lane only: issue names the lane -----------------
echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
echo '[]' > "$tmp/issues.json"
expect_ok red-windows "${RED_WINDOWS[@]}" 0
log_has red-windows-names-lane 'gh issue create .*windows'

# --- 7e. green, freeze delete fails: loud red, issue stays open ------------
echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
echo '[{"number":7}]' > "$tmp/issues.json"
expect_red green-delete-fails "${GREEN_MAIN[@]}" 0 delete
log_lacks green-delete-fails-no-close 'gh issue close'

# --- 7f. green without MERGIFY_TOKEN: issues closed, delete warned ---------
expect_ok green-no-token refs/heads/main success success true true "" 0
log_has green-no-token-closes 'gh issue close 7'
out_has green-no-token-warns 'warning|MERGIFY_TOKEN'

# --- 8. not main: no-op even when red ---------------------------------------
echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
echo '[]' > "$tmp/issues.json"
expect_ok not-main refs/heads/claude/ci-04 failure failure true true mut-fake 0
log_lacks not-main-no-issue 'gh issue create'
log_lacks not-main-no-freeze 'curl'

if [ "$fails" -gt 0 ]; then
  echo "test-main-red-guard: $fails Fehler"
  exit 1
fi
echo "test-main-red-guard: alle Faelle gruen"
