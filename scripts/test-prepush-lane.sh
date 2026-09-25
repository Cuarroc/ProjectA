#!/usr/bin/env bash
# Selbsttest fuer scripts/ci/prepush-lane.sh (CI-02).
#
# Belegt: ohne Schalter bleibt pre-push voll; PA_PREPUSH=light macht
# Branch-Pushes leicht, aber nie einen Push nach main; ein unbekannter Wert
# ist ein Fehler, kein stilles Raten. Und dass die Bahn, die das Skript
# nennt, in gates.sh existiert und nicht leer ist.
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
LANE="$HERE/scripts/ci/prepush-lane.sh"
fails=0
[ -f "$LANE" ] || { echo "FEHLER: $LANE fehlt"; exit 1; }

Z=0000000000000000000000000000000000000000
branch="refs/heads/claude/x $Z refs/heads/claude/x $Z"
main="refs/heads/main $Z refs/heads/main $Z"

check() { # fall erwartete_bahn erwarteter_exit modus stdin
  local got rc
  got="$(printf '%s\n' "$5" | PA_PREPUSH="$4" bash "$LANE" 2> /dev/null)"
  rc=$?
  if [ "$rc" -eq "$3" ] && [ "$got" = "$2" ]; then
    echo "ok   $1 (${got:-leer}, Exit $rc)"
  else
    echo "FEHLER $1: '$got' Exit $rc, erwartet '$2' Exit $3"
    fails=$((fails + 1))
  fi
}

check standard-voll          prepush    0 ""      "$branch"
check full-voll              prepush    0 full    "$branch"
check light-branch           branchpush 0 light   "$branch"
check light-nach-main        prepush    0 light   "$main"
check light-branch-und-main  prepush    0 light   "$branch
$main"
check light-master           prepush    0 light   "refs/heads/master $Z refs/heads/master $Z"
check unbekannter-wert       ""         2 schnell "$branch"

# Die genannte Bahn muss es geben - sonst endet der Hook mit "Unbekannte Bahn".
ids="$(bash "$HERE/scripts/ci/gates.sh" --list branchpush 2>&1)"
if [ -n "$ids" ] && ! printf '%s' "$ids" | grep -q 'Unbekannte Bahn'; then
  echo "ok   bahn-branchpush-existiert"
else
  echo "FEHLER bahn-branchpush-existiert: $ids"; fails=$((fails + 1))
fi
# ... und sie ist wirklich leichter: kein clippy, keine Rust-Suite.
if printf '%s\n' "$ids" | grep -qxE 'clippy|rust-suite'; then
  echo "FEHLER branchpush-ist-leicht: enthaelt clippy/rust-suite"; fails=$((fails + 1))
else
  echo "ok   branchpush-ist-leicht"
fi

# Der Hook benutzt das Skript wirklich.
if grep -q 'scripts/ci/prepush-lane.sh' "$HERE/.githooks/pre-push"; then
  echo "ok   hook-benutzt-prepush-lane"
else
  echo "FEHLER hook-benutzt-prepush-lane"; fails=$((fails + 1))
fi

if [ "$fails" -gt 0 ]; then
  echo "test-prepush-lane: $fails Fehler"
  exit 1
fi
echo "test-prepush-lane: alle Faelle gruen"
