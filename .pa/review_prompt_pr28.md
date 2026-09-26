# Review request PR #28 (CI-04): a red main stops the merge queue

You are an independent reviewer (not the author; the author is a Claude model).
Review the COMPLETE candidate below for correctness bugs, gaps against the
requirement, and safety regressions. Be concrete: cite file and line, say what
breaks and when. Rate each finding high/medium/low. Do not restate the diff. If
something is fine, say nothing about it. Answer in English. This is a READ-ONLY
review: do not modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (public GitHub repo). `main` is
merged only through a Mergify merge queue. CI is `.github/workflows/ci.yml`
with jobs `linux` and `windows` (both export a `lane_run` output from
`scripts/ci/lane-plan.sh`: "true" when the lane really ran, "false" when the
plan skipped it as light), plus the new job `main-red`. Gates live only in
`scripts/ci/gates.sh`. Shell scripts run under bash (Git Bash on Windows,
Ubuntu in CI); selftests mock `gh`/`curl` on PATH.

## Requirement (plan wording, translated)

CI-04 "a red main stops the queue": when a push to `main` ends red, open an
issue (label `ci-red`) and freeze the merge queue through the Mergify
mechanism (scheduled freeze API, exception for label `hotfix`), so no further
PR is merged onto a broken main. When main is green again (both lanes really
ran and passed), lift the freeze and close the issue. No new service. A light
green (lane skipped) is not proof of green. Missing `MERGIFY_TOKEN` degrades
loudly (issue still written, warning), an API failure with a token is exit 1.

## Review history (already addressed - verify, do not just re-report)

Two earlier reviewers (both Claude models) reviewed an earlier candidate in a
predecessor repository; their findings were fixed and are part of this diff:
unfreeze only when BOTH lanes ran; honest recovery path in the issue text;
issue reports the actual freeze outcome; superseded runs do not re-freeze
(job concurrency plus SHA comparison against the current main head); green
branch deletes freezes before closing issues; curl `--max-time`,
`--fail-with-body`, `--retry` only for GET/delete. Rejected by the author: the
freeze payload `"start":null` and endpoints are the wire format of the
official mergify-cli; `always()` instead of `!cancelled()` because cancel is a
no-op in the script. Check the fixes are correct and hunt for NEW bugs,
especially: shell quoting/injection (run IDs, SHAs, repo names in
`gh`/`curl` calls), `set -e`/pipefail pitfalls, GitHub Actions expression
mistakes, permissions, races between two consecutive main pushes, and selftest
assertions that would pass even if the guard were broken.

## Diff (git diff origin/main...HEAD)

Not shown: the four ported review artefacts under `.pa/review_*pr182*`
(reviews and disposition of the predecessor repository) and `.pa/report_ci-04.md`
is included for the claims it makes.

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index b1bf97c..a0301f2 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -89,6 +89,12 @@ on:
 #     (scripts/ci/red-first-verdict.sh), so the required check keeps its name.
 #   - scripts/ci/ci-shape.sh pins this structure (gate `ci-shape`).
 #
+# CI-04 (25.09.2026): der Job `main-red` (unten) reagiert auf das
+# Gesamtergebnis NUR auf main: rot -> Issue (Label ci-red, Run-ID) plus
+# Queue-Freeze ueber die Mergify-API, bewiesen gruen -> Freeze weg, Issue
+# zu. Er ist kein Required Check und faellt nie auf einem PR. Details im
+# Job-Kommentar und scripts/ci/main-red-guard.sh.
+#
 # Entwuerfe: jeder Job ueberspringt Draft-PRs - AUSSER den Queue-PRs von
 # Mergify (Kopf-Branch mergify/merge-queue/*): die sind technisch Entwuerfe
 # und muessen genau dann laufen. Ein Nicht-Entwurf-PR bekommt alle drei
@@ -169,10 +175,13 @@ jobs:
     timeout-minutes: 55
     # CI-03: the red-first outcome for the job `red-first` (fail-closed
     # evaluation in scripts/ci/red-first-verdict.sh).
+    # CI-04: lane_run feeds the job `main-red` (below): only a run whose
+    # lane REALLY ran counts as green proof for lifting the queue freeze.
     outputs:
       rf_plan: ${{ steps.rf_plan.outcome }}
       rf_count: ${{ steps.rf_plan.outputs.count }}
       rf_run: ${{ steps.rf_run.outcome }}
+      lane_run: ${{ steps.plan.outputs.run }}
     env:
       # Nur "true"/"false", nie das Secret selbst: so sieht kein Gate-Schritt
       # den Token, und der Upload-Schritt kann sich selbst abschalten, solange
@@ -381,6 +390,10 @@ jobs:
     # einen kalten Cache, beenden aber einen Haenger nach einem Neuntel der
     # 6 h, die GitHub sonst zulaesst.
     timeout-minutes: 35
+    # CI-04: wie im Job linux - ob die Bahn wirklich lief, entscheidet, ob
+    # ein gruener Lauf den Queue-Freeze aufheben darf (Job main-red unten).
+    outputs:
+      lane_run: ${{ steps.plan.outputs.run }}
     env:
       MERGIFY_UPLOAD: ${{ secrets.MERGIFY_TOKEN != '' }}
     steps:
@@ -540,3 +553,69 @@ jobs:
           RF_COUNT: ${{ needs.linux.outputs.rf_count }}
           RF_RUN: ${{ needs.linux.outputs.rf_run }}
         run: bash scripts/ci/red-first-verdict.sh
