#!/usr/bin/env bash
# Setzt core.hooksPath auf das Repo-lokale .githooks (Plan T-1).
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
git -C "$ROOT" config core.hooksPath .githooks
echo "core.hooksPath=$(git -C "$ROOT" config --get core.hooksPath)"

# Merge-Treiber fuer die HQ-Momentaufnahme. `.gitattributes` kann den Treiber
# nur *benennen*; was er tut, steht in der lokalen Konfiguration und reist
# nicht mit dem Klon mit -- genau wie core.hooksPath. Ohne diese Zeilen faellt
# git auf den Standardtreiber zurueck und docs/dev-hq/data.* kollidiert wieder.
git -C "$ROOT" config merge.hqdata.name "HQ-Momentaufnahme: eine Seite behalten, danach neu erzeugen"
git -C "$ROOT" config merge.hqdata.driver '.githooks/merge-hqdata %O %A %B %P'
echo "merge.hqdata.driver=$(git -C "$ROOT" config --get merge.hqdata.driver)"

# Härte-Check (Regel-Review 09.09.): hooksPath allein genügt nicht — die Hooks
# müssen im Index 100755 UND lokal ausführbar sein. Beides fehlte vom 31.08.
# bis 07.09. (62214c8): hooksPath war gesetzt, die Hooks liefen bei niemandem.
# Geprüft werden nicht nur die Hooks selbst: seit 09.09. rufen sie
# scripts/ci/gates.sh auf, und die Proben unter scripts/ werden direkt
# gestartet. Vom Windows-PC committet Git bei core.fileMode=false sonst
# 100644, und `./scripts/ci/gates.sh` läuft dann bei niemandem —
# derselbe Fehler wie bei den Hooks vom 31.08. bis 07.09., nur eine Ebene
# weiter (AGENTS.md, Regel 5: nach einem Fix nach Geschwistern suchen).
problem=0
check_mode() { # repo-relativer Pfad
  local rel="$1" abs="$ROOT/$1" mode
  [ -e "$abs" ] || return 0
  mode="$(git -C "$ROOT" ls-files -s -- "$rel" | cut -d' ' -f1)"
  if [ -z "$mode" ]; then
    # Noch gar nicht im Index. `update-index --chmod=+x` scheitert hier hart
    # und riss unter `set -e` das ganze Skript mit — nachdem es oben bereits
    # Erfolg gemeldet hatte, also eine halb eingerichtete Ablage, die sich als
    # fertig ausgibt. Ein neuer Hook ist kein Fehler, nur noch nicht committet.
    echo "HINWEIS: $rel ist noch nicht im Index — 'git add $rel', dann dieses Skript erneut."
    [ -x "$abs" ] || { chmod +x "$abs"; echo "  lokales x-Bit für $rel gesetzt."; }
    problem=1
    return 0
  fi
  if [ "$mode" != "100755" ]; then
    echo "WARNUNG: $rel hat Index-Modus $mode statt 100755 — es würde bei niemandem laufen."
    git -C "$ROOT" update-index --chmod=+x "$rel"
    echo "  Index korrigiert (update-index --chmod=+x) — bitte committen."
    problem=1
  fi
  if [ ! -x "$abs" ]; then
    chmod +x "$abs"
    echo "  lokales x-Bit für $rel gesetzt."
  fi
}

for hook in "$ROOT"/.githooks/*; do
  check_mode ".githooks/$(basename "$hook")"
done
for script in "$ROOT"/scripts/ci/*.sh "$ROOT"/scripts/test-*.sh; do
  [ -e "$script" ] || continue
  check_mode "scripts/${script#"$ROOT/scripts/"}"
done
if [ "$problem" -eq 0 ]; then
  echo "Hook-Modi: OK (100755 im Index)."
else
  echo "Modi repariert — den Index-Fix bitte committen."
fi
