#!/usr/bin/env bash
# lane-plan.sh — muss dieser Lauf die Bahn `linux` bzw. `windows` fahren?
#
# Herkunft: CI-01 (24.09.2026) als windows-plan.sh fuer die Windows-Bahn;
# CI-02 (Nutzer-Entscheidung 24.09.2026, docs/decisions.md) hat es auf beide
# Bahnen verallgemeinert. gates (windows) macht 70 % der Actions-Minuten aus
# (Windows zaehlt doppelt, gruener Lauf im Median 15,3-16,1 min), gates
# (linux) 7,3 min. Beide liefen bis CI-02 auf JEDEM Push nach main voll -
# obwohl genau dieser Code Minuten vorher im Merge-Queue-Lauf voll geprueft
# wurde.
#
# Warum ein PLAN-SCHRITT und kein `paths-ignore` / kein Job-`if`:
#   - `paths-ignore` war am 03.09. schon einmal da und hat zwei Gates blind
#     gemacht (docs/decisions.md 2026-09-04): es filtert nach Dateiendung,
#     nicht nach den Eingaben eines Gates, und ein Required Check, dessen
#     Workflow gar nicht startet, bleibt fuer immer "pending".
#   - Ein Job-`if` meldet "skipped"; ob das den Required Check erfuellt, ist
#     GitHub-Semantik, die sich aendern kann, und im Log steht kein Grund.
#   - Hier entscheidet das Gate selbst anhand EXPLIZITER Eingaben,
#     protokolliert die Entscheidung und den ausloesenden Pfad, und der Job
#     endet immer mit success oder failure. Dasselbe Muster wie
#     `red-first.sh --plan`.
#
# Entscheidung, in dieser Reihenfolge:
#   1. schedule / workflow_dispatch -> immer volle Bahn (der woechentliche
#      Volllauf auf main, CI-02).
#   2. push:
#        - nicht auf refs/heads/main, oder Vorgaenger-Commit unbekannt,
#          nicht holbar, Diff leer oder nicht bestimmbar -> volle Bahn;
#        - leicht nur hinter einem BELEGTEN Queue-Merge (Review CI-02,
#          kimi-k3 F3): HEAD muss genau EIN Merge-Commit von mergify[bot]
#          (Committer GitHub) unmittelbar auf PUSH_BEFORE sein. Ein direkter
#          Commit, ein fremder Merge oder mehr als ein Merge im Push ist
#          nicht queue-geprueft -> volle Bahn;
#        - sonst volle Bahn GENAU DANN, wenn eine CACHE-EINGABE der Bahn
#          geaendert ist (siehe unten), andernfalls leicht. Begruendung: der
#          Code auf main wurde im Queue-Lauf voll geprueft; der Push-Lauf
#          traegt nur noch den Cache fuer die PR-Laeufe, und der aendert sich
#          nur mit seinen Schluessel-Eingaben.
#   3. pull_request von Mergify (Kopf-Branch mergify/merge-queue/*) -> immer
#      volle Bahn. Die Queue ist der letzte Halt vor main.
#   4. pull_request, Bahn linux, Aenderungsmenge nicht bestimmbar (flacher
#      Checkout, kein PR-Merge-Commit, leerer Diff) -> volle Bahn. Nie "gruen
#      durch Abwesenheit" (AGENTS.md).
#   5. pull_request, Bahn windows: NEVER (CI-03, 25.09.2026). The lane runs
#      in the merge queue (3.), weekly and by hand (1.). The plan still logs
#      every changed Windows input (WINDOWS_INPUTS + include_str! targets),
#      so the author knows the queue gives the first Windows verdict. In
#      ci.yml the job runs on ubuntu-latest in this case, with a guard that
#      fails if run=true ever reaches a non-Windows runner.
#   6. pull_request, Bahn linux: voll, ausser JEDE geaenderte Datei ist
#      "leichte Doku" (is_light_doc): eine .md-Datei auf Wurzelebene, unter
#      docs/ oder unter .pa/, die KEIN Test und kein Gate liest.
#
# Cache-Eingaben (Push auf main):
#   Swatinem/rust-cache speichert nur die ABHAENGIGKEITEN, nie die Artefakte
#   des eigenen Crates (die raeumt es vor dem Speichern weg). Sein Schluessel
#   haengt an rustc-Version, Cargo.toml/Cargo.lock, rust-toolchain-Dateien
#   und .cargo/config - eine Aenderung an src-tauri/src/*.rs aendert am
#   gespeicherten Cache nichts. Der npm-Cache von actions/setup-node (nur in
#   setup-linux) haengt an package-lock.json. Genau diese Dateien loesen auf
#   main den Volllauf aus, der den Cache fuer die PRs neu schreibt.
#   NICHT erkennbar ist ein neues stabiles rustc (dtolnay/rust-toolchain
#   `stable`): das faengt der woechentliche Volllauf, bis dahin bauen PRs
#   ihre Abhaengigkeiten kalt.
#
# Eingaben der Bahn `windows` (abgeleitet aus scripts/ci/gates.sh, Gates fmt,
# clippy, rust-suite, native-tests):
#   src-tauri/**               der ganze Crate: Quelltext, Cargo.toml/.lock,
#                              build.rs, tauri.conf.json, resources/,
#                              testdata/, .config/nextest.toml, icons/
#   scripts/ci/**              gates.sh, native-tests.sh, dieses Skript
#   .github/**                 der Job selbst und seine Actions
#   .config/**                 Werkzeug-Konfiguration auf Wurzelebene
#   rust-toolchain, rust-toolchain.toml
#   .cargo/**, rustfmt.toml, .rustfmt.toml, clippy.toml, .clippy.toml
#                              cargo/rustfmt/clippy suchen sie auch in den
#                              Elternverzeichnissen des Crates
#   .gitattributes             Zeilenenden auf dem Windows-Checkout -> fmt
#   package.json, package-lock.json
#                              native-tests startet node (ConPTY-Fixture)
#   Cargo.toml, Cargo.lock       Workspace-Manifeste an der Wurzel (wirken
#                              auf den Build, sobald es eine Wurzel-Crate gibt)
#   docs/PLAN.md               include_str! in src/development_plan.rs
#   docs/agents-json.md        zur Laufzeit gelesen von einem Test in
#                              src/profiles.rs (CARGO_MANIFEST_DIR/../docs)
#   + jede Datei ausserhalb von src-tauri/, die ein `include_str!`/
#     `include_bytes!` mit Literal-Pfad irgendwo im Crate (auch build.rs,
#     tests/) referenziert. Die werden bei JEDEM Lauf frisch aus dem
#     Quelltext ermittelt - ein neues include_str!("../../x") braucht also
#     keine Pflege dieser Liste. Festgenagelt in scripts/test-lane-plan.sh.
#     NICHT erkennbar sind concat!/env!-Pfade und Laufzeit-Lesezugriffe ueber
#     CARGO_MANIFEST_DIR/.. - die stehen von Hand in der Liste
#     (docs/agents-json.md); Queue und main fahren ohnehin voll.
#
# "Leichte Doku" fuer die Bahn `linux` (CI-02): .md auf Wurzelebene, unter
# docs/ oder .pa/ - AUSSER
#   a) der statischen Liste HEAVY_DOCS: Dateien, die ein Gate ueber ein
#      Verzeichnis-Listing mit Regex liest (nicht als Literal im Code):
#        STAND.md, .pa/task_*.md   spec-status-check.mjs (Gate fe-build) und
#                                  dev-hq.mjs (Gate hq-test, hq-post-merge)
#        .pa/report_f0*.md         dev-hq.mjs (parseFindings)
#        docs/PLAN.md              include_str! + dev-hq.mjs
#        docs/agents-json.md       Test in src-tauri/src/profiles.rs
#        docs/dev-hq/*             HQ-Oberflaeche und -Daten (hq-test,
#                                  hq-visual, hq-live)
#        .pa/HQ-START.md           dev-setup.mjs
#   b) jeder Datei, die ein include_str!/include_bytes! einbindet (s. o.);
#   c) jeder Datei, die im Code, den die Gates ausfuehren, als LITERAL
#      vorkommt (doc_refs): Rust, TS/TSX, e2e, scripts/**, Test-/Build-
#      Konfiguration. Ein Token `STAND.md` macht jede Datei mit diesem Namen
#      schwer, `docs/dev-hq` jede Datei darunter, `.pa/task_` (aus einem
#      Template-String) jede mit diesem Praefix. Das ist bewusst grob: lieber
#      eine Datei zu viel schwer als eine gelesene leicht. Kommentarzeilen
#      zaehlen nicht mit, sonst waere jede in einem Kommentar zitierte Doku
#      schwer. Die Suche laeuft bei jedem PR frisch - ein neuer Test, der eine
#      Doku liest, braucht keine Pflege dieser Liste.
#   Nicht-.md-Dateien unter docs/ und .pa/ (HQ-Code, review_transport.py,
#   JSON) sind nie leicht.
#
# Ausgabe (stdout), fuer $GITHUB_OUTPUT gedacht:
#   run=true|false
#   reason=<ein Satz>
# Davor stehen menschenlesbare Zeilen mit dem Praefix "lane-plan:".
#
# Aufrufe:
#   lane-plan.sh <linux|windows>          die Entscheidung (Umgebung unten)
#   lane-plan.sh --list-dynamic           include_str!-Ziele ausserhalb src-tauri/
#   lane-plan.sh --list-inputs            Eingaben der Bahn windows
#   lane-plan.sh --classify <datei>...    je Datei "light"/"heavy <grund>"
#                                         fuer die Bahn linux (Selbsttest)
#
# Umgebung:
#   EVENT_NAME   github.event_name        (Pflicht)
#   HEAD_REF     github.head_ref          (bei pull_request)
#   GIT_REF      github.ref               (bei push; Standard refs/heads/main)
#   PUSH_BEFORE  github.event.before      (bei push)
#   PLAN_FETCH   1 = fehlenden PUSH_BEFORE-Commit per `git fetch` holen
#                (nur in CI; der Selbsttest bleibt ohne Netz)
#   PLAN_BASE    Vergleichsbasis bei pull_request; Standard: erster
#                Elternteil von HEAD. Im pull_request-Checkout ist HEAD der
#                Merge-Commit refs/pull/N/merge, sein erster Elternteil ist die
#                Spitze von main - der Diff ist also genau das, was der PR an
#                main aendert, ohne Merge-Base-Suche und mit fetch-depth 2.
#   PLAN_HEAD    Standard: HEAD
#
# Selbsttest: scripts/test-lane-plan.sh
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

