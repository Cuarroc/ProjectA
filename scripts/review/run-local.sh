#!/usr/bin/env bash
# run-local.sh - lokaler Review-Lauf ohne GitHub Actions (SETUP-09).
#
#   bash scripts/review/run-local.sh [<pr-nummer>] [--via ollama|kilo]
#        [--models a,b] [--base origin/main] [--label <name>]
#        [--author <instanz>] [--out-dir <dir>] [--dry-run]
#
# Ohne Nummer wird der aktuelle Branch gegen origin/main geprueft, mit Nummer
# der PR (origin pull/<n>/head). Das Skript baut den Review-Prompt aus dem
# Diff, schreibt ihn nach <out-dir>/review_prompt_<label>.md und schickt ihn
# an einen oder zwei KOSTENLOSE Reviewer:
#
#   --via ollama  (Standard)  Ollama, Modelle aus REVIEWER_MODELS in
#                 scripts/dev/agent-setup-check.mjs (Ueberschreiben:
#                 REVIEW_OLLAMA_MODELS oder --models). Der Versand laeuft
#                 ueber .pa/review_transport.py - der gehaertete Transport.
#   --via kilo    kilo run --agent ask -m kilo/<modell>:free. Nur :free-Modelle;
#                 alles andere wird abgelehnt, damit kein Geld fliesst.
#                 REVIEW_KILO_TIMEOUT_S: Zeitlimit je Modell (900 s, 0 = keins).
#
# Ergebnis: <out-dir>/review_<label>_<modell>.md, <label> = pr<N> oder der
# Branchname (/ -> -). out-dir ist standardmaessig .pa/ des Repos.
# Exit 0 nur, wenn JEDER Reviewer einen Text geliefert hat. Exit 1: mindestens
# ein Reviewer leer oder fehlerhaft (das Protokoll steht auf "failed"). Exit 2:
# Aufruf- oder Voraussetzungsfehler (nichts wurde bewertet).
#
# Keys stehen nie im Code: OLLAMA_API_KEY (nur fuer https://ollama.com) kommt
# aus der Umgebung und geht nur als Bearer-Kopf zum Server.
# Selbsttest ohne Netz: scripts/test-review-local.sh
set -uo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
TRANSPORT="$ROOT/.pa/review_transport.py"

die() { # exit-code meldung...
  local code="$1"
  shift
  echo "run-local: $*" >&2
  exit "$code"
}

usage() {
  sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

pr=""
via="ollama"
models_arg=""
base="origin/main"
label=""
author=""
out_dir=""
dry_run=0

while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage; exit 0 ;;
    --pr) pr="${2:-}"; shift 2 || die 2 "--pr braucht eine Nummer." ;;
    --via) via="${2:-}"; shift 2 || die 2 "--via braucht ollama oder kilo." ;;
    --models) models_arg="${2:-}"; shift 2 || die 2 "--models braucht eine Liste." ;;
    --base) base="${2:-}"; shift 2 || die 2 "--base braucht eine Referenz." ;;
    --label) label="${2:-}"; shift 2 || die 2 "--label braucht einen Namen." ;;
    --author) author="${2:-}"; shift 2 || die 2 "--author braucht einen Namen." ;;
    --out-dir) out_dir="${2:-}"; shift 2 || die 2 "--out-dir braucht ein Verzeichnis." ;;
    --dry-run) dry_run=1; shift ;;
    -*) die 2 "unbekannte Option $1 (siehe --help)." ;;
    *)
      [ -z "$pr" ] || die 2 "zu viele Argumente: $1"
      pr="$1"
      shift
      ;;
  esac
done

case "$via" in
  ollama | kilo) ;;
  *) die 2 "unbekannter Weg --via $via (ollama | kilo)." ;;
esac
if [ -n "$pr" ]; then
  case "$pr" in
    '' | *[!0-9]*) die 2 "PR-Nummer erwartet, bekommen: $pr" ;;
  esac
fi

# --- Werkzeuge -------------------------------------------------------------
# Python suchen, nicht annehmen (Windows: der Store-Stub startet nur den Store).
PY=""
for kandidat in python3 python py; do
  command -v "$kandidat" > /dev/null 2>&1 || continue
  if "$kandidat" -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" > /dev/null 2>&1; then
    PY="$kandidat"
    break
  fi
