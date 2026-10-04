#!/usr/bin/env bash
# Regression test for native-tests.sh: grep -q must not turn a long listing
# into a SIGPIPE failure under pipefail.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

expected_names=(
  real_native_host_commits_checkpoints_before_registry_and_final_handler_retire
  real_native_job_revokes_credentials_before_retirement_or_reconciliation
  real_native_runner_dispatches_owned_job_and_joins_completion
  real_native_runner_bounds_capacity_and_accepts_out_of_order_completion
  real_native_runner_retains_failed_completion_during_drain
  real_native_launch_service_owns_worktree_credentials_and_exit
  real_native_supervisor_retains_failed_run_after_completion
  real_native_provider_exit_before_input_delivery_reconciles_as_exited
)
mapfile -t configured_names < <(
  sed -n '/^EXPECTED=(/,/^)/ { /real_native_/ { s/^[[:space:]]*//; p; } }' \
    "$ROOT/scripts/ci/native-tests.sh"
)
if [ "${#configured_names[@]}" -ne 8 ]; then
  echo "FAIL: native-tests.sh must keep exactly eight real_native_ tests" >&2
  exit 1
fi
for index in "${!expected_names[@]}"; do
  if [ "${configured_names[$index]}" != "${expected_names[$index]}" ]; then
    echo "FAIL: native-tests.sh changed the expected test inventory" >&2
    exit 1
  fi
done
if ! grep -Fxq \
  'cargo test --bin projecta real_native_ -- --ignored --test-threads=1' \
  "$ROOT/scripts/ci/native-tests.sh"; then
  echo "FAIL: native-tests.sh must run the eight tests serially" >&2
  exit 1
fi

mkdir -p "$tmp/bin" "$tmp/target/debug"
cat > "$tmp/bin/cargo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  build\ --bin\ pa-capture-host) exit 0 ;;
  test\ --bin\ projecta\ real_native_\ --\ --ignored\ --list)
    cat <<'LIST'
projecta::real_native_host_commits_checkpoints_before_registry_and_final_handler_retire: test
projecta::real_native_job_revokes_credentials_before_retirement_or_reconciliation: test
projecta::real_native_runner_dispatches_owned_job_and_joins_completion: test
projecta::real_native_runner_bounds_capacity_and_accepts_out_of_order_completion: test
projecta::real_native_runner_retains_failed_completion_during_drain: test
projecta::real_native_launch_service_owns_worktree_credentials_and_exit: test
projecta::real_native_supervisor_retains_failed_run_after_completion: test
projecta::real_native_provider_exit_before_input_delivery_reconciles_as_exited: test
LIST
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
grep -q 'alle acht erwarteten Tests sind vorhanden' "$tmp/out"
echo 'ok   native-tests handles long listings without SIGPIPE'
echo 'ok   native-tests serializes unchanged eight-test inventory'