LANE=""
say() { echo "lane-plan${LANE:+ ($LANE)}: $*"; }

decide() { # run reason
  say "Entscheidung: run=$1 - $2"
  echo "run=$1"
  echo "reason=$2"
  exit 0
}

# Statische Eingaben der Bahn windows als erweiterte Muster (bash `case`-Glob,
# `*` passt auch ueber `/` hinweg).
WINDOWS_INPUTS=(
  "src-tauri/*"
  "scripts/ci/*"
  ".github/*"
  ".config/*"
  "rust-toolchain"
  "rust-toolchain.toml"
  ".cargo/*"
  "rustfmt.toml"
  ".rustfmt.toml"
  "clippy.toml"
  ".clippy.toml"
  ".gitattributes"
  "package.json"
  "package-lock.json"
  # Workspace-Manifeste an der Wurzel (Review CI-02, glm-5.2 F2): sobald es
  # eine Wurzel-Crate gibt, wirken sie auf Feature-Flags und den Build.
  "Cargo.toml"
  "Cargo.lock"
  "docs/PLAN.md"
  "docs/agents-json.md"
)

# Cache-Eingaben je Bahn (Push auf main). Begruendung im Kopf.
RUST_CACHE_INPUTS=(
  "src-tauri/Cargo.toml"
  "src-tauri/Cargo.lock"
  "Cargo.toml"
  "Cargo.lock"
  "rust-toolchain"
  "rust-toolchain.toml"
  "src-tauri/rust-toolchain"
  "src-tauri/rust-toolchain.toml"
  ".cargo/*"
  "src-tauri/.cargo/*"
)
LINUX_CACHE_EXTRA=(
  "package-lock.json"
)