+
+  # CI-04 (docs/PLAN.md): ein roter Lauf auf main stoppt die Queue.
+  # main wird ueber die Mergify-Queue gemergt, die jeden Batch vor dem Merge
+  # testet - rot wird main trotzdem, wenn der WOCHENLAUF mit neuem rustc oder
+  # geaendertem Runner-Image scheitert. Solange main rot ist, wuerde jede
+  # weitere Merge ungetesteten Code auf eine kaputte Basis setzen. Dieser Job
+  # legt dann ein Issue an (Label ci-red, Run-ID, Run-URL, SHA) und friert
+  # die Queue ueber die Mergify-Scheduled-Freeze-API ein (Marker "ci-red:",
+  # Scope base=main, Ausnahme label=hotfix, damit der Fix mergen kann). Ein
+  # gruener Lauf, dessen Bahnen WIRKLICH gelaufen sind (lane_run der Jobs
+  # linux/windows - ein leichter Push mit uebersprungenen Bahnen ist kein
+  # Gruen-Beweis), loescht den Freeze und schliesst das Issue. Logik und
+  # Nebenbedingungen: scripts/ci/main-red-guard.sh, festgenagelt in
+  # scripts/test-main-red-guard.sh; Struktur gepinnt in ci-shape.sh (Check 5).
+  #
+  # Nicht als eigener workflow_run-Workflow: der saehe die lane-plan-
+  # Entscheidung nicht und koennte ein leichtes Gruen als Beweis missdeuten.
+  # Kein Required Check: er faellt NUR nach den Gates, nie auf einem PR.
+  main-red:
+    name: main-red-guard
+    needs: [linux, windows]
+    # always(): auch nach roten Gates laufen (genau dann gibt es etwas zu
+    # tun). Nur main, nie PRs und nie Queue-Branches - das Skript selbst
+    # prueft den Ref zusaetzlich (doppelte Absicherung).
+    if: ${{ always() && github.event_name != 'pull_request' && github.ref == 'refs/heads/main' }}
+    # Main runs do not cancel each other (SHA-scoped group above), so two
+    # guards could interleave freeze/unfreeze (review predecessor PR, S-5/O-5).
+    # Serialize them; never cancel a RUNNING guard. GitHub still drops an
+    # older PENDING guard when a newer one queues behind it - harmless: the
+    # newer run judges the newer main head.
+    concurrency:
+      group: main-red-guard
+      cancel-in-progress: false
+    runs-on: ubuntu-latest
+    timeout-minutes: 5
+    # Eigenstaendige, minimale Rechte: Issue anlegen/kommentieren/schliessen,
+    # mehr braucht der Job nicht (der Freeze laeuft ueber die Mergify-API mit
+    # MERGIFY_TOKEN, nicht ueber das GitHub-Token).
+    permissions:
+      contents: read
+      issues: write
+    steps:
+      # Only the guard script is needed - no history, no toolchain. Node for
+      # the JSON parsing comes with the runner image (repo requires 24).
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
+        with:
+          fetch-depth: 1
+          sparse-checkout: scripts/ci
+
+      - name: red main -> issue + queue freeze, proven green -> unfreeze
+        env:
+          GH_TOKEN: ${{ github.token }}
+          # Nie als "!= ''"-Wahrheitswert: das Skript braucht den Token selbst
+          # fuer die Mergify-API und degradiert ohne ihn laut, aber gruen
+          # (Issue ist der Fallback - Muster wie MERGIFY_UPLOAD oben).
+          MERGIFY_TOKEN: ${{ secrets.MERGIFY_TOKEN }}
+          GIT_REF: ${{ github.ref }}
+          LINUX_RESULT: ${{ needs.linux.result }}
+          WINDOWS_RESULT: ${{ needs.windows.result }}
+          LINUX_RAN: ${{ needs.linux.outputs.lane_run }}
+          WINDOWS_RAN: ${{ needs.windows.outputs.lane_run }}
+          RUN_ID: ${{ github.run_id }}
+          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
+          SHA: ${{ github.sha }}
+          REPO: ${{ github.repository }}
+        run: bash scripts/ci/main-red-guard.sh
diff --git a/.pa/report_ci-04.md b/.pa/report_ci-04.md
new file mode 100644
index 0000000..d7141de
--- /dev/null
+++ b/.pa/report_ci-04.md
@@ -0,0 +1,146 @@
+# Bericht CI-04: Roter main stoppt die Queue
+
+Portiert aus dem internen Vorgänger-Repo (2026-09-25). Die Commit-SHAs weiter
+unten gehören zu jenem Vorgänger, nicht zu den Commits dieses Repos. Der
+Implementierungs-Commit hier trägt `Test-First: scripts/test-main-red-guard.sh`.
+Das Sitzungsjournal `.pa/ACTIVITY.md` existiert in diesem Repo nicht; die drei
+Journalzeilen des Vorgängers (interner PR-Verweis, Sitzungszustand) wurden
+nicht übernommen. Der Entscheidungseintrag steht am Ende von
+`docs/decisions.md`, hinter dem hier bereits vorhandenen W5-28-Eintrag. Der
+Trailer `Test-First: scripts/test-ci-shape.sh` aus der Review-Runde des
+Vorgängers wurde nicht wiederholt: die Datei ist auf diesem `main` bereits
+grün, ein Datei-Trailer wäre kein Rot-Beleg. Die neuen Mutationsfälle liegen
+im Implementierungs-Commit und laufen über `scripts/test-ci-shape.sh`.
+
+- Branch des Vorgängers: `claude/ci-04-red-main-stops-queue`, Stand 2026-09-25.
+- Quelle: `docs/PLAN.md` Zeile CI-04 (Branch `claude/plan-01-decisions`,
+  PLAN-01 noch nicht auf main → alte Berichtsregel, dieser Bericht).
+- Entscheidung und Begruendung: `docs/decisions.md` (2026-09-25, CI-04).
+
+## Umsetzung
+
+1. **Job `main-red` in `.github/workflows/ci.yml`**
+   (`name: main-red-guard`, `needs: [linux, windows]`,
+   `if: always() && event != pull_request && ref == refs/heads/main`,
+   ubuntu-latest, 5 min, Rechte nur `contents: read` + `issues: write`).
+   Rot → Issue mit Label `ci-red` (Run-ID, Run-URL, SHA, rote Bahnen;
+   Kommentar statt Duplikat) plus Queue-Freeze. Gruen → Freeze weg, Issue
+   zu. Kein eigener `workflow_run`-Workflow: nur im selben Lauf ist die
+   lane-plan-Entscheidung bekannt (s. Punkt 3).
+2. **Freeze ueber den Mergify-Mechanismus** (kein neuer Dienst):
+   Scheduled-Freeze-API, dieselben Endpunkte wie der offizielle
+   mergify-cli (`POST/GET /v1/repos/<repo>/scheduled_freeze`,
+   `POST .../<id>/delete`, Bearer `MERGIFY_TOKEN` — das Secret existiert
+   seit CI-01). Grund `ci-red: main red, run <ID>`, Scope `base=main`,
+   Ausnahme `label=hotfix`, damit der Fix-PR trotz Freeze mergen kann.
+3. **Leichtes Gruen zaehlt nicht**: die Jobs `linux`/`windows`
+   exportieren jetzt `lane_run` (lane-plan-Output). Nur wenn BEIDE Bahnen
+   wirklich liefen, hebt ein gruener Lauf den Freeze auf — ein Push mit
+   uebersprungenen Bahnen ist kein Gruen-Beweis, und ein Push, bei dem nur
+   eine Bahn voll lief (Cache-Eingaben differieren, z. B.
+   `package-lock.json` nur bei linux), auch nicht (Review predecessor PR).
+4. **Laut statt still**: ohne `MERGIFY_TOKEN` Issue trotzdem, Freeze mit
+   `::warning` uebersprungen (Fallback-Muster wie `MERGIFY_UPLOAD`); ein
+   scheiternder API-Aufruf MIT Token ist Exit 1. Cancelled/skipped und
+   jeder Ref != main sind No-Op (Skript prueft den Ref zusaetzlich zum
+   Job-`if`).
+5. **Gepinnt**: Gate `selftest-main-red` in gates.sh; ci-shape.sh Check 5
+   (Job vorhanden, needs linux+windows, `always()` + `refs/heads/main` im
+   `if`, `lane_run`-Outputs), mit Mutationsfaellen in test-ci-shape.sh.
+
+## Red-first und Belege (Exit-Codes, lokal, Windows/Git-Bash)
+
+- Commit 1 (rot belegt): `bash scripts/test-main-red-guard.sh` →
+  **Exit 1** ("main-red-guard.sh fehlt"), Commit fa3b2bf.
+- Nach Implementierung (Stand vor dem Review, Zahlen s. unten fuer den Endstand): `bash scripts/test-main-red-guard.sh` →
+  **Exit 0** (30/30 ok, acht Faelle inkl. Dedup, leichtes Gruen,
+  fehlender Token, API-Fehler laut).
+- `bash scripts/ci/ci-shape.sh` → **Exit 0**;
+  `bash scripts/test-ci-shape.sh` → **Exit 0** (20/20, vier neue
+  Mutationsfaelle schlagen fehl).
+- `bash scripts/ci/gates.sh run selftest-main-red ci-shape` → **Exit 0**.
+- `bash scripts/ci/gates.sh run no-masked wf-shell wf-pinned
+  selftest-gates` → **Exit 0**.
+- `actionlint .github/workflows/ci.yml` (1.7.12) → **Exit 0**.
+- Pre-commit-Hook (Bahn precommit) lief bei jedem Commit, nie
+  `--no-verify`.
+
+## Review-Nachbesserungen (predecessor PR, 2026-09-25)
+
+Zwei Reviewer (claude sonnet, claude opus), Disposition:
+`.pa/review_pr182_disposition.md`. Angenommen und umgesetzt (red-first,
+`scripts/test-main-red-guard.sh` jetzt 58 Assertions, 15 Faelle;
+`scripts/test-ci-shape.sh` 24 Faelle):
+
+- **Entfrieren nur bei BEIDEN gelaufenen Bahnen** (sonnet S-6 / opus O-1,
+  hoch): vorher reichte eine — ein Push, der nur `package-lock.json`
+  aendert (linux voll, windows leicht), haette einen Windows-Rot-Freeze
+  aufgehoben, ohne windows je wieder geprueft zu haben.
+- **Erholungsweg ehrlich** (S-1/O-3): der Push nach dem Hotfix-Merge ist
+  per CI-02 leicht und entfriert nicht; Issue-Text und eine `::notice`
+  bei leichtem/teilweisem Lauf mit offenem Freeze nennen jetzt den
+  Handgriff (`gh workflow run ci.yml` auf main).
+- **Issue meldet den tatsaechlichen Freeze-Status** (S-3): erst
+  Freeze-Versuch, dann Issue/Kommentar — nie mehr "eingefroren"
+  behaupten, wenn der Freeze fehlte oder scheiterte. Freeze-Fehler mit
+  Token bleibt laut (exit 1), aber das Issue wird vorher noch ehrlich
+  geschrieben.
+- **Ueberholte Laeufe frieren nicht erneut ein** (S-5/O-5): Job-Concurrency
+  `main-red-guard` (kein cancel) plus SHA-Vergleich gegen den main-Kopf
+  (`gh api repos/<repo>/commits/main`); ein aelterer roter Lauf
+  kommentiert nur.
+- **Reihenfolge Gruen-Zweig** (S-7/O-6): erst Freezes loeschen, dann
+  Issues schliessen; scheitert ein Delete, bleibt das Issue offen und
+  der Job wird rot.
+- **Issue-Text korrigiert** (S-8/O-2): Ausnahme ist nur `label=hotfix`,
+  der Branch-Name `hotfix/...` reicht nicht — Text sagt das jetzt.
+- **Selbsttest-Luecken geschlossen** (S-4/O-9): fremder Freeze bleibt
+  stehen, windows-rot, POST-/Delete-Fehler isoliert
+  (`MOCK_CURL_FAIL_ON`), gruen ohne Token, nur-eine-Bahn.
+- **ci-shape Check 5 geschaerft** (S-9/O-10): exaktes
+  `github.ref == 'refs/heads/main'` (Mutation `!=` wird jetzt gefangen),
+  `lane_run` verankert, `id: plan` und die Env-Verdrahtung
+  `needs.<job>.outputs.lane_run` geprueft, Windows-Mutationsfall,
+  Concurrency-Mutationsfall.
+- **curl-Robustheit** (S-10/O-8): `--max-time 30`, `--fail-with-body`
+  (Fehlergrund sichtbar), `--retry 2` nur bei GET/Delete.
+- **Datei-Modi** (S-11): 100755 kommt mit diesem Commit (der Diff zeigte
+  100644; Windows `core.fileMode=false` hatte die Korrektur verborgen).
+
+Red-Beleg der Nachbesserung: die neuen Selbsttests gegen die alten
+Skripte aus `ef22e1f` → `test-main-red-guard.sh` **Exit 1** (11 Fehler),
+`test-ci-shape.sh` **Exit 1** (3 Fehler); mit den Fixes beide **Exit 0**.
+`gates.sh run selftest-main-red ci-shape no-masked wf-shell wf-pinned
+selftest-gates` → **Exit 0**, `actionlint` → **Exit 0**.
+
+Abgelehnt mit Beleg: S-2/O-4 (Freeze-Payload `"start":null` und die
+Endpunkte sind exakt das Wire-Format des offiziellen mergify-cli,
+verifiziert gegen `crates/mergify-freeze` create.rs/delete.rs/list.rs;
+die Queue-Pause-API ist ein anderes Feature) und O-7 (`always()`
+statt `!cancelled()`: cancel ist im Skript bereits No-Op, ein Timeout
+gilt als failure und SOLL feuern, Kosten vernachlaessigbar).
+
+## NICHT ABGEDECKT von diesem Lauf
+
+- **Live-Wirkung gegen Mergify**: ob `MERGIFY_TOKEN` (fuer CI Insights
+  angelegt) den Scope `scheduled_freeze` hat, ist lokal nicht beweisbar
+  (Secret write-only). Erster echter Beleg: ein roter oder gruener
+  main-Lauf nach dem Merge — oder ein manueller Probe-Freeze im
+  Mergify-Dashboard. Faellt der Freeze-POST mit 403, wird der Job laut
+  rot und das Issue traegt die Anleitung zum manuellen Einfrieren.
+- **Kein echter roter main-Lauf ausgeloest** (wuerde die Queue real
+  einfrieren; nur per workflow_dispatch nach Merge testbar).
+- **Linux-Haelfte der Gates** (KI-7): hier ohne Rust-Aenderung; die neuen
+  Gates laufen in der Bahn linux im CI-Lauf dieses PRs.
+- **Live-Wirkung gegen Mergify** bleibt offen (s. oben): Token-Scope erst
+  beim ersten echten Lauf beweisbar.
+- **Review-Regel erledigt**: zwei AI-Reviewer (claude sonnet + opus),
+  Disposition `.pa/review_pr182_disposition.md` im PR.
+
+## Folgepunkte
+
+- Nutzer: nach dem ersten echten Ereignis pruefen, ob der Freeze im
+  Mergify-Dashboard erscheint; falls 403, Application Key mit
+  Freeze-Recht als MERGIFY_TOKEN hinterlegen.
+- OPS-01/Startcheck koennten offene `ci-red`-Issues als hartes
+  Stoppsignal werten (Idee, kein Auftrag).
diff --git a/docs/decisions.md b/docs/decisions.md
index c4abeef..e0fc5a1 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -1387,3 +1387,40 @@ minutes are billed twice on private repos, so Windows alone was ~2850 of
   (`SCOUT_FILE`), so they need a store channel first. Reverse when: a
   coordinator needs a repository-side memory again - then via a worker task,
   not a coordinator write.
