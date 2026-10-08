#!/usr/bin/env bash
# red-first — Schicht c (Plan T-1 / §7): Test-First-Belege gegen die Merge-Base.
#
# Umgebung:
#   BASE_SHA  Merge-Base (PR-Base oder origin/main)
#   HEAD_SHA  PR-Kopf (nicht der Merge-Commit des pull_request-Events)
#   PR_BODY   optional, zusaetzliche Trailer aus dem PR-Text
set -euo pipefail

# --plan: nur ermitteln, OB es etwas zu tun gibt, ohne einen einzigen Build.
#
# Der Job installierte bisher ~4 min Toolchain (apt, npm ci, Playwright,
# Rust), bevor das Skript ueberhaupt nachsah — und bei den meisten PRs
# (No-Test:, Doku, reine Tests) endet es danach sofort mit "keine Belege".
# Die Auskunft steht in `git log`, sie kostet Millisekunden.
#
# Das ist ausdruecklich KEIN paths-ignore-Verwandter: die Entscheidung
# trifft das Gate selbst nach Auswertung SEINER Eingaben und protokolliert
# sie, statt an einer Dateiendungs-Heuristik zu haengen. Und der
# Trailer-Formcheck laeuft im Plan-Modus mit — sonst waere ein PR ohne
# Trailer stillschweigend "count=0", also ein Persilschein.
PLAN_ONLY=0
if [ "${1:-}" = "--plan" ]; then
  PLAN_ONLY=1
  shift
fi

COMMIT_MSG_FILE=""
if [ "${1:-}" = "--commit-msg" ]; then
  COMMIT_MSG_FILE="${2:?--commit-msg needs a message file}"
  PLAN_ONLY=1
fi

ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/lib/test-first.sh
. "$ROOT/scripts/lib/test-first.sh"

# --------------------------------------------------------------------------
# Build-Verzeichnisse: je Baum eines, an einem STABILEN Pfad.
#
# Zwei Dinge stehen hier gegeneinander, und die Reihenfolge ist wichtig.
#
# 1. Korrektheit geht vor. Base- und Head-Baum enthalten dasselbe Paket in
#    derselben Version. Zeigen beide auf DASSELBE target/, erzeugt cargo fuer
#    beide denselben Artefaktnamen — der Paketpfad geht beim Wurzelpaket nicht
#    in den `-C metadata`-Hash ein. Am 09.09. hier gemessen: der Kopf-Lauf
#    meldete "Finished in 0.02s" und fuehrte das Binary der Merge-Base aus,
#    Backtrace-Zeile `.../base/src-tauri/src/main.rs`. Der Test war am Kopf
#    "rot", obwohl der Code am Kopf gruen ist.
#    Ein Gate, das den Baum gegen die Artefakte eines ANDEREN Baums prueft,
#    belegt nichts — es luegt. Deshalb setzt dieses Skript CARGO_TARGET_DIR je
#    Baum selbst und ueberschreibt dabei bewusst einen von aussen gesetzten
#    Wert: sonst koennte eine Umgebungsvariable in der Job-Definition das Gate
#    unbemerkt aushebeln.
#
# 2. Erst danach die Minuten. Die Worktrees liegen unter
#    $TMPDIR/red-first-$$/ — der Pfad enthaelt die PID und ist bei jedem Lauf
#    ein anderer, das darin liegende target/ also immer kalt (gemessen: 158s
#    fuer einen Baum). Die Abhaengigkeiten haengen NICHT am Workspace-Pfad,
#    nur das Wurzelpaket tut das. Ein stabiler Pfad je Rolle laesst deshalb
#    die 549 Abhaengigkeiten ueber Laeufe hinweg stehen, ohne die beiden
#    Baeume je zu vermischen.
#
# MSYS/Git-Bash: cargo ist dort ein natives Windows-Programm und versteht
# `/c/Users/...` nicht — die Umwandlung von POSIX-Pfaden greift bei
# Umgebungsvariablen nicht zuverlaessig, also hier explizit.
RF_TARGET_BASE="$ROOT/src-tauri/target-red-first-base"
# Der Kopf baut nur dann in das normale target/, wenn der Checkout WIRKLICH
# der Kopf ist — dann ist es derselbe Code, und der warme Cache ist der Sinn
# der Sache. Weicht der Checkout ab (dann legt sich unten ein eigener
# Worktree an), bekommt der Kopf ein eigenes Verzeichnis: sonst baut fremder
# Code in das target/ des Arbeitsbaums, und wir haetten genau die
# Artefakt-Vermischung, gegen die die Trennung ueberhaupt gemacht wurde.
# Befund des externen Dual-Reviews vom 21.09. (kimi-k2.7-code R-14, Schwere
# hoch); der Wert wird unten gesetzt, sobald HEAD_TREE feststeht.
RF_TARGET_HEAD="$ROOT/src-tauri/target"
RF_TARGET_HEAD_EIGEN="$ROOT/src-tauri/target-red-first-head"

