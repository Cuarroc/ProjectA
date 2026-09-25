#!/usr/bin/env bash
# Verlangt, dass jeder Workflow `defaults: run: shell: bash` deklariert.
#
# Warum: ohne diese Angabe startet GitHub jeden `run:`-Schritt als
# `bash -e {0}` — OHNE `pipefail`. Der Status einer Pipe ist dann der ihres
# LETZTEN Glieds; `cargo clippy 2>&1 | tail` meldet Erfolg, waehrend clippy
# scheitert. Mit explizitem `shell: bash` startet GitHub
# `bash --noprofile --norc -eo pipefail {0}`.
#
# Das ist der Regel-Teil der Bug-Regel-Pipeline (AGENTS.md): am 05.09. ging in
# review.yml der Exit 1 des Modell-Resolvers so verloren, am 04.09. lokal der
# Status von clippy. no-masked-output.sh faengt nur die Schreibvorgaenge nach
# $GITHUB_OUTPUT/$GITHUB_ENV — dieses Gate faengt die Klasse.
#
# Ein neuer Workflow ohne den Block ist damit rot, statt still ungehaertet zu
# sein. Selbsttest: scripts/test-workflow-shell.sh
#
# Aufruf: scripts/ci/workflow-shell.sh [verzeichnis]  (Standard: .github/workflows)
set -uo pipefail
dir="${1:-.github/workflows}"

