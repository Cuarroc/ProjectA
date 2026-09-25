#!/usr/bin/env bash
# Verbietet, dass eine Pipe den Exit-Code eines Schreibvorgangs nach
# $GITHUB_OUTPUT / $GITHUB_ENV verschluckt.
#
# Warum: GitHub startet `run:` als `bash -e {0}` OHNE `pipefail` - der Status
# einer Pipe ist der ihres LETZTEN Glieds. `python3 x.py | tee -a
# "$GITHUB_OUTPUT"` meldet also Erfolg, auch wenn x.py mit 1 endet. Genau das
# ist am 05.09. in review.yml passiert (zwei statt drei Reviewer, Job gruen).
#
# Warum als Skript und nicht als grep im Workflow: der Detektor darf nicht
# seine eigene Definition finden. Ausserhalb von .github/workflows/ ist das
# strukturell geloest statt durch eine Regex-Feinheit.
#
# Aufruf: scripts/ci/no-masked-output.sh [verzeichnis]   (Standard: .github/workflows)
set -uo pipefail
dir="${1:-.github/workflows}"
var_pattern='\$\{?GITHUB_(OUTPUT|ENV)\}?'

hits=0
for f in "$dir"/*.yml "$dir"/*.yaml; do
  [ -f "$f" ] || continue
  # Kommando-Substitutionen zuerst entfernen. Eine Pipe INNERHALB von $(...)
  # ist harmlos - `echo "x=$(a | b)" >> "$GITHUB_OUTPUT"` schreibt korrekt und
  # meldet den Status des echo. Ohne diesen Schritt lehnt das Gate genau die
  # richtigen Zeilen ab und erzeugt das rote Rauschen, das es verhindern soll.
  # (Befund des externen Dual-Reviews zu PR #29, Sonnet-Protokoll Nr. 3.)
  stripped="$(sed 's/\$([^()]*)//g' "$f")"
  if printf '%s\n' "$stripped" | grep -nE "\|.*${var_pattern}" > /dev/null; then
    echo "$f:"
    printf '%s\n' "$stripped" | grep -nE "\|.*${var_pattern}" | sed 's/^/  /'
    hits=$((hits + 1))
  fi
done

if [ "$hits" -gt 0 ]; then
  echo "::error::Eine Pipe schreibt nach GITHUB_OUTPUT/GITHUB_ENV - der Exit-Code links der Pipe geht verloren. Erst in eine Datei schreiben, dann anhaengen."
  exit 1
fi
echo "keine maskierten Exit-Codes in $dir"
