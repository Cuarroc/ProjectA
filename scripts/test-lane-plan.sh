#!/usr/bin/env bash
# Selbsttest fuer scripts/ci/lane-plan.sh (CI-01 als test-windows-plan.sh,
# CI-02 auf beide Bahnen erweitert; CI-03: windows never on an ordinary PR).
#
# Beweist in einem Wegwerf-Repo mit echtem PR-Merge-Commit (wie
# refs/pull/N/merge im Actions-Checkout):
#   Bahn windows
#   - on an ordinary PR it never runs (CI-03); the log still names a changed
#     Windows input (Rust change, include_str! target under docs/, ...) and
#     names none for docs/frontend only,
#   Bahn linux (Docs-only fast-success, CI-02)
#   - reine Doku, die kein Gate liest, laesst sie aus,
#   - Doku, die ein Gate liest (STAND.md, .pa/task_*, docs/PLAN.md,
#     docs/dev-hq/*, include_str!-Ziel, Literal im Testcode, Praefix aus
#     einem Template-String), loest sie aus - ein Verweis nur im KOMMENTAR
#     nicht,
#   - jede Nicht-.md-Datei und .md ausserhalb von Wurzel/docs/.pa loest sie aus,
#   beide Bahnen
#   - Merge-Queue, schedule und workflow_dispatch fahren IMMER voll,
#   - ein Push auf main faehrt voll genau dann, wenn eine Cache-Eingabe der
#     Bahn geaendert ist (Cargo.lock beide, package-lock.json nur linux), und
#     voll, wenn der Vorgaenger-Commit fehlt oder der Push nicht auf main geht,
#   - ein Nicht-Merge-Commit und ein zu flacher Checkout fuehren zur vollen
#     Bahn (Sicherheitsnetz),
#   - die Ausgabe hat genau die zwei Schluesselzeilen run=/reason=.
# Und im ECHTEN Repo: die bekannten Doku-Leser sind schwer, ein Paketbericht
# ist leicht.
# Jeder Fall prueft beide Richtungen - der Detektor muss scheitern KOENNEN
# (AGENTS.md, Regel 2).
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
# Ueberschreibbar, damit sich belegen laesst, dass eine aeltere Fassung des
# Skripts an den neuen Faellen scheitert.
PLAN="${LANE_PLAN_SCRIPT:-$HERE/scripts/ci/lane-plan.sh}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/lane-plan.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0

[ -f "$PLAN" ] || { echo "FEHLER: $PLAN fehlt"; exit 1; }

repo="$tmp/repo"
mkdir -p "$repo"
cd "$repo" || exit 1
git init -q -b main
git config user.email "probe@example.test"
git config user.name "lane-plan probe"
git config commit.gpgsign false
git config core.hooksPath /dev/null
git config core.autocrlf false

mkdir -p scripts/ci scripts/lib src-tauri/src docs/dev-hq src .github/workflows .pa assets
cp "$PLAN" scripts/ci/lane-plan.sh
printf 'fn main() {}\n' > src-tauri/src/main.rs
printf '[package]\nname = "x"\n' > src-tauri/Cargo.toml
printf '# lock\n' > src-tauri/Cargo.lock
printf '{}\n' > package-lock.json
# Eine Datei ausserhalb des Crates, eingebunden per include_str! - genau die
# Klasse von docs/PLAN.md in src/development_plan.rs.
printf 'const X: &str = include_str!("../../docs/EINGEBUNDEN.md");\n' > src-tauri/src/plan.rs
printf '# eingebunden\n' > docs/EINGEBUNDEN.md
# Review CI-01 (kimi-k3 F4, glm-5.2): Einbindungen ausserhalb von src/
# (build.rs, tests/) und mit Leerzeichen im Makroaufruf.
printf 'fn main() { let _ = include_str!( "../assets/BUILD.txt" ); }\n' > src-tauri/build.rs
mkdir -p src-tauri/tests
printf 'const Y: &[u8] = include_bytes!("../../assets/TEST.bin");\n' > src-tauri/tests/it.rs
printf 'b\n' > assets/BUILD.txt
printf 't\n' > assets/TEST.bin
printf 'frei\n' > assets/FREI.txt
# Review CI-02 (kimi-k3 F6): Raw-String-Einbindung.
printf 'const R: &str = include_str!(r#"../../assets/RAW.txt"#);\n' > src-tauri/src/raw.rs
printf 'r\n' > assets/RAW.txt
# Ein Test, der Doku liest - als Literal, als Template-Praefix und (nicht
# zaehlend) nur im Kommentar.
cat > scripts/lib/leser.test.mjs <<'EOF'
// docs/KOMMENTAR.md wird hier nur erwaehnt, nicht gelesen.
import { readFileSync } from "node:fs";
const a = readFileSync("docs/GELESEN.md", "utf8");
const b = (n) => readFileSync(`.pa/tpl_${n}.md`, "utf8");
EOF
for f in docs/frei.md docs/GELESEN.md docs/KOMMENTAR.md docs/PLAN.md docs/dev-hq/NOTIZ.md \
         .pa/report_x.md .pa/task_x.md .pa/report_f0_x.md .pa/tpl_a.md STAND.md CLAUDE.md; do
  printf '# %s\n' "$f" > "$f"
