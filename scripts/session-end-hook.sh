#!/usr/bin/env bash
# session-end-hook.sh — automatischer Journal-Skelett-Eintrag (Hook-Variante).
#
# Wird von globalen CLI-Hooks aufgerufen (Claude Code: SessionEnd, Kimi: Stop —
# Einrichtung und Regeln: AGENTS.md). Schreibt bewusst nur das faktische
# Gerüst (Zeit, Branch, uncommittete Dateien via sync.sh note); echte
# Zusammenfassungen bleiben manuell.
#
# Verhalten:
#   - feuert nur in Repos, die scripts/sync.sh haben (ProjectA + Worktrees)
#   - Debounce: höchstens ein Auto-Eintrag alle 30 min (Kimi-Stop feuert pro
#     Turn-Ende, nicht pro Session — ohne Debounce wäre das Spam)
#   - blockiert nie: immer Exit 0
set -u

# Hooks bekommen JSON auf stdin — aufzehren, sonst SIGPIPE-Risiko.
cat >/dev/null 2>&1 || :

instanz="${1:-agent}"
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -f "$root/scripts/sync.sh" ] || exit 0

act="$root/.pa/ACTIVITY.md"
if [ -f "$act" ]; then
  alter=$(( $(date +%s) - $(stat -c %Y "$act" 2>/dev/null || echo 0) ))
  [ "$alter" -lt 1800 ] && exit 0
fi

bash "$root/scripts/sync.sh" note "$instanz (auto)" \
  "Session aktiv oder beendet — automatischer Skelett-Eintrag (Hook). Inhaltliche Zusammenfassung ggf. manuell nachfassen." \
  >/dev/null 2>&1 || :
exit 0
