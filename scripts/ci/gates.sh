#!/usr/bin/env bash
# gates.sh — die EINZIGE Quelle der Gate-Liste.
#
# Warum es dieses Skript gibt: die Liste stand bis zum 09.09. fuenffach da —
# in .githooks/pre-commit, .githooks/pre-push, ci.yml, release.yml und als
# Prosa in AGENTS.md — und sie driftete nachweislich. pre-push fuhr
# `cargo test`, CI `cargo nextest run --profile ci` (geteilter Prozess statt
# Prozess pro Test, kein slow-timeout); release.yml fuhr weder `lint` noch
# `test:e2e` noch `no-masked-output` und war damit schwaecher gegatet als ein
# PR; `npm run test:hq` (12 node:test-Dateien unter scripts/lib/) lief
# ueberhaupt nirgends.
#
# Was lokal vor dem Push gruen war, war also nicht das, was CI misst. Deshalb
# ruft ci.yml jetzt eine ganze BAHN auf statt einzelner Schritte:
#
#     - name: Gates (linux)
#       run: bash scripts/ci/gates.sh lane linux
#
# Es gibt damit keine Gate-Liste mehr im YAML, die abweichen KOENNTE. Drift ist
# nicht geprueft, sondern unmoeglich — das ist der Unterschied zu einem
# Drift-Waechter, der selbst falsch sein kann.
#
# Aufrufe:
#   gates.sh lane <bahn>          alle Gates der Bahn, billig -> teuer
#   gates.sh run <id> [<id>...]   einzelne Gates
#   gates.sh --list [bahn]        nur auflisten, nichts ausfuehren
#   gates.sh --from <id> lane <b> ab diesem Gate weiter (nach einem Fehlschlag)
#
# Selbsttest: scripts/test-gates.sh
set -uo pipefail

# Git exportiert GIT_DIR & Co. in Hook-Unterprozesse. `cargo test` startet
# darunter ein `git -C <temp> init`, das sonst die Konfiguration DIESES Repos
# sperrt statt der des Wegwerf-Repos. Das Unset stand bisher nur in
# .githooks/pre-push — hier ist es richtig, denn jetzt laufen die Tests von
# hier aus (AGENTS.md, Regel 5: nach einem Fix nach Geschwistern suchen).
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

