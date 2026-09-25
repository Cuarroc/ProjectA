#!/usr/bin/env bash
# LIC-01: license gate for the public repository (lane linux,release).
# Both halves share one allowlist (scripts/lib/license-check.mjs and
# src-tauri/deny.toml). A license outside the list fails the gate — the fix
# is an orchestrator decision, not a local exception.
set -uo pipefail
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
fails=0

# --- Rust: cargo-deny -------------------------------------------------------
DENY_VERSION="0.20.2"
if ! cargo deny --version >/dev/null 2>&1; then
  echo "license-check: cargo-deny fehlt — installiere cargo-deny $DENY_VERSION (kann Minuten dauern)"
  cargo install cargo-deny --locked --version "$DENY_VERSION" || {
    echo "license-check: cargo-deny konnte nicht installiert werden"
    exit 1
  }
fi
( cd "$ROOT/src-tauri" && cargo deny check licenses ) || fails=1

# --- npm production dependencies --------------------------------------------
report="$(mktemp)"
trap 'rm -f "$report"' EXIT
( cd "$ROOT" && npx --yes license-checker-rseidelsohn --production --json ) > "$report" || {
  echo "license-check: license-checker-rseidelsohn fehlgeschlagen"
  exit 1
}
node "$ROOT/scripts/lib/license-check.mjs" "$report" || fails=1

exit "$fails"
