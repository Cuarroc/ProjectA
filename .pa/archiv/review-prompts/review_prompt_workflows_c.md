# Dual-Review vor dem Merge: PR #39 (CI-Umbau) in ProjectA — Teil C von 3

**Teil C: red-first, der Review-Transport und der Browser-Smoke.**

Der Diff ist auf drei Auftraege aufgeteilt, weil ein Lauf am 09.09. an der
Prompt-Groesse gescheitert sein koennte (unbelegt, siehe unten). Du bekommst
alle drei Teile nacheinander; urteile in JEDEM Teil nur ueber den Diff, der
dir darin gezeigt wird, und sage im Abschnitt "NICHT PRUEFBAR OHNE REPO",
wenn dir fuer einen Befund ein anderer Teil fehlt.

Du bist einer von drei unabhaengigen externen Reviewern (keiner von euch ist ein
Anthropic-Modell). Ihr seht denselben Text, aber ihr arbeitet **nicht** zusammen.

## Worum es geht

ProjectA ist eine Tauri-2-Desktop-App ("agentischer Terminal"): Rust-Kern
(~56.000 Zeilen, 41 Module, **kein `lib.rs`** — alle Tests liegen inline im
`mod tests` ihres Moduls), React/TypeScript-Frontend, Windows-first, Linux als
Zweitplattform. Gebaut wird sie von einer Flotte von KI-Instanzen (Claude,
Codex, Kimi, OpenCode), die parallel am selben Repo arbeiten.

Der folgende Diff soll **nach `main` gemergt werden**. `AGENTS.md`
("Dual-Review-Regel") verlangt fuer Diffs ueber 300 Zeilen ein Review durch zwei
andere KIs vor dem Merge. Das bist du. Der Autor ist Claude Opus 5; ein erster
Advisor (Fable 5.1) hat vorab beraten, seine Befunde stecken bereits im Diff.

**Deine Aufgabe ist nicht, den Diff zu loben. Deine Aufgabe ist, Gruende zu
finden, ihn NICHT zu mergen.**

## Hausregeln, gegen die du pruefen sollst

Diese Regeln stehen in `AGENTS.md` und sind hier Pruefmassstab, nicht Deko:

1. **"Gruen durch Abwesenheit" ist verboten.** Ein Gate, das durchlaeuft, weil es
   nichts findet oder nichts ausfuehrt, ist schlimmer als keins.
2. **"Eine Pruefung, die nicht scheitern kann, prueft nichts."** Jedes Gate
   braucht einen Selbsttest, der es einmal absichtlich scheitern laesst.
3. **Exit-Codes duerfen nie maskiert werden.** GitHub startet `run:` ohne
   `pipefail`; der Status einer Pipe ist der ihres letzten Glieds.
4. **Keine Retries.** "Ein Test, der beim zweiten Versuch gruen wird, ist kaputt
   und nicht gruen."
5. **Bug -> Regel:** jeder Fix prueft, ob die Fehlerklasse per Lint/Gate/Hook
   verhinderbar gewesen waere.

## Was der Autor behauptet

1. **Die Gate-Liste stand fuenffach da und driftete.** In `.githooks/pre-commit`,
   `.githooks/pre-push`, `ci.yml`, `release.yml` und als Prosa in `AGENTS.md`.
   `pre-push` fuhr `cargo test`, CI `cargo nextest run --profile ci` — geteilter
   Prozess statt Prozess pro Test, keine Retry-Sperre, kein slow-timeout. Jetzt
   haelt `scripts/ci/gates.sh` die Liste einmal; alle Aufrufer starten eine
   **Bahn** daraus. Ein Workflow-Schritt je Bahn, also keine Liste mehr im YAML.
2. **Zwei Gates liefen nirgends:** `npm run test:hq` (12 `node:test`-Dateien) und
   die Selbsttests der Workflow-Gates — auf die sich der Kommentar in `ci.yml`
   zur Begruendung berief, ohne sie je auszufuehren.
3. **`release.yml` war die schwaechste Gate-Liste im Repo** — der Workflow, der
   die signierten Installer baut: kein `lint`, kein `test:e2e`, kein
   `no-masked-output`, `cargo test` statt nextest. Faehrt jetzt dieselbe Bahn.
4. **`red-first` haette luegen koennen.** Der Job baut Merge-Base und Kopf als
   getrennte Worktrees. Ein Optimierungsversuch setzte ein GETEILTES
   `CARGO_TARGET_DIR`; beim Wurzelpaket geht der Paketpfad nicht in cargos
   `-C metadata`-Hash ein, also bekamen beide Baeume denselben Artefaktnamen.
   Gemessen: der Kopf-Lauf meldete `Finished in 0.02s` und fuehrte das Binary der
   Merge-Base aus (Backtrace auf `.../base/src-tauri/src/main.rs`) — der Test war
   "am Kopf rot", obwohl der Code gruen ist. `red-first.sh` setzt das Verzeichnis
   jetzt je Baum selbst und **ueberschreibt einen von aussen gesetzten Wert**.
5. **`test:hq` machte den Arbeitsbaum dreckig.** Zwei Tests starten `hq-live.mjs`
   mit dem Repo als cwd; der Server regenerierte beim Start
   `docs/dev-hq/data.{js,json}` im echten Baum. Behoben ueber `HQ_SKIP_SNAPSHOT`,
   dazu ein Waechter in `gates.sh`, der die Bahn rot faerbt, wenn ein Gate eine
   getrackte Datei anfasst.