# --------------------------------------------------------------------------
# Die Liste. Format: id | bahnen (komma) | arbeitsverzeichnis | befehl
#
# Reihenfolge = Ausfuehrungsreihenfolge, billig -> teuer (docs/decisions.md):
# ein kaputtes Frontend soll nicht erst nach clippy und der ganzen Rust-Suite
# sichtbar werden, und eine gesparte Minute ist eine gesparte Minute.
#
# Der urspruengliche Kommentar begruendete das mit "seit das Actions-Kontingent
# aufgebraucht ist". Das war falsch (Korrektur auf main, 09.09.: das Kontingent
# war nie erschoepft, es hatte nur niemand `gh run list` aufgerufen). Die
# Reihenfolge bleibt trotzdem richtig - sie steht hier fuer die schnelle
# Rueckmeldung, nicht fuer eine Notlage.
#
# Sie liegt als Array IN diesem Skript, nicht als eigene Datei: `.gitattributes`
# erzwingt LF nur fuer `*.sh`, ein Manifest mit anderer Endung kaeme vom
# Windows-Editor mit CRLF zurueck und `read -r` haette ein \r am Zeilenende.
# --------------------------------------------------------------------------
GATES=(
  # --- Sekunden: die Workflow-Gates und ihre eigenen Selbsttests -----------
  "no-masked|linux,release|.|bash scripts/ci/no-masked-output.sh"
  "wf-shell|linux,release|.|bash scripts/ci/workflow-shell.sh"
  "wf-pinned|linux,release|.|bash scripts/ci/actions-pinned.sh"
  # CI-03: the structure the cheaper CI relies on - required check names in
  # sync with .mergify.yml, the Windows job guarded against running its lane
  # on Linux, red-first sharing the linux setup.
  "ci-shape|linux,release|.|bash scripts/ci/ci-shape.sh"
  # Die Selbsttests belegen, dass die drei Gates ueberhaupt scheitern KOENNEN
  # (AGENTS.md, Regel 2). ci.yml berief sich auf sie als Begruendung, warum
  # man dem Detektor trauen darf — ausgefuehrt wurden sie nie.
  "selftest-gates|linux,release|.|bash scripts/test-no-masked-output.sh && bash scripts/test-workflow-shell.sh && bash scripts/test-actions-pinned.sh && bash scripts/test-prepush-lane.sh && bash scripts/test-hook-root.sh && bash scripts/test-ci-shape.sh"
  # Selbsttest des Test-First-Gates: red-first.sh wertet lange Logs aus, und
  # genau dort war die Auswertung schon einmal falsch. Stand auf main als
  # eigener ci.yml-Schritt und waere beim Umbau auf Bahnen verloren gegangen.
  # CI-02 (W1-19b): Dependabot-Manifest-Commits brauchen keinen Trailer -
  # und nur die. Der Selbsttest belegt die Ausnahme UND ihre Grenzen.
  "selftest-red-first|linux,release|.|bash scripts/test-red-first-output.sh && bash scripts/test-red-first-dependabot.sh && bash scripts/test-red-first-verdict.sh && bash scripts/test-red-first-landed.sh"
  # Der Review-Transport ist der Weg, auf dem die Dual-Review-Pflicht
  # (AGENTS.md) ueberhaupt eingeloest wird. Am 09.09. starb er an einer
  # Antwort ohne Inhalt und schrieb fuer KEINEN Reviewer ein Protokoll.
  # Laeuft gegen einen lokalen Server: kein Netz, kein Secret, keine
  # Modellminute.
  "selftest-review|linux,release|.|bash scripts/test-review-transport.sh"
  # CI-01/CI-02: der Plan-Schritt der Jobs linux und windows entscheidet, ob
  # die Bahn laufen muss (scripts/ci/lane-plan.sh). Ein falsches "false" waere
  # ein Gate, das gruen durch Abwesenheit ist - deshalb belegt der Selbsttest
  # beide Richtungen (Rust-Aenderung -> voll, gelesene Doku -> voll, freie
  # Doku -> aus, Queue/Wochenlauf -> voll, main-Push nur bei Cache-Eingaben).
  "selftest-lane-plan|linux,release|.|bash scripts/test-lane-plan.sh"

  # --- schnell: Form und Typen --------------------------------------------
  "fmt|precommit,prepush,branchpush,linux,windows,release|src-tauri|cargo fmt --check"
  "cargo-check|precommit|src-tauri|cargo check"
  "typecheck|precommit,prepush,branchpush,linux,release|.|npm run typecheck"
  "lint|prepush,branchpush,linux,release|.|npm run lint"

  # --- mittel: die Test-Suiten des Frontends ------------------------------
  "fe-test|prepush,branchpush,linux,release|.|npm test"
  # 12 node:test-Dateien unter scripts/lib/. Standen seit jeher in
  # package.json und liefen in keinem Workflow und keinem Hook.
  "hq-test|prepush,branchpush,linux,release|.|npm run test:hq"
  # Browser-Smoke des HQ. Kam am 12.09. auf main dazu.
  "hq-visual|linux,release|.|npm run test:hq:visual"
  "fe-build|linux,release|.|npm run build"
  "e2e|linux,release|.|npm run test:e2e"

  # --- teuer: der Rust-Kern -----------------------------------------------
  "clippy|prepush,linux,windows,release|src-tauri|cargo clippy --all-targets -- -D warnings"
  # nextest statt cargo test: eigener Prozess je Test (kein geteilter Zustand),
  # keine Retries im Profil `ci`, harter slow-timeout. pre-push fuhr bis zum
  # 09.09. `cargo test` und mass damit etwas anderes als CI.
  "rust-suite|prepush,linux,windows,release|src-tauri|cargo nextest run --profile ci"
  # W3-06: die sieben #[ignore]-Tests, die ein gebautes pa-capture-host
  # brauchen (ConPTY, echter Kindprozess) - rust-suite laesst #[ignore]
  # aussen vor, und ohne dieses Gate liefen sie nirgends in einer Bahn.
  # Nur windows: das Binary heisst .exe, und ConPTY gibt es nur dort. Stand
  # bis W3-06 als eigener pwsh-Schritt in ci.yml, ausserhalb dieser Liste -
  # dieselbe Drift-Klasse, die dieses Skript beseitigen soll.
  "native-tests|windows|.|bash scripts/ci/native-tests.sh"

  # --- eigene Bahn: das woechentliche Audit -------------------------------
  "audit-rust|audit|src-tauri|cargo audit"
  "audit-npm|audit|.|npm audit --audit-level=moderate"
)

