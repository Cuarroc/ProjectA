#!/usr/bin/env bash
# Selbsttest: Dependabot-Commits im Gate red-first (W1-19b, CI-02).
#
# Dependabot schreibt keinen Test-First:/No-Test:-Trailer. Bis CI-02 war
# deshalb jeder Dependabot-PR, der eine "Quelldatei" im Sinn von
# scripts/lib/test-first.sh aendert (Workflows, package.json, Cargo.toml),
# in red-first rot - #42/#34 im September, #109/#111 am 24.09. Die Ausnahme
# ist eng:
#   - Autor exakt dependabot[bot] mit seiner noreply-Adresse UND Committer
#     GitHub (web-flow) - ein lokal umgeschriebener Commit faellt heraus;
#   - JEDE geaenderte Datei ist ein Abhaengigkeits-Manifest der drei
#     konfigurierten Oekosysteme (.github/dependabot.yml).
# Beide Richtungen werden belegt: die Ausnahme greift, und sie greift NICHT
# bei fremdem Autor, falscher Adresse, fremdem Committer oder einer
# Nicht-Manifest-Datei (AGENTS.md, Regel 2).
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/red-first-dependabot.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/scripts/lib"
cp "$HERE/scripts/ci/red-first.sh" "$repo/scripts/ci/red-first.sh"
cp "$HERE/scripts/lib/test-first.sh" "$repo/scripts/lib/test-first.sh"
cd "$repo" || exit 1
git init -q -b main
git config user.email "probe@example.test"
git config user.name "red-first probe"
git config commit.gpgsign false
git config core.hooksPath /dev/null
git config core.autocrlf false
mkdir -p .github/workflows .github/actions/setup-linux src-tauri src
printf 'name: ci\n' > .github/workflows/ci.yml
printf 'name: setup\n' > .github/actions/setup-linux/action.yml
printf '{}\n' > package.json
printf '{}\n' > package-lock.json
printf '[package]\n' > src-tauri/Cargo.toml
printf '# lock\n' > src-tauri/Cargo.lock
printf 'export {};\n' > src/App.tsx
git add -A
git commit -q -m "basis"
base="$(git rev-parse HEAD)"

BOT_NAME="dependabot[bot]"
BOT_MAIL="49699333+dependabot[bot]@users.noreply.github.com"

# Ein Commit auf einem frischen Zweig ab `base`, mit frei waehlbarem Autor
# und Committer, ohne Trailer - so, wie Dependabot ihn schreibt.
commit_as() { # name autor mail committer-mail datei...
  local name="$1" an="$2" am="$3" cm="$4" f
  shift 4
  git checkout -q -B "c-$name" "$base"
  for f in "$@"; do
    mkdir -p "$(dirname "$f")"
    printf 'bump %s\n' "$name" >> "$f"
  done
  git add -A
  GIT_AUTHOR_NAME="$an" GIT_AUTHOR_EMAIL="$am" GIT_COMMITTER_NAME="GitHub" GIT_COMMITTER_EMAIL="$cm" \
    git commit -q -m "chore(deps): bump $name"
}

expect() { # fall erwartet(gruen|rot) datei...
  local name="$1" want="$2" rc
  shift 2
  BASE_SHA="$base" HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="" \
    bash scripts/ci/red-first.sh --plan > "$tmp/out" 2>&1
  rc=$?
  if { [ "$want" = gruen ] && [ "$rc" -eq 0 ] && grep -qx 'count=0' "$tmp/out"; } ||
     { [ "$want" = rot ] && [ "$rc" -ne 0 ]; }; then
    echo "ok   $name ($want, Exit $rc)"
  else
    echo "FEHLER $name: Exit $rc, erwartet $want"
    sed 's/^/    /' "$tmp/out"
    fails=$((fails + 1))
  fi
}

GH="noreply@github.com"
commit_as actions "$BOT_NAME" "$BOT_MAIL" "$GH" .github/workflows/ci.yml .github/actions/setup-linux/action.yml
expect dependabot-github-actions gruen
if grep -q 'Dependabot' "$tmp/out"; then
  echo "ok   dependabot-ausnahme-protokolliert"
else
  echo "FEHLER dependabot-ausnahme-protokolliert: keine Logzeile"; sed 's/^/    /' "$tmp/out"; fails=$((fails + 1))
fi

# Review CI-02 (kimi-k3 F5): eine Composite-Action darf auch action.yaml heissen.
commit_as action-yaml "$BOT_NAME" "$BOT_MAIL" "$GH" .github/actions/setup-linux/action.yaml
expect dependabot-action-yaml gruen

commit_as npm "$BOT_NAME" "$BOT_MAIL" "$GH" package.json package-lock.json
expect dependabot-npm gruen

commit_as cargo "$BOT_NAME" "$BOT_MAIL" "$GH" src-tauri/Cargo.toml src-tauri/Cargo.lock
expect dependabot-cargo gruen

# Review CI-02 (glm-5.2 F1): ein Workspace-Manifest an der Wurzel gehoert
# genauso zur Manifestliste (Haertung - heute hat das Repo keine Wurzel-Crate,
# und Wurzel-Manifeste verlangen ohnehin keinen Trailer; der Fall pinnt die
# Reichweite der Ausnahme).
commit_as wurzel-cargo "$BOT_NAME" "$BOT_MAIL" "$GH" Cargo.toml Cargo.lock
expect dependabot-wurzel-cargo gruen

# Gegenproben: die Ausnahme ist KEIN Freibrief.
commit_as quelltext "$BOT_NAME" "$BOT_MAIL" "$GH" package.json src/App.tsx
expect dependabot-mit-quelltext rot

commit_as mensch "Jemand" "jemand@example.test" "$GH" .github/workflows/ci.yml
expect mensch-ohne-trailer rot

commit_as falsche-adresse "$BOT_NAME" "dependabot@example.test" "$GH" package.json
expect dependabot-name-falsche-adresse rot

commit_as lokal-umgeschrieben "$BOT_NAME" "$BOT_MAIL" "jemand@example.test" package.json
expect dependabot-fremder-committer rot

if [ "$fails" -gt 0 ]; then
  echo "test-red-first-dependabot: $fails Fehler"
  exit 1
fi
echo "test-red-first-dependabot: alle Faelle gruen"
