#!/usr/bin/env bash
# sync.sh — Inter-Instanz-Kommunikation für ProjectA (Regeln: AGENTS.md)
#
#   bash scripts/sync.sh start
#       Session-Briefing: Branch, Status, Worktrees, letzte Commits,
#       Journal-Tail, Handover-Warnung. Pflicht zu Beginn jeder Sitzung.
#
#   bash scripts/sync.sh note "<instanz>" "<zusammenfassung>" [commits]
#       Hängt einen Aktivitäts-Eintrag an .pa/ACTIVITY.md an. Zeitstempel,
#       Branch und Uncommitted-Liste werden automatisch aus git ermittelt.
#       Neue Top-Level-Dateien/Ordner in der Zusammenfassung namentlich nennen.
#       Nur auf main (und hq-snapshot-Zweigen) landet der Eintrag in der
#       getrackten Datei; auf jedem anderen Branch in .pa/ACTIVITY.local.md
#       (ungetrackt) - die getrackte Datei ist ein Konfliktherd (CI-CONFLICT-01).
#       Die Zusammenfassung gehoert dort in den PR-Text.

set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$ROOT" ]; then
  echo "sync.sh: nicht in einem git-Repository" >&2
  exit 1
fi
# shellcheck source=scripts/lib/hotspots.sh
. "$ROOT/scripts/lib/hotspots.sh"
TRACKED="$ROOT/.pa/ACTIVITY.md"
ACTIVITY="$TRACKED"
branch="$(hs_branch "$ROOT")"
hs_may_touch "$branch" || ACTIVITY="$ROOT/.pa/ACTIVITY.local.md"

print_activity_tail() {
  if [ -f "$TRACKED" ]; then
    echo "== .pa/ACTIVITY.md (letzte Einträge) =="
    tail -n 40 "$TRACKED"
  else
    echo "== .pa/ACTIVITY.md existiert noch nicht =="
  fi
}

cmd="${1:-}"

case "$cmd" in
  start)
    echo "== Branch =="
    git -C "$ROOT" branch --show-current
    echo
    echo "== git status --short =="
    status="$(git -C "$ROOT" status --short)"
    if [ -n "$status" ]; then echo "$status"; else echo "(sauber)"; fi
    echo
    echo "== git worktree list =="
    git -C "$ROOT" worktree list
    echo
    echo "== git hooks =="
    hooks_path="$(git -C "$ROOT" config core.hooksPath || true)"
    if [ "$hooks_path" != ".githooks" ]; then
      echo "WARNUNG: Gates-Hooks sind NICHT aktiv (core.hooksPath='$hooks_path')."
      echo "  Fix: git config core.hooksPath .githooks"
      echo
    else
      # Härte-Check (Regel-Review 09.09.): hooksPath war 31.08.–07.09. gesetzt,
      # aber die Hooks hatten kein x-Bit und liefen bei niemandem (62214c8).
      for hook in "$ROOT"/.githooks/*; do
        name="$(basename "$hook")"
        mode="$(git -C "$ROOT" ls-files -s -- ".githooks/$name" | cut -d' ' -f1)"
        if [ "$mode" != "100755" ] || [ ! -x "$hook" ]; then
          echo "WARNUNG: .githooks/$name ist nicht ausführbar (Index-Modus ${mode:-fehlt}) — Hooks laufen trotz hooksPath nicht."
          echo "  Fix: bash scripts/install-hooks.sh (setzt Modus + x-Bit), dann committen."
          echo
        fi
      done
      # Derselbe Fehlermodus eine Ebene tiefer: `.gitattributes` benennt den
      # Merge-Treiber fuer die HQ-Momentaufnahme, aber *was* er tut, steht in
      # der lokalen Konfiguration und reist nicht mit dem Klon mit. Fehlt sie,
      # kollidiert docs/dev-hq/data.* bei jedem Merge wieder -- lautlos, weil
      # git dann einfach den Standardtreiber nimmt.
      if [ -z "$(git -C "$ROOT" config --get merge.hqdata.driver || true)" ]; then
        echo "WARNUNG: merge.hqdata ist nicht registriert — docs/dev-hq/data.* kollidiert bei jedem Merge."
        echo "  Fix: bash scripts/install-hooks.sh"
        echo
      fi
    fi
    echo "== git log --all --oneline -12 =="
    git -C "$ROOT" log --all --oneline -12
    echo
    print_activity_tail
    ;;

  note)
    instanz="${2:-}"
    zusammenfassung="${3:-}"
    commits="${4:-keine}"
    if [ -z "$instanz" ] || [ -z "$zusammenfassung" ]; then
      echo "Aufruf: bash scripts/sync.sh note \"<instanz>\" \"<zusammenfassung>\" [commits]" >&2
      exit 1
    fi
    mkdir -p "$ROOT/.pa"
    if [ ! -f "$ACTIVITY" ]; then
      {
        echo "# ACTIVITY — Sitzungs-Journal der Agent-Instanzen"
        echo
        echo "Append-only: neue Einträge am Ende. Regeln: AGENTS.md."
      } > "$ACTIVITY"
    fi
    ts="$(date '+%Y-%m-%d %H:%M')"
    branch="$(git -C "$ROOT" branch --show-current)"
    status="$(git -C "$ROOT" status --short)"
    {
      echo
      echo "## $ts — $instanz ($branch, $(basename "$ROOT"))"
      echo "- Zusammenfassung: $zusammenfassung"
      echo "- Commits: $commits"
      if [ -n "$status" ]; then
        echo "- Uncommitted:"
        echo "$status" | sed 's/^/    /'
      else
        echo "- Uncommitted: keine"
      fi
    } >> "$ACTIVITY"
    echo "Eintrag an $ACTIVITY angehängt."
    if [ "$ACTIVITY" != "$TRACKED" ]; then
      echo "Hinweis: Branch '${branch:-detached}' darf .pa/ACTIVITY.md nicht committen (Konfliktherd)."
      echo "  Der Eintrag liegt in der ungetrackten Datei .pa/ACTIVITY.local.md; die Zusammenfassung gehört in den PR-Text."
    fi
    ;;

  where)
    echo "$ACTIVITY"
    ;;

  *)
    echo "Aufruf: bash scripts/sync.sh start|note|where" >&2
    exit 1
    ;;
esac
