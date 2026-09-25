#!/usr/bin/env bash
# Selbsttest fuer scripts/ci/no-masked-output.sh: der Detektor muss den echten
# Fehler finden UND die harmlose Kommando-Substitution durchlassen. Ein
# Detektor, der nur ja sagt, ist kein Gate.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

check() { # name erwarteter_exit inhalt
  local name="$1" want="$2" body="$3"
  # Getrennte Zeile: `local a=1 b="$a"` sieht das eigene `a` unter `set -u`
  # nicht zuverlaessig - der Selbsttest ist beim ersten Lauf genau darueber
  # gestolpert.
  local d="$tmp/$name"
  mkdir -p "$d"
  printf '%s\n' "$body" > "$d/w.yml"
  bash scripts/ci/no-masked-output.sh "$d" > "$tmp/$name.log" 2>&1
  local got=$?
  if [ "$got" -ne "$want" ]; then
    echo "FEHLER $name: Exit $got, erwartet $want"; sed 's/^/    /' "$tmp/$name.log"; fails=$((fails + 1))
  else
    echo "ok   $name (Exit $got)"
  fi
}

check "tee-maskiert"      1 '        run: python3 x.py | tee -a "$GITHUB_OUTPUT"'
check "pipe-dann-append"  1 '        run: cat a | sort >> "$GITHUB_OUTPUT"'
check "geschweift"        1 '        run: a | b >> "${GITHUB_ENV}"'
check "substitution-ok"   0 '        run: echo "x=$(a | b)" >> "$GITHUB_OUTPUT"'
check "sauber"            0 '        run: printf "x=1\n" >> "$GITHUB_OUTPUT"'
check "keine-pipe"        0 '        run: echo "hallo"'

[ "$fails" -eq 0 ] && echo "alle Faelle grün" || echo "$fails Fall/Faelle rot"
[ "$fails" -eq 0 ]
