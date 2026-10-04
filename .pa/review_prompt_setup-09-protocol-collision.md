# Review request setup-09-protocol-collision: branch officer/setup-09-protocol-collision against origin/main

You are an independent reviewer (not the author).
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

1cbe02b fix(setup-09): refuse two models that would share one protocol file
ae5a66b test(setup-09): red test for two reviewers sharing one protocol file

## Changed files

 docs/setup/ollama-reviewers.md | 11 +++++++--
 scripts/review/run-local.sh    | 54 +++++++++++++++++++++++++++++++++++-------
 scripts/test-review-local.sh   | 30 +++++++++++++++++++++++
 3 files changed, 84 insertions(+), 11 deletions(-)

## Diff (three-dot diff against origin/main with 10 lines of context; lockfiles omitted)

```diff
diff --git a/docs/setup/ollama-reviewers.md b/docs/setup/ollama-reviewers.md
index 7cf64d2..28219c5 100644
--- a/docs/setup/ollama-reviewers.md
+++ b/docs/setup/ollama-reviewers.md
@@ -79,22 +79,29 @@ bash scripts/review/run-local.sh --dry-run           # nur den Prompt bauen, nic
   bekommt den Prompt als Anhang; Zeitlimit `REVIEW_KILO_TIMEOUT_S`
   (Standard 900 s, 0 = keins). Der Diff ist Eingabe eines Agenten mit
   Lesewerkzeugen: PRs unbekannter Herkunft nicht ueber `--via kilo` pruefen,
   dort ist der Ollama-Weg (reine Textanfrage, keine Werkzeuge) der sichere.
 - Ergebnis: `.pa/review_prompt_<label>.md` und `.pa/review_<label>_<modell>.md`,
   `<label>` = `pr<N>` oder der Branchname (`/` wird `-`). Mit `--out-dir` und
   `--label` umlenkbar.
 - Exit 0 nur, wenn jeder Reviewer Text geliefert hat; Exit 1 bei leerer oder
   fehlerhafter Antwort (Protokoll `Status: failed`, nochmals laufen lassen);
   Exit 2 bei Aufruf- oder Voraussetzungsfehlern (fehlendes Ollama, kilo oder
-  Key, unbekannter PR, kein Diff, Diff ueber `REVIEW_MAX_DIFF_CHARS`).
-  Ein abgeschnittener Diff waere kein Review; deshalb wird nichts gekuerzt.
+  Key, unbekannter PR, kein Diff, Diff ueber `REVIEW_MAX_DIFF_CHARS`, zwei
+  Modelle mit demselben Protokollnamen). Ein abgeschnittener Diff waere kein
+  Review; deshalb wird nichts gekuerzt.
+- Der Protokollname kommt aus dem Modell: `:cloud` faellt weg, jeder andere Tag
+  wird zum Bindestrich (`llama3:8b` → `llama3-8b`), kilo nimmt nur das letzte
+  Pfadelement ohne `:free`. Zwei Modelle, die daraus denselben Namen machen,
+  lehnt das Skript ab (`llama3:8b` neben `llama3-8b`, `a/x:free` neben
+  `b/x:free`): sie wuerden einander das Protokoll ueberschreiben, und der Lauf
+  meldete trotzdem zweimal „ok“ — ein Dual-Review, den es als Datei nicht gibt.
 - Geprueft werden nur **committete** Aenderungen. Der Diff geht an den
   gewaehlten Dienst: nichts Vertrauliches im Branch.
 - Selbsttest ohne Netz: `bash scripts/test-review-local.sh` (Fake-Ollama,
   kilo-Stub, Wegwerf-Repo).
 
 ## Disposition
 
 Jeder Befund bekommt eine Zeile in `.pa/review_<label>_disposition.md`:
 ID, Quelle, Schwere, Befund, Disposition (angenommen mit Commit / abgelehnt mit
 Grund / Folgearbeit). Vorlage: `.pa/review_w2-02_disposition.md`. Ändert sich
diff --git a/scripts/review/run-local.sh b/scripts/review/run-local.sh
index b3fe201..a2be502 100755
--- a/scripts/review/run-local.sh
+++ b/scripts/review/run-local.sh
@@ -7,20 +7,23 @@
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
+#                 Zwei Modelle mit demselben Protokollnamen (llama3:8b und
+#                 llama3-8b) werden abgelehnt: sie wuerden einander das
+#                 Protokoll wegschreiben und der Lauf meldete trotzdem Erfolg.
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
@@ -141,20 +144,55 @@ if [ "$via" = kilo ]; then
   for i in "${!models[@]}"; do
     m="${models[$i]#kilo/}"
     case "$m" in
       *:free) ;;
       *) die 2 "kilo-Modell '$m' ist kein :free-Modell. Nur kostenlose Modelle sind erlaubt (kilo models kilo | grep ':free')." ;;
     esac
     models[i]="$m"
   done
 fi
 
+# Protokollname je Modell - genau das, was in <out-dir>/review_<label>_<name>.md
+# landet. Ollama: ":cloud" faellt weg, jeder andere Tag wird zum Bindestrich
+# (kimi-k3:cloud -> kimi-k3, llama3:8b -> llama3-8b); kilo nimmt nur das letzte
+# Pfadelement ohne ":free". Alles andere wird zu '-' - dieselbe Form, die
+# slug() im Transport anwendet, damit der Name hier der Dateiname ist.
+proto_name() { # modell
+  local n="$1"
+  if [ "$via" = kilo ]; then
+    n="${n##*/}"
+    n="${n%:free}"
+  else
+    n="${n%:cloud}"
+  fi
+  printf '%s' "${n//:/-}" | tr -c 'A-Za-z0-9._-' '-'
+}
+
+# Zwei Modelle mit demselben Protokollnamen schrieben in dieselbe Datei: das
+# zweite Urteil ueberschrieb das erste, und der Lauf meldete trotzdem zweimal
+# "ok" mit Exit 0. Das widerspricht der Zusage dieses Skripts ("Exit 0 nur,
+# wenn JEDER Reviewer einen Text geliefert hat") und behauptet ein
+# Dual-Review, den es als Protokoll nicht gibt. Lieber zwei Laeufe als eine
+# Datei, in der ein Befund fehlt.
+proto_names=()
+for m in "${models[@]}"; do
+  proto_names+=("$(proto_name "$m")")
+done
+for i in "${!proto_names[@]}"; do
+  j=$((i + 1))
+  while [ "$j" -lt "${#proto_names[@]}" ]; do
+    [ "${proto_names[$i]}" != "${proto_names[$j]}" ] \
+      || die 2 "die Modelle '${models[$i]}' und '${models[$j]}' schreiben in dieselbe Protokolldatei (review_<label>_${proto_names[$i]}.md) - ein Urteil ginge verloren. Modelle mit eindeutigem Namen waehlen (--models) oder je Lauf ein Modell reviewen."
+    j=$((j + 1))
+  done
+done
+
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
@@ -303,27 +341,25 @@ if [ "$dry_run" -eq 1 ]; then
   echo "Trockenlauf: nichts wurde gesendet."
   exit 0
 fi
 
 # --- Versand ---------------------------------------------------------------
 if [ "$via" = ollama ]; then
   for n in 1 2 3 4 5 6 7 8 9; do
     unset "REVIEWER_${n}_NAME" "REVIEWER_${n}_KIND" "REVIEWER_${n}_URL" "REVIEWER_${n}_MODEL" "REVIEWER_${n}_KEY"
   done
   n=0
-  for m in "${models[@]}"; do
+  for i in "${!models[@]}"; do
     n=$((n + 1))
-    # Name fuer die Protokolldatei: ":cloud" faellt weg (kimi-k3), jeder andere
-    # Tag bleibt (llama3:8b -> llama3-8b), damit zwei Tags nicht kollidieren.
-    rname="${m%:cloud}"
-    export "REVIEWER_${n}_NAME=${rname//:/-}" "REVIEWER_${n}_KIND=ollama" \
-      "REVIEWER_${n}_URL=$ollama_host/api/generate" "REVIEWER_${n}_MODEL=$m"
+    # Der Name ist der Protokolldateiname (s.o.) und damit eindeutig geprueft.
+    export "REVIEWER_${n}_NAME=${proto_names[$i]}" "REVIEWER_${n}_KIND=ollama" \
+      "REVIEWER_${n}_URL=$ollama_host/api/generate" "REVIEWER_${n}_MODEL=${models[$i]}"
     if [ -n "${OLLAMA_API_KEY:-}" ]; then
       export "REVIEWER_${n}_KEY=$OLLAMA_API_KEY"
     fi
   done
   "$PY" "$TRANSPORT" "$prompt_file" "$out_dir" "$label" --author "$author"
   exit $?
 fi
 
 # kilo: ein Lauf je Modell, in einem leeren Wegwerfverzeichnis, damit der
 # Agent der CLI nichts im Repo anfassen kann. Das Protokoll hat dasselbe
@@ -350,23 +386,23 @@ fi
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
-for m in "${models[@]}"; do
-  name="${m##*/}"
-  name="${name%:free}"
+for i in "${!models[@]}"; do
+  m="${models[$i]}"
+  name="${proto_names[$i]}"
   path="$out_dir/review_${label}_${name}.md"
   ( cd "$work" && kilo_review "$m" < /dev/null > out.txt 2> err.txt )
   rc=$?
   # ANSI-Farben und Wagenruecklaeufe der Windows-Konsole entfernen.
   verdict="$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//' "$work/out.txt" 2> /dev/null)"
   errtext="$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//' "$work/err.txt" 2> /dev/null | tail -n 15)"
   if [ "$rc" -eq 124 ]; then
     status=failed
     body="Reviewer failure: no answer within $timeout_s s (kilo timeout).
 
diff --git a/scripts/test-review-local.sh b/scripts/test-review-local.sh
index 081530a..2ad8fe6 100755
--- a/scripts/test-review-local.sh
+++ b/scripts/test-review-local.sh
@@ -374,17 +374,47 @@ fi
 
 # 12. Standard-Ausgabeverzeichnis: relative Pfade. Protokolle landen im Repo und
 #     dort darf kein absoluter Arbeitsbaum-Pfad (Nutzername!) stehen.
 run bash "$RUN" --models fake-a:cloud
 if [ "$rc" -eq 0 ] && [ -f "$REPO/.pa/review_${label}_fake-a.md" ]   && grep -q "^- Prompt: .pa/review_prompt_${label}.md " "$REPO/.pa/review_${label}_fake-a.md"   && ! grep -rqF "$(basename "$tmp")" "$REPO/.pa" && ! printf '%s' "$out" | grep -qF "$(basename "$tmp")"; then
   ok "Standard-Ausgabe .pa/: relative Pfade in Protokoll und Konsole, kein absoluter Pfad"
 else
   bad "Standardverzeichnis: rc=$rc"; echo "$out"; cat "$REPO/.pa/review_${label}_fake-a.md" 2>&1 | head -12
 fi
 
+# 13. Protokolldatei je Reviewer. Der Name entsteht aus dem Modell
+#     ("llama3:8b" -> llama3-8b, kilo: nur das letzte Pfadelement). Zwei Modelle
+#     mit demselben Namen schreiben in dieselbe Datei: das zweite Urteil
+#     ueberschreibt das erste, der Lauf meldet trotzdem "beide ok". Das ist
+#     eine falsche Zusage ("jeder Reviewer hat geliefert") und wird abgelehnt,
+#     bevor etwas gesendet wird.
+run bash "$RUN" --models llama3:8b,llama3-8b --out-dir "$tmp/o14"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "Protokolldatei" \
+  && [ ! -e "$tmp/o14/review_${label}_llama3-8b.md" ] && [ ! -e "$tmp/o14/review_prompt_${label}.md" ]; then
+  ok "Ollama: llama3:8b und llama3-8b teilen sich den Protokollnamen - Exit 2, kein Prompt, kein Protokoll"
+else
+  bad "Ollama-Protokollname kollidiert: rc=$rc"; echo "$out"; ls "$tmp/o14" 2>&1
+fi
+# Der gepruefte Name muss der Dateiname sein, den der Transport schreibt:
+# ein Anbieterpraefix wird zum Bindestrich, zwei solche Namen bleiben getrennt.
+run bash "$RUN" --models library/llama3:8b,other/llama3:8b --out-dir "$tmp/o15"
+if [ "$rc" -eq 0 ] && [ -f "$tmp/o15/review_${label}_library-llama3-8b.md" ]   && [ -f "$tmp/o15/review_${label}_other-llama3-8b.md" ]; then
+  ok "Ollama mit Anbieterpraefix: zwei Protokolle (library-llama3-8b, other-llama3-8b)"
+else
+  bad "Ollama-Anbieterpraefix: rc=$rc"; echo "$out"; ls "$tmp/o15" 2>&1
+fi
+: > "$KILO_STUB_LOG"
+run env PATH="$tmp/bin-ok:$PATH" bash "$RUN" --via kilo --models a/step-3.7-flash:free,b/step-3.7-flash:free --out-dir "$tmp/k8"
+if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "Protokolldatei" \
+  && [ ! -s "$KILO_STUB_LOG" ] && [ ! -e "$tmp/k8/review_${label}_step-3.7-flash.md" ]; then
+  ok "kilo: zwei Anbieter, gleicher Modellname - Exit 2, kilo nie aufgerufen, kein Protokoll"
+else
+  bad "kilo-Protokollname kollidiert: rc=$rc"; echo "$out"; ls "$tmp/k8" 2>&1
+fi
+
 echo
 if [ "$fails" -eq 0 ]; then
   echo "test-review-local: alles gruen."
   exit 0
 fi
 echo "test-review-local: $fails Fehler."
 exit 1
```

## Output format

Findings, one per block: ID (F1, F2, ...), severity (high/medium/low),
file:line, reason. End with a verdict line: approve / approve with
conditions / reject.