# Doku, die ein Gate per Listing/Regex liest - Begruendung je Zeile im Kopf.
HEAVY_DOCS=(
  "STAND.md"
  ".pa/task_*.md"
  ".pa/report_f0*.md"
  ".pa/HQ-START.md"
  "docs/PLAN.md"
  "docs/agents-json.md"
  "docs/dev-hq/*"
)

# Alle Dateien ausserhalb von src-tauri/, die der Crate per include_str!/
# include_bytes! einbindet. Relative Pfade werden vom Verzeichnis der
# einbindenden Datei aus aufgeloest.
dynamic_inputs() {
  local f dir rel resolved
  while IFS= read -r f; do
    dir="$(dirname "$f")"
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      resolved="$(normalize "$dir/$rel")"
      case "$resolved" in
        src-tauri/*) ;;          # schon durch src-tauri/* gedeckt
        ../*|/*) ;;              # ausserhalb des Repos - nicht unser Diff
        *) echo "$resolved" ;;
      esac
    # Raw-Strings (r"...", r#"..."#) zaehlen genauso (Review CI-02, kimi-k3 F6);
    # das optionale Praefix braucht die Gruppe - `r#*` allein verlangte ein r.
    done < <(grep -oE 'include_(str|bytes)![[:space:]]*\([[:space:]]*(r#*)?"[^"]+"#*' "$f" 2>/dev/null |
               sed -E 's/^include_(str|bytes)![[:space:]]*\([[:space:]]*(r#*)?"//; s/"#*$//')
  # Der ganze Crate, nicht nur src/: build.rs, tests/, benches/ und examples/
  # koennen genauso einbinden (Befund kimi-k3 F4 / glm-5.2, Review CI-01).
  # target*/ bleibt draussen - dort liegen gebaute Fremdquellen.
  done < <(find src-tauri -type d -name 'target*' -prune -o -type f -name '*.rs' -print 2>/dev/null | sort)
}

