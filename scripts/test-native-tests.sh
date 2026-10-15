#!/usr/bin/env bash
# Regression test for native-tests.sh: grep -q must not turn a long listing
# into a SIGPIPE failure under pipefail.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

expected_names=(
  real_native_host_commits_checkpoints_before_registry_and_final_handler_retire
  real_native_completed_receipt_survives_sqlite_writer_within_busy_timeout
  real_native_owner_window_starts_at_reservation_not_at_fixture_build
  real_native_job_revokes_credentials_before_retirement_or_reconciliation
  real_native_runner_dispatches_owned_job_and_joins_completion
  real_native_runner_bounds_capacity_and_accepts_out_of_order_completion
  real_native_runner_retains_failed_completion_during_drain
  real_native_launch_service_owns_worktree_credentials_and_exit
  real_native_supervisor_retains_failed_run_after_completion
  real_native_provider_exit_before_input_delivery_reconciles_as_exited
  real_native_owned_host_waits_for_pending_checkpoints_after_an_undelivered_exit
)
mapfile -t configured_names < <(
  sed -n '/^EXPECTED=(/,/^)/ { /real_native_/ { s/^[[:space:]]*//; p; } }' \
    "$ROOT/scripts/ci/native-tests.sh"
)
if [ "${#configured_names[@]}" -ne 11 ]; then
  echo "FAIL: native-tests.sh must keep exactly eleven real_native_ tests" >&2
  exit 1
fi
for index in "${!expected_names[@]}"; do
  if [ "${configured_names[$index]}" != "${expected_names[$index]}" ]; then
    echo "FAIL: native-tests.sh changed the expected test inventory" >&2
    exit 1
  fi
done
# KI-30 is fixed at its cause (undelivered exit drains its checkpoints), so the
# temporary serial mitigation must not come back silently.
if ! grep -Fxq \
  'cargo test --bin projecta real_native_ -- --ignored' \
  "$ROOT/scripts/ci/native-tests.sh"; then
  echo "FAIL: native-tests.sh must run the eleven tests without --test-threads" >&2
  exit 1
fi

mkdir -p "$tmp/bin" "$tmp/target/debug"
cat > "$tmp/bin/cargo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  build\ --bin\ pa-capture-host) exit 0 ;;
  test\ --bin\ projecta\ real_native_\ --\ --ignored\ --list)
    listing="$(cat <<'LIST'
projecta::real_native_host_commits_checkpoints_before_registry_and_final_handler_retire: test
projecta::real_native_completed_receipt_survives_sqlite_writer_within_busy_timeout: test
projecta::real_native_owner_window_starts_at_reservation_not_at_fixture_build: test
projecta::real_native_job_revokes_credentials_before_retirement_or_reconciliation: test
projecta::real_native_runner_dispatches_owned_job_and_joins_completion: test
projecta::real_native_runner_bounds_capacity_and_accepts_out_of_order_completion: test
projecta::real_native_runner_retains_failed_completion_during_drain: test
projecta::real_native_launch_service_owns_worktree_credentials_and_exit: test
projecta::real_native_supervisor_retains_failed_run_after_completion: test
projecta::real_native_provider_exit_before_input_delivery_reconciles_as_exited: test
projecta::process_capture::managed::tests::real_native_owned_host_waits_for_pending_checkpoints_after_an_undelivered_exit: test
LIST
)"
    while IFS= read -r line; do
      [ "$line" = "projecta::${MOCK_MISSING_NATIVE:-}: test" ] || echo "$line"
    done <<< "$listing"
    if [ "${MOCK_EXTRA_NATIVE:-0}" = 1 ]; then
      echo 'projecta::real_native_unconfigured_test: test'
    fi
    for _ in $(seq 1 20000); do echo filler; done
    ;;
  test\ --bin\ projecta\ real_native_\ --\ --ignored) exit 0 ;;
  *) echo "unexpected cargo invocation: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/cargo"
cat > "$tmp/bin/uname" <<'EOF'
#!/usr/bin/env bash
echo Linux
EOF
chmod +x "$tmp/bin/uname"
cat > "$tmp/target/debug/pa-capture-host.exe" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$tmp/target/debug/pa-capture-host.exe"

if ! PATH="$tmp/bin:$PATH" OS=Windows_NT CARGO_TARGET_DIR="$tmp/target" \
  bash "$ROOT/scripts/ci/native-tests.sh" > "$tmp/out" 2>&1; then
  cat "$tmp/out"
  echo "FAIL: native-tests.sh rejected a valid long test listing" >&2
  exit 1
fi
grep -q 'alle 11 erwarteten Tests sind vorhanden' "$tmp/out"
echo 'ok   native-tests handles long listings without SIGPIPE'
echo 'ok   native-tests runs the complete eleven-test inventory in parallel'

if PATH="$tmp/bin:$PATH" OS=Windows_NT CARGO_TARGET_DIR="$tmp/target" MOCK_EXTRA_NATIVE=1 \
  bash "$ROOT/scripts/ci/native-tests.sh" > "$tmp/out" 2>&1; then
  echo "FAIL: native-tests.sh accepted a real_native_ test missing from EXPECTED" >&2
  exit 1
fi
grep -q 'real_native_unconfigured_test' "$tmp/out"
echo 'ok   native-tests rejects tests missing from EXPECTED'

for name in "${expected_names[1]}" "${expected_names[2]}"; do
  if PATH="$tmp/bin:$PATH" OS=Windows_NT CARGO_TARGET_DIR="$tmp/target" MOCK_MISSING_NATIVE="$name" \
    bash "$ROOT/scripts/ci/native-tests.sh" > "$tmp/out" 2>&1; then
    echo "FAIL: native-tests.sh accepted a listing missing $name" >&2
    exit 1
  fi
  grep -q "erwarteter nativer Test fehlt oder wurde umbenannt: $name" "$tmp/out"
done
echo 'ok   native-tests rejects listings missing either newly inventoried test'