LANES="precommit prepush branchpush linux windows release audit"

gate_field() { # zeile feldnummer
  printf '%s' "$1" | cut -d'|' -f"$2"
}

# Das Befehlsfeld ist das LETZTE und bekommt deshalb `-f4-`, nicht `-f4`.
# Befund des externen Dual-Reviews vom 21.09. (deepseek-v4-pro R-3 und
# kimi-k2.7-code R-1, konvergent): mit `-f4` schneidet cut einen Gate-Befehl
# am ersten `|` ab, und `eval` fuehrt still nur den Teil davor aus. Kein Gate
# hatte bisher eine Pipe — ein schlafender Fehler also, und zwar genau die
# Klasse, gegen die dieses Skript antritt: eine Liste, deren Trennzeichen ein
# Shell-Metazeichen ist. Festgenagelt in scripts/test-gates.sh.
gate_cmd() { # zeile
  printf '%s' "$1" | cut -d'|' -f4-
}

lane_exists() {
  case " $LANES " in *" $1 "*) return 0 ;; esac
  return 1
}

gate_ids_for_lane() { # bahn
  local g id lanes
  for g in "${GATES[@]}"; do
    id="$(gate_field "$g" 1)"
    lanes="$(gate_field "$g" 2)"
    case ",$lanes," in *",$1,"*) echo "$id" ;; esac
  done
}

gate_line_by_id() { # id
  local g
  for g in "${GATES[@]}"; do
    [ "$(gate_field "$g" 1)" = "$1" ] && { printf '%s' "$g"; return 0; }
  done
  return 1
}

# --------------------------------------------------------------------------
# Umgebung: was diese Maschine ist. Ohne diesen Kopf ist "Gates gruen" eine
# Behauptung ueber eine unbekannte Umgebung (AGENTS.md, Beweismassstab).
# --------------------------------------------------------------------------
os_kind() {
  case "$(uname -s 2>/dev/null || echo unbekannt)" in
    Linux) echo linux ;;
    Darwin) echo macos ;;
    MINGW* | MSYS* | CYGWIN*) echo windows ;;
    *) echo unbekannt ;;
  esac
}

version_of() { # befehl args...
  local out
  if ! command -v "$1" > /dev/null 2>&1; then
    echo "FEHLT"
    return
  fi
  # `cargo nextest --version` scheitert, wenn das Unterkommando fehlt - der
  # haeufigste Fall auf einer frischen Maschine. "FEHLER" waere dafuer die
  # falsche Auskunft.
  out="$("$@" 2>&1)" || { echo "nicht verfuegbar"; return; }
  printf '%s' "$out" | head -1
}