6. **`defaults: run: shell: bash`** in allen fuenf Workflows (erzwingt pipefail),
   **25 Actions auf Commit-SHA gepinnt** (`dtolnay/rust-toolchain@stable` war ein
   BRANCH, `taiki-e/install-action@nextest` ein wandernder Tag), **`retries: 0`**
   im Browser-Smoke, **`environment: release`**, eine **Composite Action** gegen
   die doppelte Bootstrap-Kopie, und **`red-first.sh --plan`** (erst nachsehen,
   dann Toolchain installieren).

7. **Nach dem Merge von `main` (21.09., 187 Commits):** zwei Semantik-Konflikte,
   die git nicht sehen konnte, sind im Merge-Commit mit behoben.
   (a) `main` legte am 12.09. den Schritt `Gate - native
   Parent-Host-Prozessgrenze` als **PowerShell** in den Windows-Job. Dieser
   Branch zwingt seit dem 09.09. jeden `run:`-Schritt per
   `defaults: run: shell: bash` auf bash — auch auf `windows-latest`. Der
   Schritt traegt jetzt `shell: pwsh`, und `workflow-shell.sh` erkennt die
   Klasse (PowerShell-Marker in einem run-Schritt ohne eigenes `shell:`).
   (b) `npm run test:hq:visual` (ebenfalls neu von `main`) startete hq-live
   ohne `HQ_SKIP_SNAPSHOT` und schrieb `docs/dev-hq/data.{js,json}` im echten
   Baum neu — gefunden vom Arbeitsbaum-Waechter, als das Gate zum ersten Mal
   in einer Bahn lief.
8. **`.pa/review_transport.py`** — das Werkzeug, mit dem DU gerade befragt
   wirst — starb am 09.09. an einer Antwort mit `content: null`
   (`AttributeError`) und schrieb daraufhin fuer KEINEN Reviewer ein
   Protokoll, auch nicht fuer den, der geantwortet hatte. Beim Schreiben des
   Selbsttests kam heraus, dass eine Antwort aus Leerzeichen mit **Exit 0**
   durchlief, also als gueltiges Review galt. Beides behoben, 24 Faelle in
   `scripts/test-review-transport.sh`.

## Worauf du besonders achten sollst

- **`scripts/ci/gates.sh` ist jetzt der Single Point of Failure der gesamten
  Qualitaetssicherung.** Kann er stillschweigend nichts tun? Kann eine Bahn leer
  sein? Wird ein rotes Gate immer nach aussen gemeldet? Was passiert bei einem
  Gate-Befehl mit Sonderzeichen — die Liste wird mit `cut -d'|'` zerlegt und mit
  `eval` ausgefuehrt.
- **Der `--plan`-Kurzschluss in `red-first.sh`.** Er entscheidet, ob das Bootstrap
  laeuft. Gibt es einen Weg, bei dem `count=0` herauskommt, obwohl es etwas zu
  pruefen gaebe? Der Autor behauptet, `fail_source_without_trailer` laufe vorher
  mit — stimmt das fuer JEDEN Pfad?
- **Die getrennten Build-Verzeichnisse.** Ist die Trennung wirklich vollstaendig?
  Gibt es cargo-Aufrufe in `red-first.sh`, die das Verzeichnis NICHT gesetzt
  bekommen?
- **Der Arbeitsbaum-Waechter.** Er vergleicht Mengen vor/nach dem Lauf. Kann er
  falsch-positiv werden (und damit weggeschaltet)? Kann er etwas uebersehen?
- **`workflow-shell.sh` und `actions-pinned.sh`** sind Detektoren, die ihre
  eigene Definition nicht finden duerfen. Halten die Muster?
- **Windows/MSYS.** `gates.sh` und die Hooks laufen unter Git-Bash. Pfade,
  `cygpath`, CRLF, das x-Bit im Index.
- **Sicherheit.** `release.yml` haelt Signing-Key und einen PAT, `review.yml` den
  `OPENROUTER_KEY`. Verschlechtert dieser Diff dort irgendetwas? Ist das
  SHA-Pinning vollstaendig, auch in der neuen Composite Action?
- **Der neue pwsh-Detektor in `workflow-shell.sh`.** Er arbeitet mit Markern
  (`$LASTEXITCODE`, `Write-Host`, `$env:`, ...) und einer Zustandsmaschine in
  awk, die Schritte abgrenzt. Der erste Entwurf schlug an seinem eigenen
  Kommentar an. Welche Falsch-positiven und Falsch-negativen bleiben? Ordnet
  er einen Marker dem richtigen Schritt zu?
- **`review_transport.py`.** Gibt es noch eine Antwortform, bei der ein
  Reviewer stillschweigend als "hat geantwortet" zaehlt? Ist die
  `except`-Liste zu breit (verschluckt sie einen Programmierfehler als
  "Reviewer ausgefallen")?
- **Die Pflichtliste in `scripts/test-gates.sh`.** Sie soll verhindern, dass
  ein Gate bei einer Umstrukturierung still verschwindet. Ist sie vollstaendig?
  Was schuetzt sie NICHT?
- **Was der Autor NICHT geprueft hat:** der Windows-Pfad von `release.yml` (die
  Bahn `release` laeuft dort neu in Git-Bash, mit nextest-Installation,
  Playwright und Browser-Smoke) ist nie gelaufen — Releases haengen an `v*`-Tags.
  Ebenso die Bahn `windows` und der pwsh-Schritt: die Cloud-Sitzung ist Linux.
  `e2e` und `hq-visual` sind dort auf Chromium-Build 1194 belegt, waehrend
  Playwright 1243 verlangt (Download gesperrt).

