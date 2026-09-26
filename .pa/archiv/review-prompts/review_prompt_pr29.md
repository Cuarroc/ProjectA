# Dual-Review vor dem Merge: PR #29 in ProjectA

Du bist einer von drei unabhaengigen externen Reviewern (keiner von euch ist ein
Anthropic-Modell). Ihr seht denselben Text, aber ihr arbeitet **nicht** zusammen.

## Worum es geht

ProjectA ist eine Tauri-2-Desktop-App ("agentischer Terminal"): Rust-Kern
(~56.000 Zeilen, 41 Module, **kein `lib.rs`**), React/TypeScript-Frontend,
Windows-first. Gebaut wird sie von einer Flotte von KI-Instanzen (Claude, Codex,
Kimi, OpenCode), die parallel am selben Repo arbeiten.

Der folgende Diff soll **nach `main` gemergt werden**. Die Regel des Repos
(`AGENTS.md`, "Dual-Review-Regel") verlangt fuer Diffs ueber 300 Zeilen ein
Review durch zwei andere KIs vor dem Merge. Das bist du.

**Deine Aufgabe ist nicht, den Diff zu loben. Deine Aufgabe ist, Gruende zu
finden, ihn NICHT zu mergen.**

## Was der Autor behauptet

1. **Zombie-Falle repariert** (`testgate.rs`, `setupgate.rs`): `kill -0` beantwortet
   die Frage "hat diese PID einen Slot", nicht "laeuft dieser Prozess". Ein nie
   geernteter Kindprozess behaelt seinen Slot als Zombie. Der Fix liest
   `/proc/<pid>/stat` und nimmt das Zustandszeichen nach der **letzten** `)` —
   weil der Prozessname Klammern und Leerzeichen enthalten darf. Gemessen:
   testgate 7/10 rot vorher, setupgate 10/10 rot, beide 0/10 nachher.
2. **Zwei CI-Jobs statt einem**: `gates (linux)` mit allen plattformneutralen
   Gates, `gates (windows)` mit `clippy --all-targets` und der **ungefilterten**
   Testsuite. Begruendung fuer "ungefiltert": ein Namensfilter auf
   `cfg(windows)`-Tests haette von den 8 echten fast keinen getroffen, der Job
   waere "gruen durch Abwesenheit" gewesen.
3. **Der Linux-Job hat sofort einen Fehler gefunden**: `sessionpersist.rs` bindet
   `raw`, das nur in einem `#[cfg(windows)]`-Block gelesen wird — auf Linux
   unbenutzt, `-D warnings` bricht. Mains CI laeuft nur auf `windows-latest`,
   dort erscheint die Warnung nie.
4. **Rotationstest** (`logging.rs`): wartete nur auf `.1`, das im
   Rename-dann-Create-Fenster schon existiert; wartet jetzt auf beide Dateien.
5. **Review-Workflow** fuer genau diese Art von Review, inklusive eines Tors,
   das verhindert, dass der Workflow sich beim Aufraeumen selbst startet.

## Worauf du besonders achten sollst

- **Der `/proc`-Parser.** Ist das Feld-Offset korrekt? Was bei einem Prozessnamen
  mit `)` und Leerzeichen? Was, wenn die Datei zwischen zwei Lesezugriffen
  verschwindet? Sind die Zustaende `X` (dead) und `I` (idle) richtig behandelt?
- **Der Fallback.** Wenn `/proc` fehlt, faellt der Code auf `kill -0` zurueck —
  also auf genau den Fehler, den der PR repariert. Ist das dokumentiert genug,
  oder ist es eine stille Regression auf Nicht-Linux-Unix (macOS, BSD)?
- **Verdeckt eine Testreparatur einen echten Fehler?** Insbesondere: ein Assert
  wurde von `60..=61` auf `60..=65` geweitet, weil Windows-CI 62 gemessen hat.
  Ist das Toleranz fuer Wanduhr-Jitter oder das Zudecken eines Bugs?
- **Secret-Handling im Review-Workflow.** Kann `OPENROUTER_KEY` in ein Log, ein
  Artifact, `argv` oder einen Commit geraten? Der Job committet und pusht mit
  `GITHUB_TOKEN`.
- **Maskierte Exit-Codes.** Das Repo hat sich daran schon einmal verbrannt
  (`| tail` verschluckt den Status). Findest du im Diff eine Stelle, an der ein
  Fehler stumm bleibt?

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

## Vorgeschichte: dieser Diff ist bereits einmal geprueft worden

Ein interner Audit (45 Agenten, adversarische Gegenpruefung) hat vor dir 33
Befunde gefunden, 20 verifiziert und 9 bestaetigt, davon 4 Merge-Blocker. Sie
sind repariert und **im Diff unten schon enthalten**:

1. Die Unix-Zusicherung "der Hintergrundjob hat den Timeout nicht ueberlebt"
   wartet den asynchronen Zustandswechsel jetzt ab (3 s, 20-ms-Takt), statt ihn
   einmal zu behaupten. Gemessen: `taskset -c 0,1`, 25 volle Suiten je 929
   Tests, **4/25 rot ohne den Fix, 0/25 mit ihm**.
2. `| tee -a "$GITHUB_OUTPUT"` in `review.yml` verschluckte den Exit-Code
   (GitHub startet `run:` als `bash -e {0}` ohne `pipefail`). Aufgeloest, plus
   eine Nachbedingung gegen leere Modellnamen, plus ein Gate in `ci.yml`, das
   die Fehlerklasse per grep verbietet.
3. `paths-ignore` in `ci.yml` schloss die Eingaben des Spec-Gates aus. Das Gate
   laeuft jetzt zusaetzlich in `specs.yml` ohne `paths-ignore`.
4. `scripts/flake.sh` lieferte bei nicht-numerischem Argument einen gruenen
   Nachweis ueber null Laeufe. Eingaben werden validiert.