done
printf '{}\n' > docs/dev-hq/data.json
printf 'export {};\n' > src/App.tsx
printf 'name: ci\n' > .github/workflows/ci.yml
git add -A
git commit -q -m "basis"

# Legt einen PR-Branch an, der die genannten Dateien aendert, und baut daraus
# einen Merge-Commit wie GitHubs refs/pull/N/merge (erster Elternteil = main).
pr_merge() { # name datei...
  local name="$1" f
  shift
  git checkout -q -B "pr-$name" main
  for f in "$@"; do
    mkdir -p "$(dirname "$f")"
    printf 'aenderung %s\n' "$name" >> "$f"
  done
  git add -A
  git commit -q -m "pr $name"
  git checkout -q --detach main
  git merge -q --no-ff --no-edit "pr-$name" -m "Merge pr-$name into main"
}

run_plan() { # bahn event head_ref -> Ausgabe in $tmp/out
  EVENT_NAME="$2" HEAD_REF="$3" bash scripts/ci/lane-plan.sh "$1" > "$tmp/out" 2>&1
}

expect() { # fall erwartet(true|false)
  local got
  got="$(grep -E '^run=' "$tmp/out" | tail -1)"
  if [ "$got" = "run=$2" ]; then
    echo "ok   $1 ($got)"
  else
    echo "FEHLER $1: '$got', erwartet run=$2"
    sed 's/^/    /' "$tmp/out"
    fails=$((fails + 1))
  fi
}

case_pr() { # bahn fall erwartet datei... ; HEAD_REF ueber $QUEUE_REF
  local lane="$1" name="$2" want="$3"
  shift 3
  pr_merge "$lane-$name" "$@"
  run_plan "$lane" pull_request "${QUEUE_REF:-pr-$lane-$name}"
  expect "$lane/$name" "$want"
  git checkout -q main
}

# --- Bahn windows (CI-01, CI-03) ---------------------------------------------
# CI-03: on an ordinary pull request the Windows lane never runs - it runs in
# the merge queue, on the weekly run and on workflow_dispatch. The input
# detection stays and is pinned here through the log: the plan names the
# Windows input a PR touches ("Windows input changed: <file>"), so the author
# knows the queue run is the first Windows verdict. Column 3 says whether that
# line must appear (yes) or must not (no).
expect_log() { # fall muster ja|nein
  if grep -E "$2" "$tmp/out" > /dev/null; then
    if [ "$3" = yes ]; then echo "ok   $1 (log names input)"; return; fi
  else
    if [ "$3" = no ]; then echo "ok   $1 (log names no input)"; return; fi
  fi
  echo "FEHLER $1: log line /$2/ expected=$3"
  sed 's/^/    /' "$tmp/out"
  fails=$((fails + 1))
}
case_win() { # fall eingabe(yes|no) datei...
  local name="$1" input="$2"
  shift 2
  pr_merge "windows-$name" "$@"
  run_plan windows pull_request "pr-windows-$name"
  expect "windows/$name" false
  expect_log "windows/$name" '^lane-plan \(windows\): Windows input changed: ' "$input"
  git checkout -q main
}
case_win rust-aenderung      yes src-tauri/src/main.rs
case_win doku-aenderung      no  docs/frei.md
case_win frontend-aenderung  no  src/App.tsx
case_win bericht             no  .pa/report_x.md
case_win eingebunden         yes docs/EINGEBUNDEN.md
case_win build-rs-einbindung yes assets/BUILD.txt
case_win tests-einbindung    yes assets/TEST.bin
case_win asset-frei          no  assets/FREI.txt
case_win workflow-aenderung  yes .github/workflows/ci.yml
case_win gate-skript         yes scripts/ci/gates.sh
case_win lockfile            yes package-lock.json
case_win zeilenenden         yes .gitattributes
case_win crate-ressource     yes src-tauri/resources/a.json
# Review CI-02: git quotet Nicht-ASCII-Namen ("src-tauri/src/\303\244.rs"),
# dann passt kein Muster mehr (kimi-k3 F1); Raw-String-Einbindung (kimi-k3
# F6); ein Workspace-Manifest an der Wurzel (glm-5.2 F2).
case_win umlaut-quelle       yes 'src-tauri/src/ä.rs'
case_win raw-einbindung      yes assets/RAW.txt
case_win wurzel-cargo        yes Cargo.toml
# The merge queue is the Windows verdict before main: always the full lane,
# whatever the PR touches.
QUEUE_REF=mergify/merge-queue/0123456789 case_pr windows queue-doku true docs/frei.md
QUEUE_REF=mergify/merge-queue/0123456789 case_pr windows queue-rust true src-tauri/src/main.rs
# Even an unclear change set (no PR merge commit) does not start the lane on
# an ordinary PR: there is nothing to be unsure about, the lane is off by
# rule. The linux lane keeps its safety net (below).
git checkout -q -B einzeln-windows-pr main
printf 'x\n' >> src-tauri/src/main.rs
git add -A
git commit -q -m "einzelner commit"
run_plan windows pull_request einzeln-windows-pr
expect "windows/kein-merge-commit" false
git checkout -q main