# Code, den die Gates ausfuehren: dort gesuchte Literale machen Doku schwer.
# Ohne dieses Skript und seinen Selbsttest - die zitieren Doku-Pfade als
# Beispiele und machten sie sonst selbst schwer.
doc_ref_sources() {
  find src-tauri src e2e scripts -type d \( -name 'target*' -o -name node_modules \) -prune -o \
    -type f \( -name '*.rs' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' \
    -o -name '*.cjs' -o -name '*.sh' -o -name '*.py' \) -print 2>/dev/null |
    grep -vE '^scripts/ci/lane-plan\.sh$|^scripts/test-lane-plan\.sh$'
  for f in package.json vite.config.ts vitest.config.ts playwright.config.ts tsconfig.json eslint.config.*; do
    [ -f "$f" ] && echo "$f"
  done
}

# Verweise, die nachweislich KEIN Lesezugriff auf die echte Datei sind. Format
# "<token>|<datei>": das Token zaehlt nur in DIESER Datei nicht - taucht es
# irgendwo anders auf, macht es die Doku wieder schwer. Jeder Eintrag braucht
# einen Beleg; im Zweifel keinen Eintrag.
NOT_A_READ=(
  # assert auf das Praefix eines Quellenfelds; die Quellen sind die
  # report_f0*-Berichte, die HEAVY_DOCS ohnehin fuehrt.
  ".pa/report_|scripts/lib/hq-pages.test.mjs"
  # SETUP-08: report-commit legt `.pa/report_<id>.md` an (Pfadvorlage, kein
  # Lesen einer vorhandenen Doku); erledigt-row filtert PR-Dateinamen mit dem
  # Praefix. Beide nennen nur das nackte Praefix, keine bestehende Datei.
  # Beleg: CI-Lauf 36196498999, selftest-lane-plan rot an .pa/report_ci-01.md.
  ".pa/report_|scripts/dev/report-commit.mjs"
  ".pa/report_|scripts/dev/erledigt-row.mjs"
  # Dateilisten der Rueckrechnungs-Fixture in wave_two(): die Pfade sind
  # Testdaten (gemergte PR-Dateilisten), kein Lesezugriff auf die Doku.
  # Beleg: CI-Lauf 36165998301, selftest-lane-plan rot an docs/decisions.md.
  "docs/decisions.md|src-tauri/src/workers/lane_guard.rs"
  "docs/ci-lokal.md|src-tauri/src/workers/lane_guard.rs"
  "KNOWN_ISSUES.md|src-tauri/src/workers/lane_guard.rs"
)

# Literale Doku-Verweise: `irgendwas.md` und `docs/...` bzw. `.pa/...`.
# Fuehrende ./ und ../ fallen weg (include_str!("../../docs/PLAN.md") ->
# docs/PLAN.md). Ausgabe: ein Token je Zeile.
doc_refs() {
  local files=()
  while IFS= read -r f; do [ -n "$f" ] && files+=("$f"); done < <(doc_ref_sources | sort -u)
  [ "${#files[@]}" -gt 0 ] || return 0
  # grep filtert grob vor (schnell), awk verwirft Kommentarzeilen (#, //, *,
  # /*), zieht jedes Token einer Zeile heraus und haengt die Quelldatei an.
  grep -HE '\.md|(\.pa|docs)/' "${files[@]}" 2>/dev/null |
    awk -v exempt="$(IFS=';'; printf '%s' "${NOT_A_READ[*]}")" '
      BEGIN { n = split(exempt, e, ";"); for (i = 1; i <= n; i++) if (e[i] != "") skip[e[i]] = 1 }
      {
        # Dateiname bis zum ERSTEN Doppelpunkt (grep -H trennt so); ein ":"
        # im Dateinamen darf den Rest nicht verschieben (Review CI-02,
        # glm-5.2 F3).
        match($0, /^[^:]*:/); file = substr($0, 1, RLENGTH - 1); line = substr($0, RLENGTH + 1)
        if (line ~ /^[[:space:]]*(#|\/\/|\*|\/\*)/) next
        while (match(line, /[A-Za-z0-9_.-]*[A-Za-z0-9_-][A-Za-z0-9_.\/-]*\.md|(\.pa|docs)\/[A-Za-z0-9_.\/-]+/)) {
          tok = substr(line, RSTART, RLENGTH); line = substr(line, RSTART + RLENGTH)
          while (tok ~ /^\.\.?\//) sub(/^\.\.?\//, "", tok)
          if (!((tok "|" file) in skip)) print tok
        }
      }' | sort -u
}

# a/b/../c -> a/c, ohne das Dateisystem zu fragen (die Datei muss nicht
# existieren; realpath -m gibt es auf macOS nicht).
normalize() {
  local IFS=/ part out=()
  for part in $1; do
    case "$part" in
      "" | .) ;;
      ..)
        if [ "${#out[@]}" -gt 0 ] && [ "${out[${#out[@]}-1]}" != ".." ]; then
          # Der Index wird arithmetisch ausgewertet - setzt Bash >= 4 voraus
          # (Runner und Git-Bash haben >= 5; Review CI-02, glm-5.2 F4).
          unset 'out[${#out[@]}-1]'
        else
          out+=("..")
        fi
        ;;
      *) out+=("$part") ;;
    esac
  done
  printf '%s' "${out[*]}"
}

matches_any() { # pfad muster...
  local f="$1" p
  shift
  for p in "$@"; do
    # shellcheck disable=SC2254
    case "$f" in $p) return 0 ;; esac
  done
  return 1
}

