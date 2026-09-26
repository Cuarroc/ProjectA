#!/usr/bin/env bash
# Gemeinsame Regeln fuer commit-msg und den CI-Job red-first (Plan T-1 / §7).
# Nur Funktionen — nichts ausfuehren beim Sourcen.

# Eine Datei, deren Aenderung allein keinen Trailer verlangt (Doku, Tests, Locks).
tf_path_is_exempt() {
  local p="${1#./}"
  case "$p" in
    *.md|docs/*|.pa/*|LICENSE*|CHANGELOG*|*.lock|package-lock.json|src-tauri/Cargo.lock|.gitignore|.gitattributes|.editorconfig)
      return 0
      ;;
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|src/test/*|src/__tests__/*)
      return 0
      ;;
    *.test.mjs|*.browser.mjs)
      return 0
      ;;
    scripts/test-*.sh)
      # Die Probe ist der Beleg, kein Produktcode.
      return 0
      ;;
  esac
  return 1
}

# Produkt-/Prozess-Quellcode: Aenderung verlangt einen Trailer.
tf_path_is_source() {
  local p="${1#./}"
  if tf_path_is_exempt "$p"; then
    return 1
  fi
  case "$p" in
    src/*|src-tauri/*|.github/workflows/*|.githooks/*|scripts/*|package.json|vitest.config.ts|playwright.config.ts|tsconfig.json|eslint.config.*|eslint.config.js|index.html|.claude/settings.json|.claude/hooks/*)
      return 0
      ;;
  esac
  return 1
}

tf_file_list_needs_trailer() {
  local f
  for f in "$@"; do
    [ -n "$f" ] || continue
    if tf_path_is_source "$f"; then
      return 0
    fi
  done
  return 1
}

# Trailer-Zeilen am Ende der Nachricht (git-Konvention), plus ueberall
# vorkommende `Test-First:`/`Regression-For:`/`No-Test:`-Zeilen — Agenten
# setzen sie oft vor eine Signed-off-by-Zeile.
tf_message_has_required_trailer() {
  local msg="$1"
  printf '%s\n' "$msg" | tr -d '\r' | grep -qE '^(Test-First|Regression-For|No-Test):[[:space:]]+[^[:space:]].*'
}

tf_extract_test_first_specs() {
  local msg="$1"
  printf '%s\n' "$msg" | tr -d '\r' | grep -E '^Test-First:[[:space:]]+' | sed -E 's/^Test-First:[[:space:]]+//'
}

tf_extract_regression_shas() {
  local msg="$1"
  printf '%s\n' "$msg" | tr -d '\r' | grep -E '^Regression-For:[[:space:]]+' | sed -E 's/^Regression-For:[[:space:]]+//'
}

tf_trailer_is_well_formed() {
  local msg="$1" line kind rest
  local found=0
  while IFS= read -r line; do
    case "$line" in
      Test-First:*|Regression-For:*|No-Test:*)
        found=1
        kind="${line%%:*}"
        rest="${line#*:}"
        rest="${rest# }"
        rest="${rest#	}"
        if [ -z "$rest" ]; then
          echo "leerer Trailer: $kind:" >&2
          return 1
        fi
        case "$kind" in
          Test-First)
            case "$rest" in
              *,*)
                echo "Test-First: mehrere Belege als eigene Zeilen, nie eine Liste: $rest" >&2
                return 1
                ;;
            esac
            path="${rest%%::*}"
            case "$path" in
              *[[:space:]]*)
                echo "Test-First: der Pfad darf keine Leerzeichen enthalten: $path" >&2
                return 1
                ;;
            esac
            ;;
          Regression-For)
            case "$rest" in
              *[!0-9a-fA-F]*)
                echo "Regression-For: erwartet einen Commit-SHA, nicht: $rest" >&2
                return 1
                ;;
            esac
            if [ "${#rest}" -lt 7 ] || [ "${#rest}" -gt 40 ]; then
              echo "Regression-For: SHA-Laenge 7–40, nicht ${#rest}: $rest" >&2
              return 1
            fi
            ;;
        esac
        ;;
    esac
  done <<EOF
$(printf '%s\n' "$msg" | tr -d '\r')
EOF
  [ "$found" -eq 1 ]
}

tf_subject_skips_hook() {
  local subject="$1"
  case "$subject" in
    Merge\ *|fixup!\ *|squash!\ *)
      return 0
      ;;
  esac
  return 1
}

# The OS whose #[cfg] gates cannot be compiled on this host: a Windows host
# never compiles `cfg(unix)` code, every other host never compiles
# `cfg(windows)` code. TF_HOST_OS (windows|unix) overrides the detection for
# the self-test.
tf_other_os_cfg() {
  local host="${TF_HOST_OS:-}"
  if [ -z "$host" ]; then
    case "$(uname -s 2>/dev/null)" in
      MINGW*|MSYS*|CYGWIN*) host=windows ;;
      *) host=unix ;;
    esac
  fi
  if [ "$host" = windows ]; then echo unix; else echo windows; fi
}

# 0 when the Rust test `name` (a `fn` in `path` below `tree`) is provably not
# compiled on this host because it is #[cfg]-gated to the other OS: either the
# fn carries the attribute itself, or the module that includes the file
# (`#[cfg(..)] #[path = "..."] mod ..;`) does. Anything else - an ungated test
# that is merely not listed, a name that is not in the source, a gate this
# cannot read - returns 1, so the spec stays red at the merge base and must
# be green at the head (fail closed). `not(<os>)` and `any(..)` gates are never
# treated as gated off. Found on PR #12: its Windows-only tests do not exist
# for `cargo test -- --list` on the Linux runner.
tf_rust_test_gated_off_platform() {
  local tree="$1" path="$2" name="${3##*::}" other file base
  other="$(tf_other_os_cfg)"
  file="$tree/$path"
  [ -f "$file" ] || return 1
  base="$(basename "$path")"
  # Does the source define this test at all?
  grep -Eq "fn[[:space:]]+${name}[[:space:]]*\(" "$file" || return 1
  local gate="^[[:space:]]*#\[cfg\(.*\b${other}\b"
  # (a) the attribute lines directly above the fn, or a file-level gate.
  # Patterns travel through the environment: `awk -v` would eat backslashes.
  if TF_FN="fn[[:space:]]+${name}[[:space:]]*[(]" awk '
      $0 ~ /^[[:space:]]*#!?\[/ { attrs = attrs "\n" $0; next }
      $0 ~ ENVIRON["TF_FN"] { found = attrs; exit }
      { attrs = "" }
      END { print found }
    ' "$file" | grep -E "$gate" | grep -Ev 'not\(|any\(' >/dev/null; then
    return 0
  fi
  if grep -E "^[[:space:]]*#!\[cfg\(.*\b${other}\b" "$file" | grep -Ev 'not\(|any\(' >/dev/null; then
    return 0
  fi
  # (b) the mod declaration that includes this file through #[path].
  local decl
  while IFS= read -r decl; do
    [ -f "$decl" ] || continue
    if TF_PATH="#\[path[[:space:]]*=[[:space:]]*\"([^\"]*/)?${base}\"\]" awk '
        $0 ~ /^[[:space:]]*#\[/ { attrs = attrs "\n" $0; if ($0 ~ ENVIRON["TF_PATH"]) { hit = attrs; exit } next }
        { attrs = "" }
        END { print hit }
      ' "$decl" | grep -E "$gate" | grep -Ev 'not\(|any\(' >/dev/null; then
      return 0
    fi
  done < <(grep -rlF "$base" "$tree/src-tauri/src" --include='*.rs' 2>/dev/null)
  return 1
}