# --- Bahn linux: Docs-only fast-success (CI-02) ------------------------------
case_pr linux doku-frei          false docs/frei.md
case_pr linux bericht            false .pa/report_x.md
case_pr linux wurzel-doku        false CLAUDE.md
case_pr linux nur-kommentar      false docs/KOMMENTAR.md
case_pr linux mehrere-frei       false docs/frei.md .pa/report_x.md CLAUDE.md
case_pr linux stand              true  STAND.md
case_pr linux spec               true  .pa/task_x.md
case_pr linux report-f0          true  .pa/report_f0_x.md
case_pr linux plan               true  docs/PLAN.md
case_pr linux devhq-md           true  docs/dev-hq/NOTIZ.md
case_pr linux devhq-daten        true  docs/dev-hq/data.json
case_pr linux eingebunden        true  docs/EINGEBUNDEN.md
case_pr linux literal-im-test    true  docs/GELESEN.md
case_pr linux template-praefix   true  .pa/tpl_a.md
case_pr linux nicht-md-in-docs   true  docs/bild.png
case_pr linux md-im-quellbaum    true  src/notizen.md
case_pr linux code               true  src/App.tsx
case_pr linux doku-plus-code     true  docs/frei.md src/App.tsx
QUEUE_REF=mergify/merge-queue/0123456789 case_pr linux queue-doku true docs/frei.md
# Nicht-ASCII-Name: ungelesene Doku bleibt leicht (kimi-k3 F1).
case_pr linux umlaut-doku        false 'docs/ü.md'

# --- schedule / workflow_dispatch: der Wochen-/Handlauf ist immer voll -------
for lane in linux windows; do
  for ev in schedule workflow_dispatch; do
    run_plan "$lane" "$ev" ""
    expect "$lane/$ev" true
  done
done