print_header() { # bahn
  local dirty
  dirty="$(git status --porcelain 2>/dev/null | head -1)"
  echo "=============================================================="
  echo " gates.sh — Bahn: $1"
  echo "=============================================================="
  printf ' %-14s %s\n' "Plattform" "$(uname -s -r 2>/dev/null || echo unbekannt) ($(os_kind))"
  printf ' %-14s %s\n' "node" "$(version_of node --version)"
  printf ' %-14s %s\n' "npm" "$(version_of npm --version)"
  printf ' %-14s %s\n' "rustc" "$(version_of rustc --version)"
  printf ' %-14s %s\n' "nextest" "$(version_of cargo nextest --version)"
  printf ' %-14s %s\n' "HEAD" "$(git rev-parse --short HEAD 2>/dev/null || echo '-')$([ -n "$dirty" ] && echo ' (uncommitted Aenderungen im Baum)')"
  echo
}

# Was dieser Lauf NICHT belegt. Der Block ist der Kern der Ehrlichkeit dieses
# Werkzeugs: kein einzelner Rechner deckt beide Plattformhaelften ab, und
# "Vollgates gruen" ohne diese Einschraenkung ist eine Behauptung.
print_uncovered() { # bahn
  local os
  os="$(os_kind)"
  echo
  echo "--- NICHT ABGEDECKT von diesem Lauf ---"
  case "$os" in
    windows)
      echo "  Plattform Windows:"
      echo "    - die #[cfg(unix)]-Tests (Dateirechte, Prozessgruppen-Kill) —"
      echo "      sie kompilieren unter Windows nicht (KNOWN_ISSUES KI-7)"
      echo "    - die Linux-Arme von clippy"
      echo "  Dieser Lauf belegt die Windows-Haelfte, nicht die Linux-Haelfte."
      echo "  Linux-Haelfte: derselbe Befehl in WSL2 (Clone auf ext4), siehe docs/ci-lokal.md"
      ;;
    linux)
      echo "  Plattform Linux:"
      echo "    - die #[cfg(windows)]-Tests (run_in_pty, npm_shim, ConPTY, DPAPI)"
      echo "    - die Windows-Arme von clippy"
      echo "  Dieser Lauf belegt die Linux-Haelfte, nicht die Windows-Haelfte."
      echo "  Windows-Haelfte: derselbe Befehl in Git-Bash auf dem Zielrechner."
      ;;
    macos)
      # Befund des externen Dual-Reviews vom 21.09. (deepseek-v4-pro R-5):
      # macOS im *-Fall zu fuehren war fachlich falsch. Auf macOS gilt
      # `cfg(unix)`, die Unix-Arme kompilieren und laufen dort — es fehlt die
      # Zielplattform, nicht die Unix-Haelfte.
      echo "  Plattform macOS:"
      echo "    - die #[cfg(windows)]-Tests (run_in_pty, npm_shim, ConPTY, DPAPI)"
      echo "    - die Windows-Arme von clippy"
      echo "  Die #[cfg(unix)]-Tests laufen hier, denn macOS ist unix. Was hier"
      echo "  fehlt, ist die ZIELPLATTFORM: ProjectA wird unter Windows"
      echo "  ausgeliefert, und nur der Windows-Lauf belegt das Produkt."
      ;;
    *)
      echo "  Plattform '$os' ist weder die Zielplattform (Windows) noch der"
      echo "  Linux-Belegpfad. Dieser Lauf belegt fuer das Produkt wenig."
      ;;
  esac
  case "$1" in
    precommit | prepush)
      echo "  Bahn '$1' ist die schnelle Schleife: Browser-Smoke, Frontend-Build"
      echo "  und die Workflow-Gates laufen erst in der Bahn 'linux'."
      ;;
    branchpush)
      echo "  Bahn 'branchpush' (PA_PREPUSH=light) laesst clippy und die Rust-Suite"
      echo "  aus. Vor dem Oeffnen oder Bereitmelden eines PRs: die Bahn 'prepush'."
      ;;
  esac
  echo "  Der Zustand externer Dienste (Updater-Endpoint, OmniRoute, Mirror)"
  echo "  wird von keinem Gate geprueft — dafuer ist das Release-Verify da."
  echo "---------------------------------------"
}

