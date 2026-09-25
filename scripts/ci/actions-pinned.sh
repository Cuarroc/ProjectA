#!/usr/bin/env bash
# Verlangt, dass jedes `uses:` in einem Workflow auf einen 40-stelligen
# Commit-SHA zeigt - nicht auf einen Tag und nicht auf einen Branch.
#
# Warum: ein Tag ist ein beweglicher Zeiger. `dtolnay/rust-toolchain@stable`
# und `taiki-e/install-action@nextest` waren BRANCHES bzw. wandernde Tags: ihr
# Inhalt aenderte sich ohne einen einzigen Commit in diesem Repo. Wer den Tag
# umhaengt, fuehrt Code in einem Job aus, in dem der Tauri-Signing-Key und der
# Mirror-PAT liegen (release.yml) bzw. der OPENROUTER_KEY (review.yml). Das ist
# kein Versionsthema, sondern die wertvollste Supply-Chain-Stelle im Repo.
#
# Der Versionskommentar hinter dem SHA ist die lesbare Fassung, nicht die
# autorisierende; Dependabot hebt beides gemeinsam an.
#
# Erlaubt bleiben repo-lokale Actions (`uses: ./.github/actions/...`): sie
# liegen im selben Commit und koennen sich nicht unter der Hand aendern.
#
# Gesucht wird REKURSIV unter .github, nicht nur in workflows/: eine
# Composite Action unter .github/actions/ bringt eigene `uses:` mit, laeuft
# im selben Job wie die Secrets und waere sonst der blinde Fleck genau
# dieses Gates.
#
# Selbsttest: scripts/test-actions-pinned.sh
# Aufruf: scripts/ci/actions-pinned.sh [verzeichnis]  (Standard: .github)
set -uo pipefail
dir="${1:-.github}"

bad=0
found=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  found=$((found + 1))
  # Nur echte Schluessel, keine Kommentarzeilen: die Erklaerung oben enthaelt
  # selbst das Wort `uses:` und darf den Detektor nicht ausloesen.
  while IFS=: read -r lineno rest; do
    ref="$(printf '%s' "$rest" | sed -E 's/[[:space:]]*#.*$//; s/[[:space:]]+$//')"
    case "$ref" in
      ./*) continue ;;                                   # repo-lokal
      # Gross- UND Kleinbuchstaben: ein Hex-SHA ist konventionell klein,
      # aber ein grossgeschriebener ist genauso gueltig und waere hier
      # faelschlich als "nicht gepinnt" abgelehnt worden (Befund des
      # externen Dual-Reviews vom 21.09., kimi-k2.7-code R-3).
      *@[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F])
        continue ;;                                      # genau 40 Hex-Zeichen
    esac
    echo "  $f:$lineno  $ref"
    bad=$((bad + 1))
  done < <(grep -nE '^[[:space:]]*-?[[:space:]]*uses:[[:space:]]*[^[:space:]#]' "$f" |
             sed -E 's/^([0-9]+):[[:space:]]*-?[[:space:]]*uses:[[:space:]]*/\1:/')
done < <(find "$dir" -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)

# Ein Gate, das ueber einem leeren Verzeichnis gruen wird, prueft nichts
# (AGENTS.md, Regel 2).
if [ "$found" -eq 0 ]; then
  echo "::error::Keine Workflow-/Action-Datei unter $dir gefunden - falscher Pfad?"
  exit 2
fi

if [ "$bad" -gt 0 ]; then
  echo "::error::$bad 'uses:' ohne 40-stelligen Commit-SHA. Ein Tag oder Branch ist ein beweglicher Zeiger - aufloesen mit: git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag> 'refs/tags/<tag>^{}'"
  exit 1
fi
echo "alle 'uses:' in $found Workflow-/Action-Datei(en) unter $dir sind auf einen Commit-SHA gepinnt"