+
+## 2026-09-25 - CI-04: roter main friert die Mergify-Queue ein (scheduled freeze)
+
+Was: Der neue Job `main-red` in ci.yml (needs: linux + windows, nur
+refs/heads/main, immer nach den Gates) reagiert auf das Gesamtergebnis eines
+main-Laufs. Rot: Issue mit Label `ci-red` (Run-ID, Run-URL, SHA im Text;
+Kommentar statt Duplikat) plus Queue-Freeze ueber die Mergify-Scheduled-
+Freeze-API (`POST /v1/repos/<repo>/scheduled_freeze`, Marker `ci-red:` im
+Grund, Scope `base=main`, Ausnahme `label=hotfix`). Bewiesen gruen: Freeze
+geloescht, Issue geschlossen. Logik: scripts/ci/main-red-guard.sh, Selbsttest
+scripts/test-main-red-guard.sh (Gate `selftest-main-red`), Struktur gepinnt
+in ci-shape.sh (Check 5).
+
+Warum Mergify-Freeze statt eigener Sperre: der Freeze ist der eingebaute
+Mechanismus (docs.mergify.com/merge-queue/freeze) - die Queue haelt PRs
+zurueck und das Mergify-Check sagt den Grund. Eine eigene Bedingung in
+queue_conditions koennte nur je PR greifen, nicht global.
+
+Warum Job in ci.yml statt workflow_run-Workflow: nur im selben Lauf ist
+bekannt, ob die Bahnen wirklich liefen (lane-plan.sh-Output `run`, jetzt als
+Job-Output `lane_run`). Ein leichter Push, dessen Bahnen uebersprungen
+wurden, ist kein Gruen-Beweis und darf nicht entfrieren.
+
+Warum `label=hotfix`-Ausnahme: sonst koennte der Fix-PR selbst nie durch die
+eingefrorene Queue. `hotfix/` kennt .mergify.yml bereits (priority_rules).
+
+Kein neuer Dienst, kein Geld: das vorhandene Secret MERGIFY_TOKEN (seit CI-01
+fuer Test Insights) authentifiziert auch die Freeze-API. Ohne Token degradiert
+der Job laut, aber gruen: das Issue bleibt der Fallback (Muster wie
+MERGIFY_UPLOAD). Ein scheiternder API-Aufruf MIT Token ist rot (exit 1) - ein
+Guard, der nicht einfrieren kann, darf nicht gruen durch Abwesenheit sein.
+
+Reverse when: die Queue laeuft nicht mehr ueber Mergify, oder das Secret
+MERGIFY_TOKEN bekommt keinen Scope fuer scheduled_freeze (dann Nutzer:
+Application Key im Mergify-Dashboard mit Freeze-Recht anlegen). Offen bis zum
+ersten echten Ereignis: ob das bestehende Token den Freeze-Scope hat, ist
+erst an einem echten roten/gruenen main-Lauf beobachtbar.
diff --git a/scripts/ci/ci-shape.sh b/scripts/ci/ci-shape.sh
index ae9b822..73a9d09 100755
--- a/scripts/ci/ci-shape.sh
+++ b/scripts/ci/ci-shape.sh
@@ -18,6 +18,14 @@
 #   4. red-first runs inside the linux job (plan and proof) and the job
 #      `red-first` only evaluates it: `needs: linux`, the verdict script, and
 #      no setup-linux of its own.