# --------------------------------------------------------------------------
# Ausfuehrung
# --------------------------------------------------------------------------
in_actions() { [ "${GITHUB_ACTIONS:-}" = "true" ]; }

RESULT_IDS=()
RESULT_STATES=()
RESULT_SECONDS=()

run_gate() { # id
  local line workdir cmd start dur rc
  if ! line="$(gate_line_by_id "$1")"; then
    local known
    known="$(for g in "${GATES[@]}"; do gate_field "$g" 1; done | tr '\n' ' ')"
    echo "::error::Unbekanntes Gate: $1 (bekannt: $known)" >&2
    return 2
  fi
  workdir="$(gate_field "$line" 3)"
  cmd="$(gate_cmd "$line")"

  in_actions && echo "::group::Gate $1 — $cmd"
  echo ">>> Gate $1: (cd $workdir && $cmd)"
  start="$(date +%s)"
  # Kein `| tee`, keine Pipe: der Exit-Code muss unmaskiert ankommen. Das ist
  # dieselbe Regel, die scripts/ci/no-masked-output.sh fuer die Workflows
  # erzwingt — sie gilt fuer den Runner selbst genauso.
  (
    cd "$ROOT/$workdir" || exit 1
    eval "$cmd"
  )
  rc=$?
  dur=$(( $(date +%s) - start ))
  in_actions && echo "::endgroup::"

  RESULT_IDS+=("$1")
  RESULT_SECONDS+=("$dur")
  if [ "$rc" -eq 0 ]; then
    RESULT_STATES+=("gruen")
    echo "<<< Gate $1: gruen (${dur}s)"
  else
    RESULT_STATES+=("ROT($rc)")
    echo "<<< Gate $1: ROT — Exit $rc (${dur}s)"
    hint_for "$1"
  fi
  return $rc
}

# Ein rotes Gate soll sagen, was zu tun ist. Der haeufigste Fall auf einer
# frischen Maschine ist ein fehlendes Werkzeug, nicht ein echter Fehlschlag.
hint_for() {
  case "$1" in
    rust-suite)
      command -v cargo-nextest > /dev/null 2>&1 || cargo nextest --version > /dev/null 2>&1 || {
        echo "    Hinweis: cargo-nextest fehlt. Installation:"
        echo "      cargo install cargo-nextest --locked"
        echo "    Kein Rueckfall auf 'cargo test': das misst etwas anderes"
        echo "    (geteilter Prozess, kein slow-timeout) und waere genau die"
        echo "    Drift, die dieses Skript beseitigt."
      }
      ;;
    e2e)
      echo "    Hinweis: der Browser-Smoke braucht Chromium — einmalig pro Clone:"
      echo "      npx playwright install chromium        (Linux: --with-deps)"
      ;;
    audit-rust)
      command -v cargo-audit > /dev/null 2>&1 || echo "    Hinweis: cargo install cargo-audit"
      ;;
  esac
}