missing=0
found=0
for f in "$dir"/*.yml "$dir"/*.yaml; do
  [ -f "$f" ] || continue
  found=$((found + 1))
  # Der Block muss auf Workflow-Ebene stehen (Spalte 0), nicht in einem Job:
  # ein `defaults:` unter `jobs:` haertet nur diesen einen Job.
  if ! awk '
      /^defaults:[[:space:]]*$/ { in_defaults = 1; next }
      in_defaults && /^[^[:space:]#]/ { in_defaults = 0 }
      in_defaults && /^[[:space:]]+run:[[:space:]]*$/ { in_run = 1; next }
      in_run && /^[[:space:]]{0,2}[^[:space:]#]/ { in_run = 0 }
      in_run && /^[[:space:]]+shell:[[:space:]]*bash[[:space:]]*$/ { found = 1 }
      END { exit(found ? 0 : 1) }
    ' "$f"; then
    echo "  $f"
    missing=$((missing + 1))
  fi
done

# Ein Gate, das ueber einem leeren Verzeichnis gruen wird, prueft nichts
# (AGENTS.md, Regel 2). Ein falscher Pfad ist ein Fehler, kein Erfolg.
if [ "$found" -eq 0 ]; then
  echo "::error::Keine Workflow-Datei in $dir gefunden - falscher Pfad?"
  exit 2
fi

if [ "$missing" -gt 0 ]; then
  echo "::error::$missing Workflow(s) ohne 'defaults: run: shell: bash' - ihre run-Schritte laufen ohne pipefail, ein Exit-Code links einer Pipe geht verloren."
  exit 1
fi
echo "alle $found Workflow(s) in $dir deklarieren shell: bash (pipefail)"

# ---------------------------------------------------------------------------
# Die Geschwisterstelle (AGENTS.md, Bug->Regel): der Block oben zwingt JEDEN
# `run:`-Schritt der Datei auf bash — auch auf windows-latest, wo GitHub sonst
# `pwsh` nimmt. Ein Schritt, der PowerShell enthaelt und kein eigenes `shell:`
# traegt, lief vor dem Block richtig und danach unter Git-Bash: `$LASTEXITCODE`
# ist dort leer, `throw` und `foreach` sind keine Schluesselwoerter. Gemessen
# am 21.09. beim Merge von main: `Gate - native Parent-Host-Prozessgrenze` in
# ci.yml war genau dieser Fall.
#
# Erkannt wird an Markern, die in bash nicht vorkommen. Ein Schritt mit
# eigenem `shell:` ist ausgenommen — er hat die Frage ja beantwortet.
ps_ohne_shell=0
for f in "$dir"/*.yml "$dir"/*.yaml; do
  [ -f "$f" ] || continue
  treffer="$(awk -v datei="$f" '
    function pruefe() {
      if (schritt != "" && hat_ps && !hat_shell)
        printf "  %s:%d  %s\n", datei, start, (name == "" ? "(unbenannter Schritt)" : name)
    }
    # Kommentarzeilen gehoeren zu keinem Schritt. Ohne diese Zeile schlug das
    # Gate an seinem eigenen Anlass-Kommentar an, der $LASTEXITCODE erklaert —
    # ein Detektor, der Prosa ueber sich selbst fuer Code haelt, ist unbrauchbar.
    /^[[:space:]]*#/ { next }
    # Ein Listenelement auf Schritt-Ebene beginnt einen neuen Schritt.
    /^[[:space:]]*-[[:space:]]/ {
      pruefe()
      schritt = $0; hat_ps = 0; hat_shell = 0; in_run = 0; name = ""; start = NR
      if ($0 ~ /shell:[[:space:]]*[a-z]/) hat_shell = 1
      if (match($0, /name:[[:space:]]*.*/)) { name = substr($0, RSTART + 5); sub(/^[[:space:]]*/, "", name) }
    }
    schritt != "" && /^[[:space:]]+shell:[[:space:]]*[a-z]/ { hat_shell = 1; next }
    schritt != "" && /^[[:space:]]+name:[[:space:]]*[^[:space:]]/ {
      name = $0; sub(/^[[:space:]]*name:[[:space:]]*/, "", name); next
    }
    # Nur der Rumpf von `run:` zaehlt als Code. Vorher wurde jede Zeile des
    # Schritts geprueft, also auch `name:`, `env:` und `with:` — ein
    # Schrittname wie "Write-Host testen" haette das Gate ausgeloest.
    # Befund des externen Dual-Reviews vom 21.09. (kimi-k2.7-code R-2).
    schritt != "" && /^[[:space:]]+run:/ { in_run = 1 }
    # Die Marker. Die erste Fassung kannte nur acht davon und haette
    # `Test-Path`, `Get-Process`, `Invoke-RestMethod`, `param(`,
    # `$PSVersionTable` oder `throw $ex` glatt durchgelassen — ein Detektor,
    # der die Klasse nicht faengt, fuer die er gebaut wurde, ist gruen durch
    # Abwesenheit. Befund kimi-k2.7-code R-1 (Schwere hoch) und
    # gemini-2.5-pro R-1, konvergent.
    #
    # Verb-Nomen ist das tragende Muster von PowerShell (Get-Foo, Set-Bar);
    # in bash kommt es praktisch nicht vor, weil dort kaum ein Befehl einen
    # Grossbuchstaben nach dem Bindestrich traegt.
    in_run && /(^|[^[:alnum:]_-])(Get|Set|New|Test|Invoke|Import|Export|Remove|Write|Start|Stop|Select|Where|ForEach|Add|Copy|Move|Join|Split|Out|ConvertTo|ConvertFrom)-[A-Z][A-Za-z]+/ { hat_ps = 1 }
    in_run && /\$LASTEXITCODE|\$env:|\$PSVersionTable|\$PSCmdlet|\$PSScriptRoot|-ErrorAction|-ErrorVariable/ { hat_ps = 1 }
    in_run && /(^|[^[:alnum:]_])throw([[:space:]]|$)/ { hat_ps = 1 }
    in_run && /(^|[^[:alnum:]_])param[[:space:]]*\(/ { hat_ps = 1 }
    END { pruefe() }
  ' "$f")"
  if [ -n "$treffer" ]; then
    printf '%s\n' "$treffer"
    ps_ohne_shell=$((ps_ohne_shell + 1))
  fi
done

# Composite Actions: dort gibt es kein `defaults:` — jeder `run:`-Schritt MUSS
# sein eigenes `shell:` tragen, sonst lehnt GitHub die Action zur Laufzeit ab.
# Das Gate sah bis zum 21.09. nur nach .github/workflows und damit an der
# neuen .github/actions/setup-linux/action.yml vorbei (Befund des externen
# Dual-Reviews, kimi-k2.7-code R-4). Ein Fehler, der erst im Lauf auffaellt,
# gehoert vor den Push.
aktionen_dir="$(dirname "$dir")/actions"
[ "$(basename "$dir")" = "workflows" ] || aktionen_dir="$dir/actions"
ohne_shell=0
aktionen_gefunden=0
if [ -d "$aktionen_dir" ]; then
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    aktionen_gefunden=$((aktionen_gefunden + 1))
    treffer="$(awk -v datei="$f" '
      function pruefe() {
        if (schritt != "" && hat_run && !hat_shell)
          printf "  %s:%d  %s\n", datei, start, (name == "" ? "(unbenannter Schritt)" : name)
      }
      /^[[:space:]]*#/ { next }
      /^[[:space:]]*-[[:space:]]/ {
        pruefe()
        schritt = $0; hat_run = 0; hat_shell = 0; name = ""; start = NR
        if ($0 ~ /shell:[[:space:]]*[a-z]/) hat_shell = 1
        if ($0 ~ /run:/) hat_run = 1
        if (match($0, /name:[[:space:]]*.*/)) { name = substr($0, RSTART + 5); sub(/^[[:space:]]*/, "", name) }
      }
      schritt != "" && /^[[:space:]]+shell:[[:space:]]*[a-z]/ { hat_shell = 1 }
      schritt != "" && /^[[:space:]]+run:/ { hat_run = 1 }
      schritt != "" && /^[[:space:]]+name:[[:space:]]*[^[:space:]]/ {
        name = $0; sub(/^[[:space:]]*name:[[:space:]]*/, "", name)
      }
      END { pruefe() }
    ' "$f")"
    if [ -n "$treffer" ]; then
      printf '%s\n' "$treffer"
      ohne_shell=$((ohne_shell + 1))
    fi
  done < <(find "$aktionen_dir" -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null)
fi

if [ "$ohne_shell" -gt 0 ]; then
  echo "::error::run-Schritt in einer Composite Action ohne 'shell:' - GitHub lehnt die Action zur Laufzeit ab. Ein 'shell: bash' an den Schritt."
  exit 1
fi
[ "$aktionen_gefunden" -gt 0 ] &&
  echo "alle run-Schritte in $aktionen_gefunden Composite Action(s) deklarieren ein shell:"

if [ "$ps_ohne_shell" -gt 0 ]; then
  echo "::error::PowerShell in einem run-Schritt ohne eigenes 'shell:' - der Workflow-Default 'shell: bash' fuehrt ihn unter Git-Bash aus, wo \$LASTEXITCODE leer ist und throw/foreach keine Schluesselwoerter sind. 'shell: pwsh' an den Schritt."
  exit 1
fi
echo "kein PowerShell-Schritt ohne eigenes shell:"