as_native_path() {
  if command -v cygpath > /dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

if [ -n "$COMMIT_MSG_FILE" ]; then
  # No network in a hook: without a local origin/main or HEAD say so and leave
  # the verdict to the prepush lane (red-first-plan), which fails loudly.
  if ! git rev-parse --verify -q origin/main > /dev/null || ! git rev-parse --verify -q HEAD > /dev/null; then
    echo "red-first: commit-msg check skipped (no local origin/main or HEAD); prepush re-checks" >&2
    exit 0
  fi
  HEAD_SHA="$(git rev-parse HEAD)"
  BASE_SHA="$(git merge-base HEAD origin/main)"
else
HEAD_SHA="${HEAD_SHA:-$(git rev-parse HEAD)}"
BASE_REF="${BASE_SHA:-origin/main}"
if [ -z "${BASE_SHA:-}" ]; then
  git rev-parse --verify origin/main >/dev/null 2>&1 || git fetch --depth=1 origin main
fi
BASE_SHA="$(git merge-base "$HEAD_SHA" "$BASE_REF")"
fi

echo "red-first: BASE=$BASE_SHA"
echo "red-first: HEAD=$HEAD_SHA"

collect_messages() {
  git log --no-merges --format='%H%x00%B%x00' "${BASE_SHA}..${HEAD_SHA}"
  if [ -n "${PR_BODY:-}" ]; then
    printf '%s\0%s\0' "PR_BODY" "$PR_BODY"
  fi
}

# Dependabot-Commits (W1-19b / CI-02): Dependabot schreibt keinen Trailer, und
# jeder seiner PRs war hier rot (#42/#34 im September, #109/#111 am 24.09.) -
# kein Befund ueber den Code, sondern ueber die Herkunft. Ausgenommen wird
# eng:
#   - Autor exakt dependabot[bot] mit der noreply-Adresse der App UND
#     Committer GitHub (web-flow, noreply@github.com). Wer einen Bot-Commit
#     lokal umschreibt, ist der Committer und schreibt den Trailer selbst.
#   - JEDE Datei des Commits ist ein Manifest eines in .github/dependabot.yml
#     konfigurierten Oekosystems. Ein Bot-Commit, der daneben Quellcode
#     aendert, braucht weiter einen Trailer.
# Das ist eine Herkunftsregel, keine Sicherheitsgrenze: Autor und Committer
# lassen sich faelschen. Deshalb nur Manifeste - und alle Gates laufen fuer
# den PR trotzdem voll. Selbsttest: scripts/test-red-first-dependabot.sh
DEPENDABOT_AUTHOR="dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>"
is_dependabot_manifest_commit() { # sha datei...
  local sha="$1" f
  shift
  [ "$(git log -1 --format='%an <%ae>' "$sha")" = "$DEPENDABOT_AUTHOR" ] || return 1
  [ "$(git log -1 --format='%ce' "$sha")" = "noreply@github.com" ] || return 1
  [ "$#" -gt 0 ] || return 1
  for f in "$@"; do
    case "$f" in
      # Review CI-02: Wurzel-Manifeste (glm-5.2 F1, sobald es eine
      # Wurzel-Crate gibt) und action.yaml (kimi-k3 F5, Dependabot fasst
      # beide Endungen an) gehoeren genauso dazu.
      package.json | package-lock.json | src-tauri/Cargo.toml | src-tauri/Cargo.lock | Cargo.toml | Cargo.lock) ;;
      .github/workflows/*.yml | .github/workflows/*.yaml | .github/actions/*/action.yml | .github/actions/*/action.yaml) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

# The #351 guard: a bare path trailer for a file that already exists at the
# merge base, or a malformed Test-First line. Shared by the commit-msg hook
# (--commit-msg) and the per-commit loop below - one implementation.
check_trailer_forms() { # msg
  local msg="$1" trailer spec path
  while IFS= read -r trailer; do
    [ -n "$trailer" ] || continue
    spec="${trailer#*:}"
    spec="${spec# }"
    spec="${spec#	}"
    [[ "$spec" == *::* ]] && continue
    path="${spec#./}"
    if git cat-file -e "${BASE_SHA}:${path}" 2>/dev/null; then
      echo "red-first: use Test-First: <path>::<exact test name> for each NEW test" >&2
      return 1
    fi
  done < <(printf '%s\n' "$msg" | tr -d '\r' | grep -E '^(Test-First|Regression-For):[[:space:]]+' || true)
  if grep -q '^Test-First:' <<< "$msg"; then
    if ! tf_trailer_is_well_formed "$msg"; then
      echo "red-first: malformed Test-First trailer" >&2
      return 1
    fi
  fi
  return 0
}

fail_source_without_trailer() {
  local sha msg
  local files=()
  while IFS= read -r sha; do
    [ -n "$sha" ] || continue
    files=()
    # quotepath=false: Nicht-ASCII-Namen kommen sonst C-quotet zurueck
    # ("...\303\244.rs"), und die Manifest-Muster unten passten nicht
    # (Review CI-02, kimi-k3 F1).
    while IFS= read -r _f; do
      [ -n "$_f" ] && files+=("$_f")
    done < <(git -c core.quotepath=false diff-tree --no-commit-id --name-only -r "$sha")
    msg="$(git log -1 --format=%B "$sha")"
    check_trailer_forms "$msg" || return 1
    if is_dependabot_manifest_commit "$sha" "${files[@]+"${files[@]}"}"; then
      echo "red-first: Commit $(git rev-parse --short "$sha") ist ein Dependabot-Manifest-Update - kein Trailer verlangt"
      continue
    fi
    if tf_file_list_needs_trailer "${files[@]+"${files[@]}"}"; then
      if ! tf_message_has_required_trailer "$msg"; then
        echo "red-first: Commit $sha aendert Quellcode ohne Test-First:/Regression-For:/No-Test:" >&2
        git log -1 --oneline "$sha" >&2
        git diff-tree --no-commit-id --name-only -r "$sha" >&2
        return 1
      fi
      if ! tf_trailer_is_well_formed "$msg"; then
        echo "red-first: Commit $sha hat einen missgebildeten Trailer" >&2
        return 1
      fi
    fi
  done < <(git log --no-merges --format='%H' "${BASE_SHA}..${HEAD_SHA}")
  return 0
}

if [ -n "$COMMIT_MSG_FILE" ]; then
  # Check the message being committed against the STAGED files, no build.
  # Called by .githooks/commit-msg. Same rules as the CI plan, minus history.
  msg="$(cat "$COMMIT_MSG_FILE")"
  staged=()
  while IFS= read -r _f; do [ -n "$_f" ] && staged+=("$_f"); done < <(git -c core.quotepath=false diff --cached --name-only --no-renames)
  check_trailer_forms "$msg" || exit 1
  if tf_file_list_needs_trailer "${staged[@]+"${staged[@]}"}"; then
    tf_message_has_required_trailer "$msg" || { echo "red-first: staged source change needs Test-First:/Regression-For:/No-Test:" >&2; exit 1; }
    tf_trailer_is_well_formed "$msg" || { echo "red-first: malformed trailer" >&2; exit 1; }
  fi
  # A Test-First spec must name a file in the index and, with ::name, a test
  # whose name occurs in that file (cheap grep, no cargo).
  while IFS= read -r spec; do
    [ -n "$spec" ] || continue
    path="${spec%%::*}"; path="${path#./}"
    [[ "$spec" =~ ^[a-zA-Z_][a-zA-Z0-9_]*(::[a-zA-Z_][a-zA-Z0-9_]*)+$ ]] && path="src-tauri/src/main.rs"
    if ! git cat-file -e ":${path}" 2>/dev/null; then
      echo "red-first: Test-First path not in the candidate index: $path ($spec)" >&2; exit 1
    fi
    if [[ "$spec" == *::* ]]; then
      name="${spec##*::}"
      if ! git show ":${path}" 2>/dev/null | grep -F -- "$name" >/dev/null; then
        echo "red-first: test '$name' does not occur in $path ($spec)" >&2; exit 1
      fi
    fi
  done < <(printf '%s\n' "$msg" | tr -d '\r' | grep -E '^Test-First:[[:space:]]+' | sed -E 's/^Test-First:[[:space:]]+//')
  exit 0
fi

SPECS=()
while IFS= read -r spec; do
  [ -n "$spec" ] || continue
  SPECS+=("$spec")
done < <(
  {
    git log --no-merges --format=%B "${BASE_SHA}..${HEAD_SHA}"
    printf '%s\n' "${PR_BODY:-}"
  } | tr -d '\r' | grep -E '^Test-First:[[:space:]]+' | sed -E 's/^Test-First:[[:space:]]+//'
)

REGRESSION=()
while IFS= read -r spec; do
  [ -n "$spec" ] || continue
  REGRESSION+=("$spec")
done < <(
  {
    git log --no-merges --format=%B "${BASE_SHA}..${HEAD_SHA}"
    printf '%s\n' "${PR_BODY:-}"
  } | tr -d '\r' | grep -E '^Regression-For:[[:space:]]+' | sed -E 's/^Regression-For:[[:space:]]+//'
)

fail_source_without_trailer

validate_test_first_paths_at_head() {
  local spec path
  for spec in "${SPECS[@]+"${SPECS[@]}"}"; do
    if [[ "$spec" =~ ^[a-zA-Z_][a-zA-Z0-9_]*(::[a-zA-Z_][a-zA-Z0-9_]*)+$ ]]; then
      path="src-tauri/src/main.rs"
    elif [[ "$spec" == *::* ]]; then
      path="${spec%%::*}"
    else
      path="$spec"
    fi
    path="${path#./}"
    if ! git cat-file -e "${HEAD_SHA}:${path}" 2>/dev/null; then
      echo "red-first: Test-First-Pfad existiert am HEAD nicht: $path (Beleg: $spec)" >&2
      return 1
    fi
  done
}

validate_test_first_paths_at_head

if [ "$PLAN_ONLY" -eq 1 ]; then
  # Erst nach fail_source_without_trailer: ein Commit, der Quellcode ohne
  # Trailer aendert, ist auch im Plan-Modus rot.
  echo "count=$(( ${#SPECS[@]} + ${#REGRESSION[@]} ))"
  echo "specs=${#SPECS[@]}"
  exit 0
fi

regex_escape() {
  printf '%s' "$1" | sed -e 's/[][\\.*^$+?(){}|\/]/\\&/g'
}

node_name_run() {
  # `path.mjs::name`: node --test selects only by regex, so the name is escaped
  # and anchored. The spec reporter prints the pass line classify_run looks for.
  node --test --test-reporter=spec --test-name-pattern="^$(regex_escape "$1")\$" "$2"
}

playwright_title_in_source() {
  # Exact test()/test.only|skip|fix() string title present in the source file.
  node -e 'const fs=require("fs");const n=process.argv[2];const s=fs.readFileSync(process.argv[1],"utf8");const re=/test(?:\.(?:skip|only|fix))?\(\s*(["'\''`])((?:\\.|(?!\1).)*)\1/g;let m;while((m=re.exec(s))){if(m[2]===n)process.exit(0);}process.exit(1);' "$1" "$2"
}

playwright_denkraum_name_run() {
  # `-g` matches space-joined grepTitle (`basename title`) with flags `gi`.
  # Anchor basename+title so suffix/prefix siblings cannot satisfy the trailer.
  local name="$1" path="$2" base
  base="$(basename "$path")"
  npx playwright test -c tools/denkraum/playwright.config.mjs "$path" \
    -g "$(regex_escape "$base") $(regex_escape "$name")$" --reporter=list
}

ensure_node_modules() {
  local tree="$1"
  if [ ! -d "$tree/node_modules" ] && [ -f "$tree/package.json" ]; then
    echo "red-first: npm ci in $tree"
    (cd "$tree" && npm ci)
  fi
}

run_spec() {
  # `target` ist Pflicht, nicht optional. Befund kimi-k2.7-code R-5: ein
  # kuenftiger dritter Aufruf ohne drittes Argument wuerde sonst still in das
  # Standardverzeichnis bauen — also wieder teilen, wogegen das hier steht.
  # So scheitert er sofort und laut.
  local spec="$1" tree="$2" target="$3"
  local path name candidate
  local cargo_tests=()
  # Jeder cargo-Aufruf in diesem Skript baut in das Verzeichnis SEINES Baums.
  # Ohne das koennte der Kopf die Artefakte der Merge-Base erben (siehe oben).
  local -a cargo_env=(env "CARGO_TARGET_DIR=$(as_native_path "$target")")
  if [[ "$spec" =~ ^[a-zA-Z_][a-zA-Z0-9_]*(::[a-zA-Z_][a-zA-Z0-9_]*)+$ ]]; then
    # Ein voll qualifizierter Rust-Testname ist ebenfalls eine gueltige
    # Referenz. Die exakte/eindeutige Testsuche unten bleibt; ein leerer
    # Cargo-Filter wird nie akzeptiert.
    path="src-tauri/src/main.rs"
    name="$spec"
  elif [[ "$spec" == *::* ]]; then
    path="${spec%%::*}"
    name="${spec#*::}"
  else
    path="$spec"
    name=""
  fi

  if [ ! -e "$tree/$path" ]; then
    echo "Datei fehlt: $path"
    return 1
  fi

  case "$path" in
    src-tauri/*|*.rs)
      if [ -z "$name" ]; then
        # A Test-First trailer may name a Rust source file whose tests are
        # included under a generic alias such as `tests`. Resolve the test
        # functions from that file so a path-only trailer stays bounded and
        # behaves identically on every runner.
        local source_file test_name
        local source_tests=()
        local ran_source_test=0
        source_file="$(basename "$path")"
        while IFS= read -r test_name; do
          [ -n "$test_name" ] && source_tests+=("$test_name")
        done < <(
          awk '
            /^[[:space:]]*#[[:space:]]*\[(tokio::)?test([^]]*)\]/ { pending=1; next }
            pending && match($0, /fn[[:space:]]+[A-Za-z_][A-Za-z0-9_]*/) {
              name=substr($0, RSTART, RLENGTH)
              sub(/^fn[[:space:]]+/, "", name)
              print name
              pending=0
            }
            !/^[[:space:]]*$/ && !/^[[:space:]]*#[[:space:]]*\[/ && !pending { pending=0 }
          ' "$tree/$path"
        )
        if [ "${#source_tests[@]}" -gt 0 ]; then
          for test_name in "${source_tests[@]}"; do
            cargo_tests=()
            while IFS= read -r candidate; do
              [ -n "$candidate" ] && cargo_tests+=("$candidate")
            done < <(
              cd "$tree/src-tauri"
              "${cargo_env[@]}" cargo test -- --list 2>/dev/null |
                awk -v requested="$test_name" '
                  /: test$/ {
                    sub(/: test$/, "")
                    suffix = "::" requested
                    if ($0 == requested ||
                        (length($0) > length(suffix) &&
                         substr($0, length($0) - length(suffix) + 1) == suffix)) {
                      if (!seen[$0]++) print
                    }
                  }
                '
            )
            if [ "${#cargo_tests[@]}" -ne 1 ]; then
              if [ "${#cargo_tests[@]}" -eq 0 ]; then
                echo "Rust-Testname ist auf dieser Plattform nicht vorhanden: $test_name"
                continue
              fi
              echo "Rust-Testname ist fuer $path nicht eindeutig: $test_name" >&2
              printf '  %s\n' "${cargo_tests[@]}" >&2
              return 1
            fi
            ran_source_test=1
            (cd "$tree/src-tauri" && "${cargo_env[@]}" cargo test "${cargo_tests[0]}" -- --exact --nocapture) || return
          done
          if [ "$ran_source_test" -eq 0 ]; then
            echo "red-first: $path plattformbedingt uebersprungen"
          fi
          return
        fi
      fi
      if [ -n "$name" ]; then
        while IFS= read -r candidate; do
          [ -n "$candidate" ] && cargo_tests+=("$candidate")
        done < <(
          cd "$tree/src-tauri"
          "${cargo_env[@]}" cargo test -- --list 2>/dev/null |
            awk -v requested="$name" '
              /: test$/ {
                sub(/: test$/, "")
                suffix = "::" requested
                if ($0 == requested ||
                    (length($0) > length(suffix) &&
                     substr($0, length($0) - length(suffix) + 1) == suffix)) {
                  if (!seen[$0]++) print
                }
              }
            '
        )
        if [ "${#cargo_tests[@]}" -eq 0 ]; then
          # A test that is #[cfg]-gated to the other OS does not exist for
          # `cargo test --list` here (PR #12: Windows-only tests on the
          # Linux runner). Only a provable gate is skipped; the other OS's
          # run (the queue's Windows lane) is where it is proven.
          if tf_rust_test_gated_off_platform "$tree" "$path" "$name"; then
            echo "red-first: $path plattformbedingt uebersprungen ($name ist auf dieser Plattform per #[cfg] nicht kompiliert)"
            return 0
          fi
          echo "Kein Rust-Test passt exakt auf: $name"
          return 1
        fi
        if [ "${#cargo_tests[@]}" -ne 1 ]; then
          echo "Rust-Testname ist mehrdeutig: $name" >&2
          printf '  %s\n' "${cargo_tests[@]}" >&2
          return 1
        fi
        (cd "$tree/src-tauri" && "${cargo_env[@]}" cargo test "${cargo_tests[0]}" -- --exact --nocapture)
      else
        (cd "$tree/src-tauri" && "${cargo_env[@]}" cargo test -- --nocapture)
      fi
      ;;
    e2e/*.spec.ts|e2e/*.spec.tsx|*.e2e.spec.ts|*.e2e.spec.tsx)
      ensure_node_modules "$tree"
      (cd "$tree" && npx playwright test "$path")
      ;;
    tools/denkraum/*.spec.mjs)
      # Denkraum Playwright harness (config is not the repo-root e2e one).
      ensure_node_modules "$tree"
      if [ -n "$name" ]; then
        local pw_out pw_code
        set +e
        pw_out="$(cd "$tree" && playwright_denkraum_name_run "$name" "$path" 2>&1)"
        pw_code=$?
        set -e
        printf '%s\n' "$pw_out"
        if printf '%s\n' "$pw_out" | sed -E $'s/\033\\[[0-9;]*m//g' |
          grep -E 'No tests found' >/dev/null; then
          if playwright_title_in_source "$tree/$path" "$name"; then
            echo "red-first: playwright title present but not discovered"
          else
            echo "red-first: playwright title absent from source"
          fi
        fi
        return "$pw_code"
      else
        (cd "$tree" && npx playwright test -c tools/denkraum/playwright.config.mjs "$path" --reporter=list)
      fi
      ;;
    *.ts|*.tsx)
      ensure_node_modules "$tree"
      if [ -n "$name" ]; then
        (cd "$tree" && npx vitest run "$path" -t "$name")
      else
        (cd "$tree" && npx vitest run "$path")
      fi
      ;;
    *.mjs|*.cjs)
      ensure_node_modules "$tree"
      if [ -n "$name" ]; then
        (cd "$tree" && node_name_run "$name" "$path")
      else
        (cd "$tree" && node --test "$path")
      fi
      ;;
    *.sh)
      bash "$tree/$path"
      ;;
    *)
      echo "Nicht unterstuetzter Test-First-Dateityp: $path" >&2
      return 2
      ;;
  esac
}

classify_run() {
  # 0 = gruen (Tests gelaufen und ok)
  # 1 = rot (fehlgeschlagen, Datei fehlt, 0 Tests, Compile-Fehler)
  # 2 = ungueltiger Beweis (Mehrdeutigkeit / Discovery-Ausschluss)
  local out="$1" code="$2" spec="$3" path
  path="${spec%%::*}"
  if [[ "$spec" =~ ^[a-zA-Z_][a-zA-Z0-9_]*(::[a-zA-Z_][a-zA-Z0-9_]*)+$ ]]; then
    path="src-tauri/src/main.rs"
  fi
  # Named Denkraum runs classify on non-zero exits too: absent title = red (1);
  # discovery exclusion / ambiguity = INVALID (2).
  case "$path" in
    tools/denkraum/*.spec.mjs)
      local plain expected
      plain="$(printf '%s\n' "$out" | sed -E $'s/\033\\[[0-9;]*m//g')"
      if printf '%s\n' "$plain" | grep -F 'Datei fehlt:' >/dev/null; then
        return 1
      fi
      if [[ "$spec" == *::* ]]; then
        expected="${spec#*::}"
        if printf '%s\n' "$plain" |
          grep -F 'red-first: playwright title present but not discovered' >/dev/null; then
          return 2
        fi
        if printf '%s\n' "$plain" | grep -E 'No tests found' >/dev/null; then
          if printf '%s\n' "$plain" |
            grep -F 'red-first: playwright title absent from source' >/dev/null; then
            return 1
          fi
          return 2
        fi
        if ! printf '%s\n' "$plain" | grep -F -- "› ${expected} (" >/dev/null; then
          return 2
        fi
        [ "$code" -eq 0 ] || return 1
        printf '%s\n' "$plain" | grep -E '(^|[[:space:]])1 passed' >/dev/null || return 2
        return 0
      fi
      if printf '%s\n' "$plain" | grep -E 'No tests found' >/dev/null; then
        return 1
      fi
      [ "$code" -eq 0 ] || return 1
      printf '%s\n' "$plain" | grep -E '(^|[[:space:]])[1-9][0-9]* passed' >/dev/null
      return
      ;;
  esac
  if [ "$code" -ne 0 ]; then
    return 1
  fi
  case "$path" in
    src-tauri/*|*.rs)
      # Drain all output: grep -q can close the pipe early, making printf fail
      # with SIGPIPE under pipefail even when the test result is successful.
      if printf '%s\n' "$out" | grep -F 'plattformbedingt uebersprungen' >/dev/null; then
        return 0
      fi
      printf '%s\n' "$out" | grep -E 'test result: ok\. [1-9][0-9]* passed' >/dev/null
      ;;
    *.ts|*.tsx)
      if printf '%s\n' "$out" |
        grep -E 'no tests found|No test files found|No tests found|Datei fehlt:' >/dev/null; then
        return 1
      fi
      # `vitest run path -t name` exits 0 even when the name matches nothing:
      # every test is skipped. A run without a single passed test proves
      # nothing, the same rule the Rust branch applies to "0 passed".
      # Strip ANSI first; CI output colours the counts.
      if printf '%s\n' "$out" | sed -E $'s/\033\\[[0-9;]*m//g' |
        grep -E '^[[:space:]]*Tests[[:space:]]' >/dev/null; then
        printf '%s\n' "$out" | sed -E $'s/\033\\[[0-9;]*m//g' |
          grep -E '^[[:space:]]*Tests[[:space:]].*[1-9][0-9]* passed' >/dev/null
        return
      fi
      return 0
      ;;
    *.mjs|*.cjs)
      if printf '%s\n' "$out" | grep -E 'ℹ tests 0$|Datei fehlt:' >/dev/null; then
        return 1
      fi
      if [[ "$spec" == *::* ]]; then
        # A name that matches nothing still exits 0 and reports the file itself
        # as one passing test. Only a pass line for the named test is green.
        printf '%s\n' "$out" | sed -E $'s/\033\\[[0-9;]*m//g' |
          grep -F -- "✔ ${spec#*::} (" >/dev/null
        return
      fi
      return 0
      ;;
    *.sh)
      if [[ "$spec" == *::* ]]; then
        # Shell suites have no common name-filter protocol. Their existing
        # self-tests do, however, report each successful assertion as
        # `ok   <name> (...)`. A named Test-First trailer must point to such
        # an assertion; accepting only the suite's exit code made a newly
        # added case look green at a base where that case did not exist.
        printf '%s\n' "$out" | awk -v expected="${spec#*::}" '
          {
            line = $0
            sub(/\r$/, "", line)
            if (line ~ /[[:cntrl:]]/ || line !~ /^ok[[:space:]]+/) next
            sub(/^ok[[:space:]]+/, "", line)
            if (line == expected) {
              found = 1
            } else if (index(line, expected " (") == 1) {
              suffix = substr(line, length(expected) + 1)
              if (suffix ~ /^ \([^()[:cntrl:]]+\)$/) found = 1
            }
          }
          END { exit(found ? 0 : 1) }
        '
        return
      fi
      return 0
      ;;
    *)
      return 0
      ;;
  esac
}

if [ "${#SPECS[@]}" -eq 0 ] && [ "${#REGRESSION[@]}" -eq 0 ]; then
  echo "red-first: keine Test-First-/Regression-For-Belege (Quell-Commits haben No-Test: oder nur Doku/Tests)."
  exit 0
fi

WORKDIR="${TMPDIR:-/tmp}/red-first-$$"
mkdir -p "$WORKDIR"
HEAD_TREE="$ROOT"
cleanup() {
  git worktree remove --force "$WORKDIR/base" >/dev/null 2>&1 || true
  if [ "$HEAD_TREE" != "$ROOT" ]; then
    git worktree remove --force "$HEAD_TREE" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# core.autocrlf=false: der Beweis muss die Blobs byte-genau sehen. Mit
# autocrlf=true kaemen Shell-Tests als CRLF heraus, der Shebang
# (#!/usr/bin/env bash\r) braechte die Ausfuehrung, und ein an der
# Merge-Base gruener Test saehe rot aus — das Gate naehme einen
# Test-First-Beleg an, der keiner ist (Probe: scripts/test-red-first.sh
# auf einem autocrlf-Checkout, 25.09.2026).
echo "red-first: worktree BASE"
git -c core.autocrlf=false worktree add --detach "$WORKDIR/base" "$BASE_SHA"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "$HEAD_SHA")" ]; then
  HEAD_TREE="$WORKDIR/head"
  RF_TARGET_HEAD="$RF_TARGET_HEAD_EIGEN"
  echo "red-first: worktree HEAD (Ziel $RF_TARGET_HEAD, getrennt vom Arbeitsbaum)"
  git -c core.autocrlf=false worktree add --detach "$HEAD_TREE" "$HEAD_SHA"
else
  echo "red-first: HEAD ist der aktuelle Checkout (Ziel $RF_TARGET_HEAD)"
fi

# Test-First specs whose evidence main has already proven: a commit reachable
# from the merge base carries the identical `Test-First:` line, so main's own
# red-first showed it red->green when that commit landed. Found on PR #149
# (25.09.2026): CI-02's hook fix and test reached main separately as hotfix
# #156 with the same trailer; after merging main the test is green at the
# merge base and can never be shown red again. Only the IDENTICAL spec
# counts - an existing, passing test without such a trailer on main is still
# no evidence. Self-test: scripts/test-red-first-landed.sh
PROVEN_ON_MAIN="$(git log --format=%B "$BASE_SHA" | tr -d '\r' |
  grep -E '^Test-First:[[:space:]]+' | sed -E 's/^Test-First:[[:space:]]+//; s/[[:space:]]+$//' | sort -u || true)"

red_ok=1
for spec in "${SPECS[@]}"; do
  echo
  echo "=== Test-First an der Merge-Base: $spec ==="
  set +e
  out="$(run_spec "$spec" "$WORKDIR/base" "$RF_TARGET_BASE" 2>&1)"
  code=$?
  set -e
  printf '%s\n' "$out"
  set +e
  classify_run "$out" "$code" "$spec"
  cls=$?
  set -e
  case "$cls" in
    0)
      if grep -qxF -- "$spec" <<< "$PROVEN_ON_MAIN"; then
        echo "red-first: $spec ist an der Merge-Base gruen, aber already proven on main (identischer Test-First-Trailer in der Historie der Merge-Base) - kein Fehler; der Kopf muss weiter gruen sein."
      else
        echo "red-first: $spec war an der Merge-Base GRUEN — das ist kein Test-First-Beleg." >&2
        red_ok=0
      fi
      ;;
    1)
      echo "red-first: $spec ist an der Merge-Base rot/fehlend (erwartet)."
      ;;
    *)
      echo "red-first: $spec liefert an der Merge-Base keinen gueltigen Rot-Beweis (ungueltig/mehrdeutig)." >&2
      red_ok=0
      ;;
  esac
done

head_ok=1
for spec in "${SPECS[@]}"; do
  [ -n "$spec" ] || continue
  echo
  echo "=== am Kopf: $spec ==="
  set +e
  out="$(run_spec "$spec" "$HEAD_TREE" "$RF_TARGET_HEAD" 2>&1)"
  code=$?
  set -e
  printf '%s\n' "$out"
  set +e
  classify_run "$out" "$code" "$spec"
  cls=$?
  set -e
  if [ "$cls" -ne 0 ]; then
    echo "red-first: $spec ist am Kopf nicht gruen." >&2
    head_ok=0
  else
    echo "red-first: $spec ist am Kopf gruen."
  fi
done

resolve_regression_commit() {
  local reference="$1" resolved
  if resolved="$(git rev-parse --verify "$reference^{commit}" 2>/dev/null)"; then
    printf '%s\n' "$resolved"
    return 0
  fi
  # A CI run ID is an immutable evidence reference. Resolve it to the run's
  # head instead of treating the decimal ID as a Git object name.
  if [[ "$reference" =~ ^[0-9]+$ ]] && command -v gh >/dev/null 2>&1; then
    resolved="$(GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}" gh run view --repo Cuarroc/ProjectA "$reference" --json headSha --jq .headSha 2>/dev/null || true)"
    if [ -z "$resolved" ] && command -v curl >/dev/null 2>&1; then
      resolved="$(curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN:-${GH_TOKEN:-}}" \
        "https://api.github.com/repos/Cuarroc/ProjectA/actions/runs/$reference" 2>/dev/null |
        sed -nE 's/.*"head_sha"[[:space:]]*:[[:space:]]*"([0-9a-fA-F]{40})".*/\1/p' | head -n 1 || true)"
    fi
    if [[ "$resolved" =~ ^[0-9a-fA-F]{40}$ ]]; then
      printf '%s\n' "$resolved"
      return 0
    fi
  fi
  return 1
}

for sha in "${REGRESSION[@]+"${REGRESSION[@]}"}"; do
  [ -n "$sha" ] || continue
  echo
  echo "=== Regression-For am Kopf: $sha ==="
  resolved_sha="$(resolve_regression_commit "$sha" || true)"
  if [ -z "$resolved_sha" ] || ! git merge-base --is-ancestor "$resolved_sha" "$HEAD_SHA"; then
    echo "red-first: Regression-For verweist auf keinen Vorfahren des Kopfes: $sha" >&2
    head_ok=0
  else
    echo "red-first: $sha ist Vorfahre des Kopfes; die Kopf-Gates belegen den Regressionstest."
  fi
done

if [ "$red_ok" -ne 1 ] || [ "$head_ok" -ne 1 ]; then
  exit 1
fi

echo
echo "red-first: OK"
