# Review request PR #25 (port/clean-02): remove retired queen creation path and proven dead code

You are an independent reviewer (not the author; the author is a Claude model).
Review the COMPLETE candidate below for correctness bugs, gaps against the
requirements, and safety regressions. Be concrete: cite file and line, say what
breaks and when. Rate each finding high/medium/low. Do not restate the diff. If
something is fine, say nothing about it. Answer in English or German. This is a
READ-ONLY review: do not modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/, TS/Svelte
frontend in src/, node scripts in scripts/, public GitHub repo). The change is a
pure deletion PR (37 additions, 719 deletions, 12 files).

## Package requirement

Remove code that was proven unused, and nothing else:

- The retired queen creation path: `workers::create_queen`, `create_queen_as_role`,
  `queen_task`, `ControlBackend::create_queen` with its `ApiBackend` and `FakeBackend`
  impls, and the tests of the removed path. Queen READS must stay: the 410 route,
  `queen_domain`/`queen_profile` respawn, `worker_label`. The respawn test now
  inserts a historical queen row directly instead of creating one.
- npm dependency `@tauri-apps/plugin-process` (no TS/JS import; SettingsView invokes
  `plugin:process|restart` directly, the Rust plugin stays).
- Unused functions: `isEmptySummary` (src/lib/diff.ts), `saveOnboardingHints`
  (src/lib/settings.ts), `assertCitations` (scripts/lib/hq-parse.mjs).
- Workflows `.github/workflows/review.yml` (dormant, needs OPENROUTER_KEY) and
  `anthropic-wif-test.yml` (all runs red, disabled).

Please hunt for: any remaining reference to a removed symbol (dynamic use, string
route names, docs, scripts, gates that read the deleted workflow files, CI-shape /
lane-plan / mergify config naming a removed workflow), a removed item that was in
fact still reachable, queen behaviour that changed beyond the removal, tests that
lost coverage of something that stays, a removed npm dependency that is still needed
at runtime (Tauri capability / permissions config referencing `process:`), lockfile
inconsistency, and tests in the modified respawn test that would stay green if the
respawn logic were broken.

## Diff (git diff origin/main...HEAD, candidate 0c3ba40)