done
[ -n "$PY" ] || die 2 "kein lauffaehiges Python 3 gefunden (python3 / python / py geprueft). Installieren und PATH pruefen."
command -v git > /dev/null 2>&1 || die 2 "git nicht gefunden."
TOP="$(git rev-parse --show-toplevel 2> /dev/null)" || die 2 "kein git-Repository im aktuellen Verzeichnis."
# Standard-Ausgabe: .pa/ relativ zum Repo. Die Protokolle und Konsolenzeilen
# tragen den Pfad, und ein absoluter Arbeitsbaum-Pfad hat in einem
# eingecheckten Protokoll nichts verloren (Nutzername). Ein selbst gewaehlter
# --out-dir gilt relativ zum aktuellen Verzeichnis, der Standard relativ zum Repo.
if [ -n "$out_dir" ]; then
  case "$out_dir" in
    /* | ?:*) ;;
    *) out_dir="$PWD/$out_dir" ;;
  esac
fi
cd "$TOP" || die 2 "kann nicht nach $TOP wechseln."
[ -n "$out_dir" ] || out_dir=".pa"

# --- Modelle ---------------------------------------------------------------
# Die Standardpaare stehen an genau einer Stelle: REVIEWER_MODELS in
# agent-setup-check.mjs (dieselbe Liste prueft `npm run dev:agent-check`).
default_ollama_models() {
  grep -o 'REVIEWER_MODELS = \[[^]]*\]' "$ROOT/scripts/dev/agent-setup-check.mjs" 2> /dev/null \
    | grep -o '"[^"]*"' | tr -d '"' | paste -sd, -
}

if [ -z "$models_arg" ]; then
  if [ "$via" = ollama ]; then
    models_arg="${REVIEW_OLLAMA_MODELS:-$(default_ollama_models)}"
    [ -n "$models_arg" ] || die 2 "keine Standardmodelle gefunden (REVIEWER_MODELS in scripts/dev/agent-setup-check.mjs). --models oder REVIEW_OLLAMA_MODELS setzen."
  else
    models_arg="${REVIEW_KILO_MODELS:-stepfun/step-3.7-flash:free,nvidia/nemotron-3-super-120b-a12b:free}"
  fi
fi

IFS=',' read -r -a raw_models <<< "$models_arg"
models=()
for m in "${raw_models[@]}"; do
  m="${m#"${m%%[![:space:]]*}"}"
  m="${m%"${m##*[![:space:]]}"}"
  [ -z "$m" ] || models+=("$m")
done
[ "${#models[@]}" -ge 1 ] || die 2 "keine Modelle angegeben."
[ "${#models[@]}" -le 2 ] || die 2 "hoechstens zwei Reviewer je Lauf (bekommen: ${#models[@]})."
[ "${#models[@]}" -lt 2 ] || [ "${models[0]}" != "${models[1]}" ]   || die 2 "Modell ${models[0]} doppelt angegeben - ein Dual-Review braucht zwei verschiedene Reviewer."

if [ "$via" = kilo ]; then
  for i in "${!models[@]}"; do
    m="${models[$i]#kilo/}"
    case "$m" in
      *:free) ;;
      *) die 2 "kilo-Modell '$m' ist kein :free-Modell. Nur kostenlose Modelle sind erlaubt (kilo models kilo | grep ':free')." ;;
    esac
    models[i]="$m"
  done
fi

# --- Voraussetzungen des Weges (nur beim echten Versand) -------------------
ollama_host=""
if [ "$dry_run" -eq 0 ]; then
  if [ "$via" = kilo ]; then
    command -v kilo > /dev/null 2>&1 \
      || die 2 "kilo nicht gefunden. Kilo CLI installieren (npm i -g @kilocode/cli) und PATH pruefen."
  else
    ollama_host="${OLLAMA_HOST:-http://127.0.0.1:11434}"
    case "$ollama_host" in
      http://* | https://*) ;;
      *) ollama_host="http://$ollama_host" ;;
    esac
    ollama_host="${ollama_host%/}"
    host_only="${ollama_host#*://}"
    host_only="${host_only%%/*}"
    host_only="${host_only%%:*}"
    case "$host_only" in
      ollama.com | *.ollama.com)
        [ -n "${OLLAMA_API_KEY:-}" ] \
          || die 2 "OLLAMA_API_KEY fehlt. Fuer $ollama_host wird ein Ollama-Key gebraucht (Umgebungsvariable setzen, nie einchecken) - oder lokal arbeiten: ollama signin, OLLAMA_HOST weglassen."
        ;;
    esac
    if ! OLLAMA_URL="$ollama_host/api/tags" "$PY" - << 'PYEOF' > /dev/null 2>&1
import os, urllib.request
req = urllib.request.Request(os.environ["OLLAMA_URL"])
key = os.environ.get("OLLAMA_API_KEY")
if key:
    req.add_header("Authorization", "Bearer " + key)
urllib.request.urlopen(req, timeout=15).read()
PYEOF
    then
      die 2 "Ollama nicht erreichbar unter $ollama_host. Lokal: 'ollama serve' starten und 'ollama signin' ausfuehren (docs/setup/ollama-reviewers.md)."
    fi
  fi
fi

# --- Diff: PR oder aktueller Branch gegen die Basis ------------------------
case "$base" in
  origin/*)
    git -C "$TOP" fetch --quiet origin "${base#origin/}" 2> /dev/null \
      || echo "run-local: Warnung: origin nicht erreichbar, nutze vorhandenes $base." >&2
    ;;
esac
git -C "$TOP" rev-parse --verify --quiet "$base^{commit}" > /dev/null \
  || die 2 "Basis $base nicht gefunden (git fetch origin main?)."

if [ -n "$pr" ]; then
  git -C "$TOP" fetch --quiet origin "pull/$pr/head" 2> /dev/null \
    || die 2 "PR $pr nicht gefunden: 'git fetch origin pull/$pr/head' schlug fehl (Nummer falsch, origin nicht erreichbar oder kein Zugriff)."
  head_ref="$(git -C "$TOP" rev-parse FETCH_HEAD)" || die 2 "PR $pr: FETCH_HEAD nicht lesbar."
  [ -n "$head_ref" ] || die 2 "PR $pr: FETCH_HEAD ist leer."
  [ -n "$label" ] || label="pr$pr"
  subject="PR #$pr"
else
  head_ref="HEAD"
  branch="$(git -C "$TOP" rev-parse --abbrev-ref HEAD 2> /dev/null)"
  if [ -z "$branch" ] || [ "$branch" = HEAD ]; then
    branch="head-$(git -C "$TOP" rev-parse --short HEAD)"
  fi
  [ -n "$label" ] || label="$(printf '%s' "$branch" | tr '/' '-' | tr -c 'A-Za-z0-9._\n-' '-')"
  subject="branch $branch"
  if [ -n "$(git -C "$TOP" status --porcelain 2> /dev/null)" ]; then
    echo "run-local: Warnung: uncommittete Aenderungen im Arbeitsbaum - geprueft werden nur committete Aenderungen gegen $base." >&2
  fi
  if [ -z "$author" ]; then
    case "$branch" in
      claude/* | codex/* | kimi/* | opencode/* | glm/*) author="${branch%%/*}" ;;
    esac
  fi
fi

# Lockfiles sind Rauschen fuer Reviewer und sprengen die Prompt-Groesse.
pathspec=(-- . ':(exclude)package-lock.json' ':(exclude)Cargo.lock' ':(exclude)src-tauri/Cargo.lock')
diff_text="$(git -C "$TOP" -c core.quotepath=off diff --no-color --no-ext-diff -U10 "$base...$head_ref" "${pathspec[@]}")" || die 2 "git diff $base...$head_ref schlug fehl."
if [ -z "$diff_text" ]; then
  if git -C "$TOP" diff --quiet "$base...$head_ref"; then
    die 2 "keine Aenderungen gegen $base - es gibt nichts zu pruefen."
  fi
  die 2 "gegen $base haben sich nur Lockfiles geaendert (package-lock.json, Cargo.lock; bewusst ausgeschlossen) - es gibt nichts zu pruefen."
fi
max_chars="${REVIEW_MAX_DIFF_CHARS:-250000}"
diff_chars="${#diff_text}"
if [ "$diff_chars" -gt "$max_chars" ]; then
  die 2 "der Diff hat $diff_chars Zeichen (Grenze $max_chars, REVIEW_MAX_DIFF_CHARS). Ein abgeschnittener Diff waere kein Review: den PR teilen oder die Grenze bewusst anheben."
fi
stat_text="$(git -C "$TOP" -c core.quotepath=off diff --no-color --stat "$base...$head_ref" "${pathspec[@]}")"   || die 2 "git diff --stat $base...$head_ref schlug fehl."
log_text="$(git -C "$TOP" log --no-color --format='%h %s' -n 30 "$base..$head_ref")"   || die 2 "git log $base..$head_ref schlug fehl."

mkdir -p "$out_dir" || die 2 "kann $out_dir nicht anlegen."
prompt_file="$out_dir/review_prompt_$label.md"
{
  cat << EOF
# Review request $label: $subject against $base

You are an independent reviewer (not the author${author:+; the author is a $author model}).
Review the change below for correctness bugs, gaps, and safety regressions.
Be concrete: cite file and line, say what breaks and when. Rate each finding
high/medium/low. Do not restate the diff. If something is fine, say nothing
about it. Answer in English or German. This is a READ-ONLY review: do not
modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/,
TypeScript frontend, shell/Node tooling in scripts/), public GitHub repo.
You only see this prompt, not the repository.

## Rules to check against

- A bug claim needs a compiling, failing regression test; new code comes with
  a test that was red first. Flag code changes without a test.
- Never hide exit codes (no \`| tail\` masking, no swallowed errors), never
  bypass hooks. Check sibling cases of every bug fixed.
- Seams (src-tauri/src/api.rs, main.rs, store.rs and store/, bin/pa.rs) are
  single-owner files: point out risky changes there.
- No secrets, keys, personal data or absolute user paths in tracked files.
- No new dependency or copied third-party material without a permissive
  license (MIT, Apache-2.0, BSD, ISC, MPL-2.0, Zlib, Unicode, CC0, OFL).
- Do not claim provider, model, effort, billing or token facts that were not
  observed.

## Commits

$log_text

## Changed files

$stat_text

## Diff (three-dot diff against $base with 10 lines of context; lockfiles omitted)

\`\`\`diff
EOF
  printf '%s\n' "$diff_text"
  cat << 'EOF'
```

## Output format

Findings, one per block: ID (F1, F2, ...), severity (high/medium/low),
file:line, reason. End with a verdict line: approve / approve with
conditions / reject.
EOF
} > "$prompt_file" || die 2 "kann $prompt_file nicht schreiben."

echo "Label:   $label ($subject gegen $base)"
echo "Weg:     $via"
models_line="$(printf '%s, ' "${models[@]}")"
echo "Modelle: ${models_line%, }"
echo "Prompt:  $prompt_file ($diff_chars Zeichen Diff)"

if [ "$dry_run" -eq 1 ]; then
  echo "Trockenlauf: nichts wurde gesendet."
  exit 0
fi

# --- Versand ---------------------------------------------------------------
if [ "$via" = ollama ]; then
  for n in 1 2 3 4 5 6 7 8 9; do
    unset "REVIEWER_${n}_NAME" "REVIEWER_${n}_KIND" "REVIEWER_${n}_URL" "REVIEWER_${n}_MODEL" "REVIEWER_${n}_KEY"
  done
  n=0
  for m in "${models[@]}"; do
    n=$((n + 1))
    # Name fuer die Protokolldatei: ":cloud" faellt weg (kimi-k3), jeder andere
    # Tag bleibt (llama3:8b -> llama3-8b), damit zwei Tags nicht kollidieren.
    rname="${m%:cloud}"
    export "REVIEWER_${n}_NAME=${rname//:/-}" "REVIEWER_${n}_KIND=ollama" \
      "REVIEWER_${n}_URL=$ollama_host/api/generate" "REVIEWER_${n}_MODEL=$m"
    if [ -n "${OLLAMA_API_KEY:-}" ]; then
      export "REVIEWER_${n}_KEY=$OLLAMA_API_KEY"
    fi
  done
  "$PY" "$TRANSPORT" "$prompt_file" "$out_dir" "$label" --author "$author"
  exit $?
fi

# kilo: ein Lauf je Modell, in einem leeren Wegwerfverzeichnis, damit der
# Agent der CLI nichts im Repo anfassen kann. Das Protokoll hat dasselbe
# Format wie das des Transports.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$prompt_file" "$work/prompt.md" || die 2 "kann den Prompt nicht nach $work kopieren."
# Zeitlimit: REVIEW_KILO_TIMEOUT_S (Sekunden, 0 = keins). Ohne timeout/gtimeout
# (gtimeout: coreutils auf macOS) laeuft kilo ohne Limit - mit Warnung. Bewusst
# kein Array: "${leeres_array[@]}" ist unter set -u in Bash < 4.4 ein Fehler.
timeout_s="${REVIEW_KILO_TIMEOUT_S:-900}"
timeout_bin=""
if [ "$timeout_s" != 0 ]; then
  for t in timeout gtimeout; do
    if command -v "$t" > /dev/null 2>&1; then
      timeout_bin="$t"
      break
    fi
  done
  [ -n "$timeout_bin" ]     || echo "run-local: Warnung: kein timeout/gtimeout gefunden - kilo laeuft ohne Zeitlimit (REVIEW_KILO_TIMEOUT_S greift nicht)." >&2
fi
# --agent ask: der schreibgeschuetzte Agent von kilo (edit/write verboten, Rueckfragen
# werden im nicht-interaktiven Lauf abgelehnt, kein --auto).
kilo_review() { # modell
  if [ -n "$timeout_bin" ]; then
    "$timeout_bin" "$timeout_s" kilo run --agent ask -m "kilo/$1" "Follow the instructions in the attached file." -f prompt.md
  else
    kilo run --agent ask -m "kilo/$1" "Follow the instructions in the attached file." -f prompt.md
  fi
}
digest="$("$PY" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest()[:16])' "$prompt_file")"
prompt_chars="$(wc -m < "$prompt_file" | tr -d ' ')"
failed=0
for m in "${models[@]}"; do
  name="${m##*/}"
  name="${name%:free}"
  path="$out_dir/review_${label}_${name}.md"
  ( cd "$work" && kilo_review "$m" < /dev/null > out.txt 2> err.txt )
  rc=$?
  # ANSI-Farben und Wagenruecklaeufe der Windows-Konsole entfernen.
  verdict="$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//' "$work/out.txt" 2> /dev/null)"
  errtext="$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//' "$work/err.txt" 2> /dev/null | tail -n 15)"
  if [ "$rc" -eq 124 ]; then
    status=failed
    body="Reviewer failure: no answer within $timeout_s s (kilo timeout).

No verdict. Run again; this is not a review."
  elif [ "$rc" -ne 0 ]; then
    status=failed
    body="Reviewer failure: kilo exited with $rc.

$errtext

No verdict. Run again; this is not a review."
  elif [ -z "${verdict//[[:space:]]/}" ]; then
    status=failed
    body="Reviewer failure: kilo answered with an empty text - no verdict.

$errtext

No verdict. Run again; this is not a review."
  else
    status=ok
    body="$verdict"
  fi
  {
    echo "# Review $label - $name"
    echo
    echo "- Status: $status"
    echo "- Reviewer: $name (kind kilo)"
    echo "- Model requested: kilo/$m"
    echo "- Model reported: -"
    echo "- Author of the candidate: ${author:--}"
    echo "- Prompt: $prompt_file ($prompt_chars chars, sha256 $digest)"
    echo "- Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo
    echo "---"
    echo
    printf '%s\n' "$body"
  } > "$path"
  echo "$name: $status -> $path"
  [ "$status" = ok ] || failed=$((failed + 1))
done
if [ "$failed" -gt 0 ]; then
  echo "run-local: $failed von ${#models[@]} Reviewer(n) ohne Urteil." >&2
  exit 1
fi
exit 0
