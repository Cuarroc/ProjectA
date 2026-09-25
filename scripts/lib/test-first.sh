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