DYNAMIC=()
REFS=()
load_dynamic() {
  DYNAMIC=()
  while IFS= read -r d; do [ -n "$d" ] && DYNAMIC+=("$d"); done < <(dynamic_inputs | sort -u)
}
load_refs() {
  REFS=()
  while IFS= read -r r; do [ -n "$r" ] && REFS+=("$r"); done < <(doc_refs)
}

is_windows_input() { # pfad
  matches_any "$1" "${WINDOWS_INPUTS[@]}" "${DYNAMIC[@]+"${DYNAMIC[@]}"}"
}

# Schreibt den Grund nach $WHY, wenn die Datei NICHT leicht ist.
WHY=""
is_light_doc() { # pfad
  local f="$1" r stem
  WHY=""
  case "$f" in
    *.md) ;;
    *) WHY="keine .md-Datei"; return 1 ;;
  esac
  case "$f" in
    docs/* | .pa/*) ;;
    */*) WHY="liegt nicht auf Wurzelebene, unter docs/ oder .pa/"; return 1 ;;
  esac
  if matches_any "$f" "${HEAVY_DOCS[@]}"; then
    WHY="steht in HEAVY_DOCS (von einem Gate per Listing gelesen)"
    return 1
  fi
  if matches_any "$f" "${DYNAMIC[@]+"${DYNAMIC[@]}"}"; then
    WHY="per include_str!/include_bytes! eingebunden"
    return 1
  fi
  for r in "${REFS[@]+"${REFS[@]}"}"; do
    case "$r" in
      *.md)
        # Genau dieser Pfad oder dieser Pfad als Endstueck (STAND.md,
        # report_f0.md, dev-hq/BUGS.md).
        if [ "$f" = "$r" ] || [ "${f%/"$r"}" != "$f" ]; then
          WHY="im Code der Gates als Literal '$r' referenziert"
          return 1
        fi
        ;;
      *)
        # Verzeichnis oder Praefix (docs/dev-hq, .pa/task_).
        stem="${r%/}"
        if [ "${f#"$stem"}" != "$f" ]; then
          WHY="im Code der Gates als Praefix '$r' referenziert"
          return 1
        fi
        ;;
    esac
  done
  return 0
}