## Format deiner Antwort

Nummerierte Befunde, jeder mit genau diesen fuenf Zeilen:

```
### R-1 — <Kurztitel>
- Schwere: hoch | mittel | niedrig
- Datei: <pfad:zeile>
- Behauptung: <was ist falsch>
- Beleg: <woertliches Zitat aus dem Diff>
- Vorschlag: <konkrete Aenderung>
```

Danach zwei Abschnitte:

- **MERGE-URTEIL:** genau eine Zeile — `mergen`, `mergen nach Fix von R-x, R-y`
  oder `nicht mergen`, mit einem Satz Begruendung.
- **NICHT PRUEFBAR OHNE REPO:** was du nur mit dem vollstaendigen Repo
  entscheiden koenntest. Rate nicht.

Erfinde nichts. Ein Befund, den du nicht am Diff belegen kannst, ist keiner.

---

## Der Diff

Gegen die Merge-Base auf `main`. `.pa/`-Protokolle und Journal-Dateien sind
weggelassen — sie sind Artefakte, kein Prozesscode.



## Fokus dieses Teils

Der `--plan`-Kurzschluss entscheidet, ob das Bootstrap laeuft: gibt es einen Weg zu `count=0`, obwohl es etwas zu pruefen gaebe? Die getrennten Build-Verzeichnisse: gibt es cargo-Aufrufe, die das Verzeichnis NICHT gesetzt bekommen? Und `review_transport.py` ist das Werkzeug, mit dem du gerade befragt wirst — gibt es noch eine Antwortform, bei der ein Reviewer stillschweigend als "hat geantwortet" zaehlt? Ist die `except`-Liste zu breit und verschluckt einen Programmierfehler als "Reviewer ausgefallen"?


