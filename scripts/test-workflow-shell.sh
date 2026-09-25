#!/usr/bin/env bash
# Selbsttest fuer scripts/ci/workflow-shell.sh. Ein Gate, das nicht scheitern
# kann, prueft nichts (AGENTS.md, Regel 2) - hier scheitert es einmal
# absichtlich, und der wichtigste Fall ist der letzte: ein `defaults:`-Block
# INNERHALB eines Jobs haertet nur diesen Job und darf nicht durchgehen.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

check() { # name erwarteter_exit inhalt
  local name="$1" want="$2" body="$3"
  local d="$tmp/$name"
  mkdir -p "$d"
  printf '%s\n' "$body" > "$d/w.yml"
  bash scripts/ci/workflow-shell.sh "$d" > "$tmp/$name.log" 2>&1
  local got=$?
  if [ "$got" -ne "$want" ]; then
    echo "FEHLER $name: Exit $got, erwartet $want"; sed 's/^/    /' "$tmp/$name.log"; fails=$((fails + 1))
  else
    echo "ok   $name (Exit $got)"
  fi
}

check "gehaertet" 0 'name: x
defaults:
  run:
    shell: bash

jobs:
  a:
    runs-on: ubuntu-latest'

check "fehlt-ganz" 1 'name: x

jobs:
  a:
    runs-on: ubuntu-latest'

check "defaults-ohne-shell" 1 'name: x
defaults:
  run:
    working-directory: src-tauri

jobs:
  a:
    runs-on: ubuntu-latest'

check "andere-shell" 1 'name: x
defaults:
  run:
    shell: pwsh

jobs:
  a:
    runs-on: ubuntu-latest'

# Der Fall, der die Regex-Variante schlagen wuerde: auf Job-Ebene sieht der
# Block identisch aus, haertet aber nur diesen einen Job.
check "nur-job-ebene" 1 'name: x

jobs:
  a:
    runs-on: ubuntu-latest
    defaults:
      run:
        shell: bash'

# --------------------------------------------------------------------------
# Die Geschwisterstelle: `defaults: run: shell: bash` zwingt AUCH auf
# windows-latest jeden run-Schritt auf Git-Bash. Ein pwsh-Schritt ohne eigenes
# `shell:` lief davor richtig und danach unter bash — gemessen am 21.09. beim
# Merge von main (`Gate - native Parent-Host-Prozessgrenze` in ci.yml).
# --------------------------------------------------------------------------
check "pwsh-ohne-shell" 1 'name: x
defaults:
  run:
    shell: bash

jobs:
  a:
    runs-on: windows-latest
    steps:
      - name: nativ
        run: |
          cargo build --bin pa-capture-host
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'

check "pwsh-mit-shell" 0 'name: x
defaults:
  run:
    shell: bash

jobs:
  a:
    runs-on: windows-latest
    steps:
      - name: nativ
        shell: pwsh
        run: |
          cargo build --bin pa-capture-host
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'

# Falsch-positiv-Gegenprobe: ein KOMMENTAR, der $LASTEXITCODE nur erklaert,
# ist kein PowerShell-Schritt. Genau daran schlug der Detektor beim ersten
# Entwurf an — an der Prosa, die ihn begruendet.
check "kommentar-ueber-lastexitcode" 0 'name: x
defaults:
  run:
    shell: bash

jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - name: harmlos
        run: echo hallo
      # Hinweis: $LASTEXITCODE gibt es in bash nicht.
      - name: auch harmlos
        run: echo tschuess'

# Und die Zuordnung muss stimmen: der Marker im ZWEITEN Schritt darf nicht dem
# ersten angelastet werden, der sein `shell:` ordentlich traegt.
check "marker-trifft-den-richtigen-schritt" 1 'name: x
defaults:
  run:
    shell: bash

jobs:
  a:
    runs-on: windows-latest
    steps:
      - name: erster
        shell: pwsh
        run: Write-Host eins
      - name: zweiter
        run: Write-Host zwei'

