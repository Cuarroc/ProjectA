#!/usr/bin/env bash
# Probe fuer den Merge-Treiber `hqdata` (.gitattributes + .githooks/merge-hqdata).
#
# Prueft beide Richtungen in einem frischen Temp-Repo, weil eine Pruefung, die
# nicht scheitern kann, nichts prueft (AGENTS.md, Arbeitsregel 2):
#   1. OHNE registrierten Treiber kollidieren zwei Momentaufnahmen  -> Konflikt
#   2. MIT registriertem Treiber kollidieren dieselben zwei nicht    -> sauber
#
# Laeuft ohne Netz und ohne node; die Momentaufnahmen werden hier direkt
# geschrieben, weil geprueft wird, wie git sie zusammenfuehrt, nicht wie
# scripts/dev-hq.mjs sie erzeugt.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
DRIVER="$ROOT/.githooks/merge-hqdata"
[ -x "$DRIVER" ] || { echo "FEHLER: $DRIVER fehlt oder ist nicht ausfuehrbar"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

snapshot() { printf 'window.HQ_DATA = {\n  "generatedAt": "%s",\n  "commit": "%s"\n};\n' "$1" "$2"; }

setup_repo() {
  local dir="$1" with_driver="$2"
  rm -rf "$dir"; mkdir -p "$dir"; cd "$dir"
  git init -q .; git config user.email t@t; git config user.name t
  mkdir -p docs/dev-hq
  printf 'docs/dev-hq/data.js merge=hqdata\n' > .gitattributes
  if [ "$with_driver" = "ja" ]; then
    git config merge.hqdata.name "Probe"
    git config merge.hqdata.driver "$DRIVER %O %A %B %P"
  fi
  snapshot "2026-09-21T10:00:00Z" "aaaaaaa" > docs/dev-hq/data.js
  git add -A; git commit -qm basis
  git checkout -q -b zweig
  snapshot "2026-09-21T11:00:00Z" "bbbbbbb" > docs/dev-hq/data.js
  git commit -qam "zweig erzeugt neu"
  git checkout -q -
  snapshot "2026-09-21T12:00:00Z" "ccccccc" > docs/dev-hq/data.js
  git commit -qam "haupt erzeugt neu"
}

fehler=0

# --- 1. ohne Treiber: es MUSS kollidieren ------------------------------------
setup_repo "$TMP/ohne" "nein"
if git merge --no-edit zweig >/dev/null 2>&1; then
  echo "FEHLER: ohne Treiber gab es keinen Konflikt — die Probe kann nicht scheitern, taugt also nichts."
  fehler=1
else
  if grep -q '<<<<<<<' docs/dev-hq/data.js; then
    echo "ok   ohne Treiber: Konflikt wie erwartet (Konfliktmarken in data.js)"
  else
    echo "FEHLER: Merge scheiterte, aber ohne Konfliktmarken — anderer Grund als erwartet."
    fehler=1
  fi
fi

# --- 2. mit Treiber: es darf NICHT kollidieren -------------------------------
setup_repo "$TMP/mit" "ja"
if git merge --no-edit zweig >/dev/null 2>&1; then
  if grep -q '<<<<<<<' docs/dev-hq/data.js; then
    echo "FEHLER: Merge war erfolgreich, aber Konfliktmarken stehen in der Datei."
    fehler=1
  elif node -e "process.exit(0)" 2>/dev/null && ! grep -q 'HQ_DATA' docs/dev-hq/data.js; then
    echo "FEHLER: die Momentaufnahme ist nach dem Merge unbrauchbar."
    fehler=1
  else
    echo "ok   mit Treiber: konfliktfrei, Datei bleibt eine gueltige Momentaufnahme"
  fi
else
  echo "FEHLER: mit Treiber kollidierte der Merge trotzdem."
  fehler=1
fi

cd "$ROOT"
if [ "$fehler" -eq 0 ]; then
  echo "test-hqdata-merge: beide Richtungen wie erwartet."
else
  echo "test-hqdata-merge: FEHLGESCHLAGEN."
fi
exit "$fehler"