```diff
diff --git a/.pa/review_transport.py b/.pa/review_transport.py
index b47f24d..4190786 100644
--- a/.pa/review_transport.py
+++ b/.pa/review_transport.py
@@ -30,6 +30,36 @@ import urllib.request
 from datetime import datetime, timezone
 
 
+class ReviewerError(RuntimeError):
+    """Der Reviewer hat nicht geantwortet — Transport ok, Inhalt fehlt.
+
+    Anlass: Lauf 34388829328 vom 09.09. Reviewer 1 lieferte
+    `choices[0].message.content = null`; `text.strip()` warf einen
+    AttributeError, das Skript starb mitten in der Schleife und schrieb fuer
+    KEINEN Reviewer ein Protokoll — auch nicht fuer den, der geantwortet
+    hatte. Nach aussen sah das aus wie ein kaputtes Skript, nicht wie ein
+    ausgefallener Reviewer, und genau das versprach die Kopfzeile:
+    "Exit 0 nur, wenn JEDER konfigurierte Reviewer geantwortet hat".
+    Ein Ausfall ist ein Befund und muss als Befund im Protokoll landen.
+    """
+
+
+def antwort(text, served, model):
+    """Nimmt die Antwort nur an, wenn wirklich Text da ist.
+
+    None, ein Nicht-String und eine leere Antwort sind dasselbe Ergebnis:
+    kein Urteil. Ein Protokoll mit leerem Urteil waere "gruen durch
+    Abwesenheit" (AGENTS.md).
+    """
+    if text is None:
+        raise ReviewerError("Antwort ohne Inhalt (content = null) — Modell hat nichts geliefert")
+    if not isinstance(text, str):
+        raise ReviewerError(f"Antwort ist kein Text, sondern {type(text).__name__}")
+    if not text.strip():
+        raise ReviewerError("Antwort ist leer")
+    return text, served or model
+
+
 def post(url, payload, headers, timeout):
     req = urllib.request.Request(
         url, data=json.dumps(payload).encode("utf-8"),
@@ -43,15 +73,15 @@ def call(kind, url, model, key, prompt, timeout=1800):
     if kind == "openai":
         headers = {"Authorization": f"Bearer {key}"} if key else {}
         out = post(url, {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False}, headers, timeout)
-        return out["choices"][0]["message"]["content"], out.get("model", model)
+        return antwort(out["choices"][0]["message"]["content"], out.get("model"), model)
     if kind == "ollama":
         out = post(url, {"model": model, "prompt": prompt, "stream": False}, {}, timeout)
-        return out["response"], out.get("model", model)
+        return antwort(out["response"], out.get("model"), model)
     if kind == "gemini":
         full = f"{url.rstrip('/')}/v1beta/models/{model}:generateContent"
         headers = {"x-goog-api-key": key} if key else {}
         out = post(full, {"contents": [{"parts": [{"text": prompt}]}]}, headers, timeout)
-        return out["candidates"][0]["content"]["parts"][0]["text"], out.get("modelVersion", model)
+        return antwort(out["candidates"][0]["content"]["parts"][0]["text"], out.get("modelVersion"), model)
     raise SystemExit(f"unbekannter Reviewer-Typ: {kind}")
 
 
@@ -86,8 +116,15 @@ def main(argv):
         try:
             text, served = call(r["kind"], r["url"], r["model"], r["key"], prompt)
             status = "ok"
-        except (urllib.error.URLError, urllib.error.HTTPError, KeyError, TimeoutError) as e:
-            text, served, status = f"FEHLER: {e}", r["model"], "failed"
+        # Die Liste ist absichtlich breit: jede Art, wie ein Reviewer NICHT
+        # antwortet, muss hier als Befund enden und nicht als Traceback. Ein
+        # Absturz in der Schleife kostet auch die Protokolle der Reviewer, die
+        # geantwortet haben. IndexError/TypeError/ValueError decken die
+        # Antwortformen ab, die zwar JSON sind, aber nicht die erwartete Form
+        # haben ({"choices": []}, message = null, HTML statt JSON).
+        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError,
+                ReviewerError, KeyError, IndexError, TypeError, ValueError) as e:
+            text, served, status = f"FEHLER: {type(e).__name__}: {e}", r["model"], "failed"
             failed += 1
         head = (
             f"# Review: {label} — {r['name']}\n\n"
diff --git a/playwright.config.ts b/playwright.config.ts
index afc9a6a..db88908 100644
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -3,7 +3,13 @@ import { defineConfig, devices } from "@playwright/test";
 export default defineConfig({
   testDir: "./e2e",
   fullyParallel: false,
-  retries: process.env.CI ? 1 : 0,
+  // G-2 (src-tauri/.config/nextest.toml): ein Test, der beim zweiten
+  // Versuch gruen wird, ist kaputt und nicht gruen. Das galt bis zum
+  // 09.09. nur fuer die Rust-Suite; unter CI bekam der Browser-Smoke
+  // genau den zweiten Versuch, den die Regel verbietet — und der lokale
+  // Lauf war damit strenger als CI. Stabilitaet belegt scripts/flake.sh,
+  // nicht eine stille Wiederholung. Beleg: src/e2e-retries.test.ts
+  retries: 0,
   reporter: process.env.CI ? "github" : "list",
   use: {
     baseURL: "http://127.0.0.1:1420",
diff --git a/scripts/ci/red-first.sh b/scripts/ci/red-first.sh
index b5a413d..3647cdf 100755
--- a/scripts/ci/red-first.sh
+++ b/scripts/ci/red-first.sh
@@ -7,10 +7,68 @@
 #   PR_BODY   optional, zusaetzliche Trailer aus dem PR-Text
 set -euo pipefail
 
+# --plan: nur ermitteln, OB es etwas zu tun gibt, ohne einen einzigen Build.
+#
+# Der Job installierte bisher ~4 min Toolchain (apt, npm ci, Playwright,
+# Rust), bevor das Skript ueberhaupt nachsah — und bei den meisten PRs
+# (No-Test:, Doku, reine Tests) endet es danach sofort mit "keine Belege".
+# Die Auskunft steht in `git log`, sie kostet Millisekunden.
+#
+# Das ist ausdruecklich KEIN paths-ignore-Verwandter: die Entscheidung
+# trifft das Gate selbst nach Auswertung SEINER Eingaben und protokolliert
+# sie, statt an einer Dateiendungs-Heuristik zu haengen. Und der
+# Trailer-Formcheck laeuft im Plan-Modus mit — sonst waere ein PR ohne
+# Trailer stillschweigend "count=0", also ein Persilschein.
+PLAN_ONLY=0
+if [ "${1:-}" = "--plan" ]; then
+  PLAN_ONLY=1
+  shift
+fi
+
 ROOT="$(git rev-parse --show-toplevel)"
 # shellcheck source=scripts/lib/test-first.sh
 . "$ROOT/scripts/lib/test-first.sh"
 
+# --------------------------------------------------------------------------
+# Build-Verzeichnisse: je Baum eines, an einem STABILEN Pfad.
+#
+# Zwei Dinge stehen hier gegeneinander, und die Reihenfolge ist wichtig.
+#
+# 1. Korrektheit geht vor. Base- und Head-Baum enthalten dasselbe Paket in
+#    derselben Version. Zeigen beide auf DASSELBE target/, erzeugt cargo fuer
+#    beide denselben Artefaktnamen — der Paketpfad geht beim Wurzelpaket nicht
+#    in den `-C metadata`-Hash ein. Am 09.09. hier gemessen: der Kopf-Lauf
+#    meldete "Finished in 0.02s" und fuehrte das Binary der Merge-Base aus,
+#    Backtrace-Zeile `.../base/src-tauri/src/main.rs`. Der Test war am Kopf
+#    "rot", obwohl der Code am Kopf gruen ist.
+#    Ein Gate, das den Baum gegen die Artefakte eines ANDEREN Baums prueft,
+#    belegt nichts — es luegt. Deshalb setzt dieses Skript CARGO_TARGET_DIR je
+#    Baum selbst und ueberschreibt dabei bewusst einen von aussen gesetzten
+#    Wert: sonst koennte eine Umgebungsvariable in der Job-Definition das Gate
+#    unbemerkt aushebeln.
+#
+# 2. Erst danach die Minuten. Die Worktrees liegen unter
+#    $TMPDIR/red-first-$$/ — der Pfad enthaelt die PID und ist bei jedem Lauf
+#    ein anderer, das darin liegende target/ also immer kalt (gemessen: 158s
+#    fuer einen Baum). Die Abhaengigkeiten haengen NICHT am Workspace-Pfad,
+#    nur das Wurzelpaket tut das. Ein stabiler Pfad je Rolle laesst deshalb
+#    die 549 Abhaengigkeiten ueber Laeufe hinweg stehen, ohne die beiden
+#    Baeume je zu vermischen.
+#
+# MSYS/Git-Bash: cargo ist dort ein natives Windows-Programm und versteht
+# `/c/Users/...` nicht — die Umwandlung von POSIX-Pfaden greift bei
+# Umgebungsvariablen nicht zuverlaessig, also hier explizit.
+RF_TARGET_BASE="$ROOT/src-tauri/target-red-first-base"
+RF_TARGET_HEAD="$ROOT/src-tauri/target"
+
+as_native_path() {
+  if command -v cygpath > /dev/null 2>&1; then
+    cygpath -w "$1"
+  else
+    printf '%s' "$1"
+  fi
+}
+
 HEAD_SHA="${HEAD_SHA:-$(git rev-parse HEAD)}"
 BASE_REF="${BASE_SHA:-origin/main}"
 if [ -z "${BASE_SHA:-}" ]; then
@@ -78,6 +136,14 @@ done < <(
 
 fail_source_without_trailer
 
+if [ "$PLAN_ONLY" -eq 1 ]; then
+  # Erst nach fail_source_without_trailer: ein Commit, der Quellcode ohne
+  # Trailer aendert, ist auch im Plan-Modus rot.
+  echo "count=$(( ${#SPECS[@]} + ${#REGRESSION[@]} ))"
+  echo "specs=${#SPECS[@]}"
+  exit 0
+fi
+
 ensure_node_modules() {
   local tree="$1"
   if [ ! -d "$tree/node_modules" ] && [ -f "$tree/package.json" ]; then
@@ -87,12 +153,19 @@ ensure_node_modules() {
 }
 
 run_spec() {
-  local spec="$1" tree="$2"
-  local path name candidate module_filter=0
+  local spec="$1" tree="$2" target="${3:-}"
+  local path name candidate
   local cargo_tests=()
+  # Jeder cargo-Aufruf in diesem Skript baut in das Verzeichnis SEINES Baums.
+  # Ohne das koennte der Kopf die Artefakte der Merge-Base erben (siehe oben).
+  local -a cargo_env=()
+  if [ -n "$target" ]; then
+    cargo_env=(env "CARGO_TARGET_DIR=$(as_native_path "$target")")
+  fi
   if [[ "$spec" =~ ^[a-zA-Z_][a-zA-Z0-9_]*(::[a-zA-Z_][a-zA-Z0-9_]*)+$ ]]; then
-    # A fully qualified Rust test name is also a valid reference. Keep the
-    # exact/unique test discovery below; never accept an empty Cargo filter.
+    # Ein voll qualifizierter Rust-Testname ist ebenfalls eine gueltige
+    # Referenz. Die exakte/eindeutige Testsuche unten bleibt; ein leerer
+    # Cargo-Filter wird nie akzeptiert.
     path="src-tauri/src/main.rs"
     name="$spec"
   elif [[ "$spec" == *::* ]]; then
@@ -140,7 +213,7 @@ run_spec() {
               [ -n "$candidate" ] && cargo_tests+=("$candidate")
             done < <(
               cd "$tree/src-tauri"
-              cargo test -- --list 2>/dev/null |
+              "${cargo_env[@]}" cargo test -- --list 2>/dev/null |
                 awk -v requested="$test_name" '
                   /: test$/ {
                     sub(/: test$/, "")
@@ -163,7 +236,7 @@ run_spec() {
               return 1
             fi
             ran_source_test=1
-            (cd "$tree/src-tauri" && cargo test "${cargo_tests[0]}" -- --exact --nocapture) || return
+            (cd "$tree/src-tauri" && "${cargo_env[@]}" cargo test "${cargo_tests[0]}" -- --exact --nocapture) || return
           done
           if [ "$ran_source_test" -eq 0 ]; then
             echo "red-first: $path plattformbedingt uebersprungen"
@@ -172,15 +245,11 @@ run_spec() {
         fi
       fi
       if [ -n "$name" ]; then
-        if [ "$module_filter" -eq 1 ]; then
-          (cd "$tree/src-tauri" && cargo test "$name" -- --nocapture)
-          return
-        fi
         while IFS= read -r candidate; do
           [ -n "$candidate" ] && cargo_tests+=("$candidate")
         done < <(
           cd "$tree/src-tauri"
-          cargo test -- --list 2>/dev/null |
+          "${cargo_env[@]}" cargo test -- --list 2>/dev/null |
             awk -v requested="$name" '
               /: test$/ {
                 sub(/: test$/, "")
@@ -202,9 +271,9 @@ run_spec() {
           printf '  %s\n' "${cargo_tests[@]}" >&2
           return 1
         fi
-        (cd "$tree/src-tauri" && cargo test "${cargo_tests[0]}" -- --exact --nocapture)
+        (cd "$tree/src-tauri" && "${cargo_env[@]}" cargo test "${cargo_tests[0]}" -- --exact --nocapture)
       else
-        (cd "$tree/src-tauri" && cargo test -- --nocapture)
+        (cd "$tree/src-tauri" && "${cargo_env[@]}" cargo test -- --nocapture)
       fi
       ;;
     e2e/*.spec.ts|e2e/*.spec.tsx|*.e2e.spec.ts|*.e2e.spec.tsx)
@@ -299,7 +368,7 @@ for spec in "${SPECS[@]}"; do
   echo
   echo "=== Test-First an der Merge-Base: $spec ==="
   set +e
-  out="$(run_spec "$spec" "$WORKDIR/base" 2>&1)"
+  out="$(run_spec "$spec" "$WORKDIR/base" "$RF_TARGET_BASE" 2>&1)"
   code=$?
   set -e
   printf '%s\n' "$out"
@@ -317,7 +386,7 @@ for spec in "${SPECS[@]}"; do
   echo
   echo "=== am Kopf: $spec ==="
   set +e
-  out="$(run_spec "$spec" "$HEAD_TREE" 2>&1)"
+  out="$(run_spec "$spec" "$HEAD_TREE" "$RF_TARGET_HEAD" 2>&1)"
   code=$?
   set -e
   printf '%s\n' "$out"
diff --git a/scripts/test-red-first.sh b/scripts/test-red-first.sh
index 0457d0d..81b0844 100755
--- a/scripts/test-red-first.sh
+++ b/scripts/test-red-first.sh
@@ -161,6 +161,72 @@ EOF
   BASE_SHA="$base" HEAD_SHA="$head" PR_BODY="" bash scripts/ci/red-first.sh \
     >"$PROBE/red-first.out" 2>&1
 
+  # --- Regression 09.09.: geteiltes CARGO_TARGET_DIR darf das Gate nicht
+  # --- beluegen ------------------------------------------------------------
+  # Base- und Head-Baum enthalten dasselbe Paket in derselben Version. Zeigen
+  # beide auf DASSELBE target/, vergibt cargo denselben Artefaktnamen (der
+  # Paketpfad geht beim Wurzelpaket nicht in den -C metadata-Hash ein), und
+  # der Kopf-Lauf fuehrt das Binary der Merge-Base aus: "Finished in 0.02s",
+  # Backtrace zeigt auf .../base/src-tauri/src/main.rs. Gemessen genau so, als
+  # ein Optimierungsversuch CARGO_TARGET_DIR global setzte.
+  #
+  # Der Fall ist heimtueckisch, weil er wie ein fachliches Ergebnis aussieht:
+  # der Test ist "am Kopf rot", obwohl der Code am Kopf gruen ist. red-first
+  # setzt das Verzeichnis deshalb je Baum SELBST und ueberschreibt einen von
+  # aussen gesetzten Wert.
+  if ! CARGO_TARGET_DIR="$PROBE/feindliches-target" \
+    BASE_SHA="$base" HEAD_SHA="$head" PR_BODY="" bash scripts/ci/red-first.sh \
+    >"$PROBE/hostile-target.out" 2>&1; then
+    echo "--- Ausgabe ---" >&2
+    sed 's/^/    /' "$PROBE/hostile-target.out" >&2
+    fail "ein von aussen gesetztes CARGO_TARGET_DIR haebelt den Beweis aus (Kopf faelschlich rot)"
+  fi
+  pass "geteiltes CARGO_TARGET_DIR haebelt den Beweis nicht aus"
+
+  # --- --plan: OB es etwas zu tun gibt, ohne einen einzigen Build ----------
+  # Der Plan-Modus steuert in ci.yml, ob ~4 min Toolchain installiert werden.
+  # Er darf deshalb nie "nichts zu tun" sagen, wenn doch etwas zu tun ist —
+  # und vor allem darf ein Commit ohne Trailer nicht als count=0 durchgehen.
+  if ! BASE_SHA="$base" HEAD_SHA="$head" PR_BODY="" \
+    bash scripts/ci/red-first.sh --plan >"$PROBE/plan.out" 2>&1; then
+    sed 's/^/    /' "$PROBE/plan.out" >&2
+    fail "--plan schlug fehl, obwohl Belege vorliegen"
+  fi
+  if ! grep -qE '^count=[1-9]' "$PROBE/plan.out"; then
+    sed 's/^/    /' "$PROBE/plan.out" >&2
+    fail "--plan meldet keine Belege, obwohl zwei Test-First-Trailer vorliegen"
+  fi
+  pass "--plan zaehlt vorhandene Belege"
+
+  # Doku-only: nichts zu tun, und das darf der Job glauben.
+  echo "# nur Doku" > NOTIZ.md
+  git add NOTIZ.md
+  git commit -q -m "docs: nur Doku"
+  doc_head="$(git rev-parse HEAD)"
+  if ! BASE_SHA="$head" HEAD_SHA="$doc_head" PR_BODY="" \
+    bash scripts/ci/red-first.sh --plan >"$PROBE/plan-doku.out" 2>&1; then
+    sed 's/^/    /' "$PROBE/plan-doku.out" >&2
+    fail "--plan schlug bei einem Doku-only-Bereich fehl"
+  fi
+  grep -qx 'count=0' "$PROBE/plan-doku.out" ||
+    fail "--plan meldet bei Doku-only nicht count=0"
+  pass "--plan meldet count=0 fuer Doku-only"
+
+  # Der gefaehrliche Fall: Quellcode ohne Trailer. Waere das count=0, wuerde
+  # ci.yml die Installation ueberspringen UND der Job gruen enden — ein
+  # Persilschein fuer genau den Commit, den das Gate fangen soll.
+  echo "export const smuggled = 1;" > src/smuggled.ts
+  git add src/smuggled.ts
+  git -c core.hooksPath=/dev/null commit -q -m "feat: ohne Trailer eingeschmuggelt"
+  smuggled_head="$(git rev-parse HEAD)"
+  if BASE_SHA="$doc_head" HEAD_SHA="$smuggled_head" PR_BODY="" \
+    bash scripts/ci/red-first.sh --plan >"$PROBE/plan-ohne-trailer.out" 2>&1; then
+    sed 's/^/    /' "$PROBE/plan-ohne-trailer.out" >&2
+    fail "--plan laesst Quellcode ohne Trailer als count=0 durch"
+  fi
+  pass "--plan lehnt Quellcode ohne Trailer ab (kein stilles count=0)"
+  git reset -q --hard "$head"
+
   echo "export const behavior = 'still-new';" > src/behavior.ts
   git add src/behavior.ts
   git commit -q -m "feat: falscher Test-First-Beleg" -m "Test-First: scripts/test-behavior.sh"
diff --git a/scripts/test-review-transport.sh b/scripts/test-review-transport.sh
new file mode 100755
index 0000000..8cb0aea
--- /dev/null
+++ b/scripts/test-review-transport.sh
@@ -0,0 +1,145 @@
+#!/usr/bin/env bash
+# Selbsttest fuer .pa/review_transport.py.
+#
+# Anlass: Lauf 34388829328 (09.09.). Reviewer 1 lieferte
+# `choices[0].message.content = null`; `text.strip()` warf einen
+# AttributeError, das Skript starb mitten in der Schleife und schrieb fuer
+# KEINEN Reviewer ein Protokoll — auch nicht fuer den, der geantwortet hatte.
+# Die Kopfzeile des Skripts verspricht aber: "Exit 0 nur, wenn JEDER
+# konfigurierte Reviewer geantwortet hat". Ein Ausfall ist ein Befund und
+# gehoert ins Protokoll, nicht in einen Traceback.
+#
+# Geprueft wird gegen einen lokalen HTTP-Server, der genau die Antwortformen
+# liefert, an denen das Skript gestorben ist. Kein Netz, kein Secret, keine
+# Modellminute.
+set -uo pipefail
+ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
+cd "$ROOT" || exit 1
+tmp="$(mktemp -d)"
+srv_pid=""
+trap 'if [ -n "$srv_pid" ]; then kill "$srv_pid" 2>/dev/null; fi; rm -rf "$tmp"' EXIT
+fails=0
+
+ok()  { echo "ok   $*"; }
+bad() { echo "FEHLER $*"; fails=$((fails + 1)); }
+
+# Ein Server, ein Pfad je Krankheitsbild.
+cat > "$tmp/server.py" <<'PYEOF'
+import json, sys
+from http.server import BaseHTTPRequestHandler, HTTPServer
+
+ANTWORTEN = {
+    "/null":   {"choices": [{"message": {"content": None}}], "model": "m-null"},
+    "/leer":   {"choices": [{"message": {"content": "   "}}], "model": "m-leer"},
+    "/zahl":   {"choices": [{"message": {"content": 42}}], "model": "m-zahl"},
+    "/keine":  {"choices": [], "model": "m-keine"},
+    "/fehler": {"error": {"message": "context length exceeded"}},
+    "/gut":    {"choices": [{"message": {"content": "ANNEHMEN: alles gut."}}], "model": "m-gut"},
+}
+
+class H(BaseHTTPRequestHandler):
+    def do_POST(self):
+        self.rfile.read(int(self.headers.get("Content-Length", 0)))
+        if self.path == "/html":            # JSON erwartet, HTML bekommen
+            body = b"<html>502 Bad Gateway</html>"
+        else:
+            body = json.dumps(ANTWORTEN.get(self.path, {})).encode()
+        self.send_response(200)
+        self.send_header("Content-Type", "application/json")
+        self.send_header("Content-Length", str(len(body)))
+        self.end_headers()
+        self.wfile.write(body)
+    def log_message(self, *a):
+        pass
+
+s = HTTPServer(("127.0.0.1", 0), H)
+print(s.server_port, flush=True)
+s.serve_forever()
+PYEOF
+
+python3 "$tmp/server.py" > "$tmp/port" 2>"$tmp/server.err" &
+srv_pid=$!
+port=""
+for _ in $(seq 1 50); do
+  port="$(cat "$tmp/port" 2>/dev/null)"
+  [ -n "$port" ] && break
+  sleep 0.1
+done
+if [ -z "$port" ]; then
+  echo "FEHLER: Testserver kam nicht hoch"; sed 's/^/    /' "$tmp/server.err"; exit 1
+fi
+echo "# Testserver auf 127.0.0.1:$port"
+
+echo "Ein Prompt." > "$tmp/prompt.md"
+
+# lauf <name> <erwarteter-exit> <pfad-reviewer-1> [pfad-reviewer-2]
+lauf() {
+  local name="$1" want="$2" p1="$3" p2="${4:-}"
+  local out="$tmp/out-$name"
+  mkdir -p "$out"
+  (
+    export REVIEWER_1_NAME=r1 REVIEWER_1_KIND=openai \
+           REVIEWER_1_URL="http://127.0.0.1:$port$p1" REVIEWER_1_MODEL=modell-1
+    if [ -n "$p2" ]; then
+      export REVIEWER_2_NAME=r2 REVIEWER_2_KIND=openai \
+             REVIEWER_2_URL="http://127.0.0.1:$port$p2" REVIEWER_2_MODEL=modell-2
+    fi
+    python3 .pa/review_transport.py "$tmp/prompt.md" "$out" probe --author selbsttest
+  ) > "$tmp/$name.log" 2>&1
+  local got=$?
+  if [ "$got" -ne "$want" ]; then
+    bad "$name: Exit $got, erwartet $want"; sed 's/^/    /' "$tmp/$name.log"
+    return 1
+  fi
+  ok "$name (Exit $got)"
+  if grep -q "Traceback" "$tmp/$name.log"; then
+    bad "$name: Traceback statt Befund"; sed 's/^/    /' "$tmp/$name.log"
+  fi
+  return 0
+}
+
+# Jede Art, NICHT zu antworten, ist ein Fehlschlag mit Protokoll — kein Absturz.
+for fall in null:content-null leer:leere-antwort zahl:kein-text keine:leere-choices \
+            fehler:error-objekt html:html-statt-json; do
+  pfad="/${fall%%:*}"
+  name="${fall#*:}"
+  if lauf "$name" 1 "$pfad"; then
+    datei="$tmp/out-$name/review_probe_r1.md"
+    if [ -f "$datei" ]; then
+      ok "$name: Protokoll geschrieben"
+    else
+      bad "$name: kein Protokoll — der Ausfall ist unsichtbar"
+    fi
+    grep -q "Status: failed" "$datei" 2>/dev/null &&
+      ok "$name: Status failed im Protokoll" || bad "$name: Protokoll nennt den Ausfall nicht"
+  fi
+done
+
+# Der Kern des Anlasses: faellt Reviewer 1 aus, muss Reviewer 2 TROTZDEM
+# laufen und sein Protokoll bekommen. Genau das ging am 09.09. verloren.
+if lauf "ausfall-stoppt-den-zweiten-nicht" 1 /null /gut; then
+  [ -f "$tmp/out-ausfall-stoppt-den-zweiten-nicht/review_probe_r2.md" ] &&
+    ok "Reviewer 2 hat trotz Ausfall von Reviewer 1 ein Protokoll" ||
+    bad "Reviewer 2 blieb ohne Protokoll — der Absturz kostet fremde Arbeit"
+fi
+
+# Gegenprobe: eine echte Antwort ist gruen. Ohne diesen Fall wuerde ein Skript,
+# das IMMER scheitert, den Selbsttest bestehen.
+if lauf "gute-antwort" 0 /gut; then
+  grep -q "ANNEHMEN: alles gut." "$tmp/out-gute-antwort/review_probe_r1.md" 2>/dev/null &&
+    ok "das Urteil steht im Protokoll" || bad "das Urteil fehlt im Protokoll"
+  grep -q "Status: ok" "$tmp/out-gute-antwort/review_probe_r1.md" 2>/dev/null &&
+    ok "Status ok im Protokoll" || bad "Status ok fehlt"
+fi
+
+# Ohne Reviewer ist der Lauf kein Review: Exit 2, nicht 0.
+(
+  env -u REVIEWER_1_NAME python3 .pa/review_transport.py "$tmp/prompt.md" "$tmp" probe
+) > "$tmp/ohne.log" 2>&1
+got=$?
+[ "$got" -eq 2 ] && ok "ohne konfigurierten Reviewer: Exit 2" ||
+  bad "ohne Reviewer: Exit $got, erwartet 2"
+
+echo
+[ "$fails" -eq 0 ] && echo "alle Faelle gruen" || echo "$fails Fall/Faelle rot"
+[ "$fails" -eq 0 ]
diff --git a/src/e2e-retries.test.ts b/src/e2e-retries.test.ts
new file mode 100644
index 0000000..0d929a6
--- /dev/null
+++ b/src/e2e-retries.test.ts
@@ -0,0 +1,58 @@
+/**
+ * @vitest-environment node
+ */
+import { afterEach, describe, expect, it, vi } from "vitest";
+
+// Regel G-2 (src-tauri/.config/nextest.toml, Sanierungsplan §0.1): "ein Test,
+// der beim zweiten Versuch gruen wird, ist kaputt und nicht gruen". Die
+// Rust-Suite haelt sich daran (`retries = 0` im ci-Profil), der Browser-Smoke
+// tat es bis zum 09.09. nicht: `retries: process.env.CI ? 1 : 0` gab genau
+// unter CI den zweiten Versuch, den die Regel verbietet.
+//
+// Zwei Schaeden in einem: ein flackernder e2e-Test wurde in CI stillschweigend
+// gruen, und der lokale Lauf war STRENGER als CI — also konnte "lokal gruen"
+// nicht mehr fuer "CI gruen" buergen und umgekehrt. Genau diese Aequivalenz
+// ist der Zweck von scripts/ci/gates.sh.
+//
+// Der Test laedt die Config zweimal frisch, weil `process.env.CI` beim
+// Modul-Laden gelesen wird — ein einmaliger Import wuerde die CI-Variante nie
+// sehen.
+async function loadRetries(ci: string | undefined): Promise<number | undefined> {
+  const previous = process.env.CI;
+  if (ci === undefined) {
+    delete process.env.CI;
+  } else {
+    process.env.CI = ci;
+  }
+  try {
+    vi.resetModules();
+    const module = await import("../playwright.config");
+    return module.default.retries;
+  } finally {
+    if (previous === undefined) {
+      delete process.env.CI;
+    } else {
+      process.env.CI = previous;
+    }
+  }
+}
+
+afterEach(() => {
+  vi.resetModules();
+});
+
+describe("playwright.config.ts — Retry-Verbot (G-2)", () => {
+  it("wiederholt lokal keinen fehlgeschlagenen Test", async () => {
+    await expect(loadRetries(undefined)).resolves.toBe(0);
+  });
+
+  it("wiederholt auch unter CI=true keinen fehlgeschlagenen Test", async () => {
+    await expect(loadRetries("true")).resolves.toBe(0);
+  });
+
+  it("verhaelt sich unter CI identisch zum lokalen Lauf", async () => {
+    const local = await loadRetries(undefined);
+    const ci = await loadRetries("true");
+    expect(ci).toBe(local);
+  });
+});
```
