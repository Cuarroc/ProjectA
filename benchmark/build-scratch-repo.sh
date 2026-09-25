#!/usr/bin/env bash
# KB-1: baut das Benchmark-Scratch-Repo deterministisch auf.
# Feste Git-Identitaet + feste Commit-Daten => identische SHAs bei jedem Neuaufbau.
# Aufruf: bash benchmark/build-scratch-repo.sh
# Ergebnis: benchmark/scratch-repo mit main = B0, Tag B0, Tag B1 (Branch base-move),
#           T3_TREE = erwarteter Tree-OID der deterministischen T3-Konfliktloesung.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$HERE/scratch-repo"

export GIT_AUTHOR_NAME="F8 Benchmark"
export GIT_AUTHOR_EMAIL="f8-bench@example.test"
export GIT_COMMITTER_NAME="F8 Benchmark"
export GIT_COMMITTER_EMAIL="f8-bench@example.test"

D_B0="2026-09-09T09:00:00Z"
D_B1="2026-09-09T09:05:00Z"
D_T3W="2026-09-09T09:10:00Z"
D_T3M="2026-09-09T09:15:00Z"

rm -rf "$REPO"
mkdir -p "$REPO/src" "$REPO/test"
git -C "$REPO" init -q -b main
git -C "$REPO" config core.autocrlf false

# --- B0: Basis-Commit (T1: absichtlich roter Test; sub vertauscht die Operanden) ---
cat > "$REPO/package.json" <<'EOF'
{
  "name": "bench-scratch",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
EOF

cat > "$REPO/src/calc.js" <<'EOF'
export function add(a, b) {
  return a + b;
}

export function sub(a, b) {
  return b - a;
}
EOF

cat > "$REPO/test/calc.test.js" <<'EOF'
import test from 'node:test';
import assert from 'node:assert/strict';
import { add, sub } from '../src/calc.js';

test('add returns the sum of both numbers', () => {
  assert.equal(add(2, 3), 5);
});

test('sub subtracts the second number from the first', () => {
  assert.equal(sub(10, 4), 6);
});
EOF

cat > "$REPO/BENCH.txt" <<'EOF'
benchmark conflict file
base: initial line
EOF

git -C "$REPO" add -A
GIT_AUTHOR_DATE="$D_B0" GIT_COMMITTER_DATE="$D_B0" \
  git -C "$REPO" commit -q -m "B0: benchmark base (T1 red test planted)"
B0="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" tag B0 "$B0"

# --- B1: Base-Move fuer T3 (kollidiert mit der Task-Aenderung an BENCH.txt) ---
git -C "$REPO" checkout -q -b base-move
cat > "$REPO/BENCH.txt" <<'EOF'
benchmark conflict file
base: initial line
base-move: main advanced here
EOF
git -C "$REPO" add -A
GIT_AUTHOR_DATE="$D_B1" GIT_COMMITTER_DATE="$D_B1" \
  git -C "$REPO" commit -q -m "B1: base-move (main advances, collides with task3)"
B1="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" tag B1 "$B1"

# --- Referenzloesung fuer T3_TREE (wirft keinen Branch im Endzustand) ---
git -C "$REPO" checkout -q -b t3-ref "$B0"
cat > "$REPO/BENCH.txt" <<'EOF'
benchmark conflict file
base: initial line
task3: worker line
EOF
git -C "$REPO" add -A
GIT_AUTHOR_DATE="$D_T3W" GIT_COMMITTER_DATE="$D_T3W" \
  git -C "$REPO" commit -q -m "T3 reference: worker change"

set +e
git -C "$REPO" merge -q base-move >/dev/null 2>&1
set -e
# Deterministische Aufloesung (Regel aus benchmark/README.md):
# base-move-Zeile vor der task3-Zeile, beide am Dateiende.
cat > "$REPO/BENCH.txt" <<'EOF'
benchmark conflict file
base: initial line
base-move: main advanced here
task3: worker line
EOF
git -C "$REPO" add BENCH.txt
GIT_AUTHOR_DATE="$D_T3M" GIT_COMMITTER_DATE="$D_T3M" \
  git -C "$REPO" commit -q -m "T3 reference: deterministic resolution"
T3_TREE="$(git -C "$REPO" rev-parse 'HEAD^{tree}')"

# --- Endzustand einfrieren: main = B0, base-move = B1, Referenzbranch weg ---
git -C "$REPO" checkout -q main
git -C "$REPO" branch -q -D t3-ref

echo "B0=$B0"
echo "B1=$B1"
echo "T3_TREE=$T3_TREE"
echo "--- git log --all --oneline ---"
git -C "$REPO" log --all --oneline
echo "--- refs ---"
git -C "$REPO" show-ref
