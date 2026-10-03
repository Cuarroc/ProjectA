#!/usr/bin/env bash
# Self-test for scripts/ci/script-modes.sh.
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
GATE="$HERE/scripts/ci/script-modes.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q -b main
git -C "$tmp" config user.name script-modes-test
git -C "$tmp" config user.email test@example.invalid
mkdir -p "$tmp/scripts/ci" "$tmp/scripts/lib"
cp "$GATE" "$tmp/scripts/ci/script-modes.sh"
chmod 755 "$tmp/scripts/ci/script-modes.sh"
printf '#!/usr/bin/env bash\n' > "$tmp/scripts/ci/ok.sh"
printf '#!/usr/bin/env bash\n' > "$tmp/scripts/lib/bad.sh"
chmod 755 "$tmp/scripts/ci/ok.sh"
chmod 644 "$tmp/scripts/lib/bad.sh"
printf '#!/usr/bin/env bash\n' > "$tmp/scripts/top.sh"
chmod 644 "$tmp/scripts/top.sh"
git -C "$tmp" add scripts

if bash "$tmp/scripts/ci/script-modes.sh" > "$tmp/bad.log" 2>&1; then
  echo "FEHLER: ein 100644-Skript blieb gruen"
  exit 1
fi
grep -q 'scripts/lib/bad.sh is indexed as 100644' "$tmp/bad.log" || {
  echo "FEHLER: der falsche Modus wurde nicht benannt"
  cat "$tmp/bad.log"
  exit 1
}

grep -q 'scripts/top.sh is indexed as 100644' "$tmp/bad.log" || {
  echo "FEHLER: ein Skript direkt unter scripts/ wurde nicht erkannt"
  cat "$tmp/bad.log"
  exit 1
}

git -C "$tmp" update-index --chmod=+x scripts/lib/bad.sh scripts/top.sh
bash "$tmp/scripts/ci/script-modes.sh" > "$tmp/good.log" 2>&1 || {
  echo "FEHLER: zwei 100755-Skripte blieben rot"
  cat "$tmp/good.log"
  exit 1
}

echo "script-modes: alle Faelle gruen"