+#   5. CI-04: the job `main-red` exists, waits for BOTH gate jobs, fires
+#      only on refs/heads/main (exact `==`, with always(), or a red gates
+#      job would skip it), calls scripts/ci/main-red-guard.sh, reads the
+#      lane outputs instead of hardcoded values and serializes its runs
+#      (job-level concurrency) - and both gate jobs export the lane_run
+#      output from a step `id: plan`, without which a light green push
+#      (lanes skipped) would count as green proof and lift the queue
+#      freeze.
 #
 # The YAML is read line-wise (awk), like the other workflow gates here: no
 # YAML library is guaranteed on the runner, the Git-Bash or WSL. Limit
@@ -135,6 +143,47 @@ has "$redfirst" "setup-linux" && err "job red-first: has its own setup-linux aga
 proof_if="$(step "red-first - proof against merge base" <<< "$linux" | grep -E '^        if:')"
 has "$proof_if" "steps.rf_plan.outputs.count != ''" || err "job linux: proof step 'if' lacks steps.rf_plan.outputs.count != '': $proof_if"
 
+# 5. CI-04: the main-red guard job - a red main opens an issue and freezes
+# the Mergify queue, a proven-green main lifts both.
+mainred="$(job main-red)"
+if [ -z "$mainred" ]; then
+  err "job main-red missing (CI-04: red main must freeze the queue)"
+else
+  has "$mainred" "name: main-red-guard" || err "job main-red: does not report 'main-red-guard'"
+  mainred_needs="$(grep -E '^    needs:' <<< "$mainred")"
+  has "$mainred_needs" "linux" || err "job main-red: 'needs' lacks linux - the guard could run without the linux verdict"
+  has "$mainred_needs" "windows" || err "job main-red: 'needs' lacks windows - the guard could run without the windows verdict"
+  mainred_if="$(grep -E '^    if:' <<< "$mainred")"
+  has "$mainred_if" "always()" || err "job main-red: 'if' lacks always() - a red gates job would skip the guard itself: $mainred_if"
+  # Exact operator: a substring check would also let != through, and then
+  # the guard would fire on every ref EXCEPT main (review predecessor PR, S-9/O-10).
+  grep -qE "github\.ref == 'refs/heads/main'" <<< "$mainred_if" ||
+    err "job main-red: 'if' must pin github.ref == 'refs/heads/main' exactly: $mainred_if"
+  has "$mainred" "main-red-guard.sh" || err "job main-red: does not call scripts/ci/main-red-guard.sh"
+  # The env wiring decides what the script believes about the lanes: a
+  # hardcoded "true" would make a light push look like a full run, a
+  # hardcoded failure would freeze a green main (review predecessor PR, S-9).
+  has "$mainred" 'LINUX_RAN: ${{ needs.linux.outputs.lane_run }}' ||
+    err "job main-red: LINUX_RAN must read needs.linux.outputs.lane_run"
+  has "$mainred" 'WINDOWS_RAN: ${{ needs.windows.outputs.lane_run }}' ||
+    err "job main-red: WINDOWS_RAN must read needs.windows.outputs.lane_run"
+  # Serialized guards: main runs do not cancel each other, and a stale red
+  # run must not interleave freeze/unfreeze with a newer green one (S-5/O-5).
+  has "$mainred" "group: main-red-guard" ||
+    err "job main-red: no job-level concurrency group - stale runs could interleave freeze/unfreeze"
+fi
+# Without the lane_run outputs a light green push (lanes skipped by
+# lane-plan.sh) would count as green proof and lift the freeze. Anchored:
+# the output line itself, not just the words somewhere in the job block
+# (full-line comments are already stripped by job()). And without a step
+# `id: plan` the output would silently be empty - the freeze could never
+# lift (review predecessor PR, S-9/O-10).
+lane_out_re='^      lane_run: \$\{\{ steps\.plan\.outputs\.run \}\}$'
+grep -qE "$lane_out_re" <<< "$linux" || err "job linux: output 'lane_run' missing - main-red cannot tell a real lane from a skipped one"
+grep -qE "$lane_out_re" <<< "$windows" || err "job windows: output 'lane_run' missing - main-red cannot tell a real lane from a skipped one"
+has "$linux" "id: plan" || err "job linux: step id 'plan' missing - lane_run would be empty and the freeze could never lift"
+has "$windows" "id: plan" || err "job windows: step id 'plan' missing - lane_run would be empty and the freeze could never lift"
+
 if [ "$errors" -gt 0 ]; then
   echo "ci-shape: $errors problem(s)"
   exit 1
