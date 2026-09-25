#!/usr/bin/env bash
# Laeuft einen Test n-mal und zaehlt die Fehlschlaege. Der Akzeptanz-Nachweis
# fuer G-2: ein Test, der 0/n faellt, ist nicht mehr nicht-deterministisch.
# Kein Ersatz fuer einen deterministischen roten Test (Sanierungsplan §0.1) -
# die Schleife belegt Stabilitaet, nicht Korrektheit.
#
# Aufruf: scripts/flake.sh <test-filter> [laeufe]   (Standard: 20)
# <test-filter> ist ein TEILSTRING des Testnamens, kein exakter Name; der
# Filter geht als `test(<filter>)` an nextest.
set -uo pipefail
test_filter="${1:?Aufruf: scripts/flake.sh <test-filter> [laeufe]}"
runs="${2:-20}"

# Ein nicht-numerisches `laeufe` machte aus `seq 1 abc` eine leere Schleife:
# 0 Fehlschlaege, Exit 0 - ein gruener Nachweis, ohne einen einzigen Test
# auszufuehren. Genau das darf ein Beweismittel nicht koennen.
case "$runs" in
  '' | *[!0-9]*)
    echo "laeufe muss eine positive Ganzzahl sein, war: '$runs'" >&2
    exit 2
    ;;
esac
if [ "$runs" -le 0 ]; then
  echo "laeufe muss groesser als 0 sein, war: $runs" >&2
  exit 2
fi

cd "$(dirname "$0")/../src-tauri" || exit 1

# Vorprobe: trifft der Filter ueberhaupt einen Test? Vorher lief ein Filter ins
# Leere n-mal "rot" durch und meldete einen gruenen Test als nicht-deterministisch.
#
# stderr geht NICHT nach /dev/null: schlaegt `cargo nextest list` an einem
# Kompilierfehler fehl, soll der Fehler dastehen und nicht als "Filter trifft
# keinen Test" verkleidet werden. Das ist dieselbe Fehlerklasse - eine
# verschluckte Meldung -, die dieses Skript und das CI-Gate sonst bekaempfen.
# (Befund des externen Dual-Reviews zu PR #29, Sonnet-Protokoll Nr. 5.)
liste="$(mktemp)"
if ! cargo nextest list --profile ci -E "test($test_filter)" > "$liste" 2> "$liste.err"; then
  echo "cargo nextest list ist fehlgeschlagen - der echte Fehler:" >&2
  cat "$liste.err" >&2
  rm -f "$liste" "$liste.err"
  exit 2
fi
matched="$(grep -c '::' "$liste")"
rm -f "$liste" "$liste.err"
if [ "$matched" -eq 0 ]; then
  echo "Filter trifft keinen Test: $test_filter" >&2
  exit 2
fi

log_dir="$(mktemp -d)"
echo "$test_filter: $matched Test(s), $runs Laeufe, Logs in $log_dir"

failures=0
ran=0
for i in $(seq 1 "$runs"); do
  if ! cargo nextest run --profile ci -E "test($test_filter)" >"$log_dir/lauf-$i.log" 2>&1; then
    failures=$((failures + 1))
    echo "Lauf $i: rot -> $log_dir/lauf-$i.log"
  fi
  ran=$((ran + 1))
done

echo "$test_filter: $failures/$ran Fehlschlaege"
# Beide Bedingungen: die Zahl der Laeufe ist Teil des Nachweises, nicht nur ihr
# Ausgang. Ein Nachweis ueber 0 Laeufe ist keiner.
[ "$ran" -eq "$runs" ] && [ "$failures" -eq 0 ]