# Die Marker, die die ERSTE Fassung des Detektors glatt durchgelassen haette.
# Befund des externen Dual-Reviews vom 21.09. (kimi-k2.7-code R-1, Schwere
# hoch; gemini-2.5-pro R-1, konvergent): die Liste kannte acht Marker und
# damit nicht die Klasse, fuer die sie gebaut wurde.
ps_fall() { # name codezeile
  check "$1" 1 "name: x
defaults:
  run:
    shell: bash

jobs:
  a:
    runs-on: windows-latest
    steps:
      - name: nativ
        run: |
          $2"
}
ps_fall "ps-test-path"        'if (Test-Path .\\ziel) { exit 1 }'
ps_fall "ps-get-process"      'Get-Process | Select-Object -First 1'
ps_fall "ps-invoke-rest"      'Invoke-RestMethod -Uri https://example.test'
ps_fall "ps-import-module"    'Import-Module Pester'
ps_fall "ps-throw-einfach"    "throw 'fehler'"
ps_fall "ps-throw-variable"   'throw $ex'
ps_fall "ps-param"            'param($Pfad)'
ps_fall "ps-psversiontable"   'Write-Output $PSVersionTable.PSVersion'

# Gegenproben: bash bleibt bash. Ein Schrittname oder ein env-Wert, der wie
# PowerShell aussieht, darf den Detektor NICHT ausloesen — nur der Rumpf von
# `run:` zaehlt (Befund kimi-k2.7-code R-2).
check "bash-mit-bindestrich-befehl" 0 'name: x
defaults:
  run:
    shell: bash

jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - name: harmlos
        run: |
          npm run test:e2e
          git rev-parse HEAD
          cargo clippy --all-targets -- -D warnings'

check "schrittname-sieht-aus-wie-ps" 0 'name: x
defaults:
  run:
    shell: bash

jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - name: Write-Host und Test-Path dokumentieren
        run: echo hallo'

# Composite Actions: ein run-Schritt ohne `shell:` ist zur Laufzeit ein
# Fehler. Befund kimi-k2.7-code R-4 — das Gate sah gar nicht dorthin.
komposit() { # name erwarteter_exit inhalt
  local name="$1" want="$2" body="$3"
  local d="$tmp/$name"
  mkdir -p "$d/actions/probe"
  printf 'name: x\ndefaults:\n  run:\n    shell: bash\n\njobs:\n  a:\n    runs-on: ubuntu-latest\n' > "$d/w.yml"
  printf '%s\n' "$body" > "$d/actions/probe/action.yml"
  bash scripts/ci/workflow-shell.sh "$d" > "$tmp/$name.log" 2>&1
  local got=$?
  if [ "$got" -ne "$want" ]; then
    echo "FEHLER $name: Exit $got, erwartet $want"; sed 's/^/    /' "$tmp/$name.log"; fails=$((fails + 1))
  else
    echo "ok   $name (Exit $got)"
  fi
}

komposit "komposit-ohne-shell" 1 'name: probe
runs:
  using: composite
  steps:
    - name: baut
      run: npm ci'

komposit "komposit-mit-shell" 0 'name: probe
runs:
  using: composite
  steps:
    - name: baut
      shell: bash
      run: npm ci'

# Und die echte Composite Action dieses Repos muss durchgehen. Ohne diesen
# Fall belegt der Selbsttest nur, dass der Detektor an KUENSTLICHEN Dateien
# funktioniert (Befund gemini-2.5-pro R-2, sinngemaess auf dieses Gate).
if bash scripts/ci/workflow-shell.sh .github/workflows > "$tmp/echt.log" 2>&1; then
  echo "ok   die echte .github/actions/setup-linux/action.yml geht durch"
else
  echo "FEHLER die echte Composite Action faellt durch"; sed 's/^/    /' "$tmp/echt.log"; fails=$((fails + 1))
fi

# Leeres Verzeichnis: Exit 2, nicht 0. Sonst waere ein Tippfehler im Pfad ein
# gruenes Gate.
mkdir -p "$tmp/leer"
bash scripts/ci/workflow-shell.sh "$tmp/leer" > "$tmp/leer.log" 2>&1
got=$?
if [ "$got" -ne 2 ]; then
  echo "FEHLER leeres-verzeichnis: Exit $got, erwartet 2"; fails=$((fails + 1))
else
  echo "ok   leeres-verzeichnis (Exit $got)"
fi

[ "$fails" -eq 0 ] && echo "alle Faelle grün" || echo "$fails Fall/Faelle rot"
[ "$fails" -eq 0 ]