diff --git a/scripts/ci/gates.sh b/scripts/ci/gates.sh
index 97289fa..b82d924 100755
--- a/scripts/ci/gates.sh
+++ b/scripts/ci/gates.sh
@@ -87,6 +87,12 @@ GATES=(
   # beide Richtungen (Rust-Aenderung -> voll, gelesene Doku -> voll, freie
   # Doku -> aus, Queue/Wochenlauf -> voll, main-Push nur bei Cache-Eingaben).
   "selftest-lane-plan|linux,release|.|bash scripts/test-lane-plan.sh"
+  # CI-04: bei rotem main Issue + Queue-Freeze, bei bewiesen gruenem main
+  # wieder auf. Der Selbsttest belegt beide Richtungen und die leisen
+  # Fehlerklassen: leichtes Gruen (Bahnen uebersprungen) darf NICHT
+  # entfrieren, ohne MERGIFY_TOKEN bleibt das Issue der Fallback (gruen mit
+  # Warnung), ein scheiternder Freeze-API-Aufruf MIT Token ist laut rot.
+  "selftest-main-red|linux,release|.|bash scripts/test-main-red-guard.sh"
 
   # --- schnell: Form und Typen --------------------------------------------
   "fmt|precommit,prepush,branchpush,linux,windows,release|src-tauri|cargo fmt --check"
diff --git a/scripts/ci/main-red-guard.sh b/scripts/ci/main-red-guard.sh
new file mode 100755
index 0000000..db2373f
--- /dev/null
+++ b/scripts/ci/main-red-guard.sh
@@ -0,0 +1,267 @@
+#!/usr/bin/env bash
+# main-red-guard.sh — CI-04: a red run on main stops the Mergify queue.
+#
+# Why this script exists: main is merged through the Mergify queue, which
+# tests every batch before merging — so a red main should be rare, but the
+# weekly full run (new stable rustc, runner-image drift) can turn main red
+# anyway. While main is red, every queued merge would add untested code on
+# top of a broken base. This script is the reaction, wired as the job
+# `main-red` in ci.yml (needs: linux + windows, only on refs/heads/main):
+#
+#   red run   -> freeze the queue via the Mergify scheduled-freeze API
+#                (reason marker "ci-red:", scope base=main, exception
+#                label=hotfix so the fix PR can still merge) and THEN open
+#                an issue (label `ci-red`, run ID + run URL + SHA in the
+#                body; comment instead of duplicating when one is open) so
+#                the issue can report the freeze state that ACTUALLY
+#                happened — never a freeze that was skipped or failed
+#                (review predecessor PR, sonnet S-3). Exception: a stale run whose
+#                SHA is no longer the main head only comments and never
+#                freezes — otherwise a slow old red run could freeze again
+#                after a newer run already went green (S-5 / opus O-5).
+#   green run -> delete every "ci-red:" freeze FIRST, then close the open
+#                issues (S-7 / O-6) — but only when BOTH lanes REALLY ran
+#                (lane-plan.sh output `run`). A light push whose lanes were
+#                skipped is no green proof, and neither is a push where
+#                only one lane ran (S-6 / O-1): lane-plan cache inputs
+#                differ per lane, so e.g. a package-lock-only push runs
+#                linux fully while windows stays light. While a ci-red
+#                freeze/issue is open such a run points at the manual full
+#                run (`gh workflow run ci.yml`) — the merge push after the
+#                hotfix is light by CI-02 design and cannot unfreeze (S-1 /
+#                O-3).
+#   else      -> cancelled/skipped/mixed results and every ref != main are
+#                a no-op (the job `if` guards too; this is the double guard).
+#
+# Mergify API (same endpoints and wire format the official mergify-cli
+# uses, crates/mergify-freeze — verified 2026-09-25 against create.rs /
+# delete.rs / list.rs): POST /v1/repos/<repo>/scheduled_freeze with
+# start/end = null (the documented open-ended emergency-freeze shape),
+# GET .../scheduled_freeze (answer key `scheduled_freezes`),
+# POST .../scheduled_freeze/<id>/delete with {"delete_reason": ...},
+# auth `Authorization: Bearer $MERGIFY_TOKEN`. Without MERGIFY_TOKEN the
+# freeze steps are skipped with a ::warning (the issue is the fallback —
+# same degrade pattern as the Test-Insights upload in ci.yml). Every other
+# external failure is LOUD (exit 1): a guard that cannot freeze while main
+# is red must not be green by absence (AGENTS.md).
+#
+# Inputs (env): GIT_REF, LINUX_RESULT, WINDOWS_RESULT, LINUX_RAN,
+# WINDOWS_RAN (lane-plan outputs "true"/"false"), RUN_ID, RUN_URL, SHA,
+# REPO (owner/repo), GH_TOKEN (used by gh itself), MERGIFY_TOKEN.
+#
+# Self-test: scripts/test-main-red-guard.sh
+set -uo pipefail
+
+: "${GIT_REF:?}" "${LINUX_RESULT:?}" "${WINDOWS_RESULT:?}" \
+  "${LINUX_RAN:=}" "${WINDOWS_RAN:=}" \
+  "${RUN_ID:?}" "${RUN_URL:?}" "${SHA:?}" "${REPO:?}"
+MERGIFY_TOKEN="${MERGIFY_TOKEN:-}"
+
+API="https://api.mergify.com/v1/repos/$REPO"
+MARKER="ci-red:"
+
+note() { echo "::notice title=main-red-guard::$*"; }
+warn() { echo "::warning title=main-red-guard::$*"; }
+fail() { echo "::error title=main-red-guard::$*"; exit 1; }
+
+summary() {
+  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"
+  return 0
+}
+
+# --- helpers ---------------------------------------------------------------
+
+# mg_api <method> <path> [json-body] [retry] — one Mergify API call, loud on
+# failure. --fail-with-body keeps the server's error message visible (plain
+# -f would discard it); --max-time so a hanging API cannot eat the whole
+# 5-minute job budget. Retry only where the call is idempotent (GET,
+# delete) — never on the create POST (review predecessor PR, S-10 / opus O-8).
+mg_api() {
+  local method="$1" path="$2" body="${3:-}" retry="${4:-}"
+  local args=(-sS --fail-with-body --max-time 30 -X "$method" -H "Authorization: Bearer $MERGIFY_TOKEN")
+  [ -n "$retry" ] && args+=(--retry 2 --retry-all-errors)
+  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data "$body")
+  curl "${args[@]}" "$API$path"
+}
+
+# freeze_ids — IDs of our freezes (reason starts with the marker), one/line.
+freeze_ids() {
+  mg_api GET /scheduled_freeze "" retry | node -e '
+    const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
+    for (const f of d.scheduled_freezes || [])
+      if (f.id && (f.reason || "").startsWith("ci-red:")) console.log(f.id);
+  '
+}
+
+# open_ci_red_issues — numbers of open issues with label ci-red, one/line.
+open_ci_red_issues() {
+  gh issue list --repo "$REPO" --label ci-red --state open --json number --limit 50 |
+    node -e '
+      const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
+      for (const i of d) console.log(i.number);
+    '
+}
+
+# issue_body <failed-lanes> <freeze-state-sentence>
+issue_body() {
+  cat <<EOF
+**main ist rot** (CI-04).
+
+- Run-ID: $RUN_ID
+- Run: $RUN_URL
+- Commit: $SHA
+- Rote Bahn(en): $1
+
+**Freeze-Status:** $2
+
+Wie es weitergeht:
+
+1. Fix-PR mit Label \`hotfix\` — der Freeze laesst \`label=hotfix\` durch
+   (der Branch-Name allein reicht NICHT).
+2. Der Push nach dem Queue-Merge des Fixes ist ein LEICHTER Lauf (Bahnen
+   uebersprungen) und hebt den Freeze nicht auf. Nach dem Merge des Fixes
+   einen vollen Lauf starten: \`gh workflow run ci.yml\` (Actions -> ci ->
+   Run workflow, Branch main). Ein gruener Lauf, bei dem BEIDE Bahnen
+   wirklich gelaufen sind, loescht den Freeze und schliesst dieses Issue
+   automatisch.
+3. Manuell: Mergify-Dashboard -> Merge Protections -> Scheduled Freezes,
+   Freeze \`ci-red: ...\` loeschen, danach dieses Issue schliessen.
+EOF
+}
+
+# --- double guard: only main -----------------------------------------------
+if [ "$GIT_REF" != "refs/heads/main" ]; then
+  note "ref $GIT_REF ist nicht main - nichts zu tun (Job-if greift zuerst)."
+  exit 0
+fi
+
+red="false"
+[ "$LINUX_RESULT" = "failure" ] && red="true"
+[ "$WINDOWS_RESULT" = "failure" ] && red="true"
+green="false"
+[ "$LINUX_RESULT" = "success" ] && [ "$WINDOWS_RESULT" = "success" ] && green="true"
+
+if [ "$red" = "false" ] && [ "$green" = "false" ]; then
+  note "Ergebnisse linux=$LINUX_RESULT windows=$WINDOWS_RESULT - weder rot noch gruen (cancelled/skipped), nichts zu tun."
+  exit 0
+fi
+
+# --- red: freeze first, then an issue that reports the ACTUAL state --------
+if [ "$red" = "true" ]; then
+  failed=""
+  [ "$LINUX_RESULT" = "failure" ] && failed="gates (linux)"
+  [ "$WINDOWS_RESULT" = "failure" ] && failed="${failed:+$failed, }gates (windows)"
+
+  gh label create ci-red --repo "$REPO" --color B60205 --force \
+    --description "main ist rot (CI-04)" ||
+    fail "gh label create fehlgeschlagen"
+
+  # A stale run (its SHA is no longer the main head) must not freeze again:
+  # main runs do not cancel each other, so a slow old red run could finish
+  # after a newer run already went green (review predecessor PR, S-5 / O-5).
+  head="$(gh api "repos/$REPO/commits/main" --jq .sha)" ||
+    fail "gh api commits/main fehlgeschlagen"
+  if [ "$head" != "$SHA" ]; then
+    note "ueberholter Lauf: $SHA ist nicht mehr der main-Kopf ($head) - kein neuer Freeze."
+    existing="$(open_ci_red_issues)" || fail "gh issue list fehlgeschlagen"
+    if [ -n "$existing" ]; then
+      first="$(printf '%s\n' "$existing" | head -1)"
+      gh issue comment "$first" --repo "$REPO" \
+        --body "Ueberholter Lauf rot: Run $RUN_ID ($RUN_URL), Commit $SHA - der main-Kopf ist inzwischen $head. Kein neuer Freeze; der Lauf auf dem Kopf entscheidet." ||
+        fail "gh issue comment fehlgeschlagen"
+      echo "Issue #$first kommentiert (ueberholter Lauf, kein Freeze)."
+    fi
+    summary "### main-red-guard: ROT (ueberholt)" "$SHA != Kopf $head - kein Freeze"
+    exit 0
+  fi
+
+  freeze_state="" freeze_failed=0
+  if [ -z "$MERGIFY_TOKEN" ]; then
+    freeze_state="Der Queue-Freeze wurde NICHT gesetzt (MERGIFY_TOKEN fehlt) - bitte manuell einfrieren: Mergify-Dashboard -> Merge Protections -> Scheduled Freezes, Grund 'ci-red:', Scope base=main, Ausnahme label=hotfix."
+    warn "MERGIFY_TOKEN ist nicht gesetzt - Queue-Freeze uebersprungen. Das Issue bleibt die Absicherung; Freeze manuell im Mergify-Dashboard setzen."
+  elif ! ids="$(freeze_ids)"; then
+    freeze_state="ACHTUNG: die Mergify-Freeze-Liste war nicht lesbar (API-Fehler) - der Freeze-Status ist unbekannt, bitte manuell pruefen und noetigenfalls einfrieren."
+    freeze_failed=1
+  elif [ -n "$ids" ]; then
+    freeze_state="Die Mergify-Queue war bereits eingefroren (Marker ci-red:, ID(s): $(printf '%s' "$ids" | tr '\n' ' '))."
+    echo "Freeze mit Marker '$MARKER' existiert bereits: $(printf '%s' "$ids" | tr '\n' ' ')- kein zweiter."
+  else
+    payload="$(printf '{"reason":"ci-red: main red, run %s","start":null,"end":null,"timezone":"UTC","matching_conditions":["base=main"],"exclude_conditions":["label=hotfix"]}' "$RUN_ID")"
+    if mg_api POST /scheduled_freeze "$payload" > /dev/null; then
+      freeze_state="Die Mergify-Queue wurde eingefroren (ci-red: main red, run $RUN_ID; Ausnahme: label=hotfix)."
+      echo "Queue eingefroren (ci-red: main red, run $RUN_ID; Ausnahme: label=hotfix)."
+    else
+      freeze_state="ACHTUNG: der Queue-Freeze konnte NICHT angelegt werden (Mergify-API-Fehler) - die Queue laeuft weiter, obwohl main rot ist! Bitte manuell einfrieren (s. unten)."
+      freeze_failed=1
+    fi
+  fi
+
+  body="$(issue_body "$failed" "$freeze_state")"
+  existing="$(open_ci_red_issues)" || fail "gh issue list fehlgeschlagen"
+  if [ -z "$existing" ]; then
+    gh issue create --repo "$REPO" --label ci-red \
+      --title "Roter main: Run $RUN_ID" --body "$body" ||
+      fail "gh issue create fehlgeschlagen"
+    echo "Issue angelegt (Label ci-red, Run $RUN_ID)."
+  else
+    first="$(printf '%s\n' "$existing" | head -1)"
+    gh issue comment "$first" --repo "$REPO" \
+      --body "Erneut rot: Run $RUN_ID ($RUN_URL), Commit $SHA, Bahn(en): $failed. Freeze-Status: $freeze_state" ||
+      fail "gh issue comment fehlgeschlagen"
+    echo "Issue #$first schon offen - kommentiert statt dupliziert."
+  fi
+
+  [ "$freeze_failed" = 1 ] &&
+    fail "Mergify: Freeze nicht gesichert - die Queue laeuft moeglicherweise weiter, obwohl main rot ist (Details im Issue)."
+  summary "### main-red-guard: ROT" "$freeze_state"
+  exit 0
+fi
+
+# --- green: only a FULL run (both lanes) is proof ---------------------------
+if [ "$LINUX_RAN" != "true" ] || [ "$WINDOWS_RAN" != "true" ]; then
+  msg="kein voller Lauf (linux run=${LINUX_RAN:-leer}, windows run=${WINDOWS_RAN:-leer}) - kein Gruen-Beweis, Freeze bleibt"
+  existing="$(open_ci_red_issues)" || fail "gh issue list fehlgeschlagen"
+  ids=""
+  if [ -n "$MERGIFY_TOKEN" ]; then
+    ids="$(freeze_ids)" || fail "Mergify: Freeze-Liste nicht lesbar"
+  fi
+  if [ -n "$existing" ] || [ -n "$ids" ]; then
+    note "$msg. Ein ci-red-Freeze/Issue ist noch offen - nach dem Fix-Merge einen vollen Lauf starten: gh workflow run ci.yml (Branch main). Nur der entfriert."
+  else
+    note "$msg."
+  fi
+  exit 0
+fi
+
+# Delete our freezes BEFORE closing the issues (S-7/O-6): if a delete fails
+# the issue must stay open - a closed issue with a live freeze would look
+# resolved while the queue is still frozen.
+del_failed=0
+if [ -z "$MERGIFY_TOKEN" ]; then
+  warn "MERGIFY_TOKEN ist nicht gesetzt - kann keinen Freeze loeschen. Falls einer aktiv ist: manuell im Mergify-Dashboard loeschen."
+else
+  ids="$(freeze_ids)" || fail "Mergify: Freeze-Liste nicht lesbar"
+  for id in $ids; do
+    if mg_api POST "/scheduled_freeze/$id/delete" \
+        "{\"delete_reason\":\"main green again, run $RUN_ID\"}" retry > /dev/null; then
+      echo "Freeze $id geloescht."
+    else
+      echo "::error title=main-red-guard::Mergify: Freeze $id konnte nicht geloescht werden"
+      del_failed=1
+    fi
+  done
+fi
+[ "$del_failed" = 1 ] &&
+  fail "Freeze(s) konnten nicht geloescht werden - Issue(s) bleiben offen, bis der Freeze weg ist."
+
+closed=""
+existing="$(open_ci_red_issues)" || fail "gh issue list fehlgeschlagen"
+for n in $existing; do
+  gh issue close "$n" --repo "$REPO" \
+    --comment "Gruen bewiesen: Run $RUN_ID ($RUN_URL), Commit $SHA - beide Bahnen gelaufen. Freeze aufgehoben (CI-04)." ||
+    fail "gh issue close #$n fehlgeschlagen"
+  closed="$closed #$n"
+done
+[ -n "$closed" ] && echo "Issues geschlossen:$closed"
+summary "### main-red-guard: GRUEN" "Issues geschlossen:${closed:-keine}" "Freezes geloescht: ${ids:-keine/uebersprungen}"
+exit 0
diff --git a/scripts/test-ci-shape.sh b/scripts/test-ci-shape.sh
index e049cb4..842cafe 100755
--- a/scripts/test-ci-shape.sh
+++ b/scripts/test-ci-shape.sh
@@ -121,6 +121,33 @@ case_m auto-merge-drift mg '/^  auto_merge_conditions:/,/^[a-z]/ { /check-succes
 # .mergify.yml: a required check missing from merge_conditions.
 case_m merge-condition-missing mg '/^    merge_conditions:/,/^[a-z]/ { /check-success = gates \(windows\)/d }' \
   "merge_conditions lacks 'check-success = gates \\(windows\\)'"
+# ci.yml (CI-04): the main-red job no longer waits for both gate jobs.
+case_m main-red-without-needs ci '/^  main-red:/,$ s/^    needs: \[linux, windows\]$/    needs: []/' \
+  "main-red.*needs"
+# ... or fires without always(), so a red gates job would skip the guard.
+case_m main-red-without-always ci 's/if: \$\{\{ always\(\) &&/if: ${{/' \
+  "main-red.*always"
+# ... or is no longer bound to main (would fire on any ref).
+case_m main-red-if-without-main ci "s#github\\.ref == 'refs/heads/main'#github.ref == 'refs/heads/qa'#" \
+  "main-red.*refs/heads/main"
+# ... or the lane_run output is gone - a light green push could unfreeze.
+case_m main-red-without-lane-run ci '/^  linux:/,/^  windows:/ s/^      lane_run: .*$//' \
+  "linux.*lane_run"
+# ... same for the windows job (review predecessor PR, sonnet S-9).
+case_m main-red-without-lane-run-windows ci '/^  windows:/,/^  red-first:/ s/^      lane_run: .*$//' \
+  "windows.*lane_run"
+# ... or inverted: != instead of == would fire on EVERY ref but main
+# (review predecessor PR, S-9/O-10: a substring check lets this through).
+case_m main-red-if-inverted ci "s#github\\.ref == 'refs/heads/main'#github.ref != 'refs/heads/main'#" \
+  "main-red.*refs/heads/main"
+# ... or the guard no longer reads the lane outputs - a light push would
+# look like a full one (review predecessor PR, S-9).
+case_m main-red-without-ran-wiring ci 's#\$\{\{ needs\.linux\.outputs\.lane_run \}\}#"true"#' \
+  "main-red.*needs.linux.outputs.lane_run"
+# ... or the guards race: without a job-level concurrency group a stale red
+# run can freeze again after a newer green run lifted it (S-5/O-5).
+case_m main-red-without-concurrency ci '/^  main-red:/,$ s/^      group: main-red-guard$//' \
+  "main-red.*concurrency"
 
 # Call errors are errors, not a silent pass.
 check missing-file fail "$tmp/does-not-exist.yml" "$MG" "not found"
diff --git a/scripts/test-main-red-guard.sh b/scripts/test-main-red-guard.sh
new file mode 100755
index 0000000..472b6e7
--- /dev/null
+++ b/scripts/test-main-red-guard.sh
@@ -0,0 +1,301 @@
+#!/usr/bin/env bash
+# Self-test for scripts/ci/main-red-guard.sh (CI-04).
+#
+# CI-04: a red run on main must open an issue (label `ci-red`, run ID in the
+# body) and freeze the Mergify queue; a green run that actually ran BOTH
+# lanes must lift the freeze and close the issue. This test pins that
+# contract - including the failure modes that must NOT silently pass:
+#   - a "light" green push (lanes skipped by lane-plan.sh) is no green
+#     proof and must not unfreeze - and neither is a push where only ONE
+#     lane really ran (review predecessor PR, sonnet S-6 / opus O-1);
+#   - a light/partial push with an open ci-red freeze/issue must point at
+#     the manual full run (`gh workflow run ci.yml`) - the merge push after
+#     the hotfix is light by design (review predecessor PR, S-1 / O-3);
+#   - the issue text must carry the ACTUAL freeze state, never claim a
+#     freeze that was skipped or failed (review predecessor PR, S-3);
+#   - a stale red run (its SHA is no longer the main head) must comment,
+#     not freeze (review predecessor PR, S-5 / O-5);
+#   - a freeze whose reason does not start with the marker must survive
+#     the green sweep (review predecessor PR, S-4);
+#   - the freeze is deleted BEFORE the issue is closed (review predecessor PR,
+#     S-7 / O-6);
+#   - without MERGIFY_TOKEN the issue is still opened and the freeze is
+#     skipped with a warning (degraded, not red - the same pattern as the
+#     Test-Insights upload in ci.yml);
+#   - a failing freeze API call WITH a token is loud (exit 1) - for the
+#     list, the create AND the delete path (review predecessor PR, S-4 / O-9);
+#   - any ref that is not main is a no-op (double guard next to the job `if`).
+#
+# `curl` and `gh` are replaced by PATH shims that log every call to $MOCK_LOG
+# and answer from $MOCK_FREEZES_JSON / $MOCK_ISSUES_JSON /
+# $MOCK_MAIN_HEAD_SHA. No network, no secret, no real issue.
+set -uo pipefail
+
+HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
+SUT="${MAIN_RED_GUARD_SCRIPT:-$HERE/scripts/ci/main-red-guard.sh}"
+tmp="$(mktemp -d "${TMPDIR:-/tmp}/main-red-guard.XXXXXX")"
+trap 'rm -rf "$tmp"' EXIT
+fails=0
+
+if [ ! -f "$SUT" ]; then
+  echo "FEHLER: $SUT fehlt (Red-first: Implementierung folgt)"
+  exit 1
+fi
+
+# --- PATH shims ------------------------------------------------------------
+mkdir -p "$tmp/bin"
+
+cat > "$tmp/bin/curl" <<'SHIM'
+#!/usr/bin/env bash
+# one log line per call, even when a payload carries newlines
+printf '%s\n' "curl $*" | tr '\n' ' ' >> "$MOCK_LOG"
+echo >> "$MOCK_LOG"
+args="$*"
+if [ "${MOCK_CURL_FAIL:-}" = "1" ]; then
+  echo "mock curl: simulated HTTP failure" >&2
+  exit 22
+fi
+# selective failure: MOCK_CURL_FAIL_ON=POST fails every POST (create),
+# =delete only the delete calls, =scheduled_freeze also the GET list
+if [ -n "${MOCK_CURL_FAIL_ON:-}" ] && [[ "$args" == *"$MOCK_CURL_FAIL_ON"* ]]; then
+  echo "mock curl: simulated failure on '$MOCK_CURL_FAIL_ON'" >&2
+  exit 22
+fi
+case "$args" in
+  *"/delete"*) echo '{}' ;;
+  *"POST"*) echo '{"id":"frz_new","reason":"created"}' ;;
+  *) cat "$MOCK_FREEZES_JSON" ;;
+esac
+SHIM
+
+cat > "$tmp/bin/gh" <<'SHIM'
+#!/usr/bin/env bash
+printf '%s\n' "gh $*" | tr '\n' ' ' >> "$MOCK_LOG"
+echo >> "$MOCK_LOG"
+case "$*" in
+  *"api repos"*) echo "${MOCK_MAIN_HEAD_SHA:-deadbeefcafe}" ;;
+  *"issue list"*) cat "$MOCK_ISSUES_JSON" ;;
+  *"issue create"*) echo "https://example.test/issues/99" ;;
+esac
+exit 0
+SHIM
+
+chmod +x "$tmp/bin/curl" "$tmp/bin/gh"
+
+# --- case runner -----------------------------------------------------------
+# case_run <name> <git_ref> <linux_result> <windows_result> <linux_ran>
+#          <windows_ran> <token> <curl_fail> [curl_fail_on] [main_head_sha]
+# freezes/issues answers come from $tmp/freezes.json / $tmp/issues.json,
+# which each case writes first. Assertion of the log is left to the case.
+run_case() {
+  local name="$1"; shift
+  : > "$tmp/log"
+  MOCK_LOG="$tmp/log" \
+  MOCK_FREEZES_JSON="$tmp/freezes.json" \
+  MOCK_ISSUES_JSON="$tmp/issues.json" \
+  MOCK_CURL_FAIL="$7" \
+  MOCK_CURL_FAIL_ON="${8:-}" \
+  MOCK_MAIN_HEAD_SHA="${9:-deadbeefcafe}" \
+  PATH="$tmp/bin:$PATH" \
+  GIT_REF="$1" LINUX_RESULT="$2" WINDOWS_RESULT="$3" \
+  LINUX_RAN="$4" WINDOWS_RAN="$5" \
+  MERGIFY_TOKEN="$6" GH_TOKEN="fake" \
+  RUN_ID="424242" RUN_URL="https://example.test/runs/424242" \
+  SHA="deadbeefcafe" REPO="owner/repo" \
+  bash "$SUT" > "$tmp/out" 2>&1
+}
+
+expect_ok() { # name ...
+  local name="$1"; shift
+  if run_case "$name" "$@"; then
+    echo "ok   $name (exit 0)"
+  else
+    echo "FEHLER $name: exit != 0"
+    sed 's/^/    /' "$tmp/out"
+    fails=$((fails + 1))
+  fi
+}
+
+expect_red() { # name ...
+  local name="$1"; shift
+  if run_case "$name" "$@"; then
+    echo "FEHLER $name: exit 0, erwartet Fehler"
+    sed 's/^/    /' "$tmp/out"
+    fails=$((fails + 1))
+  else
+    echo "ok   $name (laut rot)"
+  fi
+}
+
+log_has() { # name pattern
+  if grep -qE -- "$2" "$tmp/log"; then
+    echo "ok   $1"
+  else
+    echo "FEHLER $1: Muster '$2' fehlt im Aufrufprotokoll:"
+    sed 's/^/    /' "$tmp/log"
+    fails=$((fails + 1))
+  fi
+}
+
+log_lacks() { # name pattern
+  if grep -qE -- "$2" "$tmp/log"; then
+    echo "FEHLER $1: Muster '$2' darf nicht im Aufrufprotokoll stehen:"
+    sed 's/^/    /' "$tmp/log"
+    fails=$((fails + 1))
+  else
+    echo "ok   $1"
+  fi
+}
+
+# log_before name pattern1 pattern2 — first match of pattern1 must precede
+# first match of pattern2 in the call log.
+log_before() {
+  local n1 n2
+  n1="$(grep -nE -- "$2" "$tmp/log" | head -1 | cut -d: -f1)"
+  n2="$(grep -nE -- "$3" "$tmp/log" | head -1 | cut -d: -f1)"
+  if [ -n "$n1" ] && [ -n "$n2" ] && [ "$n1" -lt "$n2" ]; then
+    echo "ok   $1"
+  else
+    echo "FEHLER $1: '$2' (Zeile ${n1:-keine}) nicht vor '$3' (Zeile ${n2:-keine}):"
+    sed 's/^/    /' "$tmp/log"
+    fails=$((fails + 1))
+  fi
+}
+
+out_has() { # name pattern
+  if grep -qE -- "$2" "$tmp/out"; then
+    echo "ok   $1"
+  else
+    echo "FEHLER $1: Muster '$2' fehlt in der Ausgabe:"
+    sed 's/^/    /' "$tmp/out"
+    fails=$((fails + 1))
+  fi
+}
+
+# Args for run_case beyond the name:
+#   GIT_REF LINUX_RESULT WINDOWS_RESULT LINUX_RAN WINDOWS_RAN
+#   MERGIFY_TOKEN CURL_FAIL [CURL_FAIL_ON] [MAIN_HEAD_SHA]
+#   (freezes/issues via files)
+RED_MAIN=(refs/heads/main failure success true true mut-fake)
+RED_WINDOWS=(refs/heads/main success failure true true mut-fake)
+GREEN_MAIN=(refs/heads/main success success true true mut-fake)
+PARTIAL_MAIN=(refs/heads/main success success true false mut-fake)
+
+# --- 1. red, nothing open: issue + freeze, both carry the run ID -----------
+echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
+echo '[]' > "$tmp/issues.json"
+expect_ok red-fresh "${RED_MAIN[@]}" 0
+log_has red-fresh-creates-label 'gh label create .*ci-red'
+log_has red-fresh-creates-issue 'gh issue create .*--label ci-red'
+log_has red-fresh-issue-has-run-id 'gh issue create .*424242'
+log_has red-fresh-creates-freeze 'curl .*POST .*scheduled_freeze'
+log_has red-fresh-freeze-has-run-id 'curl .*ci-red:.*424242'
+log_has red-fresh-freeze-scoped-main 'base=main'
+log_has red-fresh-freeze-hotfix-exception 'label=hotfix'
+# the issue reports the freeze only because it really happened (S-3)
+log_has red-fresh-issue-states-freeze 'gh issue create .*wurde eingefroren'
+
+# --- 2. red, already open: comment instead of duplicate, no second freeze --
+echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
+echo '[{"number":7}]' > "$tmp/issues.json"
+expect_ok red-duplicate "${RED_MAIN[@]}" 0
+log_lacks red-duplicate-no-new-issue 'gh issue create'
+log_has red-duplicate-comments 'gh issue comment '
+log_has red-duplicate-comment-states-freeze 'gh issue comment .*eingefroren'
+log_lacks red-duplicate-no-second-freeze 'curl .*POST .*scheduled_freeze'
+
+# --- 3. green, both lanes ran: freeze deleted BEFORE the issue is closed ---
+echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
+echo '[{"number":7}]' > "$tmp/issues.json"
+expect_ok green-unfreeze "${GREEN_MAIN[@]}" 0
+log_has green-unfreeze-deletes 'curl .*POST .*scheduled_freeze/frz1/delete'
+log_has green-unfreeze-closes-issue 'gh issue close 7'
+log_before green-unfreeze-order 'curl .*scheduled_freeze/frz1/delete' 'gh issue close 7'
+
+# --- 3b. green, foreign freeze present: only the marker freeze is deleted --
+echo '{"scheduled_freezes":[{"id":"frzX","reason":"manual maintenance freeze"},{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
+echo '[{"number":7}]' > "$tmp/issues.json"
+expect_ok green-foreign-freeze "${GREEN_MAIN[@]}" 0
+log_has green-foreign-deletes-ours 'curl .*POST .*scheduled_freeze/frz1/delete'
+log_lacks green-foreign-keeps-theirs 'frzX/delete'
+
+# --- 4. green, but both lanes skipped (light push): NO unfreeze, and with --
+# --- an open freeze/issue the notice points at the manual full run --------
+echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
+echo '[{"number":7}]' > "$tmp/issues.json"
+expect_ok green-light refs/heads/main success success false false mut-fake 0
+log_lacks green-light-no-delete 'curl .*POST .*delete'
+log_lacks green-light-no-close 'gh issue close'
+out_has green-light-says-why 'light|leicht|nicht gelaufen|skipped|run=false'
+out_has green-light-dispatch-hint 'workflow run ci\.yml|workflow_dispatch'
+
+# --- 4b. green, only ONE lane ran: still no green proof (S-6/O-1) ----------
+expect_ok green-partial "${PARTIAL_MAIN[@]}" 0
+log_lacks green-partial-no-delete 'curl .*POST .*delete'
+log_lacks green-partial-no-close 'gh issue close'
+out_has green-partial-dispatch-hint 'workflow run ci\.yml|workflow_dispatch'
+
+# --- 5. cancelled run: no-op ------------------------------------------------
+expect_ok cancelled-noop refs/heads/main cancelled success true true mut-fake 0
+log_lacks cancelled-noop-no-issue 'gh issue (create|comment)'
+log_lacks cancelled-noop-no-freeze 'curl .*POST'
+
+# --- 6. red without MERGIFY_TOKEN: issue yes, freeze skipped with warning, -
+# --- and the issue must NOT claim a freeze that never happened (S-3) -------
+echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
+echo '[]' > "$tmp/issues.json"
+expect_ok red-no-token refs/heads/main failure success true true "" 0
+log_has red-no-token-creates-issue 'gh issue create'
+log_lacks red-no-token-no-curl 'curl'
+out_has red-no-token-warns 'warning|MERGIFY_TOKEN'
+log_lacks red-no-token-no-freeze-claim 'gh issue create .*wurde eingefroren'
+log_has red-no-token-issue-honest 'gh issue create .*manuell'
+
+# --- 7. red, freeze API fails WITH token: loud red, issue still written ----
+echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
+echo '[]' > "$tmp/issues.json"
+expect_red red-freeze-api-fails "${RED_MAIN[@]}" 1
+log_has red-freeze-api-fails-issue 'gh issue create'
+
+# --- 7b. red, only the freeze POST fails: loud red, honest issue (O-9) -----
+expect_red red-freeze-post-fails "${RED_MAIN[@]}" 0 POST
+log_has red-freeze-post-fails-issue 'gh issue create .*NICHT'
+
+# --- 7c. red, but the SHA is no longer the main head: comment, no freeze ---
+echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
+echo '[{"number":7}]' > "$tmp/issues.json"
+expect_ok red-stale-sha "${RED_MAIN[@]}" 0 "" ffff0000aaaabbbb
+log_has red-stale-checks-head 'gh api .*commits/main'
+log_lacks red-stale-no-freeze 'curl .*POST'
+log_lacks red-stale-no-new-issue 'gh issue create'
+log_has red-stale-comments 'gh issue comment '
+
+# --- 7d. red on the windows lane only: issue names the lane -----------------
+echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
+echo '[]' > "$tmp/issues.json"
+expect_ok red-windows "${RED_WINDOWS[@]}" 0
+log_has red-windows-names-lane 'gh issue create .*windows'
+
+# --- 7e. green, freeze delete fails: loud red, issue stays open ------------
+echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
+echo '[{"number":7}]' > "$tmp/issues.json"
+expect_red green-delete-fails "${GREEN_MAIN[@]}" 0 delete
+log_lacks green-delete-fails-no-close 'gh issue close'
+
+# --- 7f. green without MERGIFY_TOKEN: issues closed, delete warned ---------
+expect_ok green-no-token refs/heads/main success success true true "" 0
+log_has green-no-token-closes 'gh issue close 7'
+out_has green-no-token-warns 'warning|MERGIFY_TOKEN'
+
+# --- 8. not main: no-op even when red ---------------------------------------
+echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
+echo '[]' > "$tmp/issues.json"
+expect_ok not-main refs/heads/claude/ci-04 failure failure true true mut-fake 0
+log_lacks not-main-no-issue 'gh issue create'
+log_lacks not-main-no-freeze 'curl'
+
+if [ "$fails" -gt 0 ]; then
+  echo "test-main-red-guard: $fails Fehler"
+  exit 1
+fi
+echo "test-main-red-guard: alle Faelle gruen"
```