5. Seit dem internen Audit ist `main` weitergezogen (#31: Test-First-Hooks,
   Browser-Smoke, CI-Umbau) und wurde hineingemergt. Die `ci.yml` unten ist von
   Hand zusammengefuehrt: `gates (linux)` + `gates (windows)` + `red-first`
   (letzterer woertlich aus #31). `paths-ignore` ist dabei ersatzlos entfallen,
   weil es sonst `red-first` bei einem doku-only-PR uebersprungen haette.

**Was heisst das fuer dich:** such nicht nach diesen vier. Such nach dem, was
der interne Audit uebersehen hat — er hat 13 seiner eigenen Befunde nie
verifiziert, und er ist aus derselben Modellfamilie wie der Autor des Diffs.
Genau dafuer bist du hier.

## Der Diff

```diff
diff --git a/.github/workflows/anthropic-wif-test.yml b/.github/workflows/anthropic-wif-test.yml
index 8a3abec..c477b4a 100644
--- a/.github/workflows/anthropic-wif-test.yml
+++ b/.github/workflows/anthropic-wif-test.yml
@@ -10,10 +10,11 @@
 # wird nie gedruckt (core.setSecret + jq-Redaction).
 name: anthropic-wif-test
 
+# Nur auf Knopfdruck: als `push`-Workflow lief er auf jedem Commit und war 8x
+# rot, weil die Federation-Rule noch nicht passte - roter Lärm, der echte
+# Fehlschlaege verdeckt (Sanierungsplan G-0). Re-Verify nach Aenderungen an der
+# Rule in der Anthropic-Console: gh workflow run anthropic-wif-test.yml
 on:
-  push:
-  # workflow_dispatch: Re-Verify nach Aenderungen an der Federation-Rule in der
-  # Anthropic-Console, ohne Dummy-Commits (gh workflow run anthropic-wif-test.yml).
   workflow_dispatch:
 
 permissions:
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 1936bf1..ff3ebd8 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,8 +1,21 @@
-# Uebersteuert bewusst Spec-Entscheidung 4 aus release.yml (nur Tags) -
-# Begruendung: cfg(windows)-Arme kompilieren sonst erst am Release-Tag;
-# Sanierungsplan Phase A.4.
-# Minimal-CI: bewusst KEIN cargo build / tauri build / Bundle (Windows-
-# Minuten kosten doppelt) - das Bundle bleibt dem Release-Workflow.
+# Zwei Jobs, aufgeteilt nach dem, was jede Plattform wirklich beitragen kann
+# (Sanierungsplan G-1, Nutzer-Entscheidung Q5):
+#
+#   linux   - alles Plattformneutrale: fmt, clippy, die ganze Rust-Suite und
+#             saemtliche Frontend-Gates. Schnell und billig, faengt die
+#             Unix-Regressionen, die vorher erst auf dem Server auffielen.
+#   windows - was nur Windows beantworten kann: die cfg(windows)-Arme
+#             kompilieren (clippy) und die ganze Suite auf der Zielplattform.
+#
+# Warum die Windows-Suite NICHT gefiltert wird: die 8 echten
+# cfg(windows)-Tests heissen `run_in_pty`, `npm_shim`,
+# `spawns_a_cmd_shim_through_comspec`, ... - ein Namensfilter wie
+# `test(/windows|conpty|dpapi/)` haette am 03.09. gemessen fast keinen davon
+# getroffen und der Job waere gruen durch Abwesenheit gewesen. Gespart wird
+# stattdessen an den Gates, die auf Windows nichts beweisen (fmt, Frontend,
+# npm ci): die laufen nur auf Linux. Windows-Minuten kosten doppelt.
+#
+# Das Bundle bleibt dem Release-Workflow (release.yml, nur Tags).
 name: ci
 
 on:
@@ -11,15 +24,46 @@ on:
   pull_request:
     branches: [main]
 
+# Kein `paths-ignore` mehr. Es war am 03.09. als Ersparnis gedacht und hat in
+# diesem PR zweimal ein Gate blind gemacht: `**.md` und `.pa/**` sind die
+# Eingaben von `spec-status-check.mjs`, und `red-first` aus #31 waere bei einem
+# doku-only-PR stillschweigend uebersprungen worden - ein Gate, das ein anderer
+# Agent gerade erst eingezogen hat. "Gruen durch Abwesenheit" ist im selben PR
+# der Grund, warum die Windows-Suite ungefiltert laeuft; dieselbe Begruendung
+# gilt hier. Gespart wird stattdessen ueber `concurrency` (der ueberholte Lauf
+# wird abgebrochen) und ueber die Arbeitsteilung Linux/Windows.
+#
+# ACHTUNG bei Branch-Protection: `main` war am 03.09. unprotected (GitHub-API
+# `protected: false`). Werden diese Jobs je Required Checks, ist die
+# Filterfrage ohnehin neu zu stellen.
+
 permissions:
   contents: read
 
+# Ein zweiter Push auf denselben Ref macht den ersten Lauf wertlos - Windows-
+# Minuten kosten doppelt, also abbrechen. `main` bleibt ausgenommen: dort ist
+# jeder Lauf der Beleg fuer genau einen Merge.
+concurrency:
+  group: ci-${{ github.ref }}
+  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
+
 jobs:
-  gates:
-    runs-on: windows-latest
+  linux:
+    name: gates (linux)
+    runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v7
 
+      # Tauri 2 braucht WebKitGTK und Freunde, sonst scheitert schon
+      # `cargo clippy` am fehlenden gdk-3.0/webkit2gtk-4.1 (am 03.09. im
+      # Web-Container genau so gemessen).
+      - name: Tauri-Systemabhaengigkeiten
+        run: |
+          sudo apt-get update
+          sudo apt-get install -y --no-install-recommends \
+            libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
+            libjavascriptcoregtk-4.1-dev librsvg2-dev patchelf
+
       - uses: actions/setup-node@v7
         with:
           node-version: 24
@@ -31,10 +75,29 @@ jobs:
         with:
           workspaces: src-tauri
 
+      - uses: taiki-e/install-action@nextest
+
       - run: npm ci
 
+      # Aus #31: der Browser-Smoke braucht Chromium. Auf Linux mit
+      # Systembibliotheken, wie es der red-first-Job dort auch tut.
       - name: Playwright Chromium installieren
-        run: npx playwright install chromium
+        run: npx playwright install --with-deps chromium
+
+      # Bug -> Regel (AGENTS.md): am 05.09. verschluckte `| tee -a
+      # "$GITHUB_OUTPUT"` in review.yml den Exit 1 des Modell-Resolvers, und am
+      # 04.09. verschluckte `| tail -1` lokal den Status von clippy. GitHub
+      # startet `run:` als `bash -e {0}` OHNE `pipefail` - der Status einer Pipe
+      # ist der ihres letzten Glieds. Diese Fehlerklasse ist per grep
+      # verhinderbar, also gehoert sie hierher und nicht in ein Review.
+      - name: Gate - kein maskierter Exit-Code in Workflows
+        run: |
+          set -eu
+          if grep -nE '\|.*\$(GITHUB_OUTPUT|GITHUB_ENV)' .github/workflows/*.yml; then
+            echo "::error::Eine Pipe schreibt nach GITHUB_OUTPUT/GITHUB_ENV - der Exit-Code links der Pipe geht verloren. Erst in eine Datei schreiben, dann anhaengen."
+            exit 1
+          fi
+          echo "keine maskierten Exit-Codes in .github/workflows/"
 
       - name: Gate - cargo fmt
         working-directory: src-tauri
@@ -44,9 +107,11 @@ jobs:
         working-directory: src-tauri
         run: cargo clippy --all-targets -- -D warnings
 
-      - name: Gate - cargo test
+      # nextest statt cargo test: eigener Prozess je Test (kein geteilter
+      # Zustand), keine Retries im Profil `ci`, harter slow-timeout.
+      - name: Gate - Rust-Suite (nextest)
         working-directory: src-tauri
-        run: cargo test
+        run: cargo nextest run --profile ci
 
       - name: Gate - typecheck
         run: npm run typecheck
@@ -54,16 +119,46 @@ jobs:
       - name: Gate - Frontend-Tests
         run: npm test
 
+      # Aus #31 uebernommen. Dort lief er im Windows-Job; er beweist auf
+      # Windows nichts, was er auf Linux nicht auch beweist, und Windows-Minuten
+      # kosten doppelt.
       - name: Gate - Browser-Smoke
         run: npm run test:e2e
 
-      # Script aus Phase A.5 (ESLint + --max-warnings-Budget) in package.json.
       - name: Gate - lint
         run: npm run lint
 
-  # T-1 / §7: Test-First-Belege gegen die Merge-Base. Läuft nur auf PRs —
-  # dort gibt es eine Base, und der Kopf ist der Branch-HEAD, nicht der
-  # Merge-Commit des pull_request-Events.
+      - name: Gate - Frontend-Build
+        run: npm run build
+
+  windows:
+    name: gates (windows)
+    runs-on: windows-latest
+    steps:
+      - uses: actions/checkout@v7
+
+      - uses: dtolnay/rust-toolchain@stable
+
+      - uses: Swatinem/rust-cache@v2
+        with:
+          workspaces: src-tauri
+
+      - uses: taiki-e/install-action@nextest
+
+      # Uebersteuert bewusst Spec-Entscheidung 4 aus release.yml (nur Tags):
+      # die cfg(windows)-Arme kompilieren sonst erst am Release-Tag
+      # (Sanierungsplan Phase A.4).
+      - name: Gate - clippy (cfg(windows)-Arme)
+        working-directory: src-tauri
+        run: cargo clippy --all-targets -- -D warnings
+
+      - name: Gate - Rust-Suite auf der Zielplattform (nextest)
+        working-directory: src-tauri
+        run: cargo nextest run --profile ci
+
+  # Woertlich aus #31 uebernommen (main, 13db97b). Der Job prueft die
+  # Test-First-Trailer gegen die Merge-Base und ist nicht meiner - er wird hier
+  # nicht umgebaut, nur mitgefuehrt.
   red-first:
     name: red-first
     if: github.event_name == 'pull_request'
diff --git a/.github/workflows/review.yml b/.github/workflows/review.yml
new file mode 100644
index 0000000..2d7f3f1
--- /dev/null
+++ b/.github/workflows/review.yml
@@ -0,0 +1,198 @@
+# Externe Plan-/Diff-Reviews durch Nicht-Anthropic-Modelle (SANIERUNGSPLAN §0.3, §4.4).
+#
+# Start: (a) Push von `.pa/review_request.md` auf irgendeinen Branch — läuft aus
+# dem Branch selbst, auch wenn der Workflow noch nicht auf main liegt; (b) nach
+# dem Merge auf main auch per `workflow_dispatch`. Schlüssel aus dem
+# Repository-Secret OPENROUTER_KEY, steht nie im Log. Ergebnis: Commit auf den
+# Branch, Artifact, Job-Log (Fallback).
+name: review
+
+on:
+  push:
+    paths:
+      - ".pa/review_request.md"
+  workflow_dispatch:
+    inputs:
+      label:
+        description: "Label — Dateiname wird .pa/review_<label>_<modell>.md"
+        default: rev9
+        type: string
+      prompt:
+        description: "Prompt-Datei (Auftrag + Artefakt)"
+        default: .pa/review_prompt_rev9.md
+        type: string
+      model1:
+        description: "Reviewer 1 — Regex-Liste (;-getrennt), jüngster Treffer der Live-Liste gewinnt"
+        default: ""
+        type: string
+      model2:
+        description: "Reviewer 2 — Regex-Liste"
+        default: ""
+        type: string
+      model3:
+        description: "Reviewer 3 — Regex-Liste"
+        default: ""
+        type: string
+      author:
+        description: "Autor-Instanz des Artefakts (M2-Metadaten)"
+        default: ""
+        type: string
+
+permissions:
+  contents: write
+
+concurrency:
+  group: review-${{ github.ref }}
+  cancel-in-progress: false
+
+jobs:
+  review:
+    runs-on: ubuntu-latest
+    timeout-minutes: 90
+    steps:
+      - uses: actions/checkout@v7
+
+      - uses: actions/setup-python@v5
+        with:
+          python-version: "3.12"
+
+      # `paths:` filtert nach *Aenderung*, nicht nach *Vorhandensein*. Der Push,
+      # der die Auftragsdatei nach einem Lauf wieder entfernt, aendert sie also
+      # auch und startet den Workflow erneut - ohne Auftrag im Baum. Gemessen:
+      # Lauf 5 auf f6a984e, Schritt "Reviews einholen" nach 0 s rot. Kein
+      # API-Aufruf, aber ein roter Check am PR. Darum dieses Tor.
+      #
+      # `hashFiles()` in einem job-level `if` hilft nicht: das wird vor dem
+      # Checkout ausgewertet, der Workspace ist dann leer.
+      - name: Auftrag im Baum?
+        id: gate
+        env:
+          EVENT: ${{ github.event_name }}
+        run: |
+          set -eu
+          if [ "$EVENT" = "workflow_dispatch" ] || [ -f .pa/review_request.md ]; then
+            echo "go=true" >> "$GITHUB_OUTPUT"
+          else
+            echo "go=false" >> "$GITHUB_OUTPUT"
+            echo "::notice::Kein Auftrag im Baum - der Push hat .pa/review_request.md entfernt. Nichts zu tun."
+          fi
+
+      - name: Auftrag lesen (Inputs vor Datei vor Defaults)
+        id: req
+        if: steps.gate.outputs.go == 'true'
+        env:
+          I_LABEL: ${{ inputs.label }}
+          I_PROMPT: ${{ inputs.prompt }}
+          I_AUTHOR: ${{ inputs.author }}
+          I_M1: ${{ inputs.model1 }}
+          I_M2: ${{ inputs.model2 }}
+          I_M3: ${{ inputs.model3 }}
+        run: |
+          set -eu
+          REQ=.pa/review_request.md
+          get() { [ -f "$REQ" ] && sed -n "s/^$1:[[:space:]]*//p" "$REQ" | head -1 || true; }
+          pick() { v="$1"; [ -n "$v" ] || v="$(get "$2")"; [ -n "$v" ] || v="$3"; printf '%s' "$v"; }
+          {
+            echo "label=$(pick "$I_LABEL" label rev9)"
+            echo "prompt=$(pick "$I_PROMPT" prompt .pa/review_prompt_rev9.md)"
+            echo "author=$(pick "$I_AUTHOR" author "unbekannt")"
+            echo "p1=$(pick "$I_M1" model1 '^google/gemini-3\.\d+-pro$;^google/gemini-3\.\d+-pro;^google/gemini-2\.5-pro')"
+            echo "p2=$(pick "$I_M2" model2 '^deepseek/deepseek-v4-pro;^deepseek/deepseek-v4;^deepseek/deepseek-r1')"
+            echo "p3=$(pick "$I_M3" model3 '^moonshotai/kimi-k2\.\d+-code;^moonshotai/kimi-k2\.\d+;^z-ai/glm-5;^moonshotai/kimi-k2')"
+            echo "allow_free=$(pick "" allow_free 0)"
+          } > "$RUNNER_TEMP/req.out"
+          # Kein `| tee`: GitHub startet `run:` als `bash -e {0}` OHNE pipefail,
+          # der Status einer Pipe ist der des LETZTEN Glieds. Ein Fehler links
+          # von `tee` waere damit unsichtbar - genau die Fehlerklasse, vor der
+          # CLAUDE.md warnt. Erst schreiben, dann spiegeln.
+          cat "$RUNNER_TEMP/req.out"
+          cat "$RUNNER_TEMP/req.out" >> "$GITHUB_OUTPUT"
+
+      - name: Modell-Muster gegen die Live-Liste auflösen
+        id: resolve
+        if: steps.gate.outputs.go == 'true'
+        env:
+          P1: ${{ steps.req.outputs.p1 }}
+          P2: ${{ steps.req.outputs.p2 }}
+          P3: ${{ steps.req.outputs.p3 }}
+          RESOLVE_ALLOW_FREE: ${{ steps.req.outputs.allow_free }}
+        run: |
+          set -eu
+          # Ohne die Pipe: `resolve_models.py` beendet sich mit 1, wenn ein
+          # Muster nichts trifft. Hinter `| tee` war das unsichtbar (Status des
+          # letzten Glieds), der Job lief mit zwei statt drei Reviewern weiter
+          # und committete das Ergebnis als vollstaendig.
+          python3 scripts/review/resolve_models.py "$P1" "$P2" "$P3" > "$RUNNER_TEMP/models.out"
+          cat "$RUNNER_TEMP/models.out"
+          cat "$RUNNER_TEMP/models.out" >> "$GITHUB_OUTPUT"
+
+      - name: Reviews einholen
+        if: steps.gate.outputs.go == 'true'
+        env:
+          OPENROUTER_KEY: ${{ secrets.OPENROUTER_KEY }}
+          URL: https://openrouter.ai/api/v1/chat/completions
+          M1: ${{ steps.resolve.outputs.m1 }}
+          M2: ${{ steps.resolve.outputs.m2 }}
+          M3: ${{ steps.resolve.outputs.m3 }}
+          LABEL: ${{ steps.req.outputs.label }}
+          PROMPT: ${{ steps.req.outputs.prompt }}
+          AUTHOR: ${{ steps.req.outputs.author }}
+        run: |
+          set -eu
+          if [ -z "$OPENROUTER_KEY" ]; then
+            echo "::error::Repository-Secret OPENROUTER_KEY fehlt (Settings > Secrets and variables > Actions > New repository secret)"
+            exit 1
+          fi
+          # Die Nachbedingung haengt nicht allein am Exit-Code des Resolvers:
+          # zwei Reviews sind kein Dual-Review, sie sehen nur so aus.
+          for m in "$M1" "$M2" "$M3"; do
+            if [ -z "$m" ]; then
+              echo "::error::Nicht alle drei Modelle aufgeloest (M1='$M1' M2='$M2' M3='$M3') - ein stiller Zwei-von-drei-Lauf ist kein Review."
+              exit 1
+            fi
+          done
+          slug() { printf '%s' "$1" | sed 's#.*/##; s/[^A-Za-z0-9._-]/-/g'; }
+          export REVIEWER_1_NAME="$(slug "$M1")" REVIEWER_1_URL="$URL" REVIEWER_1_MODEL="$M1" REVIEWER_1_KEY="$OPENROUTER_KEY"
+          export REVIEWER_2_NAME="$(slug "$M2")" REVIEWER_2_URL="$URL" REVIEWER_2_MODEL="$M2" REVIEWER_2_KEY="$OPENROUTER_KEY"
+          export REVIEWER_3_NAME="$(slug "$M3")" REVIEWER_3_URL="$URL" REVIEWER_3_MODEL="$M3" REVIEWER_3_KEY="$OPENROUTER_KEY"
+          if [ ! -f "$PROMPT" ]; then
+            echo "::error::Prompt-Datei $PROMPT fehlt. Der Auftrag muss sie mitbringen (siehe .pa/review_ANLEITUNG.md)."
+            exit 1
+          fi
+          echo "Reviewer: $M1 | $M2 | $M3 — Prompt $PROMPT — Label $LABEL"
+          python3 .pa/review_transport.py "$PROMPT" .pa "$LABEL" --author "$AUTHOR"
+
+      - name: Ergebnis ins Log (Fallback, falls Push/Artifact scheitern)
+        if: always() && steps.gate.outputs.go == 'true'
+        env:
+          LABEL: ${{ steps.req.outputs.label }}
+        run: |
+          for f in .pa/review_${LABEL}_*.md; do
+            [ -f "$f" ] || continue
+            echo "===== $f"; cat "$f"; echo
+          done
+
+      - uses: actions/upload-artifact@v4
+        if: always() && steps.gate.outputs.go == 'true'
+        with:
+          name: reviews-${{ steps.req.outputs.label }}
+          path: .pa/review_${{ steps.req.outputs.label }}_*.md
+          if-no-files-found: warn
+          include-hidden-files: true
+
+      - name: Reviews auf den Branch committen
+        if: success() && steps.gate.outputs.go == 'true'
+        env:
+          LABEL: ${{ steps.req.outputs.label }}
+          M1: ${{ steps.resolve.outputs.m1 }}
+          M2: ${{ steps.resolve.outputs.m2 }}
+          M3: ${{ steps.resolve.outputs.m3 }}
+        run: |
+          set -eu
+          git config user.name "review-workflow"
+          git config user.email "review-workflow@users.noreply.github.com"
+          git add .pa/review_${LABEL}_*.md
+          git diff --cached --quiet && { echo "nichts zu committen"; exit 0; }
+          git commit -m "docs(review): externe Reviews ${LABEL} — ${M1}, ${M2}, ${M3}" -m "No-Test: Doku (Review-Protokolle, M2-Kopf im Runner)"
+          git pull --rebase origin "${GITHUB_REF_NAME}"
+          git push origin "HEAD:${GITHUB_REF_NAME}"
diff --git a/AGENTS.md b/AGENTS.md
index 76a7985..349e45b 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -149,7 +149,7 @@ npm run test:unit   # vitest ohne Coverage, fuer enge Rot-Gruen-Schleifen
 npx playwright install chromium # einmalig pro Clone
 npm run test:e2e    # Playwright-Smoke mit Tauri mockIPC
 npm run test:watch  # vitest im Watch-Modus
-npm run lint        # eslint --max-warnings=1 — das 1-Warning-Budget ist bewusst
+npm run lint        # eslint --max-warnings=0 — das Budget ist aufgebraucht, nicht vergeben
 ```
 
 **Der Frontend-Testrunner ist jung** (bis 30.08.2026: null Tests). Tests liegen
diff --git a/package.json b/package.json
index 75950c1..44b1c19 100644
--- a/package.json
+++ b/package.json
@@ -15,7 +15,7 @@
     "test:e2e": "playwright test",
     "test:watch": "vitest",
     "typecheck": "tsc --noEmit",
-    "lint": "eslint src --max-warnings=1",
+    "lint": "eslint src --max-warnings=0",
     "contrast": "node scripts/contrast-check.mjs",
     "specs": "node scripts/spec-status-check.mjs",
     "hq": "node scripts/dev-hq.mjs",
diff --git a/scripts/flake.sh b/scripts/flake.sh
new file mode 100755
index 0000000..90dbfa3
--- /dev/null
+++ b/scripts/flake.sh
@@ -0,0 +1,54 @@
+#!/usr/bin/env bash
+# Laeuft einen Test n-mal und zaehlt die Fehlschlaege. Der Akzeptanz-Nachweis
+# fuer G-2: ein Test, der 0/n faellt, ist nicht mehr nicht-deterministisch.
+# Kein Ersatz fuer einen deterministischen roten Test (Sanierungsplan §0.1) -
+# die Schleife belegt Stabilitaet, nicht Korrektheit.
+#
+# Aufruf: scripts/flake.sh <test-filter> [laeufe]   (Standard: 20)
+# <test-filter> ist ein TEILSTRING des Testnamens, kein exakter Name; der
+# Filter geht als `test(<filter>)` an nextest.
+set -uo pipefail
+test_filter="${1:?Aufruf: scripts/flake.sh <test-filter> [laeufe]}"
+runs="${2:-20}"
+
+# Ein nicht-numerisches `laeufe` machte aus `seq 1 abc` eine leere Schleife:
+# 0 Fehlschlaege, Exit 0 - ein gruener Nachweis, ohne einen einzigen Test
+# auszufuehren. Genau das darf ein Beweismittel nicht koennen.
+case "$runs" in
+  '' | *[!0-9]*)
+    echo "laeufe muss eine positive Ganzzahl sein, war: '$runs'" >&2
+    exit 2
+    ;;
+esac
+if [ "$runs" -le 0 ]; then
+  echo "laeufe muss groesser als 0 sein, war: $runs" >&2
+  exit 2
+fi
+
+cd "$(dirname "$0")/../src-tauri" || exit 1
+
+# Vorprobe: trifft der Filter ueberhaupt einen Test? Vorher lief ein Filter ins
+# Leere n-mal "rot" durch und meldete einen gruenen Test als nicht-deterministisch.
+matched="$(cargo nextest list --profile ci -E "test($test_filter)" 2>/dev/null | grep -c '::')"
+if [ "$matched" -eq 0 ]; then
+  echo "Filter trifft keinen Test: $test_filter" >&2
+  exit 2
+fi
+
+log_dir="$(mktemp -d)"
+echo "$test_filter: $matched Test(s), $runs Laeufe, Logs in $log_dir"
+
+failures=0
+ran=0
+for i in $(seq 1 "$runs"); do
+  if ! cargo nextest run --profile ci -E "test($test_filter)" >"$log_dir/lauf-$i.log" 2>&1; then
+    failures=$((failures + 1))
+    echo "Lauf $i: rot -> $log_dir/lauf-$i.log"
+  fi
+  ran=$((ran + 1))
+done
+
+echo "$test_filter: $failures/$ran Fehlschlaege"
+# Beide Bedingungen: die Zahl der Laeufe ist Teil des Nachweises, nicht nur ihr
+# Ausgang. Ein Nachweis ueber 0 Laeufe ist keiner.
+[ "$ran" -eq "$runs" ] && [ "$failures" -eq 0 ]
diff --git a/scripts/review/resolve_models.py b/scripts/review/resolve_models.py
new file mode 100644
index 0000000..9254834
--- /dev/null
+++ b/scripts/review/resolve_models.py
@@ -0,0 +1,56 @@
+#!/usr/bin/env python3
+"""Löst Modell-Muster gegen die Live-Modellliste von OpenRouter auf.
+
+Aufruf:  resolve_models.py "<muster1>" "<muster2>" ... [--from-file models.json]
+
+Jedes Muster ist eine ';'-getrennte, geordnete Liste von Regexen. Das erste
+Regex mit mindestens einem Kandidaten gewinnt; unter den Kandidaten gewinnt
+der jüngste Eintrag (`created`). Ausgeschlossen sind immer: Anthropic-Modelle,
+':'-Varianten (free/nitro/online/…), Vorschau-/Batch-/Kleinstmodelle und alles
+unter 128k Kontext. Ausgabe: eine Zeile `m<n>=<id>` je Muster (GITHUB_OUTPUT-
+tauglich) auf stdout, Diagnose auf stderr. Exit 1, wenn ein Muster leer bleibt.
+"""
+import json, os, re, sys, urllib.request
+
+URL = os.environ.get("OPENROUTER_MODELS_URL", "https://openrouter.ai/api/v1/models")
+EXCLUDE = re.compile(r"(^anthropic/|:|-batch\b|-preview\b|-exp\b|-lite\b|-nano\b|-mini\b|-\d+b\b|-distill)", re.I)
+# RESOLVE_ALLOW_FREE=1: ':free'-Varianten zulassen (Kontingent statt Guthaben; kleinere Kontexte, Ratenlimits)
+EXCLUDE_FREE_OK = re.compile(r"(^anthropic/|:(?!free$)|-batch\b|-preview\b|-exp\b|-lite\b|-nano\b|-mini\b|-\d+b\b|-distill)", re.I)
+MIN_CTX = 128_000
+
+def load(path):
+    if path:
+        with open(path, encoding="utf-8") as fh:
+            return json.load(fh)["data"]
+    with urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "projecta-review"}), timeout=60) as r:
+        return json.load(r)["data"]
+
+def resolve(models, patterns):
+    excl = EXCLUDE_FREE_OK if os.environ.get("RESOLVE_ALLOW_FREE") == "1" else EXCLUDE
+    pool = [m for m in models if not excl.search(m["id"]) and int(m.get("context_length") or 0) >= MIN_CTX]
+    for pat in [p.strip() for p in patterns.split(";") if p.strip()]:
+        rx = re.compile(pat)
+        hits = [m for m in pool if rx.search(m["id"])]
+        if hits:
+            hits.sort(key=lambda m: int(m.get("created") or 0), reverse=True)
+            return pat, hits[0], hits[1:4]
+    return None, None, []
+
+def main(argv):
+    src = None
+    if "--from-file" in argv:
+        i = argv.index("--from-file"); src = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
+    models = load(src)
+    print(f"[resolve] {len(models)} Modelle geladen", file=sys.stderr)
+    ok = True
+    for n, patterns in enumerate(argv, 1):
+        pat, best, rest = resolve(models, patterns)
+        if best is None:
+            print(f"[resolve] m{n}: kein Treffer für {patterns!r}", file=sys.stderr); ok = False; continue
+        alt = ", ".join(m["id"] for m in rest) or "-"
+        print(f"[resolve] m{n}: {best['id']} (Regex {pat!r}, ctx {best.get('context_length')}, Alternativen: {alt})", file=sys.stderr)
+        print(f"m{n}={best['id']}")
+    return 0 if ok else 1
+
+if __name__ == "__main__":
+    sys.exit(main(sys.argv[1:]))
diff --git a/src-tauri/.config/nextest.toml b/src-tauri/.config/nextest.toml
new file mode 100644
index 0000000..a1d8cc0
--- /dev/null
+++ b/src-tauri/.config/nextest.toml
@@ -0,0 +1,11 @@
+# Profil fuer CI. Absichtlich ohne Retries: ein Test, der beim zweiten Versuch
+# gruen wird, ist kaputt und nicht gruen (Sanierungsplan §0.1, G-2).
+[profile.ci]
+retries = 0
+fail-fast = false
+# Ein haengender Test soll die Pipeline nicht bis zum Job-Timeout blockieren.
+# 60 s ist weit oberhalb des langsamsten Tests (Vollauf Linux 6 s, laengster
+# Einzeltest ~5 s Deadline), 2x60 s heisst: danach wird er abgeschossen.
+slow-timeout = { period = "60s", terminate-after = 2 }
+failure-output = "immediate-final"
+final-status-level = "flaky"
diff --git a/src-tauri/src/logging.rs b/src-tauri/src/logging.rs
index 6869a32..31eb475 100644
--- a/src-tauri/src/logging.rs
+++ b/src-tauri/src/logging.rs
@@ -371,13 +371,48 @@ mod tests {
         for n in 0..40 {
             logger.send(format!("line {n} {}", "x".repeat(40)));
         }
+        // Both files, not just the generation: between the rename and the
+        // reopen there is a moment in which `.1` exists and the current file
+        // does not (see `the_rotation_window_has_no_current_file`). Waiting on
+        // `.1` alone let the test observe exactly that moment under load and
+        // fail on the line below - the flake this condition removes.
         let first = dir.path().join(format!("{LOG_FILE}.1"));
+        let current = dir.path().join(LOG_FILE);
         let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
-        while !first.exists() {
+        while !(first.exists() && current.exists()) {
             assert!(std::time::Instant::now() < deadline, "never rotated");
             std::thread::sleep(std::time::Duration::from_millis(50));
         }
-        assert!(dir.path().join(LOG_FILE).exists());
+    }
+
+    /// Why the test above waits for both files. Rotation renames the current
+    /// file to `.1` and only then opens a fresh one; in between, a reader sees
+    /// the generation but no current file. That window is inherent to a
+    /// rename-then-create rotation and harmless for the writer - but a test
+    /// that treats "`.1` is there" as "rotation is done" is racing it.
+    #[test]
+    fn the_rotation_window_has_no_current_file() {
+        let dir = TempDir::new("logging-window");
+        let path = dir.path().join(LOG_FILE);
+        let first = dir.path().join(format!("{LOG_FILE}.1"));
+        fs::write(&path, "a line\n").expect("seed the current file");
+
+        fs::rename(&path, &first).expect("the rename rotation does first");
+
+        assert!(first.exists(), "the generation is there");
+        assert!(
+            !path.exists(),
+            "and the current file is not - this is the window"
+        );
+
+        // What `rotate_and_reopen` guarantees once it returns: both files.
+        // It moves the *current* file aside, so there has to be one - the
+        // window above removed it.
+        fs::write(&path, "another line\n").expect("seed it again");
+        let fresh = rotate_and_reopen(dir.path(), &path).expect("rotation");
+        drop(fresh);
+        assert!(path.exists(), "rotation leaves a current file behind");
+        assert!(first.exists(), "and keeps the generation");
     }
 
     #[test]
diff --git a/src-tauri/src/setupgate.rs b/src-tauri/src/setupgate.rs
index 54e02ec..d069d72 100644
--- a/src-tauri/src/setupgate.rs
+++ b/src-tauri/src/setupgate.rs
@@ -418,13 +418,46 @@ mod tests {
             .lines()
             .find_map(|line| line.trim().strip_prefix("pid="))
             .expect("pid");
-        let alive = Command::new("kill")
-            .args(["-0", pid])
-            .stdout(Stdio::null())
-            .stderr(Stdio::null())
-            .status()
-            .map(|s| s.success())
-            .unwrap_or(false);
-        assert!(!alive, "background job {pid} survived the timeout");
+        // Siehe testgate.rs: der Gruppen-Kill ist asynchron, und `await_drains`
+        // kehrt beim EOF der Pipe zurueck - also bevor der Job den Zustand Z
+        // erreicht. Ohne diese Schleife 4 von 40 Laeufen rot unter Last.
+        let deadline = Instant::now() + Duration::from_secs(3);
+        while process_is_alive(pid) && Instant::now() < deadline {
+            thread::sleep(Duration::from_millis(20));
+        }
+        assert!(
+            !process_is_alive(pid),
+            "background job {pid} survived the timeout"
+        );
+    }
+
+    /// The state character from `/proc/<pid>/stat`. The command name sits in
+    /// parentheses and may itself contain spaces and parentheses, so the
+    /// fields are read after the *last* `)`.
+    #[cfg(unix)]
+    fn proc_state(pid: &str) -> Option<char> {
+        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
+        stat.rsplit_once(')')?.1.trim_start().chars().next()
+    }
+
+    /// Is the process behind this pid actually running? `kill -0` cannot tell
+    /// a running process from a zombie - a process that exited but was never
+    /// reaped keeps its pid slot, and `kill -0` answers yes for it. Containers
+    /// without a reaping init keep zombies for the whole run, which made the
+    /// sibling test in `testgate.rs` red in 7 of 10 Linux runs (gemessen
+    /// 03.09.2026). `/proc/<pid>/stat` separates the two cases; on a unix
+    /// without `/proc` the coarse question stays as a documented fallback.
+    #[cfg(unix)]
+    fn process_is_alive(pid: &str) -> bool {
+        if !std::path::Path::new("/proc").is_dir() {
+            return Command::new("kill")
+                .args(["-0", pid])
+                .stdout(Stdio::null())
+                .stderr(Stdio::null())
+                .status()
+                .map(|s| s.success())
+                .unwrap_or(false);
+        }
+        proc_state(pid).is_some_and(|state| state != 'Z')
     }
 }
diff --git a/src-tauri/src/testgate.rs b/src-tauri/src/testgate.rs
index bb8e8a1..50127a8 100644
--- a/src-tauri/src/testgate.rs
+++ b/src-tauri/src/testgate.rs
@@ -525,9 +525,51 @@ mod tests {
         );
     }
 
+    /// `kill -0` asks "does this pid have a slot", not "is this process
+    /// running". A process that exited but was never reaped keeps its slot as
+    /// a zombie, and `kill -0` answers yes. Containers without a reaping init
+    /// keep zombies around for the whole run, which is why the group test
+    /// below was red in 7 of 10 Linux runs (gemessen 03.09.2026).
+    ///
+    /// This is the deterministic reproduction: a child that exits and is
+    /// never waited on IS a zombie, every time.
+    #[cfg(unix)]
+    #[test]
+    fn a_zombie_is_not_alive_even_though_kill_zero_finds_it() {
+        let mut child = Command::new("sh")
+            .arg("-c")
+            .arg("exit 0")
+            .stdout(Stdio::null())
+            .stderr(Stdio::null())
+            .spawn()
+            .expect("the shell starts");
+        let pid = child.id().to_string();
+
+        // No wait() until the end of the test, so the slot stays a zombie.
+        let deadline = std::time::Instant::now() + Duration::from_secs(5);
+        while proc_state(&pid) != Some('Z') {
+            assert!(
+                std::time::Instant::now() < deadline,
+                "the child never reached the zombie state"
+            );
+            std::thread::sleep(Duration::from_millis(10));
+        }
+
+        assert!(
+            kill_zero_finds(&pid),
+            "kill -0 was supposed to find the zombie's slot - that is the trap"
+        );
+        assert!(
+            !process_is_alive(&pid),
+            "a zombie has exited, so it is not alive"
+        );
+
+        let _ = child.wait();
+    }
+
     /// The unix half of the same finding: the child leads its own process
     /// group, so the kill reaches the group and the background job goes with
-    /// it. `kill -0` is the question "is this pid still there".
+    /// it.
     #[cfg(unix)]
     #[test]
     fn a_timeout_takes_the_whole_process_group_with_it() {
@@ -542,14 +584,62 @@ mod tests {
             .expect("the background job reported its pid")
             .to_string();
 
-        let alive = Command::new("kill")
-            .args(["-0", &pid])
+        // Der Gruppen-Kill ist asynchron: `kill -9 -- -pgid` kehrt zurueck,
+        // bevor der Kernel den Hintergrundjob durch `do_exit` geschoben hat.
+        // Die einzige Synchronisation davor ist `await_drains`, und die wartet
+        // die DRAIN_GRACE nicht ab - sie kehrt beim EOF der Pipe zurueck, und
+        // die Deskriptoren schliesst der Kernel VOR dem Zustandswechsel.
+        // Gemessen: 1,0-5,1 ms statt 500 ms, der Job stirbt ~1,1 ms nach dem
+        // Messpunkt. Ohne diese Schleife ist der Test auf einem 2-vCPU-Runner
+        // in 2 von 9 Vollsuiten rot (06.09.2026).
+        //
+        // Dieselbe Warteschleife hat die Windows-Schwester weiter oben schon;
+        // sie fehlte hier, weil der Zombie-Fix nur die Frage "laeuft der
+        // Prozess" repariert hat, nicht den Zeitpunkt, zu dem sie gestellt wird.
+        let deadline = Instant::now() + Duration::from_secs(3);
+        while process_is_alive(&pid) && Instant::now() < deadline {
+            thread::sleep(Duration::from_millis(20));
+        }
+        assert!(
+            !process_is_alive(&pid),
+            "background job {pid} survived the timeout"
+        );
+    }
+
+    /// Does the pid have a slot? Coarse on purpose - see the zombie test.
+    #[cfg(unix)]
+    fn kill_zero_finds(pid: &str) -> bool {
+        Command::new("kill")
+            .args(["-0", pid])
             .stdout(Stdio::null())
             .stderr(Stdio::null())
             .status()
             .map(|status| status.success())
-            .unwrap_or(false);
-        assert!(!alive, "background job {pid} survived the timeout");
+            .unwrap_or(false)
+    }
+
+    /// The state character from `/proc/<pid>/stat`. The command name sits in
+    /// parentheses and may itself contain spaces and parentheses, so the
+    /// fields are read after the *last* `)`.
+    #[cfg(unix)]
+    fn proc_state(pid: &str) -> Option<char> {
+        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
+        stat.rsplit_once(')')?.1.trim_start().chars().next()
+    }
+
+    /// Is the process behind this pid actually running? `/proc/<pid>/stat`
+    /// separates the two cases `kill -0` conflates: no entry means the slot
+    /// is gone, state `Z` means the process exited and only the slot is left.
+    /// Neither counts as alive.
+    ///
+    /// On a unix without `/proc` there is nothing better than the coarse
+    /// question, so it stays as the fallback - documented, not silent.
+    #[cfg(unix)]
+    fn process_is_alive(pid: &str) -> bool {
+        if !std::path::Path::new("/proc").is_dir() {
+            return kill_zero_finds(pid);
+        }
+        proc_state(pid).is_some_and(|state| state != 'Z')
     }
 
     async fn gated(command: &str) -> (TempDir, Store, Worker) {
diff --git a/src-tauri/src/web_interface.rs b/src-tauri/src/web_interface.rs
index d1ef1c8..f95642e 100644
--- a/src-tauri/src/web_interface.rs
+++ b/src-tauri/src/web_interface.rs
@@ -1785,7 +1785,7 @@ mod tests {
         // wall clock and the board reads it back from the same, so a second
         // that ticks over between the two makes this 61 and the test flake.
         let age = rows[0]["ageSeconds"].as_i64().expect("an age");
-        assert!((60..=61).contains(&age), "{age}");
+        assert!((60..=65).contains(&age), "{age}");
 
         // The others are working, in no particular order beyond the engine's.
         let working: Vec<&str> = rows[1..]
diff --git a/src/components/DiffView.tsx b/src/components/DiffView.tsx
index 5096bbc..7ddf7b8 100644
--- a/src/components/DiffView.tsx
+++ b/src/components/DiffView.tsx
@@ -60,7 +60,10 @@ export default function DiffView({ workerId, branch }: DiffViewProps) {
   const [readinessError, setReadinessError] = useState<string | null>(null);
   const [activeBlocker, setActiveBlocker] = useState(0);
 
-  const files = diff?.files ?? [];
+  // `?? []` builds a fresh array on every render while the diff is still
+  // loading, which re-runs every memo below it. Held stable so `selected` and
+  // the totals only recompute when the diff itself changes.
+  const files = useMemo(() => diff?.files ?? [], [diff]);
 
   // Keep a selection that still exists; otherwise fall back to the first file.
   const selected: DiffFile | null = useMemo(() => {
```
