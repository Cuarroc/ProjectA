#!/usr/bin/env bash
# Selbsttest: die Hooks pruefen den Arbeitsbaum, der committet/pusht - nicht
# den, in dem die Hook-Dateien liegen (CI-02, Koordinator-Befund 24.09.).
#
# Anlass: core.hooksPath stand absolut auf <hauptcheckout>/.githooks. Die
# Hooks bestimmten ROOT aus ihrem eigenen Pfad ("$(dirname "$0")/.."), also
# lief jeder Commit/Push aus einem Worktree die Gates des HAUPTCHECKOUTS -
# gruen oder rot fuer einen Baum, der gar nicht gepusht wurde. Das ist "gruen
# durch Abwesenheit" (AGENTS.md). Richtig: git startet Hooks mit cwd = Toplevel
# des Arbeitsbaums, ROOT ist also `git rev-parse --show-toplevel`.
#
# Aufbau: ein Repo "haupt" mit den echten Hooks aus .githooks und Stubs fuer
# gates.sh, prepush-lane.sh und lib/test-first.sh, die ihren eigenen Ort ins
# Protokoll schreiben; ein Worktree "wt" davon; core.hooksPath absolut auf
# haupt/.githooks. Dann Commit und Push AUS dem Worktree - jeder Stub-Aufruf
# muss aus wt kommen.
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0
fail() { echo "FEHLER $*"; fails=$((fails + 1)); }

export HOOK_LOG="$TMP/hook.log"
: > "$HOOK_LOG"

H="$TMP/haupt"
mkdir -p "$H/.githooks" "$H/scripts/ci" "$H/scripts/lib"
for h in pre-commit pre-push commit-msg; do
  cp "$HERE/.githooks/$h" "$H/.githooks/$h"
  chmod +x "$H/.githooks/$h"
done

# Stubs: jeder schreibt "<name> <eigenes Toplevel>" ins Protokoll.
cat > "$H/scripts/ci/gates.sh" << 'EOF'
#!/usr/bin/env bash
echo "gates $(CDPATH= cd -- "$(dirname "$0")/../.." && pwd) $*" >> "$HOOK_LOG"
exit 0
EOF
cat > "$H/scripts/ci/prepush-lane.sh" << 'EOF'
#!/usr/bin/env bash
cat > /dev/null
echo "prepush-lane $(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)" >> "$HOOK_LOG"
echo prepush
EOF
cat > "$H/scripts/lib/test-first.sh" << 'EOF'
echo "test-first $(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" >> "$HOOK_LOG"
tf_subject_skips_hook() { return 0; }
EOF

g() { git -C "$1" "${@:2}"; }
git init -q "$H"
g "$H" config user.name test
g "$H" config user.email test@example.invalid
g "$H" config core.autocrlf false
g "$H" add .
g "$H" -c core.hooksPath=/dev/null commit -qm base
git init -q --bare "$TMP/remote.git"
g "$H" remote add origin "$TMP/remote.git"

W="$TMP/wt"
g "$H" worktree add -q -b topic "$W"
# Wie im echten Repo: absolut auf die Hooks des Hauptcheckouts.
g "$H" config core.hooksPath "$H/.githooks"
H_ABS="$(CDPATH= cd -- "$H" && pwd)"
W_ABS="$(CDPATH= cd -- "$W" && pwd)"

echo wt > "$W/datei.txt"
g "$W" add datei.txt
if ! g "$W" commit -qm "aus dem worktree" > "$TMP/commit.out" 2>&1; then
  fail "commit-im-worktree: $(cat "$TMP/commit.out")"
fi
if ! g "$W" push -q origin topic > "$TMP/push.out" 2>&1; then
  fail "push-aus-dem-worktree: $(cat "$TMP/push.out")"
fi

expect() { # fall stub
  local line
  line="$(grep "^$2 " "$HOOK_LOG" | head -1)"
  if [ -z "$line" ]; then
    fail "$1: $2 wurde nie aufgerufen (Protokoll: $(tr '\n' '|' < "$HOOK_LOG"))"
  elif [ "${line#"$2 $W_ABS"}" != "$line" ]; then
    echo "ok   $1"
  else
    fail "$1: $line - erwartet Toplevel $W_ABS, nicht $H_ABS"
  fi
}

expect pre-commit-prueft-worktree   "gates"
expect commit-msg-liest-worktree    "test-first"
expect pre-push-plant-im-worktree   "prepush-lane"
# Jede Gate-Zeile muss aus dem Worktree kommen (pre-commit UND pre-push).
if grep "^gates " "$HOOK_LOG" | grep -qv "^gates $W_ABS "; then
  fail "alle-gates-im-worktree: $(grep '^gates ' "$HOOK_LOG" | tr '\n' '|')"
elif [ "$(grep -c '^gates ' "$HOOK_LOG")" -lt 2 ]; then
  fail "alle-gates-im-worktree: erwartet pre-commit und pre-push, Protokoll: $(tr '\n' '|' < "$HOOK_LOG")"
else
  echo "ok   alle-gates-im-worktree"
fi

if [ "$fails" -gt 0 ]; then
  echo "test-hook-root: $fails Fehler"
  exit 1
fi
echo "test-hook-root: alle Faelle gruen"
