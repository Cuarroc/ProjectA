#!/usr/bin/env bash
# Baut pa-capture-host und fuehrt die #[ignore]-Tests aus, die einen echten
# Windows-Kindprozess brauchen (ConPTY, Job-Objekt, das gebaute Host-Binary).
#
# Herkunft: bis W3-06 stand dieser Ablauf als eigener pwsh-Schritt in
# .github/workflows/ci.yml ("Gate - native Parent-Host-Prozessgrenze"),
# ausserhalb von scripts/ci/gates.sh - genau die Drift, gegen die gates.sh
# laut seinem eigenen Kopfkommentar antritt (die Gate-Liste stand bis 09.09.
# fuenffach da). Jetzt eine Quelle; der Befehl ist woertlich derselbe, nur
# von pwsh nach bash uebertragen (der Default dieser Datei ist ohnehin
# Git-Bash, siehe .github/workflows/ci.yml).
#
# Welche neun #[ignore]-Tests das Repo fuer den nativen Capture-Host kennt
# (docs/PLAN.md W3-06), und warum hier nur acht laufen:
#
#   - 5 in src-tauri/src/store/native_managed_tests.rs (real_native_*)
#   - 3 in src-tauri/src/workers.rs                     (real_native_*)
#   - 1 in src-tauri/src/process_capture/windows_capture.rs:
#       native_argument_fixture. Das ist kein eigenstaendiger Test, sondern
#       ein isolierter Kind-Prozess-Fixture: neun ANDERE, NICHT ignorierte
#       Tests derselben Datei (seit W2-08a auch stall/trickle/flood)
#       starten ihn selbst per current_exe()+--exact
#       mit PA_CAPTURE_FIXTURE_MODE gesetzt. Ohne diese Variable direkt
#       gestartet, panict er bewusst ("fixture must only run with explicit
#       isolated mode") - das ist sein Vertrag, kein stumm ausgeklammerter
#       Test. Er laeuft ohnehin schon jedes Mal, wenn diese neun Tests im
#       Gate rust-suite laufen (sie liegen in der projecta_capture-Bibliothek,
#       AGENTS.md: "the shared native capture tests run once in the
#       projecta_capture library" - dort auch fuer die anderen zwei
#       Binaer-Ziele, ohne Verdreifachung).
#
# Die restlichen sechs #[ignore]-Tests im Repo brauchen etwas anderes als
# den Capture-Host und gehoeren nicht hierher: drei in testutil.rs reden mit
# echten CLIs (kimi/opencode/claude), einer in omniroute.rs braucht ein
# lebendes OmniRoute samt Management-Token, zwei in store.rs regenerieren
# Testdaten-Fixtures bzw. brauchen PA_PROD_DB_COPY.
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"

case "${OS:-}$(uname -s 2>/dev/null)" in
  *Windows_NT*|MINGW*|MSYS*|CYGWIN*) ;;
  *)
    echo "::error::native-tests.sh braucht ein echtes Windows (ConPTY, gebautes .exe) - kein Ersatz auf Linux/macOS moeglich. Plattform hier: $(uname -s 2>/dev/null || echo unbekannt)" >&2
    exit 1
    ;;
esac

cd "$ROOT/src-tauri" || exit 1

echo ">>> baue pa-capture-host"
cargo build --bin pa-capture-host
rc=$?
[ "$rc" -eq 0 ] || { echo "::error::cargo build --bin pa-capture-host: Exit $rc" >&2; exit "$rc"; }

echo ">>> Selbsttest der Parent/Host-Prozessgrenze"
"${CARGO_TARGET_DIR:-target}/debug/pa-capture-host.exe" --self-test-host
rc=$?
[ "$rc" -eq 0 ] || { echo "::error::pa-capture-host --self-test-host: Exit $rc" >&2; exit "$rc"; }

# Die acht erwarteten Testnamen. Erst in eine Variable, dann pruefen -
# `cargo test ... --list | grep ...` unter `pipefail` waere anfaellig fuer
# genau die SIGPIPE-Falle, die scripts/test-gates.sh fuer gates.sh selbst
# dokumentiert (frueher Abbruch von grep -> Exit 141 statt eines echten
# Befundes).
EXPECTED=(
  real_native_host_commits_checkpoints_before_registry_and_final_handler_retire
  real_native_job_revokes_credentials_before_retirement_or_reconciliation
  real_native_runner_dispatches_owned_job_and_joins_completion
  real_native_runner_bounds_capacity_and_accepts_out_of_order_completion
  real_native_runner_retains_failed_completion_during_drain
  real_native_launch_service_owns_worktree_credentials_and_exit
  real_native_supervisor_retains_failed_run_after_completion
  real_native_provider_exit_before_input_delivery_reconciles_as_exited
)

echo ">>> pruefe, dass alle acht erwarteten nativen Tests existieren (kein gruen durch Abwesenheit)"
listed="$(cargo test --bin projecta real_native_ -- --ignored --list)"
rc=$?
[ "$rc" -eq 0 ] || { echo "::error::cargo test --list: Exit $rc" >&2; exit "$rc"; }

missing=0
for name in "${EXPECTED[@]}"; do
  if ! printf '%s\n' "$listed" | grep -q "::${name}: test\$"; then
    echo "::error::erwarteter nativer Test fehlt oder wurde umbenannt: $name" >&2
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 1
echo "alle acht erwarteten Tests sind vorhanden:"
printf '  - %s\n' "${EXPECTED[@]}"

echo ">>> fuehre die acht nativen Tests aus (--ignored)"
cargo test --bin projecta real_native_ -- --ignored