is_cache_input() { # pfad lane
  if matches_any "$1" "${RUST_CACHE_INPUTS[@]}"; then return 0; fi
  if [ "$2" = linux ] && matches_any "$1" "${LINUX_CACHE_EXTRA[@]}"; then return 0; fi
  return 1
}

case "${1:-}" in
  --list-dynamic)
    dynamic_inputs | sort -u
    exit 0
    ;;
  --list-inputs)
    load_dynamic
    printf '%s\n' "${WINDOWS_INPUTS[@]}" "${DYNAMIC[@]+"${DYNAMIC[@]}"}"
    exit 0
    ;;
  --classify)
    shift
    load_dynamic
    load_refs
    for f in "$@"; do
      if is_light_doc "$f"; then echo "light $f"; else echo "heavy $f - $WHY"; fi
    done
    exit 0
    ;;
  linux | windows)
    LANE="$1"
    ;;
  *)
    echo "::error::lane-plan.sh: Bahn fehlt oder unbekannt: '${1:-}' (linux|windows)" >&2
    exit 2
    ;;
esac

EVENT_NAME="${EVENT_NAME:-}"
HEAD_REF="${HEAD_REF:-}"
[ -n "$EVENT_NAME" ] || { echo "::error::lane-plan.sh: EVENT_NAME fehlt" >&2; exit 2; }

# Nicht-ASCII-Namen unquotet ausgeben: sonst kommt "src-tauri/src/\303\244.rs"
# (mit fuehrendem Anfuehrungszeichen) zurueck und kein case-Muster passt mehr -
# eine Rust-Datei mit Umlaut rutschte leicht durch (Review CI-02, kimi-k3 F1).
changed_files() { # basis kopf -> $CHANGED, Exit != 0 bei Fehler
  CHANGED="$(git -c core.quotepath=false diff --name-only "$1" "$2" 2>&1)"
}