# Ein Gate darf den Arbeitsbaum nicht veraendern. Das klingt selbstverstaendlich
# und war es nicht: `npm run test:hq` startete ueber zwei Tests den hq-live-
# Server, der beim Start docs/dev-hq/data.json und data.js im ECHTEN Baum
# neu erzeugte. Solange das Gate nirgends lief, sah es niemand; ab dem
# Einhaengen war der Baum nach jedem `prepush` dreckig — und eine Warnung, die
# immer erscheint, wird nicht mehr gelesen.
#
# Verglichen werden Mengen VOR und NACH dem Lauf, nicht "Baum sauber":
# uncommittete eigene Arbeit ist normal und darf den Lauf nicht rot faerben.
# Statuszeile UND Inhalts-Hash je betroffenem Pfad.
#
# Befund des externen Dual-Reviews vom 21.09. (deepseek-v4-pro R-1, Schwere
# hoch) — und er hat recht: mit nur den Statuszeilen war der Waechter blind,
# sobald eine getrackte Datei schon vorher geaendert war. ` M docs/x.js`
# bleibt ` M docs/x.js`, egal wie oft ein Gate die Datei neu schreibt; `comm`
# meldet nichts. Blind war er damit ausgerechnet im haeufigsten lokalen Fall,
# naemlich dem, den er ausdruecklich erlauben soll: uncommittete eigene
# Arbeit. Der alte Selbsttest prueft nur die Gegenprobe (keine NEUE
# Aenderung), nicht diesen Fall — er konnte die Luecke also nicht finden.
#
# Ein Pfad, der gar nicht in `git status` auftaucht, ist unveraendert; seine
# Aenderung erzeugt eine neue Statuszeile und faellt weiterhin so auf.
tree_snapshot() {
  local eintrag xy pfad
  git status --porcelain -z 2>/dev/null | while IFS= read -r -d "" eintrag; do
    xy="${eintrag:0:2}"
    pfad="${eintrag:3}"
    if [ -f "$pfad" ]; then
      printf '%s %s %s\n' "$xy" "$(git hash-object -- "$pfad" 2>/dev/null || echo keinhash)" "$pfad"
    else
      printf '%s - %s\n' "$xy" "$pfad"
    fi
  done | sort
}

check_tree_untouched() { # schnappschuss_vorher
  local nachher neu
  nachher="$(tree_snapshot)"
  # Beide Richtungen: auch eine verschwundene Statuszeile (dirty -> clean)
  # kann bedeuten, dass ein Gate vorhandene Benutzerarbeit verworfen hat.
  neu="$(comm -3 <(printf '%s\n' "$1") <(printf '%s\n' "$nachher"))"
  [ -n "$neu" ] || return 0
  echo
  echo "::error::Ein Gate hat den Arbeitsbaum veraendert. Gates duerfen lesen und in ignorierte Verzeichnisse schreiben, aber keine getrackten Dateien anfassen - sonst haengt das Ergebnis davon ab, wie oft man sie laufen laesst."
  printf '%s\n' "$neu" | sed 's/^/    /'
  return 1
}