# --- Push auf main: voll genau bei Cache-Eingaben ----------------------------
# Standard ist, was Mergify auf main schreibt: ein Merge-Commit mit Autor
# mergify[bot], Committer GitHub, erster Elternteil = Vorgaenger des Pushes.
# PUSH_KIND waehlt die Gegenproben (Review CI-02, kimi-k3 F3): ein direkter
# Commit, ein Merge ohne Mergify (Admin-Umgehung der Queue), zwei Merges in
# einem Push - keiner davon ist belegt queue-geprueft.
MERGIFY_NAME="mergify[bot]"
MERGIFY_MAIL="37929162+mergify[bot]@users.noreply.github.com"
merge_as() { # autor mail branch
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME=GitHub GIT_COMMITTER_EMAIL=noreply@github.com \
    git merge -q --no-ff --no-edit "$3" -m "Merge pull request from $3"
}
push_branch() { # branch name datei...
  local b="$1" name="$2" f
  shift 2
  git checkout -q -B "$b" main
  for f in "$@"; do
    mkdir -p "$(dirname "$f")"
    printf 'push %s\n' "$name" >> "$f"
  done
  git add -A
  git commit -q -m "push $name"
  git checkout -q main
}
push_case() { # bahn fall erwartet datei... ; PUSH_REF, PUSH_KIND ueberschreibbar
  local lane="$1" name="$2" want="$3" before
  shift 3
  git checkout -q main
  before="$(git rev-parse HEAD)"
  push_branch "push-$lane-$name" "$name" "$@"
  case "${PUSH_KIND:-mergify}" in
    mergify) merge_as "$MERGIFY_NAME" "$MERGIFY_MAIL" "push-$lane-$name" ;;
    mensch) merge_as "Jemand" "jemand@example.test" "push-$lane-$name" ;;
    direkt) git merge -q --ff-only "push-$lane-$name" ;;
    zwei)
      merge_as "$MERGIFY_NAME" "$MERGIFY_MAIL" "push-$lane-$name"
      push_branch "push-$lane-$name-b" "$name-b" docs/frei.md
      merge_as "$MERGIFY_NAME" "$MERGIFY_MAIL" "push-$lane-$name-b"
      ;;
  esac
  EVENT_NAME=push GIT_REF="${PUSH_REF:-refs/heads/main}" PUSH_BEFORE="${BEFORE_OVERRIDE-$before}" \
    bash scripts/ci/lane-plan.sh "$lane" > "$tmp/out" 2>&1
  expect "$lane/push-$name" "$want"
}
for lane in linux windows; do
  push_case "$lane" rust-code    false src-tauri/src/main.rs
  push_case "$lane" frontend     false src/App.tsx
  push_case "$lane" cargo-lock   true  src-tauri/Cargo.lock
  push_case "$lane" cargo-toml   true  src-tauri/Cargo.toml
  push_case "$lane" toolchain    true  rust-toolchain.toml
  push_case "$lane" cargo-config true  .cargo/config.toml
  PUSH_REF=refs/heads/andere push_case "$lane" nicht-main true docs/frei.md
  BEFORE_OVERRIDE="" push_case "$lane" ohne-vorgaenger true docs/frei.md
  BEFORE_OVERRIDE=0000000000000000000000000000000000000000 push_case "$lane" neuer-branch true docs/frei.md
  BEFORE_OVERRIDE=1111111111111111111111111111111111111111 push_case "$lane" vorgaenger-fehlt true docs/frei.md
  PUSH_KIND=direkt push_case "$lane" direkter-commit true src/App.tsx
  PUSH_KIND=mensch push_case "$lane" merge-ohne-queue true src/App.tsx
  PUSH_KIND=zwei   push_case "$lane" zwei-merges      true src/App.tsx
done
# Der npm-Cache haengt nur an der Linux-Bahn (setup-linux).
push_case linux   npm-lock true  package-lock.json
push_case windows npm-lock false package-lock.json

# --- Sicherheitsnetz --------------------------------------------------------
# Kein Merge-Commit (HEAD hat nur einen Elternteil): Aenderungsmenge unklar.
# Bahn linux only - windows is off on every ordinary PR (CI-03, above).
git checkout -q -B einzeln-linux main
printf 'x\n' >> docs/frei.md
git add -A
git commit -q -m "einzelner commit"
run_plan linux pull_request einzeln-linux
expect "linux/kein-merge-commit" true
git checkout -q main

# Zu flacher Checkout: der erste Elternteil fehlt.
pr_merge flach docs/frei.md
git branch -q -f merge-flach HEAD
git checkout -q main
git clone -q --depth 1 --no-local --branch merge-flach "file://$repo" "$tmp/flach" 2> /dev/null
# Bahn linux only; for windows a shallow checkout changes nothing (CI-03).
(
  cd "$tmp/flach" || exit 1
  EVENT_NAME=pull_request HEAD_REF=pr-flach bash scripts/ci/lane-plan.sh windows > "$tmp/out" 2>&1
)
expect "windows/flacher-checkout" false
(
  cd "$tmp/flach" || exit 1
  EVENT_NAME=pull_request HEAD_REF=pr-flach bash scripts/ci/lane-plan.sh linux > "$tmp/out" 2>&1
)
expect "linux/flacher-checkout" true
# ... und zwar aus dem richtigen Grund, nicht zufaellig ueber einen anderen
# Zweig des Sicherheitsnetzes.
if grep -E '^reason=.*nicht verfuegbar' "$tmp/out" > /dev/null; then
  echo "ok   linux/flacher-checkout-grund"
else
  echo "FEHLER linux/flacher-checkout-grund:"; sed 's/^/    /' "$tmp/out"; fails=$((fails + 1))
fi