# Verfasser des Queue-Merges auf main (merge_method merge, .mergify.yml):
# Autor mergify[bot] mit der noreply-Adresse der App, Committer GitHub.
MERGIFY_AUTHOR="mergify[bot] <37929162+mergify[bot]@users.noreply.github.com>"

case "$EVENT_NAME" in
  schedule | workflow_dispatch)
    decide true "Ereignis '$EVENT_NAME' - woechentlicher/manueller Volllauf auf main"
    ;;
  push)
    GIT_REF="${GIT_REF:-refs/heads/main}"
    [ "$GIT_REF" = "refs/heads/main" ] ||
      decide true "Push auf '$GIT_REF', nicht main - volle Bahn als Sicherheitsnetz"
    before="${PUSH_BEFORE:-}"
    case "$before" in
      "" | 0000000000000000000000000000000000000000)
        decide true "Vorgaenger-Commit des Pushes unbekannt - volle Bahn"
        ;;
    esac
    if ! git cat-file -e "${before}^{commit}" 2> /dev/null && [ "${PLAN_FETCH:-}" = 1 ]; then
      say "hole Vorgaenger-Commit $before"
      git fetch --no-tags --quiet --depth=1 origin "$before" 2>&1 | sed 's/^/lane-plan: fetch: /'
    fi
    git cat-file -e "${before}^{commit}" 2> /dev/null ||
      decide true "Vorgaenger-Commit $before nicht verfuegbar - volle Bahn"
    # Herkunft des Push-Kopfes (Review CI-02, kimi-k3 F3): der leichte Lauf
    # beruht darauf, dass genau dieser Stand Minuten vorher im Queue-Lauf
    # voll geprueft wurde. Belegt ist das nur, wenn HEAD genau EIN
    # Merge-Commit von mergify[bot] (Committer GitHub) ist, der unmittelbar
    # auf dem Vorgaenger sitzt - also der Merge, den die Queue nach ihrem
    # gruenen Lauf geschrieben hat. Ein direkter Commit, ein Merge von
    # anderer Hand (Admin-Umgehung) oder mehr als ein Merge in diesem Push
    # hat diesen Beleg nicht -> volle Bahn.
    head="${PLAN_HEAD:-HEAD}"
    git rev-parse --verify --quiet "${head}^2" > /dev/null ||
      decide true "$head ist kein Merge-Commit (direkter Push auf main?) - Herkunft nicht queue-geprueft, volle Bahn"
    [ "$(git log -1 --format='%an <%ae>' "$head")" = "$MERGIFY_AUTHOR" ] ||
      decide true "Merge auf main stammt nicht von mergify[bot] - Herkunft nicht queue-geprueft, volle Bahn"
    [ "$(git log -1 --format='%ce' "$head")" = "noreply@github.com" ] ||
      decide true "Merge auf main hat einen fremden Committer - Herkunft nicht queue-geprueft, volle Bahn"
    [ "$(git rev-parse "${head}^1")" = "$before" ] ||
      decide true "Push enthaelt mehr als den Queue-Merge (z. B. zwei Merges) - volle Bahn"
    if ! changed_files "$before" "${PLAN_HEAD:-HEAD}"; then
      say "git diff scheiterte: $CHANGED"
      decide true "Aenderungsliste des Pushes nicht bestimmbar - volle Bahn"
    fi
    [ -n "$CHANGED" ] || decide true "leere Aenderungsliste des Pushes - verdaechtig, also volle Bahn"
    count=0
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      count=$((count + 1))
      if is_cache_input "$f" "$LANE"; then
        decide true "$f ist eine Cache-Eingabe - Volllauf auf main schreibt den Cache fuer die PRs neu"
      fi
    done <<< "$CHANGED"
    decide false "Push auf main mit $count geaenderten Datei(en), keine Cache-Eingabe - der Code wurde im Merge-Queue-Lauf voll geprueft"
    ;;
  pull_request) ;;
  *)
    decide true "Ereignis '$EVENT_NAME' ist unbekannt - volle Bahn als Sicherheitsnetz"
    ;;
esac

