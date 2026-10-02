# Review request setup-09-r2: branch claude/setup-09-review-local against origin/main

You are an independent reviewer (not the author; the author is a claude model).
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
- Never hide exit codes (no `| tail` masking, no swallowed errors), never
  bypass hooks. Check sibling cases of every bug fixed.
- Seams (src-tauri/src/api.rs, main.rs, store.rs and store/, bin/pa.rs) are
  single-owner files: point out risky changes there.
- No secrets, keys, personal data or absolute user paths in tracked files.
- No new dependency or copied third-party material without a permissive
  license (MIT, Apache-2.0, BSD, ISC, MPL-2.0, Zlib, Unicode, CC0, OFL).
- Do not claim provider, model, effort, billing or token facts that were not
  observed.

## Commits

e216dca fix(setup-09): review kimi F1-F7 - read-only kilo agent, name collisions, host match
9aa71bd fix(setup-09): review glm F1-F5 - timeout fallback, guarded git calls, tests
3d9502a feat(setup-09): local review runner without GitHub Actions
5ebd4c1 test(setup-09): red self-test for the local review runner

## Changed files

 docs/setup/ollama-reviewers.md |  43 +++++
 scripts/ci/gates.sh            |   2 +-
 scripts/review/run-local.sh    | 403 +++++++++++++++++++++++++++++++++++++++++
 scripts/test-review-local.sh   | 375 ++++++++++++++++++++++++++++++++++++++
 4 files changed, 822 insertions(+), 1 deletion(-)

## Diff (three-dot diff against origin/main with 10 lines of context; lockfiles omitted)

```diff
diff --git a/docs/setup/ollama-reviewers.md b/docs/setup/ollama-reviewers.md
index cd3d9ff..7cf64d2 100644
--- a/docs/setup/ollama-reviewers.md
+++ b/docs/setup/ollama-reviewers.md
@@ -43,20 +43,63 @@ enthalten:
 3. Die Regeln, gegen die geprüft wird (Auszug aus `AGENTS.md`: Beweismaßstab,
    Nahtstellen, keine Secrets, …).
 4. Das gewünschte Ausgabeformat: Befunde mit ID, Schwere, Datei:Zeile,
    Begründung, Urteil (freigeben / freigeben mit Auflagen / ablehnen).
 
 Den Prompt mit einem Skript zusammensetzen, nicht per Shell-Umleitung: ein
 Hook-Ausgabe-Überschreiben hat schon einmal einen 238-Zeichen-Prompt erzeugt
 (`.pa/review_w2-02_disposition.md`). Antworten wie „keine Frage erkannt" sind
 kein Review.
 
+## Lokal reviewen
+
+`scripts/review/run-local.sh` ist der Ein-Befehl-Weg ohne GitHub Actions
+(keine CI-Minuten): Es baut den Prompt aus dem Diff und ruft den oben
+beschriebenen `.pa/review_transport.py` auf, statt ihn nachzubauen.
+
+```sh
+bash scripts/review/run-local.sh 42                  # PR #42 (origin pull/42/head) gegen origin/main
+bash scripts/review/run-local.sh                     # aktueller Branch gegen origin/main
+bash scripts/review/run-local.sh 42 --via kilo       # kostenlose Modelle ueber die kilo-CLI
+bash scripts/review/run-local.sh --dry-run           # nur den Prompt bauen, nichts senden
+```
+
+- `--via ollama` (Standard): die Modelle stehen in `REVIEWER_MODELS` in
+  `scripts/dev/agent-setup-check.mjs` (`kimi-k3:cloud`, `glm-5.2:cloud`);
+  ueberschreiben mit `--models a,b` oder `REVIEW_OLLAMA_MODELS`. Endpunkt ist
+  `OLLAMA_HOST` (Standard: lokaler Ollama, kein Key). Nur wer direkt gegen
+  `https://ollama.com` spricht, setzt `OLLAMA_API_KEY` in der Umgebung.
+- `--via kilo`: `kilo run -m kilo/<modell>:free`, nur `:free`-Modelle (alles
+  andere lehnt das Skript ab). Standard: `stepfun/step-3.7-flash:free` und
+  `nvidia/nemotron-3-super-120b-a12b:free`; die Liste der kostenlosen Modelle
+  aendert sich (`kilo models kilo | grep ':free'`), ueberschreiben mit
+  `--models` oder `REVIEW_KILO_MODELS`. Beide Standardmodelle standen am
+  26.09.2026 in `kilo models kilo`; veraltet ein Name, endet der Lauf mit
+  `failed`, dann `--models` setzen. kilo laeuft als `--agent ask` (Schreiben
+  verboten, keine Auto-Freigaben) in einem leeren Wegwerfverzeichnis und
+  bekommt den Prompt als Anhang; Zeitlimit `REVIEW_KILO_TIMEOUT_S`
+  (Standard 900 s, 0 = keins). Der Diff ist Eingabe eines Agenten mit
+  Lesewerkzeugen: PRs unbekannter Herkunft nicht ueber `--via kilo` pruefen,
+  dort ist der Ollama-Weg (reine Textanfrage, keine Werkzeuge) der sichere.
+- Ergebnis: `.pa/review_prompt_<label>.md` und `.pa/review_<label>_<modell>.md`,
+  `<label>` = `pr<N>` oder der Branchname (`/` wird `-`). Mit `--out-dir` und
+  `--label` umlenkbar.
+- Exit 0 nur, wenn jeder Reviewer Text geliefert hat; Exit 1 bei leerer oder
+  fehlerhafter Antwort (Protokoll `Status: failed`, nochmals laufen lassen);
+  Exit 2 bei Aufruf- oder Voraussetzungsfehlern (fehlendes Ollama, kilo oder
+  Key, unbekannter PR, kein Diff, Diff ueber `REVIEW_MAX_DIFF_CHARS`).
+  Ein abgeschnittener Diff waere kein Review; deshalb wird nichts gekuerzt.
+- Geprueft werden nur **committete** Aenderungen. Der Diff geht an den
+  gewaehlten Dienst: nichts Vertrauliches im Branch.
+- Selbsttest ohne Netz: `bash scripts/test-review-local.sh` (Fake-Ollama,
+  kilo-Stub, Wegwerf-Repo).
+
 ## Disposition
 
 Jeder Befund bekommt eine Zeile in `.pa/review_<label>_disposition.md`:
 ID, Quelle, Schwere, Befund, Disposition (angenommen mit Commit / abgelehnt mit
 Grund / Folgearbeit). Vorlage: `.pa/review_w2-02_disposition.md`. Ändert sich
 der Kandidat danach, wird das Delta erneut geprüft.
 
 ## Reviewer oder Advisor?
 
 Das Ollama-Paar prüft Diffs und Pläne im Alltag. Für harte Entscheidungen und