```diff
diff --git a/.github/workflows/anthropic-wif-test.yml b/.github/workflows/anthropic-wif-test.yml
deleted file mode 100644
index 45f09c6..0000000
--- a/.github/workflows/anthropic-wif-test.yml
+++ /dev/null
@@ -1,88 +0,0 @@
-# Anthropic Workload Identity Federation (WIF) - Test-Workflow.
-# Tauscht das GitHub-OIDC-Token des Runners gegen ein Anthropic-Access-Token.
-# Kein statisches Secret im Repo: die Identifikatoren (federation rule, org,
-# service account, workspace) sind keine Credentials - autorisierend ist allein
-# das OIDC-Token, das nur GitHub fuer dieses Repo ausstellen kann.
-# Härte-Regel (Repo-Regel 2): ein Austausch, der scheitern kann, muss auch
-# scheitern koennen - curl --fail-with-body + pipefail, und die JWT-Claims
-# (sub/aud/iss) werden dekodiert geloggt, damit der Abgleich mit der
-# Federation-Rule im Anthropic-Console-Setup belegbar ist. Der Token selbst
-# wird nie gedruckt (core.setSecret + jq-Redaction).
-name: anthropic-wif-test
-
-# Nur auf Knopfdruck: als `push`-Workflow lief er auf jedem Commit und war 8x
-# rot, weil die Federation-Rule noch nicht passte - roter Lärm, der echte
-# Fehlschlaege verdeckt (Sanierungsplan G-0). Re-Verify nach Aenderungen an der
-# Rule in der Anthropic-Console: gh workflow run anthropic-wif-test.yml
-on:
-  workflow_dispatch:
-
-permissions:
-  id-token: write
-  contents: read
-
-# `run:`-Schritte laufen ohne diese Zeilen als `bash -e {0}` — OHNE `pipefail`.
-# Der Status einer Pipe ist dann der ihres LETZTEN Glieds, und ein
-# `cargo clippy 2>&1 | tail` meldet Erfolg, waehrend clippy scheitert. Genau so
-# ging am 05.09. in review.yml der Exit 1 des Modell-Resolvers verloren und am
-# 04.09. lokal der Status von clippy.
-#
-# Mit explizitem `shell: bash` startet GitHub den Schritt als
-# `bash --noprofile --norc -eo pipefail {0}` — die Fehlerklasse ist damit
-# strukturell dicht, nicht nur an den Stellen, die jemand einzeln gehaertet hat.
-# scripts/ci/no-masked-output.sh bleibt trotzdem: es faengt die Schreibvorgaenge
-# nach $GITHUB_OUTPUT/$GITHUB_ENV, die auch mit pipefail noch falsch waeren,
-# weil dort der Exit-Code gar nicht erst geprueft wird.
-#
-# Gilt auch auf windows-latest: dort ist `bash` die mitgelieferte Git-Bash.
-# Schritte mit eigenem `shell:` (pwsh in release.yml) sind unberuehrt.
-# Alle `uses:` sind auf einen Commit-SHA gepinnt, nicht auf einen Tag oder
-# Branch. Begruendung: docs/decisions.md (09.09.). Dependabot hebt sie ueber
-# den Versionskommentar an; der Kommentar ist die lesbare Fassung des SHA,
-# nicht die autorisierende.
-defaults:
-  run:
-    shell: bash
-
-jobs:
-  call-claude:
-    runs-on: ubuntu-latest
-    steps:
-      - name: Fetch GitHub OIDC token
-        uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
-        with:
-          script: |
-            const token = await core.getIDToken('https://api.anthropic.com');
-            core.setSecret(token);
-            core.exportVariable('JWT', token);
-
-      - name: Show JWT claims (sub/aud - diagnose federation rule match)
-        run: |
-          set -euo pipefail
-          python3 - <<'PY'
-          import base64, json, os
-          payload = os.environ['JWT'].split('.')[1]
-          payload += '=' * (-len(payload) % 4)
-          claims = json.loads(base64.urlsafe_b64decode(payload))
-          keep = ('iss', 'aud', 'sub', 'repository', 'repository_owner', 'ref')
-          print(json.dumps({k: claims.get(k) for k in keep}, indent=2))
-          PY
-
-      - name: Exchange for an Anthropic access token
-        run: |
-          set -euo pipefail
-          RESPONSE=$(curl -sS --fail-with-body https://api.anthropic.com/v1/oauth/token \
-            -H "content-type: application/json" \
-            --data @- <<JSON
-          {
-            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
-            "assertion": "$JWT",
-            "federation_rule_id": "fdrl_01R4fytnbmy1shnvwaDFT1pi",
-            "organization_id": "3f533e4d-bfd0-44d5-9425-907e7afd15a9",
-            "service_account_id": "svac_0173UHPCS4v5BAgQvs59vkM6",
-            "workspace_id": "wrkspc_017Md8ncvm73PKT2xqAiGsZH"
-          }
-          JSON
-          )
-          echo "$RESPONSE" | jq 'with_entries(if (.key | test("token$")) then .value = "<redacted>" else . end)'
-          echo "OK: Token-Austausch erfolgreich (sk-ant-oat01 redacted)."
diff --git a/.github/workflows/review.yml b/.github/workflows/review.yml
deleted file mode 100644
index c121c5b..0000000
--- a/.github/workflows/review.yml
+++ /dev/null
@@ -1,227 +0,0 @@
-# RUHEND (seit 24.09.2026, SETUP-A): Reviews laufen lokal ueber das
-# Ollama-Cloud-Paar kimi-k3 + glm-5.2 (docs/setup/ollama-reviewers.md).
-# Nutzerentscheidung "nur Abos, kein OpenRouter": dieser Workflow braucht
-# OPENROUTER_KEY und wird nicht mehr gestartet. Nicht loeschen, nicht auf
-# Ollama umbauen (der Runner hat keine bei Ollama Cloud angemeldete Instanz). Gilt ebenso fuer
-# scripts/review/resolve_models.py.
-#
-# Externe Plan-/Diff-Reviews durch Nicht-Anthropic-Modelle (Regel aus docs/PLAN.md §0; historisch SANIERUNGSPLAN §0.3, §4.4).
-#
-# ACHTUNG, die wichtigste Zeile dieser Datei: es gibt KEINEN `push`-Trigger mehr.
-#
-# Der externe Dual-Review zu PR #29 hat den Grund dafuer konvergent gefunden
-# (Protokolle `.pa/review_pr29_sonnet.md`, `.pa/review_pr29_grok.md`):
-# `on: push` mit `paths:` startet den Workflow AUS DEM GEPUSHTEN COMMIT. Wer auf
-# irgendeinen Branch pushen darf, konnte im selben Commit `review_transport.py`
-# aendern - also genau die Datei, die `$OPENROUTER_KEY` in den Haenden haelt -
-# und sich per Auftragsdatei selbst ausloesen. Der Key ging an einen fremden
-# Endpunkt, `GITHUB_TOKEN` mit `contents: write` sass daneben im selben Prozess.
-# Kein Fork noetig, kein Zugriff auf die Repo-Secrets noetig: Push-Recht genuegte.
-# Das ist eine Rechte-Eskalation, kein Kostenthema.
-#
-# Drei Konsequenzen, alle hier umgesetzt:
-#   1. Nur noch `workflow_dispatch`. Ein Lauf ist jetzt eine bewusste Handlung
-#      einer Person mit Schreibrecht, kein Nebeneffekt eines Pushes. Damit sind
-#      auch die beiden Selbstausloeser-Fallen vom 05./06.09. strukturell weg:
-#      weder das Mitbringen noch das Entfernen einer Datei startet noch etwas.
-#   2. `permissions: contents: read`. Der Job committet nichts mehr; die
-#      Protokolle kommen als Artifact und im Job-Log zurueck. Das entfernt
-#      zugleich zwei Folgebefunde: das unquotierte `git add .pa/review_${LABEL}_*`
-#      (Word-Split staged beliebige Dateien) und das Rennen zwischen
-#      Shallow-Checkout und `git pull --rebase` bei langen Laeufen.
-#   3. `environment: review`. Wirksam wird das erst, wenn jemand in
-#      `Settings > Environments > review` Required Reviewers eintraegt UND
-#      OPENROUTER_KEY ausschliesslich als Environment-Secret speichert.
-#      Eine Repository-Kopie waere fuer geaenderte Workflows ohne environment
-#      weiter erreichbar. Der Eintrag allein erzwingt keine Freigabe.
-#
-# Der Schluessel heisst OPENROUTER_KEY. Die sichere Migration vom Repository
-# ins geschuetzte Environment ist noch offen. Anleitung: `.pa/review_ANLEITUNG.md`.
-name: review
-
-on:
-  workflow_dispatch:
-    inputs:
-      label:
-        description: "Label - Dateiname wird .pa/review_<label>_<modell>.md (nur A-Z a-z 0-9 . _ -)"
-        default: rev9
-        type: string
-      prompt:
-        description: "Prompt-Datei (Auftrag + Artefakt), Pfad im Repo"
-        default: .pa/review_prompt_rev9.md
-        type: string
-      model1:
-        description: "Reviewer 1 - Regex-Liste (;-getrennt), juengster Treffer der Live-Liste gewinnt"
-        default: ""
-        type: string
-      model2:
-        description: "Reviewer 2 - Regex-Liste"
-        default: ""
-        type: string
-      model3:
-        description: "Reviewer 3 - Regex-Liste"
-        default: ""
-        type: string
-      author:
-        description: "Autor-Instanz des Artefakts (M2-Metadaten)"
-        default: ""
-        type: string
-
-permissions:
-  contents: read
-
-concurrency:
-  group: review-${{ github.ref }}
-  cancel-in-progress: false
-
-# `run:`-Schritte laufen ohne diese Zeilen als `bash -e {0}` — OHNE `pipefail`.
-# Der Status einer Pipe ist dann der ihres LETZTEN Glieds, und ein
-# `cargo clippy 2>&1 | tail` meldet Erfolg, waehrend clippy scheitert. Genau so
-# ging am 05.09. in review.yml der Exit 1 des Modell-Resolvers verloren und am
-# 04.09. lokal der Status von clippy.
-#
-# Mit explizitem `shell: bash` startet GitHub den Schritt als
-# `bash --noprofile --norc -eo pipefail {0}` — die Fehlerklasse ist damit
-# strukturell dicht, nicht nur an den Stellen, die jemand einzeln gehaertet hat.
-# scripts/ci/no-masked-output.sh bleibt trotzdem: es faengt die Schreibvorgaenge
-# nach $GITHUB_OUTPUT/$GITHUB_ENV, die auch mit pipefail noch falsch waeren,
-# weil dort der Exit-Code gar nicht erst geprueft wird.
-#
-# Gilt auch auf windows-latest: dort ist `bash` die mitgelieferte Git-Bash.
-# Schritte mit eigenem `shell:` (pwsh in release.yml) sind unberuehrt.
-# Alle `uses:` sind auf einen Commit-SHA gepinnt, nicht auf einen Tag oder
-# Branch. Begruendung: docs/decisions.md (09.09.). Dependabot hebt sie ueber
-# den Versionskommentar an; der Kommentar ist die lesbare Fassung des SHA,
-# nicht die autorisierende.
-defaults:
-  run:
-    shell: bash
-
-jobs:
-  review:
-    runs-on: ubuntu-latest
-    timeout-minutes: 90
-    environment: review
-    steps:
-      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
-
-      - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7
-        with:
-          python-version: "3.12"
-
-      - name: Auftrag lesen (Inputs vor Datei vor Defaults)
-        id: req
-        env:
-          I_LABEL: ${{ inputs.label }}
-          I_PROMPT: ${{ inputs.prompt }}
-          I_AUTHOR: ${{ inputs.author }}
-          I_M1: ${{ inputs.model1 }}
-          I_M2: ${{ inputs.model2 }}
-          I_M3: ${{ inputs.model3 }}
-        run: |
-          set -eu
-          REQ=.pa/review_request.md
-          get() { [ -f "$REQ" ] && sed -n "s/^$1:[[:space:]]*//p" "$REQ" | head -1 || true; }
-          pick() { v="$1"; [ -n "$v" ] || v="$(get "$2")"; [ -n "$v" ] || v="$3"; printf '%s' "$v"; }
-          LABEL="$(pick "$I_LABEL" label rev9)"
-          # Das Label landet in Dateinamen, Globs und im Artifact-Namen. Frueher
-          # ging es unquotiert in `git add .pa/review_${LABEL}_*.md`; ein Label
-          # mit Leerzeichen staged damit beliebige Dateien. Der Commit-Schritt
-          # ist weg, die Pruefung bleibt - ein Label ist ein Name, kein Ausdruck.
-          case "$LABEL" in
-            '' | *[!A-Za-z0-9._-]*)
-              echo "::error::Label darf nur A-Z a-z 0-9 . _ - enthalten, war: '$LABEL'"
-              exit 1
-              ;;
-          esac
-          PROMPT="$(pick "$I_PROMPT" prompt .pa/review_prompt_rev9.md)"
-          # Pfad muss im Repo liegen: kein `..`, kein absoluter Pfad.
-          case "$PROMPT" in
-            /* | *..*)
-              echo "::error::Prompt-Pfad muss relativ und ohne '..' sein, war: '$PROMPT'"
-              exit 1
-              ;;
-          esac
-          {
-            echo "label=$LABEL"
-            echo "prompt=$PROMPT"
-            echo "author=$(pick "$I_AUTHOR" author "unbekannt")"
-            echo "p1=$(pick "$I_M1" model1 '^google/gemini-3\.\d+-pro$;^google/gemini-3\.\d+-pro;^google/gemini-2\.5-pro')"
-            echo "p2=$(pick "$I_M2" model2 '^deepseek/deepseek-v4-pro;^deepseek/deepseek-v4;^deepseek/deepseek-r1')"
-            echo "p3=$(pick "$I_M3" model3 '^moonshotai/kimi-k2\.\d+-code;^moonshotai/kimi-k2\.\d+;^z-ai/glm-5;^moonshotai/kimi-k2')"
-            echo "allow_free=$(pick "" allow_free 0)"
-          } > "$RUNNER_TEMP/req.out"
-          # Kein `| tee`: GitHub startet `run:` als `bash -e {0}` OHNE pipefail,
-          # der Status einer Pipe ist der des LETZTEN Glieds. Erst schreiben,
-          # dann spiegeln.
-          cat "$RUNNER_TEMP/req.out"
-          cat "$RUNNER_TEMP/req.out" >> "$GITHUB_OUTPUT"
-
-      - name: Modell-Muster gegen die Live-Liste aufloesen
-        id: resolve
-        env:
-          P1: ${{ steps.req.outputs.p1 }}
-          P2: ${{ steps.req.outputs.p2 }}
-          P3: ${{ steps.req.outputs.p3 }}
-          RESOLVE_ALLOW_FREE: ${{ steps.req.outputs.allow_free }}
-        run: |
-          set -eu
-          python3 scripts/review/resolve_models.py "$P1" "$P2" "$P3" > "$RUNNER_TEMP/models.out"
-          cat "$RUNNER_TEMP/models.out"
-          cat "$RUNNER_TEMP/models.out" >> "$GITHUB_OUTPUT"
-
-      - name: Reviews einholen
-        env:
-          OPENROUTER_KEY: ${{ secrets.OPENROUTER_KEY }}
-          URL: https://openrouter.ai/api/v1/chat/completions
-          M1: ${{ steps.resolve.outputs.m1 }}
-          M2: ${{ steps.resolve.outputs.m2 }}
-          M3: ${{ steps.resolve.outputs.m3 }}
-          LABEL: ${{ steps.req.outputs.label }}
-          PROMPT: ${{ steps.req.outputs.prompt }}
-          AUTHOR: ${{ steps.req.outputs.author }}
-        run: |
-          set -eu
-          if [ -z "$OPENROUTER_KEY" ]; then
-            echo "::error::OPENROUTER_KEY fehlt: als Secret im geschuetzten Environment review setzen (Settings > Environments > review), keine Repository-Kopie anlegen."
-            exit 1
-          fi
-          # Die Nachbedingung haengt nicht allein am Exit-Code des Resolvers:
-          # zwei Reviews sind kein Dual-Review, sie sehen nur so aus.
-          for m in "$M1" "$M2" "$M3"; do
-            if [ -z "$m" ]; then
-              echo "::error::Nicht alle drei Modelle aufgeloest (M1='$M1' M2='$M2' M3='$M3') - ein stiller Zwei-von-drei-Lauf ist kein Review."
-              exit 1
-            fi
-          done
-          if [ ! -f "$PROMPT" ]; then
-            echo "::error::Prompt-Datei $PROMPT fehlt. Der Auftrag muss sie mitbringen (siehe .pa/review_ANLEITUNG.md)."
-            exit 1
-          fi
-          slug() { printf '%s' "$1" | sed 's#.*/##; s/[^A-Za-z0-9._-]/-/g'; }
-          export REVIEWER_1_NAME="$(slug "$M1")" REVIEWER_1_URL="$URL" REVIEWER_1_MODEL="$M1" REVIEWER_1_KEY="$OPENROUTER_KEY"
-          export REVIEWER_2_NAME="$(slug "$M2")" REVIEWER_2_URL="$URL" REVIEWER_2_MODEL="$M2" REVIEWER_2_KEY="$OPENROUTER_KEY"
-          export REVIEWER_3_NAME="$(slug "$M3")" REVIEWER_3_URL="$URL" REVIEWER_3_MODEL="$M3" REVIEWER_3_KEY="$OPENROUTER_KEY"
-          echo "Reviewer: $M1 | $M2 | $M3 - Prompt $PROMPT - Label $LABEL"
-          python3 .pa/review_transport.py "$PROMPT" .pa "$LABEL" --author "$AUTHOR"
-
-      # Die Protokolle kommen als Artifact und im Log zurueck, nicht mehr als
-      # Commit. Wer sie im Repo haben will, laedt sie herunter und committet sie
-      # selbst - das ist der Schritt, an dem ein Mensch draufsieht.
-      - name: Ergebnis ins Log
-        if: always()
-        env:
-          LABEL: ${{ steps.req.outputs.label }}
-        run: |
-          for f in ".pa/review_${LABEL}"_*.md; do
-            [ -f "$f" ] || continue
-            echo "===== $f"; cat "$f"; echo
-          done
-
-      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
-        if: always()
-        with:
-          name: reviews-${{ steps.req.outputs.label }}
-          path: .pa/review_${{ steps.req.outputs.label }}_*.md
-          if-no-files-found: warn
-          include-hidden-files: true
diff --git a/package-lock.json b/package-lock.json
index 82e7cba..96258fc 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -9,7 +9,6 @@
       "version": "1.4.1",
       "dependencies": {
         "@tauri-apps/api": "^2.1.1",
-        "@tauri-apps/plugin-process": "^2.3.1",
         "@tauri-apps/plugin-updater": "^2.10.1",
         "@xterm/addon-canvas": "^0.7.0",
         "@xterm/addon-fit": "~0.10.0",
@@ -1901,15 +1900,6 @@
         "node": ">= 10"
       }
     },
-    "node_modules/@tauri-apps/plugin-process": {
-      "version": "2.3.1",
-      "resolved": "https://registry.npmjs.org/@tauri-apps/plugin-process/-/plugin-process-2.3.1.tgz",
-      "integrity": "sha512-nCa4fGVaDL/B9ai03VyPOjfAHRHSBz5v6F/ObsB73r/dA3MHHhZtldaDMIc0V/pnUw9ehzr2iEG+XkSEyC0JJA==",
-      "license": "MIT OR Apache-2.0",
-      "dependencies": {
-        "@tauri-apps/api": "^2.8.0"
-      }
-    },
     "node_modules/@tauri-apps/plugin-updater": {
       "version": "2.11.0",
       "resolved": "https://registry.npmjs.org/@tauri-apps/plugin-updater/-/plugin-updater-2.11.0.tgz",
diff --git a/package.json b/package.json
index effa387..4d92c54 100644
--- a/package.json
+++ b/package.json
@@ -35,7 +35,6 @@
   },
   "dependencies": {
     "@tauri-apps/api": "^2.1.1",
-    "@tauri-apps/plugin-process": "^2.3.1",
     "@tauri-apps/plugin-updater": "^2.10.1",
     "@xterm/addon-canvas": "^0.7.0",
     "@xterm/addon-fit": "~0.10.0",
diff --git a/scripts/lib/hq-parse.mjs b/scripts/lib/hq-parse.mjs
index db64395..bba7f12 100644
--- a/scripts/lib/hq-parse.mjs
+++ b/scripts/lib/hq-parse.mjs
@@ -310,11 +310,3 @@ export function parseFindings(standText, opts = {}) {
   }
   return findings.map((f) => (f.source ? f : { ...f, klass: "UNPROVEN" }));
 }
-
-export function assertCitations(findings) {
-  for (const f of findings) {
-    if (f.klass !== "UNPROVEN" && !f.source) {
-      throw new Error(`citation missing for ${f.id ?? "finding"}`);
-    }
-  }
-}
diff --git a/src-tauri/src/api.rs b/src-tauri/src/api.rs
index 4649156..459cfe1 100644
--- a/src-tauri/src/api.rs
+++ b/src-tauri/src/api.rs
@@ -439,21 +439,6 @@ pub trait ControlBackend: Send + Sync {
         spawned_by: Option<String>,
     ) -> Result<Worker, String>;
 
-    /// Start a queen: a domain coordinator without a worktree. Same
-    /// `spawned_by` bookkeeping as [`ControlBackend::create_worker`].
-    ///
-    /// Retired as a public write: HTTP answers 410 and must not call this.
-    /// The method stays so a direct trait caller still hits a typed refusal
-    /// on the app backend.
-    #[allow(dead_code)]
-    fn create_queen(
-        &self,
-        project_id: &str,
-        task: &str,
-        profile_id: Option<String>,
-        spawned_by: Option<String>,
-    ) -> Result<Worker, String>;
-
     fn list_workers(&self, project_id: Option<&str>) -> Result<Vec<Worker>, String>;
 
     /// One worker with the column the status engine puts it in, or `None` when
@@ -2763,9 +2748,6 @@ pub(crate) mod tests {
     /// readable where it is matched on.
     type SpawnRecord = (String, String, String, Option<String>);
     type PlanImportRecord = (String, String, i64, Option<String>);
-    /// The same for a queen spawn, whose profile is optional:
-    /// `(projectId, domain, profileId, spawnedBy)`.
-    type QueenRecord = (String, String, Option<String>, Option<String>);
 
     /// A backend that answers from canned data and records what it was asked.
     #[derive(Default)]
@@ -2781,7 +2763,6 @@ pub(crate) mod tests {
         checkpoints: Mutex<HashMap<String, Value>>,
         reject_agent_run: std::sync::atomic::AtomicBool,
         created: Mutex<Vec<SpawnRecord>>,
-        queened: Mutex<Vec<QueenRecord>>,
         sent: Mutex<Vec<(String, String)>>,
         /// `(workerId, removeWorktree)` of every merge the API asked for.
         merged: Mutex<Vec<(String, bool)>>,
@@ -3254,23 +3235,6 @@ pub(crate) mod tests {
             Ok(worker("wk-new"))
         }
 
-        fn create_queen(
-            &self,
-            project_id: &str,
-            task: &str,
-            profile_id: Option<String>,
-            spawned_by: Option<String>,
-        ) -> Result<Worker, String> {
-            core_verdict(project_id)?;
-            self.queened.lock().unwrap().push((
-                project_id.to_string(),
-                task.to_string(),
-                profile_id,
-                spawned_by,
-            ));
-            Ok(queen("wk-queen"))
-        }
-
         fn list_workers(&self, project_id: Option<&str>) -> Result<Vec<Worker>, String> {
             // A small hierarchy: an orchestrator with a queen, the queen with
             // two employees, one worker started by the user, and one whose
@@ -5768,7 +5732,6 @@ pub(crate) mod tests {
                 .contains("queen creation is retired"),
             "{body}"
         );
-        assert!(fx.backend.queened.lock().unwrap().is_empty());
 
         let (status, _) = call(
             port,
@@ -5778,7 +5741,6 @@ pub(crate) mod tests {
             r#"{"projectId":"pj-1","task":"Frontend","profileId":"kimi"}"#,
         );
         assert_eq!(status, 410);
-        assert!(fx.backend.queened.lock().unwrap().is_empty());
 
         // The route is gone as a write target; missing fields are not a 400.
         for payload in [r#"{"task":"t"}"#, r#"{"projectId":"pj-1"}"#, "not json"] {
@@ -5790,17 +5752,6 @@ pub(crate) mod tests {
         assert_eq!(status, 405);
     }
 
-    #[test]
-    fn in_crate_fixtures_may_still_call_create_queen() {
-        let fx = fixture("api-queen-fixture");
-        let queen = fx
-            .backend
-            .create_queen("pj-1", "Backend-API", None, None)
-            .expect("fixtures keep the in-crate spawn");
-        assert_eq!(queen.kind, KIND_QUEEN);
-        assert_eq!(fx.backend.queened.lock().unwrap().len(), 1);
-    }
-
     #[test]
     fn the_tree_nests_children_under_their_controllers() {
         let fx = fixture("api-tree");
@@ -7780,7 +7731,6 @@ pub(crate) mod tests {
         // Nothing was created along the way - a refused route must not leave a
         // row behind, or the status would be the only honest part of the reply.
         assert!(fx.backend.created.lock().unwrap().is_empty());
-        assert!(fx.backend.queened.lock().unwrap().is_empty());
         assert!(fx.backend.scouted.lock().unwrap().is_empty());
         assert!(fx.backend.told.lock().unwrap().is_empty());
         assert!(fx.backend.repos.lock().unwrap().is_empty());
diff --git a/src-tauri/src/learnings.rs b/src-tauri/src/learnings.rs
index b03eeda..2ed0687 100644
--- a/src-tauri/src/learnings.rs
+++ b/src-tauri/src/learnings.rs
@@ -350,8 +350,8 @@ fn one_line(content: &str) -> String {
 ///
 /// A global rather than a parameter because the alternative is threading a
 /// path through [`inject`], [`inject_prompt`] and [`approve_learning`] - and
-/// from there through `create_worker_as_role`, `create_queen_as_role`,
-/// `respawn_worker` and the API backend trait, none of which have anything to
+/// from there through `create_worker_as_role`, `respawn_worker` and the API
+/// backend trait, none of which have anything to
 /// do with where a file lives. The key vault reached its directory the same
 /// way, from the same `app_data_dir` in `main`.
 static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index e235123..9bf7f82 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -2682,16 +2682,6 @@ impl ControlBackend for ApiBackend {
         Ok(worker)
     }
 
-    fn create_queen(
-        &self,
-        _project_id: &str,
-        _task: &str,
-        _profile_id: Option<String>,
-        _spawned_by: Option<String>,
-    ) -> Result<Worker, String> {
-        Err(workers::ERR_QUEEN_RETIRED.to_string())
-    }
-
     fn list_workers(&self, project_id: Option<&str>) -> Result<Vec<Worker>, String> {
         tauri::async_runtime::block_on(self.store.list_workers(project_id))
     }
diff --git a/src-tauri/src/status.rs b/src-tauri/src/status.rs
index ed2c77e..6394229 100644
--- a/src-tauri/src/status.rs
+++ b/src-tauri/src/status.rs
@@ -465,8 +465,9 @@ pub(crate) fn worker_label(worker: &Worker) -> String {
         // A project has exactly one orchestrator, and its task text is the whole
         // role prompt - the role is the only name worth showing.
         KIND_ORCHESTRATOR => "Orchestrator".to_string(),
-        // A queen is known by its domain. `workers::queen_task` writes the
-        // prefix; a task without one predates it and is taken whole.
+        // A queen is known by its domain. The prefix dates from when queens
+        // could still be created; a task without one predates it and is taken
+        // whole.
         KIND_QUEEN => short_label(worker.task.strip_prefix("Queen: ").unwrap_or(&worker.task)),
         // Scouts and everything else have no role name to fall back on.
         _ => short_label(&worker.task),
diff --git a/src-tauri/src/workers.rs b/src-tauri/src/workers.rs
index 870916d..19fff41 100644
--- a/src-tauri/src/workers.rs
+++ b/src-tauri/src/workers.rs
@@ -869,158 +869,6 @@ pub async fn send_to_orchestrator(
     Ok(worker)
 }
 
-/// Create a queen: a coordinator for one domain of the project.
-///
-/// A queen is shaped exactly like an orchestrator - a row, no worktree, an
-/// agent in the repository root whose whole role arrives as a system prompt -
-/// but her reach is narrower: she may only start employees for her own domain,
-/// booked under her own id, and she escalates anything beyond it to the
-/// orchestrator. Same as an orchestrator, a failed spawn has only the row to
-/// roll back.
-///
-/// Public paths refuse with [`ERR_QUEEN_RETIRED`]. This stays for in-crate
-/// tests and historical fixtures.
-#[cfg_attr(not(test), allow(dead_code))]
-pub async fn create_queen(
-    store: &Store,
-    agents: &dyn AgentControl,
-    project_id: &str,
-    domain_task: &str,
-    profile_id: Option<&str>,
-    spawned_by: Option<&str>,
-) -> Result<Worker, String> {
-    create_queen_as_role(
-        store,
-        agents,
-        project_id,
-        domain_task,
-        profile_id,
-        spawned_by,
-        None,
-    )
-    .await
-}
-
-/// [`create_queen`], run as one of her profile's role variants.
-///
-/// A queen already owns her profile's prompt channel, so her role addition is
-/// not a second injection but a block inside the prompt she is spawned with:
-/// her marching orders first, then the curated role, then the raw playbook. A
-/// second file would be written over the very prompt that makes her a queen.
-#[allow(clippy::too_many_arguments)]
-#[cfg_attr(not(test), allow(dead_code))]
-pub async fn create_queen_as_role(
-    store: &Store,
-    agents: &dyn AgentControl,
-    project_id: &str,
-    domain_task: &str,
-    profile_id: Option<&str>,
-    spawned_by: Option<&str>,
-    role_variant_id: Option<&str>,
-) -> Result<Worker, String> {
-    let project = store
-        .get_project(project_id)
-        .await?
-        .ok_or_else(|| format!("{ERR_UNKNOWN}project: {project_id}"))?;
-    let profile_id = profile_id.unwrap_or(ORCHESTRATOR_PROFILE);
-    let profile = profiles::find_profile(profile_id)
-        .ok_or_else(|| format!("{ERR_UNKNOWN}agent profile: {profile_id}"))?;
-    learnings::ensure_profile_enabled(store, profile_id).await?;
-    crate::routing::ensure_spawnable(store).await?;
-    let variant = resolve_role_variant(store, profile_id, role_variant_id).await?;
-    let variant_name = variant.as_ref().map(|variant| variant.name.as_str());
-
-    let worker_id = store::new_id("wk");
-    // A queen is handed no task text either - her domain arrives as a data
-    // block at the top of her system prompt - so the playbook is appended to
-    // that prompt as its own block rather than interpolated into the domain,
-    // and it carries no `--- TASK ---` marker because no task follows it. The
-    // row and `queen_domain` keep the raw domain, so a respawn rebuilds the
-    // prompt from the assignment rather than from a playbook that has moved on.
-    let playbook =
-        learnings::inject_prompt(store, &project.id, &project.repo_path, profile_id, "queen").await;
-    let profile = queen_profile(
-        &profile,
-        &project,
-        domain_task,
-        &worker_id,
-        variant
-            .as_ref()
-            .map(|variant| variant.system_prompt_addition.as_str()),
-        playbook.as_deref(),
-    )?;
-
-    let row = WorkerRow {
-        id: worker_id.clone(),
-        project_id: project.id.clone(),
-        task: role_task(variant_name, &queen_task(domain_task)),
-        profile_id: profile.id.clone(),
-        // No branch, for the same reason as the orchestrator: a queen never
-        // writes code, so there is nothing to open a pull request from.
-        branch: String::new(),
-        worktree_path: project.repo_path.clone(),
-        status: STATUS_RUNNING.to_string(),
-        kind: KIND_QUEEN.to_string(),
-        pr_url: None,
-        spawned_by: spawned_by.map(str::to_string),
-        test_status: None,
-        tested_at: None,
-        // Same reason as on a worker: her respawn rebuilds the prompt from the
-        // row, so the row has to say which variant she was.
-        role_variant_id: variant.as_ref().map(|variant| variant.id.clone()),
-        paused_reason: None,
-        created_at: store::now_unix_secs(),
-    };
-    store.insert_worker(&row).await?;
-
-    let routed = crate::routing::spawn_routing(
-        store,
-        &profile,
-        Some(Path::new(&project.repo_path)),
-        &worker_id,
-    )
-    .await?;
-    let profile = routed.profile;
-    let env = routed.env;
-    crate::routing::prepare_codex_home(&profile, Path::new(&project.repo_path));
-    log_message(store, &worker_id, MSG_SYSTEM, &routed.attribution);
-    // Bound before the child starts, like every spawn path: an agent that
-    // exits at once must still be found by the exit hook.
-    let session_id = match agents.spawn_bound(
-        &worker_id,
-        &profile,
-        Path::new(&project.repo_path),
-        &env,
-        &|session_id| store.bind_session_in_memory(&worker_id, session_id),
-    ) {
-        Ok(session_id) => session_id,
-        Err(err) => {
-            let _ = store.take_session(&worker_id);
-            crate::hooks::remove_worker_files(&worker_id);
-            let _ = store.delete_worker(&worker_id).await;
-            return Err(err);
-        }
-    };
-
-    store.record_session_start(&worker_id, &session_id).await;
-    log_message(
-        store,
-        &worker_id,
-        MSG_SYSTEM,
-        &format!("Queen created for project {}: {domain_task}", project.name),
-    );
-    if let Some(name) = variant_name {
-        log_message(store, &worker_id, MSG_SYSTEM, &format!("Rolle: {name}"));
-    }
-    Ok(row.into_worker(Some(session_id)))
-}
-
-/// The task text a queen carries on the board.
-#[cfg_attr(not(test), allow(dead_code))]
-pub fn queen_task(domain_task: &str) -> String {
-    format!("Queen: {domain_task}")
-}
-
 /// The domain part of a queen's task text. A respawn needs it to put the role
 /// prompt back on; a task without the prefix is taken whole.
 fn queen_domain(task: &str) -> &str {
@@ -2629,8 +2477,8 @@ pub async fn respawn_worker(
             }
             // A queen is handed no task text, so both her role and her
             // playbook ride inside the prompt that makes her a queen, in the
-            // order `create_queen_as_role` builds them: marching orders, then
-            // the curated role, then the raw playbook.
+            // order the retired creation path built them: marching orders,
+            // then the curated role, then the raw playbook.
             Some(project) if worker.kind == KIND_QUEEN => {
                 let playbook = learnings::inject_prompt(
                     store,
@@ -6122,181 +5970,52 @@ mod tests {
         assert!(fx.store.list_workers(None).await.unwrap().is_empty());
     }
 
-    #[tokio::test]
-    async fn a_queen_gets_no_worktree_and_her_own_kind() {
-        let fx = fixture("create-queen").await;
-        let agents = FakeAgents::default();
-
-        let worker = create_queen(
-            &fx.store,
-            &agents,
-            &fx.project_id,
-            "Backend-API",
-            None,
-            Some("wk-orch"),
-        )
-        .await
-        .expect("create queen");
-
-        assert_eq!(worker.kind, KIND_QUEEN);
-        assert_eq!(worker.task, "Queen: Backend-API");
-        assert_eq!(worker.profile_id, ORCHESTRATOR_PROFILE);
-        assert_eq!(worker.status, STATUS_RUNNING);
-        assert_eq!(worker.session_id.as_deref(), Some("pty-fake-1"));
-        assert_eq!(worker.spawned_by.as_deref(), Some("wk-orch"));
-
-        // Like the orchestrator: no branch, no checkout, the repository itself.
-        assert!(worker.branch.is_empty(), "{}", worker.branch);
-        assert_eq!(worker.worktree_path, fx.repo);
-        assert_eq!(agents.spawned.lock().unwrap()[0].1, fx.repo);
-        let worktrees = fx._dir.path().join(worktree::WORKTREES_DIR);
-        assert!(
-            !worktrees.exists(),
-            "{} should not exist",
-            worktrees.display()
-        );
-
-        // Persisted like any other worker, hierarchy bookkeeping included.
-        let stored = fx.store.get_worker(&worker.id).await.unwrap().unwrap();
-        assert_eq!(stored, worker);
-        assert_eq!(stored.kind, KIND_QUEEN);
-        assert_eq!(stored.spawned_by.as_deref(), Some("wk-orch"));
-    }
-
-    #[tokio::test]
-    async fn a_queen_is_launched_with_her_marching_orders() {
-        let fx = fixture("queen-prompt").await;
-        let agents = FakeAgents::default();
-
-        let queen = create_queen(
-            &fx.store,
-            &agents,
-            &fx.project_id,
-            "Backend-API",
-            None,
-            None,
-        )
-        .await
-        .unwrap();
-
-        let args = agents.args.lock().unwrap()[0].clone();
-        let flag = args
-            .iter()
-            .position(|arg| arg == "--append-system-prompt")
-            .expect("the queen carries a system prompt");
-        let prompt = &args[flag + 1];
-
-        assert!(prompt.contains("Queen"), "{prompt}");
-        assert!(prompt.contains("Backend-API"), "{prompt}");
-        assert!(prompt.contains(&fx.project_id), "{prompt}");
-        assert!(prompt.contains(&queen.id), "{prompt}");
-        assert!(prompt.contains("NIEMALS selbst Code"), "{prompt}");
-        assert!(prompt.contains("Lies zu Beginn einer Sitzung"), "{prompt}");
-        // Her own id is baked into the spawn command she is told to use.
-        assert!(
-            prompt.contains(&format!("--on-behalf-of {}", queen.id)),
-            "{prompt}"
-        );
-        // Every subcommand a queen may use is spelled out for her.
-        for usage in [
-            "worker spawn --project",
-            "worker list",
-            "worker status",
-            "worker send",
-            "queue add",
-            "queue list",
-            "queue cancel",
-            "board",
-            "quota",
-        ] {
-            assert!(prompt.contains(usage), "{usage} missing from: {prompt}");
-        }
-        // Her world is narrower than the orchestrator's: no queens of her own,
-        // no scout, no recommendations, no providers.
-        for absent in [
-            "queen spawn",
-            "scout triage",
-            "recommendations",
-            "providers",
-        ] {
-            assert!(
-                !prompt.contains(absent),
-                "{absent} should not be in: {prompt}"
-            );
-        }
-    }
-
     #[tokio::test]
     async fn a_respawned_queen_keeps_her_marching_orders() {
         let fx = fixture("queen-respawn").await;
         let agents = FakeAgents::default();
-        let queen = create_queen(
-            &fx.store,
-            &agents,
-            &fx.project_id,
-            "Backend-API",
-            None,
-            None,
-        )
-        .await
-        .unwrap();
+        // Queen creation is retired (410 / ERR_QUEEN_RETIRED), but a
+        // historical row still respawns - so the fixture inserts one directly.
+        let row = WorkerRow {
+            id: "wk-queen".to_string(),
+            project_id: fx.project_id.clone(),
+            task: "Queen: Backend-API".to_string(),
+            profile_id: ORCHESTRATOR_PROFILE.to_string(),
+            branch: String::new(),
+            worktree_path: fx.repo.clone(),
+            status: STATUS_RUNNING.to_string(),
+            kind: KIND_QUEEN.to_string(),
+            pr_url: None,
+            spawned_by: None,
+            test_status: None,
+            tested_at: None,
+            role_variant_id: None,
+            paused_reason: None,
+            created_at: store::now_unix_secs(),
+        };
+        fx.store.insert_worker(&row).await.unwrap();
 
-        archive_worker(&fx.store, &agents, &queen.id).await.unwrap();
-        let respawned = respawn_worker(&fx.store, &agents, &queen.id).await.unwrap();
+        archive_worker(&fx.store, &agents, "wk-queen")
+            .await
+            .unwrap();
+        let respawned = respawn_worker(&fx.store, &agents, "wk-queen")
+            .await
+            .unwrap();
 
         assert_eq!(respawned.kind, KIND_QUEEN);
         assert_eq!(respawned.status, STATUS_RUNNING);
-        let args = agents.args.lock().unwrap()[1].clone();
+        let args = agents.args.lock().unwrap()[0].clone();
         let flag = args
             .iter()
             .position(|arg| arg == "--append-system-prompt")
             .expect("the respawned queen carries a system prompt");
         // The domain survives the round trip through the task text.
         assert!(args[flag + 1].contains("Backend-API"), "{}", args[flag + 1]);
-        assert!(args[flag + 1].contains(&queen.id), "{}", args[flag + 1]);
-    }
-
-    #[tokio::test]
-    async fn a_queen_needs_a_project_and_a_real_profile() {
-        let fx = fixture("queen-unknown").await;
-        let agents = FakeAgents::default();
-
-        let err = create_queen(&fx.store, &agents, "pj-nope", "Backend", None, None)
-            .await
-            .expect_err("unknown project");
-        assert!(err.contains("unknown project"), "{err}");
-
-        let err = create_queen(
-            &fx.store,
-            &agents,
-            &fx.project_id,
-            "Backend",
-            Some("nope"),
-            None,
-        )
-        .await
-        .expect_err("unknown profile");
-        assert!(err.contains("unknown agent profile"), "{err}");
-
-        assert_eq!(agents.spawn_count(), 0);
-        assert!(fx.store.list_workers(None).await.unwrap().is_empty());
-    }
-
-    #[tokio::test]
-    async fn a_failed_queen_spawn_leaves_no_row_behind() {
-        let fx = fixture("queen-rollback").await;
-        let agents = FakeAgents::failing();
-
-        let err = create_queen(&fx.store, &agents, &fx.project_id, "Backend", None, None)
-            .await
-            .expect_err("spawn must fail");
-        assert!(err.contains("failed to spawn"), "{err}");
-        assert!(fx.store.list_workers(None).await.unwrap().is_empty());
+        assert!(args[flag + 1].contains("wk-queen"), "{}", args[flag + 1]);
     }
 
     #[test]
-    fn the_queen_task_prefix_round_trips() {
-        assert_eq!(queen_task("Backend-API"), "Queen: Backend-API");
+    fn the_queen_domain_prefix_round_trips() {
         assert_eq!(queen_domain("Queen: Backend-API"), "Backend-API");
         // A task without the prefix is taken whole rather than dropped.
         assert_eq!(queen_domain("something else"), "something else");
@@ -9412,7 +9131,7 @@ mod tests {
         assert_eq!(strip_role_prefix("[Test-Fixer] fix it"), "fix it");
         // A queen keeps her domain even when a role is in front of it.
         assert_eq!(
-            queen_domain(&role_task(Some("Test-Fixer"), &queen_task("Backend-API"))),
+            queen_domain(&role_task(Some("Test-Fixer"), "Queen: Backend-API")),
             "Backend-API"
         );
         // Nothing that is not our own marker is touched.
diff --git a/src/lib/diff.ts b/src/lib/diff.ts
index 42a7392..93a5ea4 100644
--- a/src/lib/diff.ts
+++ b/src/lib/diff.ts
@@ -21,10 +21,6 @@ export function summarizeDiff(diff: WorkerDiff): DiffSummary {
   return { baseBranch: diff.baseBranch, files: diff.files.length, additions, deletions };
 }
 
-export function isEmptySummary(summary: DiffSummary): boolean {
-  return summary.files === 0;
-}
-
 interface CacheEntry {
   summary: DiffSummary;
   at: number;
diff --git a/src/lib/settings.ts b/src/lib/settings.ts
index 296afe6..64a816f 100644
--- a/src/lib/settings.ts
+++ b/src/lib/settings.ts
@@ -48,10 +48,6 @@ export function loadOnboardingHints(): boolean {
   return readString(KEYS.onboarding) !== "0";
 }
 
-export function saveOnboardingHints(show: boolean): void {
-  writeString(KEYS.onboarding, show ? null : "0");
-}
-
 /**
  * The default port for the web interface, or `null` when none was stored.
  * Anything that does not parse stays unstored rather than lying about.
```