case "$HEAD_REF" in
  mergify/merge-queue/*)
    decide true "Merge-Queue-Lauf ($HEAD_REF) - volle Bahn vor dem Merge auf main"
    ;;
esac

# CI-03 (user decision 25.09.2026, docs/decisions.md): an ordinary pull
# request never runs the Windows lane. It runs in the merge queue (above),
# on the weekly run and on workflow_dispatch. The input detection below is
# kept for the log only: it tells the author that this PR touches a Windows
# input and that the queue run gives the first Windows verdict. Nothing here
# can switch the lane on - so neither an unclear change set nor a failing
# diff needs a safety net; both only shorten the log.
# The event is checked here again although every other event has decided
# above: a later restructuring must not let this block switch off the
# weekly or manual full run (review PR #149, glm-5.2 F1).
if [ "$LANE" = windows ] && [ "$EVENT_NAME" = pull_request ]; then
  wbase="${PLAN_BASE:-}"
  if [ -z "$wbase" ] && git rev-parse --verify --quiet "${PLAN_HEAD:-HEAD}^2" > /dev/null; then
    wbase="$(git rev-parse --verify --quiet "${PLAN_HEAD:-HEAD}^1")"
  fi
  if [ -n "$wbase" ] && changed_files "$wbase" "${PLAN_HEAD:-HEAD}" && [ -n "$CHANGED" ]; then
    load_dynamic
    count=0
    inputs=0
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      count=$((count + 1))
      if is_windows_input "$f"; then
        inputs=$((inputs + 1))
        say "Windows input changed: $f"
      fi
    done <<< "$CHANGED"
    say "$count changed file(s), $inputs of them Windows input(s)"
  else
    say "change set not determinable - irrelevant here, the lane is off on every ordinary PR"
  fi
  decide false "ordinary pull request - the Windows lane runs in the merge queue, weekly and on workflow_dispatch, not per PR (CI-03)"
fi

PLAN_HEAD="${PLAN_HEAD:-HEAD}"
if [ -z "${PLAN_BASE:-}" ]; then
  if ! PLAN_BASE="$(git rev-parse --verify --quiet "${PLAN_HEAD}^1")"; then
    decide true "Vergleichsbasis ${PLAN_HEAD}^1 nicht verfuegbar (Checkout zu flach?) - volle Bahn"
  fi
  # Nur ein Merge-Commit (refs/pull/N/merge) hat einen zweiten Elternteil.
  # Ohne ihn ist ^1 der Vorgaenger-Commit und der Diff nur der letzte
  # Commit des PRs - zu wenig, also volle Bahn.
  if ! git rev-parse --verify --quiet "${PLAN_HEAD}^2" > /dev/null; then
    decide true "$PLAN_HEAD ist kein PR-Merge-Commit - Aenderungsmenge unklar, volle Bahn"
  fi
fi

if ! changed_files "$PLAN_BASE" "$PLAN_HEAD"; then
  say "git diff scheiterte: $CHANGED"
  decide true "Aenderungsliste nicht bestimmbar - volle Bahn"
fi

if [ -z "$CHANGED" ]; then
  decide true "leere Aenderungsliste - das ist verdaechtig, also volle Bahn"
fi

load_dynamic
if [ "${#DYNAMIC[@]}" -gt 0 ]; then
  say "per include_str!/include_bytes! eingebunden (ausserhalb src-tauri/): ${DYNAMIC[*]}"
fi

count=0
# Bahn linux: nur reine, von keinem Gate gelesene Doku ist leicht.
load_refs
while IFS= read -r f; do
  [ -n "$f" ] || continue
  count=$((count + 1))
  if ! is_light_doc "$f"; then
    decide true "$f: $WHY"
  fi
done <<< "$CHANGED"
say "$count geaenderte Datei(en), alle sind Doku, die kein Gate liest:"
while IFS= read -r f; do [ -n "$f" ] && say "  $f"; done <<< "$CHANGED"
decide false "nur Doku ohne Leser unter den Gates ($count Datei(en)) - Rust, Frontend und Selbsttests nicht noetig"