diff --git a/scripts/ci/gates.sh b/scripts/ci/gates.sh
index 18284e4..0c3d45e 100755
--- a/scripts/ci/gates.sh
+++ b/scripts/ci/gates.sh
@@ -73,21 +73,21 @@ GATES=(
   # genau dort war die Auswertung schon einmal falsch. Stand auf main als
   # eigener ci.yml-Schritt und waere beim Umbau auf Bahnen verloren gegangen.
   # CI-02 (W1-19b): Dependabot-Manifest-Commits brauchen keinen Trailer -
   # und nur die. Der Selbsttest belegt die Ausnahme UND ihre Grenzen.
   "selftest-red-first|linux,release|.|bash scripts/test-red-first-output.sh && bash scripts/test-red-first-dependabot.sh && bash scripts/test-red-first-verdict.sh && bash scripts/test-red-first-landed.sh && bash scripts/test-red-first-platform.sh"
   # Der Review-Transport ist der Weg, auf dem die Dual-Review-Pflicht
   # (AGENTS.md) ueberhaupt eingeloest wird. Am 09.09. starb er an einer
   # Antwort ohne Inhalt und schrieb fuer KEINEN Reviewer ein Protokoll.
   # Laeuft gegen einen lokalen Server: kein Netz, kein Secret, keine
   # Modellminute.
-  "selftest-review|linux,release|.|bash scripts/test-review-transport.sh"
+  "selftest-review|linux,release|.|bash scripts/test-review-transport.sh && bash scripts/test-review-local.sh"
   # CI-01/CI-02: der Plan-Schritt der Jobs linux und windows entscheidet, ob
   # die Bahn laufen muss (scripts/ci/lane-plan.sh). Ein falsches "false" waere
   # ein Gate, das gruen durch Abwesenheit ist - deshalb belegt der Selbsttest
   # beide Richtungen (Rust-Aenderung -> voll, gelesene Doku -> voll, freie
   # Doku -> aus, Queue/Wochenlauf -> voll, main-Push nur bei Cache-Eingaben).
   "selftest-lane-plan|linux,release|.|bash scripts/test-lane-plan.sh"
   # Nutzer-Regel (freigegeben 25.09.2026): Geheimnis-Scan vor jedem Commit.
   # gitleaks ueber den Index (nur das, was der Commit einfuehren wuerde,
   # unter einer Sekunde). Die Allowlist fuer die Test-Kanarienvoegel aus
   # Pruefung E steht in .gitleaks.toml. Kein stiller Rueckfall:
diff --git a/scripts/review/run-local.sh b/scripts/review/run-local.sh
new file mode 100644
index 0000000..4983f2b
--- /dev/null
+++ b/scripts/review/run-local.sh
@@ -0,0 +1,403 @@
+#!/usr/bin/env bash
+# run-local.sh - lokaler Review-Lauf ohne GitHub Actions (SETUP-09).
+#
+#   bash scripts/review/run-local.sh [<pr-nummer>] [--via ollama|kilo]
+#        [--models a,b] [--base origin/main] [--label <name>]
+#        [--author <instanz>] [--out-dir <dir>] [--dry-run]
+#
+# Ohne Nummer wird der aktuelle Branch gegen origin/main geprueft, mit Nummer
+# der PR (origin pull/<n>/head). Das Skript baut den Review-Prompt aus dem
+# Diff, schreibt ihn nach <out-dir>/review_prompt_<label>.md und schickt ihn
+# an einen oder zwei KOSTENLOSE Reviewer:
+#
+#   --via ollama  (Standard)  Ollama, Modelle aus REVIEWER_MODELS in
+#                 scripts/dev/agent-setup-check.mjs (Ueberschreiben:
+#                 REVIEW_OLLAMA_MODELS oder --models). Der Versand laeuft
+#                 ueber .pa/review_transport.py - der gehaertete Transport.
+#   --via kilo    kilo run --agent ask -m kilo/<modell>:free. Nur :free-Modelle;
+#                 alles andere wird abgelehnt, damit kein Geld fliesst.
+#                 REVIEW_KILO_TIMEOUT_S: Zeitlimit je Modell (900 s, 0 = keins).
+#
+# Ergebnis: <out-dir>/review_<label>_<modell>.md, <label> = pr<N> oder der
+# Branchname (/ -> -). out-dir ist standardmaessig .pa/ des Repos.
+# Exit 0 nur, wenn JEDER Reviewer einen Text geliefert hat. Exit 1: mindestens
+# ein Reviewer leer oder fehlerhaft (das Protokoll steht auf "failed"). Exit 2:
+# Aufruf- oder Voraussetzungsfehler (nichts wurde bewertet).
+#
+# Keys stehen nie im Code: OLLAMA_API_KEY (nur fuer https://ollama.com) kommt
+# aus der Umgebung und geht nur als Bearer-Kopf zum Server.
+# Selbsttest ohne Netz: scripts/test-review-local.sh
+set -uo pipefail
+
+SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
+ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
+TRANSPORT="$ROOT/.pa/review_transport.py"
+
+die() { # exit-code meldung...
+  local code="$1"
+  shift
+  echo "run-local: $*" >&2
+  exit "$code"
+}
+
+usage() {
+  sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
+}
+
+pr=""
+via="ollama"
+models_arg=""
+base="origin/main"
+label=""
+author=""
+out_dir=""
+dry_run=0
+
+while [ $# -gt 0 ]; do
+  case "$1" in
+    -h | --help) usage; exit 0 ;;
+    --pr) pr="${2:-}"; shift 2 || die 2 "--pr braucht eine Nummer." ;;
+    --via) via="${2:-}"; shift 2 || die 2 "--via braucht ollama oder kilo." ;;
+    --models) models_arg="${2:-}"; shift 2 || die 2 "--models braucht eine Liste." ;;
+    --base) base="${2:-}"; shift 2 || die 2 "--base braucht eine Referenz." ;;
+    --label) label="${2:-}"; shift 2 || die 2 "--label braucht einen Namen." ;;
+    --author) author="${2:-}"; shift 2 || die 2 "--author braucht einen Namen." ;;
+    --out-dir) out_dir="${2:-}"; shift 2 || die 2 "--out-dir braucht ein Verzeichnis." ;;
+    --dry-run) dry_run=1; shift ;;
+    -*) die 2 "unbekannte Option $1 (siehe --help)." ;;
+    *)
+      [ -z "$pr" ] || die 2 "zu viele Argumente: $1"
+      pr="$1"
+      shift
+      ;;
+  esac
+done
+
+case "$via" in
+  ollama | kilo) ;;
+  *) die 2 "unbekannter Weg --via $via (ollama | kilo)." ;;
+esac
+if [ -n "$pr" ]; then
+  case "$pr" in
+    '' | *[!0-9]*) die 2 "PR-Nummer erwartet, bekommen: $pr" ;;
+  esac
+fi
+
+# --- Werkzeuge -------------------------------------------------------------
+# Python suchen, nicht annehmen (Windows: der Store-Stub startet nur den Store).
+PY=""
+for kandidat in python3 python py; do
+  command -v "$kandidat" > /dev/null 2>&1 || continue
+  if "$kandidat" -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" > /dev/null 2>&1; then
+    PY="$kandidat"
+    break
+  fi
+done
+[ -n "$PY" ] || die 2 "kein lauffaehiges Python 3 gefunden (python3 / python / py geprueft). Installieren und PATH pruefen."
+command -v git > /dev/null 2>&1 || die 2 "git nicht gefunden."
+TOP="$(git rev-parse --show-toplevel 2> /dev/null)" || die 2 "kein git-Repository im aktuellen Verzeichnis."
+[ -n "$out_dir" ] || out_dir="$TOP/.pa"
+
+# --- Modelle ---------------------------------------------------------------
+# Die Standardpaare stehen an genau einer Stelle: REVIEWER_MODELS in
+# agent-setup-check.mjs (dieselbe Liste prueft `npm run dev:agent-check`).
+default_ollama_models() {
+  grep -o 'REVIEWER_MODELS = \[[^]]*\]' "$ROOT/scripts/dev/agent-setup-check.mjs" 2> /dev/null \
+    | grep -o '"[^"]*"' | tr -d '"' | paste -sd, -
+}
+
+if [ -z "$models_arg" ]; then
+  if [ "$via" = ollama ]; then
+    models_arg="${REVIEW_OLLAMA_MODELS:-$(default_ollama_models)}"
+    [ -n "$models_arg" ] || die 2 "keine Standardmodelle gefunden (REVIEWER_MODELS in scripts/dev/agent-setup-check.mjs). --models oder REVIEW_OLLAMA_MODELS setzen."
+  else
+    models_arg="${REVIEW_KILO_MODELS:-stepfun/step-3.7-flash:free,nvidia/nemotron-3-super-120b-a12b:free}"
+  fi
+fi
+
+IFS=',' read -r -a raw_models <<< "$models_arg"
+models=()
+for m in "${raw_models[@]}"; do
+  m="${m#"${m%%[![:space:]]*}"}"
+  m="${m%"${m##*[![:space:]]}"}"
+  [ -z "$m" ] || models+=("$m")
+done
+[ "${#models[@]}" -ge 1 ] || die 2 "keine Modelle angegeben."
+[ "${#models[@]}" -le 2 ] || die 2 "hoechstens zwei Reviewer je Lauf (bekommen: ${#models[@]})."
+[ "${#models[@]}" -lt 2 ] || [ "${models[0]}" != "${models[1]}" ]   || die 2 "Modell ${models[0]} doppelt angegeben - ein Dual-Review braucht zwei verschiedene Reviewer."
+
+if [ "$via" = kilo ]; then
+  for i in "${!models[@]}"; do
+    m="${models[$i]#kilo/}"
+    case "$m" in
+      *:free) ;;
+      *) die 2 "kilo-Modell '$m' ist kein :free-Modell. Nur kostenlose Modelle sind erlaubt (kilo models kilo | grep ':free')." ;;
+    esac
+    models[i]="$m"
+  done
+fi
+
+# --- Voraussetzungen des Weges (nur beim echten Versand) -------------------
+ollama_host=""
+if [ "$dry_run" -eq 0 ]; then
+  if [ "$via" = kilo ]; then
+    command -v kilo > /dev/null 2>&1 \
+      || die 2 "kilo nicht gefunden. Kilo CLI installieren (npm i -g @kilocode/cli) und PATH pruefen."
+  else
+    ollama_host="${OLLAMA_HOST:-http://127.0.0.1:11434}"
+    case "$ollama_host" in
+      http://* | https://*) ;;
+      *) ollama_host="http://$ollama_host" ;;
+    esac
+    ollama_host="${ollama_host%/}"
+    host_only="${ollama_host#*://}"
+    host_only="${host_only%%/*}"
+    host_only="${host_only%%:*}"
+    case "$host_only" in
+      ollama.com | *.ollama.com)
+        [ -n "${OLLAMA_API_KEY:-}" ] \
+          || die 2 "OLLAMA_API_KEY fehlt. Fuer $ollama_host wird ein Ollama-Key gebraucht (Umgebungsvariable setzen, nie einchecken) - oder lokal arbeiten: ollama signin, OLLAMA_HOST weglassen."
+        ;;
+    esac
+    if ! OLLAMA_URL="$ollama_host/api/tags" "$PY" - << 'PYEOF' > /dev/null 2>&1
+import os, urllib.request
+req = urllib.request.Request(os.environ["OLLAMA_URL"])
+key = os.environ.get("OLLAMA_API_KEY")
+if key:
+    req.add_header("Authorization", "Bearer " + key)
+urllib.request.urlopen(req, timeout=15).read()
+PYEOF
+    then
+      die 2 "Ollama nicht erreichbar unter $ollama_host. Lokal: 'ollama serve' starten und 'ollama signin' ausfuehren (docs/setup/ollama-reviewers.md)."
+    fi
+  fi
+fi
+
+# --- Diff: PR oder aktueller Branch gegen die Basis ------------------------
+case "$base" in
+  origin/*)
+    git -C "$TOP" fetch --quiet origin "${base#origin/}" 2> /dev/null \
+      || echo "run-local: Warnung: origin nicht erreichbar, nutze vorhandenes $base." >&2
+    ;;
+esac
+git -C "$TOP" rev-parse --verify --quiet "$base^{commit}" > /dev/null \
+  || die 2 "Basis $base nicht gefunden (git fetch origin main?)."
+
+if [ -n "$pr" ]; then
+  git -C "$TOP" fetch --quiet origin "pull/$pr/head" 2> /dev/null \
+    || die 2 "PR $pr nicht gefunden: 'git fetch origin pull/$pr/head' schlug fehl (Nummer falsch, origin nicht erreichbar oder kein Zugriff)."
+  head_ref="$(git -C "$TOP" rev-parse FETCH_HEAD)" || die 2 "PR $pr: FETCH_HEAD nicht lesbar."
+  [ -n "$head_ref" ] || die 2 "PR $pr: FETCH_HEAD ist leer."
+  [ -n "$label" ] || label="pr$pr"
+  subject="PR #$pr"
+else
+  head_ref="HEAD"
+  branch="$(git -C "$TOP" rev-parse --abbrev-ref HEAD 2> /dev/null)"
+  if [ -z "$branch" ] || [ "$branch" = HEAD ]; then
+    branch="head-$(git -C "$TOP" rev-parse --short HEAD)"
+  fi
+  [ -n "$label" ] || label="$(printf '%s' "$branch" | tr '/' '-' | tr -c 'A-Za-z0-9._\n-' '-')"
+  subject="branch $branch"
+  if [ -n "$(git -C "$TOP" status --porcelain 2> /dev/null)" ]; then
+    echo "run-local: Warnung: uncommittete Aenderungen im Arbeitsbaum - geprueft werden nur committete Aenderungen gegen $base." >&2
+  fi
+  if [ -z "$author" ]; then
+    case "$branch" in
+      claude/* | codex/* | kimi/* | opencode/* | glm/*) author="${branch%%/*}" ;;
+    esac
+  fi
+fi
+
+# Lockfiles sind Rauschen fuer Reviewer und sprengen die Prompt-Groesse.
+pathspec=(-- . ':(exclude)package-lock.json' ':(exclude)Cargo.lock' ':(exclude)src-tauri/Cargo.lock')
+diff_text="$(git -C "$TOP" -c core.quotepath=off diff --no-color --no-ext-diff -U10 "$base...$head_ref" "${pathspec[@]}")" || die 2 "git diff $base...$head_ref schlug fehl."
+if [ -z "$diff_text" ]; then
+  if git -C "$TOP" diff --quiet "$base...$head_ref"; then
+    die 2 "keine Aenderungen gegen $base - es gibt nichts zu pruefen."
+  fi
+  die 2 "gegen $base haben sich nur Lockfiles geaendert (package-lock.json, Cargo.lock; bewusst ausgeschlossen) - es gibt nichts zu pruefen."
+fi
+max_chars="${REVIEW_MAX_DIFF_CHARS:-250000}"
+diff_chars="${#diff_text}"
+if [ "$diff_chars" -gt "$max_chars" ]; then
+  die 2 "der Diff hat $diff_chars Zeichen (Grenze $max_chars, REVIEW_MAX_DIFF_CHARS). Ein abgeschnittener Diff waere kein Review: den PR teilen oder die Grenze bewusst anheben."
+fi
+stat_text="$(git -C "$TOP" -c core.quotepath=off diff --no-color --stat "$base...$head_ref" "${pathspec[@]}")"   || die 2 "git diff --stat $base...$head_ref schlug fehl."
+log_text="$(git -C "$TOP" log --no-color --format='%h %s' -n 30 "$base..$head_ref")"   || die 2 "git log $base..$head_ref schlug fehl."
+
+mkdir -p "$out_dir" || die 2 "kann $out_dir nicht anlegen."
+prompt_file="$out_dir/review_prompt_$label.md"
+{
+  cat << EOF
+# Review request $label: $subject against $base
+
+You are an independent reviewer (not the author${author:+; the author is a $author model}).
+Review the change below for correctness bugs, gaps, and safety regressions.
+Be concrete: cite file and line, say what breaks and when. Rate each finding
+high/medium/low. Do not restate the diff. If something is fine, say nothing
+about it. Answer in English or German. This is a READ-ONLY review: do not
+modify any files.
+
+## Context
+
+Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/,
+TypeScript frontend, shell/Node tooling in scripts/), public GitHub repo.
+You only see this prompt, not the repository.
+
+## Rules to check against
+
+- A bug claim needs a compiling, failing regression test; new code comes with
+  a test that was red first. Flag code changes without a test.
+- Never hide exit codes (no \`| tail\` masking, no swallowed errors), never
+  bypass hooks. Check sibling cases of every bug fixed.
+- Seams (src-tauri/src/api.rs, main.rs, store.rs and store/, bin/pa.rs) are
+  single-owner files: point out risky changes there.
+- No secrets, keys, personal data or absolute user paths in tracked files.
+- No new dependency or copied third-party material without a permissive
+  license (MIT, Apache-2.0, BSD, ISC, MPL-2.0, Zlib, Unicode, CC0, OFL).
+- Do not claim provider, model, effort, billing or token facts that were not
+  observed.
+
+## Commits
+
+$log_text
+
+## Changed files
+
+$stat_text
+
+## Diff (three-dot diff against $base with 10 lines of context; lockfiles omitted)
+
+\`\`\`diff
+EOF
+  printf '%s\n' "$diff_text"
+  cat << 'EOF'
+```
+
+## Output format
+
+Findings, one per block: ID (F1, F2, ...), severity (high/medium/low),
+file:line, reason. End with a verdict line: approve / approve with
+conditions / reject.
+EOF
+} > "$prompt_file" || die 2 "kann $prompt_file nicht schreiben."
+
+echo "Label:   $label ($subject gegen $base)"
+echo "Weg:     $via"
+models_line="$(printf '%s, ' "${models[@]}")"
+echo "Modelle: ${models_line%, }"
+echo "Prompt:  $prompt_file ($diff_chars Zeichen Diff)"
+
+if [ "$dry_run" -eq 1 ]; then
+  echo "Trockenlauf: nichts wurde gesendet."
+  exit 0
+fi
+
+# --- Versand ---------------------------------------------------------------
+if [ "$via" = ollama ]; then
+  for n in 1 2 3 4 5 6 7 8 9; do
+    unset "REVIEWER_${n}_NAME" "REVIEWER_${n}_KIND" "REVIEWER_${n}_URL" "REVIEWER_${n}_MODEL" "REVIEWER_${n}_KEY"
+  done
+  n=0
+  for m in "${models[@]}"; do
+    n=$((n + 1))
+    # Name fuer die Protokolldatei: ":cloud" faellt weg (kimi-k3), jeder andere
+    # Tag bleibt (llama3:8b -> llama3-8b), damit zwei Tags nicht kollidieren.
+    rname="${m%:cloud}"
+    export "REVIEWER_${n}_NAME=${rname//:/-}" "REVIEWER_${n}_KIND=ollama" \
+      "REVIEWER_${n}_URL=$ollama_host/api/generate" "REVIEWER_${n}_MODEL=$m"
+    if [ -n "${OLLAMA_API_KEY:-}" ]; then
+      export "REVIEWER_${n}_KEY=$OLLAMA_API_KEY"
+    fi
+  done
+  "$PY" "$TRANSPORT" "$prompt_file" "$out_dir" "$label" --author "$author"
+  exit $?
+fi
+
+# kilo: ein Lauf je Modell, in einem leeren Wegwerfverzeichnis, damit der
+# Agent der CLI nichts im Repo anfassen kann. Das Protokoll hat dasselbe
+# Format wie das des Transports.
+work="$(mktemp -d)"
+trap 'rm -rf "$work"' EXIT
+cp "$prompt_file" "$work/prompt.md" || die 2 "kann den Prompt nicht nach $work kopieren."
+# Zeitlimit: REVIEW_KILO_TIMEOUT_S (Sekunden, 0 = keins). Ohne timeout/gtimeout
+# (gtimeout: coreutils auf macOS) laeuft kilo ohne Limit - mit Warnung. Bewusst
+# kein Array: "${leeres_array[@]}" ist unter set -u in Bash < 4.4 ein Fehler.
+timeout_s="${REVIEW_KILO_TIMEOUT_S:-900}"
+timeout_bin=""
+if [ "$timeout_s" != 0 ]; then
+  for t in timeout gtimeout; do
+    if command -v "$t" > /dev/null 2>&1; then
+      timeout_bin="$t"
+      break
+    fi
+  done
+  [ -n "$timeout_bin" ]     || echo "run-local: Warnung: kein timeout/gtimeout gefunden - kilo laeuft ohne Zeitlimit (REVIEW_KILO_TIMEOUT_S greift nicht)." >&2
+fi
+# --agent ask: der schreibgeschuetzte Agent von kilo (edit/write verboten, Rueckfragen
+# werden im nicht-interaktiven Lauf abgelehnt, kein --auto).
+kilo_review() { # modell
+  if [ -n "$timeout_bin" ]; then
+    "$timeout_bin" "$timeout_s" kilo run --agent ask -m "kilo/$1" "Follow the instructions in the attached file." -f prompt.md
+  else
+    kilo run --agent ask -m "kilo/$1" "Follow the instructions in the attached file." -f prompt.md
+  fi
+}
+digest="$("$PY" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest()[:16])' "$prompt_file")"
+prompt_chars="$(wc -m < "$prompt_file" | tr -d ' ')"
+failed=0
+for m in "${models[@]}"; do
+  name="${m##*/}"
+  name="${name%:free}"
+  path="$out_dir/review_${label}_${name}.md"
+  ( cd "$work" && kilo_review "$m" < /dev/null > out.txt 2> err.txt )
+  rc=$?
+  # ANSI-Farben und Wagenruecklaeufe der Windows-Konsole entfernen.
+  verdict="$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//' "$work/out.txt" 2> /dev/null)"
+  errtext="$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//' "$work/err.txt" 2> /dev/null | tail -n 15)"
+  if [ "$rc" -eq 124 ]; then
+    status=failed
+    body="Reviewer failure: no answer within $timeout_s s (kilo timeout).
+
+No verdict. Run again; this is not a review."
+  elif [ "$rc" -ne 0 ]; then
+    status=failed
+    body="Reviewer failure: kilo exited with $rc.
+
+$errtext
+
+No verdict. Run again; this is not a review."
+  elif [ -z "${verdict//[[:space:]]/}" ]; then
+    status=failed
+    body="Reviewer failure: kilo answered with an empty text - no verdict.
+
+$errtext
+
+No verdict. Run again; this is not a review."
+  else
+    status=ok
+    body="$verdict"
+  fi
+  {
+    echo "# Review $label - $name"
+    echo
+    echo "- Status: $status"
+    echo "- Reviewer: $name (kind kilo)"
+    echo "- Model requested: kilo/$m"
+    echo "- Model reported: -"
+    echo "- Author of the candidate: ${author:--}"
+    echo "- Prompt: $prompt_file ($prompt_chars chars, sha256 $digest)"
+    echo "- Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
+    echo
+    echo "---"
+    echo
+    printf '%s\n' "$body"
+  } > "$path"
+  echo "$name: $status -> $path"
+  [ "$status" = ok ] || failed=$((failed + 1))
+done
+if [ "$failed" -gt 0 ]; then
+  echo "run-local: $failed von ${#models[@]} Reviewer(n) ohne Urteil." >&2
+  exit 1
+fi
+exit 0
diff --git a/scripts/test-review-local.sh b/scripts/test-review-local.sh
new file mode 100644
index 0000000..c5f5cb9
--- /dev/null
+++ b/scripts/test-review-local.sh
@@ -0,0 +1,375 @@
+#!/usr/bin/env bash
+# Selbsttest fuer scripts/review/run-local.sh (SETUP-09).
+#
+# run-local.sh baut den Review-Prompt fuer einen PR oder den aktuellen Branch
+# und schickt ihn ueber .pa/review_transport.py (Ollama) oder die kilo-CLI an
+# kostenlose Reviewer. Hier laeuft alles ohne Netz, ohne Key und ohne
+# Modellminute:
+#   - Ollama: ein lokaler HTTP-Server (Fake-Reviewer) auf 127.0.0.1,
+#   - kilo:   ein Stub-Skript "kilo" vorn im PATH,
+#   - git:    ein Wegwerf-Repo mit einem lokalen Bare-Repo als origin.
+# Geprueft wird vor allem, dass ein leerer oder fehlerhafter Reviewer den Lauf
+# rot macht (wie der gehaertete Transport) und dass fehlende Voraussetzungen
+# eine klare deutsche Meldung liefern statt eines Tracebacks.
+set -uo pipefail
+ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
+RUN="$ROOT/scripts/review/run-local.sh"
+tmp="$(mktemp -d)"
+srv_pid=""
+trap 'if [ -n "$srv_pid" ]; then kill "$srv_pid" 2>/dev/null; fi; rm -rf "$tmp"' EXIT
+fails=0
+
+ok()  { echo "ok   $*"; }
+bad() { echo "FEHLER $*"; fails=$((fails + 1)); }
+
+# Interpreter suchen wie in test-review-transport.sh (Store-Stub unter Windows).
+PY=""
+for kandidat in python3 python py; do
+  command -v "$kandidat" > /dev/null 2>&1 || continue
+  if "$kandidat" -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" > /dev/null 2>&1; then
+    PY="$kandidat"
+    break
+  fi
+done
+if [ -z "$PY" ]; then
+  echo "FEHLER: kein lauffaehiges Python 3 gefunden - der Selbsttest waere ungelaufen, nicht gruen." >&2
+  exit 2
+fi
+
+if [ ! -f "$RUN" ]; then
+  bad "scripts/review/run-local.sh fehlt"
+  echo "$fails Fehler."
+  exit 1
+fi
+
+# --- Fake-Ollama: /api/tags (Erreichbarkeit) und /api/generate -------------
+cat > "$tmp/server.py" <<'PYEOF'
+import json, sys
+from http.server import BaseHTTPRequestHandler, HTTPServer
+
+class H(BaseHTTPRequestHandler):
+    def _send(self, obj):
+        raw = json.dumps(obj).encode()
+        self.send_response(200)
+        self.send_header("Content-Type", "application/json")
+        self.send_header("Content-Length", str(len(raw)))
+        self.end_headers()
+        self.wfile.write(raw)
+    def do_GET(self):
+        self._send({"models": []})
+    def do_POST(self):
+        n = int(self.headers.get("Content-Length") or 0)
+        req = json.loads(self.rfile.read(n) or b"{}")
+        model = req.get("model", "")
+        # Modelle mit "leer" antworten ohne Text: kein Urteil.
+        text = "" if "leer" in model else "Urteil: freigeben (fake %s). Prompt %d Zeichen." % (model, len(req.get("prompt", "")))
+        auth = self.headers.get("Authorization") or ""
+        # "auth" nur fuer einen echten Bearer-Kopf mit Wert, nicht fuer irgendeinen.
+        bearer = auth.startswith("Bearer ") and len(auth) > len("Bearer ")
+        with open(sys.argv[2], "a") as log:
+            log.write("%s|%s|%s\n" % (model, "auth" if bearer else "noauth", req.get("prompt", "").count("MARKER_LINE")))
+        self._send({"model": model, "response": text})
+    def log_message(self, *a):
+        pass
+
+srv = HTTPServer(("127.0.0.1", 0), H)
+open(sys.argv[1], "w").write(str(srv.server_address[1]))
+srv.serve_forever()
+PYEOF
+"$PY" "$tmp/server.py" "$tmp/port" "$tmp/requests.log" &
+srv_pid=$!
+for _ in $(seq 1 50); do [ -s "$tmp/port" ] && break; sleep 0.1; done
+PORT="$(cat "$tmp/port" 2>/dev/null || true)"
+if [ -z "$PORT" ]; then
+  echo "FEHLER: Fake-Server startete nicht." >&2
+  exit 2
+fi
+FAKE="http://127.0.0.1:$PORT"
+
+# --- Wegwerf-Repo: origin (bare) mit main, Branch mit Aenderung, pull/7/head -
+git init -q --bare "$tmp/origin.git"
+git init -q -b main "$tmp/repo"
+(
+  cd "$tmp/repo" || exit 1
+  git config user.email t@example.invalid
+  git config user.name test
+  git config commit.gpgsign false
+  git remote add origin "$tmp/origin.git"
+  echo "base" > a.txt
+  git add a.txt && git commit -q -m base
+  git push -q origin main
+  git checkout -q -b claude/demo-branch
+  echo "MARKER_LINE one" > b.txt
+  echo "MARKER_LINE two" >> b.txt
+  git add b.txt && git commit -q -m change
+  git push -q origin HEAD:refs/pull/7/head
+)
+REPO="$tmp/repo"
+
+run() { # arg... ; setzt $out und $rc, laeuft im Wegwerf-Repo
+  out="$(cd "$REPO" && "$@" 2>&1)"
+  rc=$?
+}
+
+# Der Fake-Ollama darf nichts ausser sich selbst ansprechen.
+export OLLAMA_HOST="$FAKE"
+unset OLLAMA_API_KEY REVIEW_OLLAMA_MODELS REVIEW_KILO_MODELS
+
+# 1. Standardmodelle stammen aus der Repo-Konfiguration (agent-setup-check.mjs).
+run bash "$RUN" --dry-run --out-dir "$tmp/o0"
+want="$(grep -o 'REVIEWER_MODELS = \[[^]]*\]' "$ROOT/scripts/dev/agent-setup-check.mjs" | grep -o '"[^"]*"' | tr -d '"' | tr '\n' ' ')"
+got="$(printf '%s\n' "$out" | sed -n 's/^Modelle: //p' | tr ',' ' ' | tr -s ' ')"
+if [ "$rc" -eq 0 ] && [ -n "$want" ] && [ "$(echo $want)" = "$(echo $got)" ]; then
+  ok "Standardmodelle = REVIEWER_MODELS aus agent-setup-check.mjs ($(echo $want))"
+else
+  bad "Standardmodelle: rc=$rc erwartet [$want] bekommen [$got]"; echo "$out"
+fi
+
+# 2. Zwei Ollama-Reviewer, Branch-Modus: Exit 0, Protokolle, Prompt mit Diff.
+: > "$tmp/requests.log"
+run bash "$RUN" --models fake-a:cloud,fake-b:cloud --out-dir "$tmp/o1"
+label="claude-demo-branch"
+if [ "$rc" -eq 0 ] \
+  && grep -q "Status: ok" "$tmp/o1/review_${label}_fake-a.md" 2>/dev/null \
+  && grep -q "Status: ok" "$tmp/o1/review_${label}_fake-b.md" 2>/dev/null; then
+  ok "Branch-Modus, zwei Reviewer: Exit 0 und zwei Protokolle review_${label}_<modell>.md"
+else
+  bad "Branch-Modus: rc=$rc"; echo "$out"; ls "$tmp/o1" 2>&1
+fi
+if grep -q "MARKER_LINE one" "$tmp/o1/review_prompt_${label}.md" 2>/dev/null \
+  && grep -q "b.txt" "$tmp/o1/review_prompt_${label}.md" 2>/dev/null \
+  && ! grep -q "^+base" "$tmp/o1/review_prompt_${label}.md" 2>/dev/null; then
+  ok "Prompt enthaelt den Diff gegen origin/main (und nicht die Basis-Datei)"
+else
+  bad "Prompt-Datei review_prompt_${label}.md fehlt oder hat den falschen Diff"
+fi
+# Spalten: modell|auth-oder-noauth|Zahl der MARKER_LINE-Zeilen im Prompt (je 2).
+if [ "$(awk -F'|' '$3 == 2 && $2 == "noauth"' "$tmp/requests.log" | wc -l | tr -d ' ')" = "2" ] \
+  && [ "$(wc -l < "$tmp/requests.log" | tr -d ' ')" = "2" ]; then
+  ok "Genau zwei Anfragen, ohne Authorization-Kopf (lokaler Ollama braucht keinen Key)"
+else
+  bad "Anfragen: $(cat "$tmp/requests.log")"
+fi
+
+# 3. Ein leerer Reviewer macht den Lauf rot; der andere laeuft trotzdem.
+run bash "$RUN" --models fake-a:cloud,fake-leer:cloud --out-dir "$tmp/o2"
+if [ "$rc" -ne 0 ] \
+  && grep -q "Status: ok" "$tmp/o2/review_${label}_fake-a.md" 2>/dev/null \
+  && grep -q "Status: failed" "$tmp/o2/review_${label}_fake-leer.md" 2>/dev/null; then
+  ok "Leerer Reviewer: Exit $rc, Protokoll 'failed', der andere Reviewer lief durch"
+else
+  bad "Leerer Reviewer: rc=$rc"; echo "$out"
+fi
+
+# 4. PR-Modus: Nummer -> pull/7/head von origin; Label pr7.
+run bash "$RUN" 7 --models fake-a:cloud --out-dir "$tmp/o3"
+if [ "$rc" -eq 0 ] && grep -q "Status: ok" "$tmp/o3/review_pr7_fake-a.md" 2>/dev/null \
+  && grep -q "MARKER_LINE two" "$tmp/o3/review_prompt_pr7.md" 2>/dev/null; then
+  ok "PR-Modus: review_pr7_fake-a.md aus origin pull/7/head"
+else
+  bad "PR-Modus: rc=$rc"; echo "$out"
+fi
+run bash "$RUN" 99 --models fake-a:cloud --out-dir "$tmp/o3b"
+if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qi "PR 99" && [ ! -e "$tmp/o3b/review_pr99_fake-a.md" ]; then
+  ok "Unbekannter PR: Exit $rc mit deutscher Meldung, kein Protokoll"
+else
+  bad "Unbekannter PR: rc=$rc"; echo "$out"
+fi
+
+# 5. Ollama nicht erreichbar / ollama.com ohne Key: klare deutsche Meldung.
+run env OLLAMA_HOST=http://127.0.0.1:9 bash "$RUN" --models fake-a:cloud --out-dir "$tmp/o4"
+if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "nicht erreichbar" && ! printf '%s' "$out" | grep -q "Traceback"; then
+  ok "Ollama nicht erreichbar: Exit $rc, 'nicht erreichbar', kein Traceback"
+else
+  bad "Ollama nicht erreichbar: rc=$rc"; echo "$out"
+fi
+run env OLLAMA_HOST=https://ollama.com bash "$RUN" --models fake-a --out-dir "$tmp/o5"
+if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "OLLAMA_API_KEY"; then
+  ok "ollama.com ohne OLLAMA_API_KEY: Exit $rc und Hinweis auf OLLAMA_API_KEY"
+else
+  bad "ollama.com ohne Key: rc=$rc"; echo "$out"
+fi
+
+# 6. Der Key gelangt als Bearer-Kopf zum Server, aber in keine Datei.
+: > "$tmp/requests.log"
+# Der Wert wird zur Laufzeit zusammengesetzt: ein Literal KEY=... im Quelltext
+# meldet der Geheimnis-Scan (gitleaks generic-api-key) zu Recht.
+canary="canary-$(date +%s)-$$"
+run env "OLLAMA_API_KEY=$canary" bash "$RUN" --models fake-a:cloud --out-dir "$tmp/o6"
+if [ "$rc" -eq 0 ] && grep -q "|auth|" "$tmp/requests.log" && ! grep -rq "$canary" "$tmp/o6" \
+  && ! printf '%s' "$out" | grep -q "$canary"; then
+  ok "OLLAMA_API_KEY wird gesendet, steht aber weder im Protokoll noch im Prompt noch in der Ausgabe"
+else
+  bad "Key-Behandlung: rc=$rc"; echo "$out"
+fi
+
+# 7. Keine Aenderung gegen die Basis: kein Review (Exit 2).
+run bash "$RUN" --base HEAD --models fake-a:cloud --out-dir "$tmp/o7"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "keine Aenderungen"; then
+  ok "Leerer Diff: Exit 2, 'keine Aenderungen'"
+else
+  bad "Leerer Diff: rc=$rc"; echo "$out"
+fi
+
+# 8. Ungueltige Aufrufe: mehr als zwei Modelle, unbekannter Weg.
+run bash "$RUN" --models a,b,c --out-dir "$tmp/o8"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "hoechstens zwei"; then
+  ok "Mehr als zwei Modelle: Exit 2"
+else
+  bad "Drei Modelle: rc=$rc"; echo "$out"
+fi
+run bash "$RUN" --via gpt --out-dir "$tmp/o8"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "ollama | kilo"; then
+  ok "Unbekannter Weg --via gpt: Exit 2"
+else
+  bad "--via gpt: rc=$rc"; echo "$out"
+fi
+
+# 9. kilo: Stub im PATH. Nur :free-Modelle; leer/Fehler -> rot; fehlende CLI -> Meldung.
+mkdir -p "$tmp/bin-ok" "$tmp/bin-leer" "$tmp/bin-fail" "$tmp/bin-none"
+cat > "$tmp/bin-ok/kilo" <<'EOF'
+#!/usr/bin/env bash
+# Stub: haelt die Aufrufform fest, damit Aenderungen an run-local.sh auffallen.
+echo "$@" >> "$KILO_STUB_LOG"
+[ "$1" = "run" ] || { echo "stub: erwartet 'run'" >&2; exit 64; }
+echo "Urteil: freigeben (kilo stub)"
+EOF
+cat > "$tmp/bin-leer/kilo" <<'EOF'
+#!/usr/bin/env bash
+echo "> code - stub" >&2
+exit 0
+EOF
+cat > "$tmp/bin-fail/kilo" <<'EOF'
+#!/usr/bin/env bash
+echo "Error: quota exhausted" >&2
+exit 1
+EOF
+chmod +x "$tmp/bin-ok/kilo" "$tmp/bin-leer/kilo" "$tmp/bin-fail/kilo"
+export KILO_STUB_LOG="$tmp/kilo.log"
+: > "$KILO_STUB_LOG"
+
+run env PATH="$tmp/bin-ok:$PATH" bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free,nvidia/nemotron-3-super-120b-a12b:free --out-dir "$tmp/k1"
+if [ "$rc" -eq 0 ] \
+  && grep -q "Status: ok" "$tmp/k1/review_${label}_step-3.7-flash.md" 2>/dev/null \
+  && grep -q "Status: ok" "$tmp/k1/review_${label}_nemotron-3-super-120b-a12b.md" 2>/dev/null \
+  && grep -q "kilo stub" "$tmp/k1/review_${label}_step-3.7-flash.md"; then
+  ok "kilo: zwei :free-Modelle, Exit 0, Protokolle im Transport-Format"
+else
+  bad "kilo ok: rc=$rc"; echo "$out"; ls "$tmp/k1" 2>&1
+fi
+if grep -q -- "-m kilo/stepfun/step-3.7-flash:free" "$KILO_STUB_LOG" && grep -q "^run " "$KILO_STUB_LOG"; then
+  ok "kilo-Aufruf: kilo run -m kilo/<modell>:free"
+else
+  bad "kilo-Aufrufform: $(cat "$KILO_STUB_LOG")"
+fi
+
+run env PATH="$tmp/bin-ok:$PATH" bash "$RUN" --via kilo --models qwen/qwen3.8-27b --out-dir "$tmp/k2"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q ":free" && [ ! -e "$tmp/k2/review_${label}_qwen3.8-27b.md" ]; then
+  ok "kilo: Modell ohne :free wird abgelehnt (Exit 2), es fliesst kein Geld"
+else
+  bad "kilo ohne :free: rc=$rc"; echo "$out"
+fi
+
+run env PATH="$tmp/bin-leer:$PATH" bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k3"
+if [ "$rc" -ne 0 ] && grep -q "Status: failed" "$tmp/k3/review_${label}_step-3.7-flash.md" 2>/dev/null; then
+  ok "kilo leer: Exit $rc, Protokoll 'failed'"
+else
+  bad "kilo leer: rc=$rc"; echo "$out"
+fi
+run env PATH="$tmp/bin-fail:$PATH" bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k4"
+if [ "$rc" -ne 0 ] && grep -q "Status: failed" "$tmp/k4/review_${label}_step-3.7-flash.md" 2>/dev/null \
+  && grep -q "quota exhausted" "$tmp/k4/review_${label}_step-3.7-flash.md"; then
+  ok "kilo Fehler: Exit $rc, Protokoll nennt den Grund"
+else
+  bad "kilo Fehler: rc=$rc"; echo "$out"
+fi
+
+# PATH so bauen, dass kilo sicher fehlt, git/python/bash aber da sind.
+nokilo=""
+IFS=':' read -ra parts <<< "$PATH"
+for p in "${parts[@]}"; do
+  [ -x "$p/kilo" ] || [ -x "$p/kilo.cmd" ] || nokilo="${nokilo:+$nokilo:}$p"
+done
+run env PATH="$nokilo" bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k5"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "kilo" && printf '%s' "$out" | grep -qi "nicht gefunden"; then
+  ok "kilo fehlt: Exit 2 mit deutscher Meldung"
+else
+  bad "kilo fehlt: rc=$rc"; echo "$out"
+fi
+
+# 10. Zeitlimit und Diff-Grenze: beides ist ein Fehler, kein stilles Abschneiden.
+if command -v timeout > /dev/null 2>&1 || command -v gtimeout > /dev/null 2>&1; then
+  mkdir -p "$tmp/bin-slow"
+  printf '#!/usr/bin/env bash
+exec sleep 30
+' > "$tmp/bin-slow/kilo"
+  chmod +x "$tmp/bin-slow/kilo"
+  run env PATH="$tmp/bin-slow:$PATH" REVIEW_KILO_TIMEOUT_S=1 bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k6"
+  if [ "$rc" -ne 0 ] && grep -q "Status: failed" "$tmp/k6/review_${label}_step-3.7-flash.md" 2>/dev/null     && grep -q "no answer within 1 s" "$tmp/k6/review_${label}_step-3.7-flash.md"; then
+    ok "kilo ohne Antwort im Zeitlimit: Exit $rc, Protokoll 'failed' mit Grund"
+  else
+    bad "kilo Zeitlimit: rc=$rc"; echo "$out"
+  fi
+else
+  echo "skip kilo-Zeitlimit: weder timeout noch gtimeout im PATH"
+fi
+run env REVIEW_MAX_DIFF_CHARS=10 bash "$RUN" --models fake-a:cloud --out-dir "$tmp/o9"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "Grenze 10" && [ ! -e "$tmp/o9/review_${label}_fake-a.md" ]   && [ ! -e "$tmp/o9/review_prompt_${label}.md" ]; then
+  ok "Diff ueber REVIEW_MAX_DIFF_CHARS: Exit 2, kein Prompt, kein Protokoll"
+else
+  bad "Diff-Grenze: rc=$rc"; echo "$out"
+fi
+
+# 11. Review kimi-k3 (r2): Namenskollision, Host mit Port, nur Lockfiles, kein
+#     Zeitlimit, kilo ohne Schreibrechte.
+run bash "$RUN" --models llama3:8b,llama3:70b --out-dir "$tmp/o10"
+if [ "$rc" -eq 0 ] && [ -f "$tmp/o10/review_${label}_llama3-8b.md" ] && [ -f "$tmp/o10/review_${label}_llama3-70b.md" ]; then
+  ok "Zwei Tags desselben Modells ueberschreiben sich nicht (llama3-8b, llama3-70b)"
+else
+  bad "Tags eines Modells: rc=$rc"; echo "$out"; ls "$tmp/o10" 2>&1
+fi
+run bash "$RUN" --models fake-a:cloud,fake-a:cloud --out-dir "$tmp/o11"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "doppelt"; then
+  ok "Dasselbe Modell zweimal: Exit 2 (kein Dual-Review)"
+else
+  bad "Doppeltes Modell: rc=$rc"; echo "$out"
+fi
+run env OLLAMA_HOST=https://ollama.com:443 bash "$RUN" --models fake-a --out-dir "$tmp/o12"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "OLLAMA_API_KEY"; then
+  ok "ollama.com mit Port ohne Key: Hinweis auf OLLAMA_API_KEY statt 'nicht erreichbar'"
+else
+  bad "ollama.com:443 ohne Key: rc=$rc"; echo "$out"
+fi
+(
+  cd "$REPO" || exit 1
+  git checkout -q -b claude/only-lock main
+  echo '{}' > package-lock.json
+  git add package-lock.json && git commit -q -m lock
+)
+run bash "$RUN" --models fake-a:cloud --out-dir "$tmp/o13"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qi "lockfile" && ! printf '%s' "$out" | grep -q "keine Aenderungen"; then
+  ok "Nur Lockfiles geaendert: Exit 2 mit ehrlicher Meldung (nicht 'keine Aenderungen')"
+else
+  bad "Nur Lockfiles: rc=$rc"; echo "$out"
+fi
+git -C "$REPO" checkout -q claude/demo-branch
+: > "$KILO_STUB_LOG"
+run env PATH="$tmp/bin-ok:$PATH" REVIEW_KILO_TIMEOUT_S=0 bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k7"
+if [ "$rc" -eq 0 ] && grep -q "Status: ok" "$tmp/k7/review_${label}_step-3.7-flash.md" 2>/dev/null   && ! printf '%s' "$out" | grep -qi "unbound"; then
+  ok "kilo ohne Zeitlimit (REVIEW_KILO_TIMEOUT_S=0): Exit 0, kein Abbruch durch leeres Array"
+else
+  bad "kilo ohne Zeitlimit: rc=$rc"; echo "$out"
+fi
+if grep -q -- "--agent ask" "$KILO_STUB_LOG"; then
+  ok "kilo laeuft mit --agent ask (kein Schreiben, keine Auto-Freigaben)"
+else
+  bad "kilo ohne --agent ask: $(cat "$KILO_STUB_LOG")"
+fi
+
+echo
+if [ "$fails" -eq 0 ]; then
+  echo "test-review-local: alles gruen."
+  exit 0
+fi
+echo "test-review-local: $fails Fehler."
+exit 1
```

## Output format

Findings, one per block: ID (F1, F2, ...), severity (high/medium/low),
file:line, reason. End with a verdict line: approve / approve with
conditions / reject.