# Aufruffehler sind Aufruffehler, kein stilles "false".
if EVENT_NAME="" bash scripts/ci/lane-plan.sh linux > "$tmp/out" 2>&1; then
  echo "FEHLER ohne-event: Exit 0, erwartet Abbruch"; fails=$((fails + 1))
else
  echo "ok   ohne-event (Abbruch)"
fi
if EVENT_NAME=pull_request bash scripts/ci/lane-plan.sh macos > "$tmp/out" 2>&1; then
  echo "FEHLER unbekannte-bahn: Exit 0, erwartet Abbruch"; fails=$((fails + 1))
else
  echo "ok   unbekannte-bahn (Abbruch)"
fi

# Ausgabeform: genau eine run=- und eine reason=-Zeile; alle anderen Zeilen
# tragen das Praefix, damit ci.yml nur die Schluessel nach $GITHUB_OUTPUT
# schreibt (dieselbe Regel wie beim red-first-Plan).
for lane in linux windows; do
  pr_merge "format-$lane" docs/frei.md
  run_plan "$lane" pull_request "pr-format-$lane"
  if [ "$(grep -cE '^run=(true|false)$' "$tmp/out")" -eq 1 ] &&
     [ "$(grep -cE '^reason=.+' "$tmp/out")" -eq 1 ] &&
     ! grep -vE '^(run=|reason=|lane-plan \('"$lane"'\): )' "$tmp/out" > /dev/null; then
    echo "ok   $lane/ausgabeform"
  else
    echo "FEHLER $lane/ausgabeform:"; sed 's/^/    /' "$tmp/out"; fails=$((fails + 1))
  fi
  git checkout -q main
done

# --- Im ECHTEN Repo ---------------------------------------------------------
# Die include_str!-Suche SELBST findet docs/PLAN.md. Geprueft wird
# --list-dynamic, nicht --list-inputs: docs/PLAN.md steht auch statisch in der
# Liste und haette einen blinden Detektor sonst verdeckt (Befund kimi-k3 F4,
# Review CI-01).
(cd "$HERE" && bash "$PLAN" --list-dynamic) > "$tmp/inputs" 2>&1
if grep -x 'docs/PLAN.md' "$tmp/inputs" > /dev/null; then
  echo "ok   echtes-repo-findet-docs/PLAN.md"
else
  echo "FEHLER echtes-repo: docs/PLAN.md fehlt in --list-dynamic"; fails=$((fails + 1))
fi

# Die bekannten Doku-Leser der Gates muessen schwer sein (spec-status-check,
# dev-hq, include_str!, profiles.rs, HQ). Ein Paketbericht und das
# Entscheidungsprotokoll muessen leicht bleiben - sonst waere der
# Docs-only-Weg still wirkungslos (z. B. wenn ein Token wie `.pa/report_`
# alle Berichte schwer macht).
# Ein Aufruf fuer alle Dateien: die Literal-Suche ueber den ganzen Baum ist
# der teure Teil.
# Review CI-02 (kimi-k3 F2): auch die Wurzel-Doku wird festgenagelt - alle
# vier sind heute schwer (AGENTS.md/CLAUDE.md/README.md als Literal im
# Gate-Code referenziert, .pa/HQ-START.md in HEAVY_DOCS). Faellt eine davon
# kuenftig leicht durch, schlaegt dieser Test an.
real_spec="$(cd "$HERE" && ls .pa/task_*.md 2> /dev/null | head -1)"
real_heavy=(STAND.md docs/PLAN.md docs/agents-json.md docs/dev-hq/BUGS.md docs/dev-hq/data.json
            AGENTS.md CLAUDE.md README.md .pa/HQ-START.md
            .pa/report_f0.md ${real_spec:+"$real_spec"})
real_light=(.pa/report_ci-01.md docs/decisions.md)
(cd "$HERE" && bash "$PLAN" --classify "${real_heavy[@]}" "${real_light[@]}") > "$tmp/classify" 2>&1
real_expect() { # erwartet datei
  if grep -qxF "$1 $2" "$tmp/classify" || grep -qF "$1 $2 - " "$tmp/classify"; then
    echo "ok   echtes-repo $1: $2"
  else
    echo "FEHLER echtes-repo $2: erwartet $1"; sed 's/^/    /' "$tmp/classify"; fails=$((fails + 1))
  fi
}
for f in "${real_heavy[@]}"; do real_expect heavy "$f"; done
for f in "${real_light[@]}"; do real_expect light "$f"; done

if [ "$fails" -gt 0 ]; then
  echo "test-lane-plan: $fails Fehler"
  exit 1
fi
echo "test-lane-plan: alle Faelle gruen"