print_summary() { # bahn geplante_anzahl
  local i state total=0
  echo
  echo "--- Zusammenfassung (Bahn $1) ---"
  for i in "${!RESULT_IDS[@]}"; do
    printf ' %-16s %-10s %4ss\n' "${RESULT_IDS[$i]}" "${RESULT_STATES[$i]}" "${RESULT_SECONDS[$i]}"
    total=$(( total + RESULT_SECONDS[i] ))
  done
  printf ' %-16s %-10s %4ss\n' "(gesamt)" "" "$total"
  if [ "${#RESULT_IDS[@]}" -lt "$2" ]; then
    echo " $(( $2 - ${#RESULT_IDS[@]} )) Gate(s) nach dem Fehlschlag NICHT mehr gelaufen."
  fi

  # Dieselbe Tabelle im Actions-UI. Erst in eine Datei, dann anhaengen — eine
  # Pipe nach $GITHUB_STEP_SUMMARY verschluckte den Exit-Code links davon.
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### Gates — Bahn \`$1\`"
      echo
      echo "| Gate | Ergebnis | Dauer |"
      echo "|---|---|---|"
      for i in "${!RESULT_IDS[@]}"; do
        state="${RESULT_STATES[$i]}"
        [ "$state" = "gruen" ] && state="✅ gruen" || state="❌ $state"
        echo "| \`${RESULT_IDS[$i]}\` | $state | ${RESULT_SECONDS[$i]}s |"
      done
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

usage() {
  cat <<'USAGE'
gates.sh — die eine Gate-Quelle fuer CI, Release, Hooks und den lokalen Lauf.

  gates.sh lane <bahn>          alle Gates der Bahn, billig -> teuer
  gates.sh run <id> [<id>...]   einzelne Gates
  gates.sh --list [bahn]        auflisten, nichts ausfuehren
  gates.sh --from <id> lane <b> ab diesem Gate weiter

Bahnen: precommit prepush branchpush linux windows release audit
USAGE
}

# --------------------------------------------------------------------------
FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from)
      FROM="${2:-}"
      [ -n "$FROM" ] || { echo "--from braucht ein Gate" >&2; exit 2; }
      shift 2
      ;;
    --list)
      shift
      if [ $# -gt 0 ]; then
        lane_exists "$1" || { echo "Unbekannte Bahn: $1 (bekannt: $LANES)" >&2; exit 2; }
        gate_ids_for_lane "$1"
      else
        for g in "${GATES[@]}"; do
          printf '%-16s %-42s (cd %s && %s)\n' "$(gate_field "$g" 1)" "$(gate_field "$g" 2)" "$(gate_field "$g" 3)" "$(gate_cmd "$g")"
        done
      fi
      exit 0
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    lane)
      lane="${2:-}"
      lane_exists "$lane" || { echo "Unbekannte Bahn: '${lane:-}' (bekannt: $LANES)" >&2; exit 2; }
      ids=()
      while IFS= read -r id; do [ -n "$id" ] && ids+=("$id"); done < <(gate_ids_for_lane "$lane")
      # Eine leere Bahn waere ein gruener Lauf ohne ein einziges Gate — genau
      # das Muster "gruen durch Abwesenheit" (AGENTS.md, Regel 2).
      [ "${#ids[@]}" -gt 0 ] || { echo "::error::Bahn '$lane' enthaelt kein Gate."; exit 2; }
      if [ -n "$FROM" ]; then
        gate_line_by_id "$FROM" > /dev/null || { echo "--from: unbekanntes Gate '$FROM'" >&2; exit 2; }
        rest=()
        seen=0
        for id in "${ids[@]}"; do
          [ "$id" = "$FROM" ] && seen=1
          [ "$seen" -eq 1 ] && rest+=("$id")
        done
        [ "${#rest[@]}" -gt 0 ] || { echo "--from: '$FROM' liegt nicht in der Bahn '$lane'" >&2; exit 2; }
        ids=("${rest[@]}")
      fi
      print_header "$lane"
      tree_before="$(tree_snapshot)"
      status=0
      for id in "${ids[@]}"; do
        if ! run_gate "$id"; then status=1; break; fi
      done
      print_summary "$lane" "${#ids[@]}"
      check_tree_untouched "$tree_before" || status=1
      print_uncovered "$lane"
      exit "$status"
      ;;
    run)
      shift
      [ $# -gt 0 ] || { echo "run braucht mindestens ein Gate" >&2; exit 2; }
      # Unbekannte Gates sind ein Aufruffehler und werden VOR dem ersten Lauf
      # abgelehnt — sonst faende man den Tippfehler erst nach 20 Minuten
      # Rust-Suite, und der Exit-Code saehe aus wie ein fachlicher Fehlschlag.
      for id in "$@"; do
        gate_line_by_id "$id" > /dev/null || {
          known="$(for g in "${GATES[@]}"; do gate_field "$g" 1; done | tr '\n' ' ')"
          echo "Unbekanntes Gate: $id (bekannt: $known)" >&2
          exit 2
        }
      done
      print_header "run"
      # Derselbe Waechter wie in der Bahn. Befund des externen Dual-Reviews
      # vom 21.09. (deepseek-v4-pro R-4): er stand nur im lane-Zweig, obwohl
      # `run` die dokumentierte Einzel-Gate-API ist — wer ein Gate einzeln
      # faehrt, bekam Seiteneffekte auf getrackte Dateien nicht gemeldet.
      tree_before="$(tree_snapshot)"
      status=0
      count=$#
      for id in "$@"; do
        if ! run_gate "$id"; then status=1; break; fi
      done
      print_summary "run" "$count"
      check_tree_untouched "$tree_before" || status=1
      print_uncovered "run"
      exit "$status"
      ;;
    *)
      echo "Unbekanntes Argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

usage >&2
exit 2
