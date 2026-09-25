# Review-Auftrag: predecessor PR — CI-04 "Roter main stoppt die Queue"

Du bist unabhaengiger Reviewer (nicht Autor; der Autor war ein anderes
Modell). Pruefe den Diff unten auf KORREKTHEITSFEHLER und Luecken, die zu
einem "gruen durch Abwesenheit" fuehren koennen (ein Gate/Job meldet
Erfolg, ohne das Relevante geprueft zu haben), auf Fehler in der
GitHub-Actions-Semantik, auf Fehler in der Mergify-API-Nutzung und auf
Shell-Fehler. Stil ist egal. Nenne jeden Befund mit Schwere
(hoch/mittel/niedrig), Datei und Zeile, was bricht und wann, und einem
konkreten Vorschlag. Keine Befunde erfinden: wenn etwas korrekt ist, sag
das knapp. Ende mit dem Urteil "mergebar: ja/nein".

## Kontext

- Repo: Tauri-App (Rust-Crate `src-tauri/`, React-Frontend `src/`,
  Node-Skripte `scripts/`). Gates stehen in `scripts/ci/gates.sh` (Bahnen
  linux, windows, prepush, ...). `ci.yml` hat die Jobs `linux`, `windows`
  und `red-first`. Required Checks auf main: diese drei plus
  `Mergify Merge Protections`. Merges laufen ueber eine
  Mergify-Merge-Queue.
- CI-02 hat leichte vs. volle Laeufe eingefuehrt: ein Push auf main kann
  "leicht" sein (Bahnen uebersprungen, Erfolg gemeldet). Der lane-plan
  gibt pro Bahn `lane_run` aus (true/false).
- Ziel dieses PRs (CI-04 aus docs/PLAN.md): Wird ein Lauf auf `main` rot,
  oeffnet die CI ein Issue (Label `ci-red`, Run-ID/URL/SHA, rote Bahnen;
  Kommentar statt Duplikat bei schon offenem Issue) und friert die
  Mergify-Queue ein (Scheduled-Freeze-API, dieselben Endpunkte wie der
  offizielle mergify-cli: `POST/GET /v1/repos/<repo>/scheduled_freeze`,
  `POST .../<id>/delete`, Bearer `MERGIFY_TOKEN`). Grund
  `ci-red: main red, run <ID>`, Scope `base=main`, Ausnahme
  `label=hotfix` (Fix-PR darf mergen). Wird main wieder gruen UND lief
  mindestens eine Bahn wirklich (`lane_run` true), wird der Freeze
  geloescht und das Issue geschlossen. Ein leichtes Gruen (beide Bahnen
  uebersprungen) entfriert NICHT.
- Degradation: ohne `MERGIFY_TOKEN` Issue trotzdem, Freeze mit
  `::warning` uebersprungen; scheiternder API-Aufruf MIT Token ist
  Exit 1. Cancelled-Runs und Refs != main sind No-Op (Skript prueft den
  Ref zusaetzlich zum Job-`if`).
- Der neue Job `main-red` in ci.yml: `needs: [linux, windows]`,
  `if: always() && ... ref == refs/heads/main`, kein Required Check,
  Rechte nur `contents: read` + `issues: write`.
- `MERGIFY_TOKEN` existiert als Repo-Secret seit CI-01 (Test Insights);
  ob es den Scope `scheduled_freeze` hat, ist lokal nicht beweisbar.
- Neue Selbsttests: `scripts/test-main-red-guard.sh` (30 Faelle),
  Gate `selftest-main-red` in gates.sh, ci-shape.sh Check 5 plus vier
  Mutationsfaelle in `scripts/test-ci-shape.sh`.

## Worauf besonders achten

- Kann der Job bei rotem main still bleiben (Issue/Freeze faellt weg,
  Job trotzdem gruen)? Kann er bei gruenem main faelschlich feuern?
- `always()` + `needs`-Semantik: was passiert, wenn `linux`/`windows`
  gecancelt oder uebersprungen werden? Sind die Ergebnis-Abfragen
  (`needs.<job>.result`, Outputs) korrekt — insb. werden Outputs von
  uebersprungenen/gecancelten Jobs leer statt falsch-negativ?
- Leichtes Gruen: ist die `lane_run`-Logik wasserdicht (Outputs an den
  richtigen Steps, kein Default-"true")?
- Mergify-API: Endpunkte, HTTP-Methoden, JSON-Felder (name, reason,
  conditions/scope, exceptions), Delete-Pfad, Dedup ueber GET — stimmen
  sie mit der dokumentierten Scheduled-Freeze-API ueberein? Kann der
  Delete-Aufruf einen fremden Freeze loeschen?
- Issue-Dedup: kann Issue-Spam entstehen (mehrere rote Runs,
  Rennbedingungen)? Wird beim Schliessen das richtige Issue erwischt?
- Shell: `set -uo pipefail`, Quoting, `curl`-Fehlerbehandlung
  (HTTP-Code vs. Exit-Code), jq-Verfuegbarkeit auf ubuntu-latest,
  awk/sed-Portabilitaet, Secrets in Logs (Token darf nie geloggt
  werden).
- ci-shape.sh Check 5 und die Mutationsfaelle: pruefen sie die
  behaupteten Eigenschaften wirklich, oder kann eine Mutation
  durchrutschen ("gruen durch Abwesenheit" im Meta-Test)?
- gates.sh-Einbindung: laeuft `selftest-main-red` in den richtigen
  Bahnen, ohne die bestehenden zu brechen?

## Regeln (Auszug AGENTS.md)

- Beweismassstab: nie "gruen durch Abwesenheit" - ein Gate, das nichts
  prueft, darf nicht Erfolg melden, ohne es zu sagen.
- Keine Secrets in Dateien oder Logs. Actions SHA-gepinnt. Exit-Codes
  ungemaskiert.
- Windows-Minuten zaehlen doppelt; CI-Kosten sparsam halten.

## Ausgabeformat

Pro Befund: Nummer, Schwere, Datei:Zeile, Was bricht und wann, Konkreter
Fix. Danach: "Keine weiteren Befunde" bzw. knappe Liste der geprueften
und fuer korrekt befundenen Punkte. Letzte Zeile: "Urteil: mergebar ja"
oder "Urteil: mergebar nein (wegen Befund N)".

## Zu pruefender Diff (git diff origin/main...HEAD)

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index b1bf97c..ce48e1a 100644
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
@@ -540,3 +553,61 @@ jobs:
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
diff --git a/.pa/ACTIVITY.md b/.pa/ACTIVITY.md
index 214af09..550d681 100644
--- a/.pa/ACTIVITY.md
+++ b/.pa/ACTIVITY.md
@@ -4748,3 +4748,8 @@ Final checkpoint evidence: 35 focused tests, Clippy, fmt and build passed; both
 - Zusammenfassung: F-CORE-3 B.3: MSG_USER hinter dem Zustellbeweis in send_to_orchestrator (C-2-Muster); red-first belegt, prepush-Lane gruen, Draft-PR #171
 - Commits: keine
 - Uncommitted: keine
+
+## 2026-09-25 09:11 — kimi-k3 ci-04 (claude/ci-04-red-main-stops-queue, ci-04-red-main-stops-queue)
+- Zusammenfassung: CI-04 umgesetzt: Job main-red in ci.yml (Issue ci-red + Mergify-Queue-Freeze bei rotem main, Auto-Unfreeze nur bei bewiesen gruenem Lauf), Selbsttest-Gate selftest-main-red, ci-shape Check 5. Draft-predecessor PR.
+- Commits: fa3b2bf 9a2280a
+- Uncommitted: keine
diff --git a/.pa/report_ci-04.md b/.pa/report_ci-04.md
new file mode 100644
index 0000000..7f0c8d8
--- /dev/null
+++ b/.pa/report_ci-04.md
@@ -0,0 +1,76 @@
+# Bericht CI-04: Roter main stoppt die Queue
+
+- Branch `claude/ci-04-red-main-stops-queue`, Worktree
+  `.claude/worktrees/ci-04-red-main-stops-queue`, Stand 2026-09-25.
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
+   exportieren jetzt `lane_run` (lane-plan-Output). Nur wenn mindestens
+   eine Bahn wirklich lief, hebt ein gruener Lauf den Freeze auf — ein
+   Push mit uebersprungenen Bahnen ist kein Gruen-Beweis.
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
+- Nach Implementierung: `bash scripts/test-main-red-guard.sh` →
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
+- **Zwei AI-Reviewer vor Merge noetig** (>300 Zeilen, Nahtstelle ci.yml /
+  gates.sh): Disposition im PR nachreichen.
+
+## Folgepunkte
+
+- Nutzer: nach dem ersten echten Ereignis pruefen, ob der Freeze im
+  Mergify-Dashboard erscheint; falls 403, Application Key mit
+  Freeze-Recht als MERGIFY_TOKEN hinterlegen.
+- OPS-01/Startcheck koennten offene `ci-red`-Issues als hartes
+  Stoppsignal werten (Idee, kein Auftrag).
diff --git a/docs/decisions.md b/docs/decisions.md
index 06a1a65..7a8c3aa 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -1352,3 +1352,40 @@ minutes are billed twice on private repos, so Windows alone was ~2850 of
   `scripts/test-red-first-landed.sh` (gate `selftest-red-first`). Reverse
   when: trailers on main stop being gated by red-first (then a trailer there
   would no longer prove anything).
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
index ae9b822..0087b67 100755
--- a/scripts/ci/ci-shape.sh
+++ b/scripts/ci/ci-shape.sh
@@ -18,6 +18,11 @@
 #   4. red-first runs inside the linux job (plan and proof) and the job
 #      `red-first` only evaluates it: `needs: linux`, the verdict script, and
 #      no setup-linux of its own.
+#   5. CI-04: the job `main-red` exists, waits for BOTH gate jobs, fires only
+#      on refs/heads/main (with always(), or a red gates job would skip it),
+#      calls scripts/ci/main-red-guard.sh - and both gate jobs export the
+#      lane_run output, without which a light green push (lanes skipped)
+#      would count as green proof and lift the queue freeze.
 #
 # The YAML is read line-wise (awk), like the other workflow gates here: no
 # YAML library is guaranteed on the runner, the Git-Bash or WSL. Limit
@@ -135,6 +140,27 @@ has "$redfirst" "setup-linux" && err "job red-first: has its own setup-linux aga
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
+  has "$mainred_if" "refs/heads/main" || err "job main-red: 'if' lacks refs/heads/main - the guard must never fire on a PR: $mainred_if"
+  has "$mainred" "main-red-guard.sh" || err "job main-red: does not call scripts/ci/main-red-guard.sh"
+fi
+# Without the lane_run outputs a light green push (lanes skipped by
+# lane-plan.sh) would count as green proof and lift the freeze.
+lane_out='lane_run: ${{ steps.plan.outputs.run }}'
+has "$linux" "$lane_out" || err "job linux: output 'lane_run' missing - main-red cannot tell a real lane from a skipped one"
+has "$windows" "$lane_out" || err "job windows: output 'lane_run' missing - main-red cannot tell a real lane from a skipped one"
+
 if [ "$errors" -gt 0 ]; then
   echo "ci-shape: $errors problem(s)"
   exit 1
diff --git a/scripts/ci/gates.sh b/scripts/ci/gates.sh
index af906ea..54e6e09 100755
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
new file mode 100644
index 0000000..8b1e202
--- /dev/null
+++ b/scripts/ci/main-red-guard.sh
@@ -0,0 +1,199 @@
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
+#   red run   -> open an issue (label `ci-red`, run ID + run URL + SHA in the
+#                body; comment instead of duplicating when one is open) and
+#                freeze the queue via the Mergify scheduled-freeze API
+#                (reason marker "ci-red:", scope base=main, exception
+#                label=hotfix so the fix PR can still merge).
+#   green run -> delete every "ci-red:" freeze and close the open issues —
+#                but only when at least one lane REALLY ran (lane-plan.sh
+#                output `run`). A light push whose lanes were skipped is no
+#                green proof and must not unfreeze.
+#   else      -> cancelled/skipped/mixed results and every ref != main are
+#                a no-op (the job `if` guards too; this is the double guard).
+#
+# Mergify API (same endpoints the official mergify-cli uses,
+# crates/mergify-freeze): POST /v1/repos/<repo>/scheduled_freeze,
+# GET .../scheduled_freeze, POST .../scheduled_freeze/<id>/delete,
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
+# mg_api <method> <path> [json-body] — one Mergify API call, loud on failure.
+mg_api() {
+  local method="$1" path="$2" body="${3:-}"
+  local args=(-sfS -X "$method" -H "Authorization: Bearer $MERGIFY_TOKEN")
+  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data "$body")
+  curl "${args[@]}" "$API$path"
+}
+
+# freeze_ids — IDs of our freezes (reason starts with the marker), one/line.
+freeze_ids() {
+  mg_api GET /scheduled_freeze | node -e '
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
+issue_body() {
+  cat <<EOF
+**main ist rot.** Die Mergify-Queue ist eingefroren (CI-04).
+
+- Run-ID: $RUN_ID
+- Run: $RUN_URL
+- Commit: $SHA
+- Rote Bahn(en): $1
+
+Wie es weitergeht:
+
+1. Fix-Branch als \`hotfix/...\` oder mit Label \`hotfix\` — der Freeze
+   laesst \`label=hotfix\` durch (exclude_conditions).
+2. Sobald ein Lauf auf main, dessen Bahnen wirklich gelaufen sind, gruen
+   ist, loescht dieser Job den Freeze und schliesst das Issue.
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
+# --- red: issue + freeze -----------------------------------------------------
+if [ "$red" = "true" ]; then
+  failed=""
+  [ "$LINUX_RESULT" = "failure" ] && failed="gates (linux)"
+  [ "$WINDOWS_RESULT" = "failure" ] && failed="${failed:+$failed, }gates (windows)"
+
+  gh label create ci-red --repo "$REPO" --color B60205 --force \
+    --description "main ist rot: Queue eingefroren (CI-04)" ||
+    fail "gh label create fehlgeschlagen"
+
+  body="$(issue_body "$failed")"
+  existing="$(open_ci_red_issues)" || fail "gh issue list fehlgeschlagen"
+  if [ -z "$existing" ]; then
+    gh issue create --repo "$REPO" --label ci-red \
+      --title "Roter main: Run $RUN_ID" --body "$body" ||
+      fail "gh issue create fehlgeschlagen"
+    echo "Issue angelegt (Label ci-red, Run $RUN_ID)."
+    summary "### main-red-guard: ROT" "Issue angelegt, Run $RUN_ID ($RUN_URL)"
+  else
+    first="$(printf '%s\n' "$existing" | head -1)"
+    gh issue comment "$first" --repo "$REPO" \
+      --body "Erneut rot: Run $RUN_ID ($RUN_URL), Commit $SHA, Bahn(en): $failed." ||
+      fail "gh issue comment fehlgeschlagen"
+    echo "Issue #$first schon offen - kommentiert statt dupliziert."
+    summary "### main-red-guard: ROT" "Issue #$first kommentiert, Run $RUN_ID"
+  fi
+
+  if [ -z "$MERGIFY_TOKEN" ]; then
+    warn "MERGIFY_TOKEN ist nicht gesetzt - Queue-Freeze uebersprungen. Das Issue bleibt die Absicherung; Freeze manuell im Mergify-Dashboard setzen."
+    summary "Freeze UEBERSPRUNGEN: MERGIFY_TOKEN fehlt (manuell einfrieren!)"
+    exit 0
+  fi
+
+  ids="$(freeze_ids)" || fail "Mergify: Freeze-Liste nicht lesbar"
+  if [ -n "$ids" ]; then
+    echo "Freeze mit Marker '$MARKER' existiert bereits: $(printf '%s' "$ids" | tr '\n' ' ')- kein zweiter."
+    summary "Freeze bereits vorhanden"
+  else
+    payload="$(printf '{"reason":"ci-red: main red, run %s","start":null,"end":null,"timezone":"UTC","matching_conditions":["base=main"],"exclude_conditions":["label=hotfix"]}' "$RUN_ID")"
+    mg_api POST /scheduled_freeze "$payload" > /dev/null ||
+      fail "Mergify: Freeze konnte nicht angelegt werden - die Queue laeuft weiter, obwohl main rot ist!"
+    echo "Queue eingefroren (ci-red: main red, run $RUN_ID; Ausnahme: label=hotfix)."
+    summary "Queue eingefroren (Ausnahme: label=hotfix)"
+  fi
+  exit 0
+fi
+
+# --- green: only with real lane proof --------------------------------------
+if [ "$LINUX_RAN" != "true" ] && [ "$WINDOWS_RAN" != "true" ]; then
+  note "leichter Lauf (beide Bahnen run=false, Plan-Schritt hat sie uebersprungen) - kein Gruen-Beweis, Freeze bleibt."
+  exit 0
+fi
+
+closed=""
+existing="$(open_ci_red_issues)" || fail "gh issue list fehlgeschlagen"
+for n in $existing; do
+  gh issue close "$n" --repo "$REPO" \
+    --comment "Gruen bewiesen: Run $RUN_ID ($RUN_URL), Commit $SHA - Bahnen gelaufen. Freeze aufgehoben (CI-04)." ||
+    fail "gh issue close #$n fehlgeschlagen"
+  closed="$closed #$n"
+done
+[ -n "$closed" ] && echo "Issues geschlossen:$closed"
+
+if [ -z "$MERGIFY_TOKEN" ]; then
+  warn "MERGIFY_TOKEN ist nicht gesetzt - kann keinen Freeze loeschen. Falls einer aktiv ist: manuell im Mergify-Dashboard loeschen."
+  summary "### main-red-guard: GRUEN" "Issues geschlossen:$closed" "Freeze-Loeschen UEBERSPRUNGEN: MERGIFY_TOKEN fehlt"
+  exit 0
+fi
+
+ids="$(freeze_ids)" || fail "Mergify: Freeze-Liste nicht lesbar"
+for id in $ids; do
+  mg_api POST "/scheduled_freeze/$id/delete" \
+    "{\"delete_reason\":\"main green again, run $RUN_ID\"}" > /dev/null ||
+    fail "Mergify: Freeze $id konnte nicht geloescht werden"
+  echo "Freeze $id geloescht."
+done
+[ -z "$ids" ] && echo "Kein ci-red-Freeze aktiv - nichts zu loeschen."
+summary "### main-red-guard: GRUEN" "Issues geschlossen:${closed:-keine}" "Freezes geloescht: ${ids:-keine}"
+exit 0
diff --git a/scripts/test-ci-shape.sh b/scripts/test-ci-shape.sh
index e049cb4..1011e37 100755
--- a/scripts/test-ci-shape.sh
+++ b/scripts/test-ci-shape.sh
@@ -121,6 +121,18 @@ case_m auto-merge-drift mg '/^  auto_merge_conditions:/,/^[a-z]/ { /check-succes
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
 
 # Call errors are errors, not a silent pass.
 check missing-file fail "$tmp/does-not-exist.yml" "$MG" "not found"
diff --git a/scripts/test-main-red-guard.sh b/scripts/test-main-red-guard.sh
new file mode 100644
index 0000000..4714012
--- /dev/null
+++ b/scripts/test-main-red-guard.sh
@@ -0,0 +1,206 @@
+#!/usr/bin/env bash
+# Self-test for scripts/ci/main-red-guard.sh (CI-04).
+#
+# CI-04: a red run on main must open an issue (label `ci-red`, run ID in the
+# body) and freeze the Mergify queue; a green run that actually ran the lanes
+# must lift the freeze and close the issue. This test pins that contract -
+# including the failure modes that must NOT silently pass:
+#   - a "light" green push (both lanes skipped by lane-plan.sh) is no green
+#     proof and must not unfreeze;
+#   - without MERGIFY_TOKEN the issue is still opened and the freeze is
+#     skipped with a warning (degraded, not red - the same pattern as the
+#     Test-Insights upload in ci.yml);
+#   - a failing freeze API call WITH a token is loud (exit 1);
+#   - any ref that is not main is a no-op (double guard next to the job `if`).
+#
+# `curl` and `gh` are replaced by PATH shims that log every call to $MOCK_LOG
+# and answer from $MOCK_FREEZES_JSON / $MOCK_ISSUES_JSON. No network, no
+# secret, no real issue.
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
+#          <windows_ran> <token> <curl_fail>
+# freezes/issues answers come from $tmp/freezes.json / $tmp/issues.json,
+# which each case writes first. Assertion of the log is left to the case.
+run_case() {
+  local name="$1"; shift
+  : > "$tmp/log"
+  MOCK_LOG="$tmp/log" \
+  MOCK_FREEZES_JSON="$tmp/freezes.json" \
+  MOCK_ISSUES_JSON="$tmp/issues.json" \
+  MOCK_CURL_FAIL="$7" \
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
+#   MERGIFY_TOKEN  (freezes/issues via files, curl_fail as 10th arg)
+RED_MAIN=(refs/heads/main failure success true true mut-fake)
+GREEN_MAIN=(refs/heads/main success success true false mut-fake)
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
+
+# --- 2. red, already open: comment instead of duplicate, no second freeze --
+echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
+echo '[{"number":7}]' > "$tmp/issues.json"
+expect_ok red-duplicate "${RED_MAIN[@]}" 0
+log_lacks red-duplicate-no-new-issue 'gh issue create'
+log_has red-duplicate-comments 'gh issue comment '
+log_lacks red-duplicate-no-second-freeze 'curl .*POST .*scheduled_freeze'
+
+# --- 3. green, lanes ran: freeze deleted, issue closed ----------------------
+echo '{"scheduled_freezes":[{"id":"frz1","reason":"ci-red: main red, run 111"}]}' > "$tmp/freezes.json"
+echo '[{"number":7}]' > "$tmp/issues.json"
+expect_ok green-unfreeze "${GREEN_MAIN[@]}" 0
+log_has green-unfreeze-deletes 'curl .*POST .*scheduled_freeze/frz1/delete'
+log_has green-unfreeze-closes-issue 'gh issue close 7'
+
+# --- 4. green, but both lanes skipped (light push): NO unfreeze -------------
+expect_ok green-light refs/heads/main success success false false mut-fake 0
+log_lacks green-light-no-delete 'curl .*POST .*delete'
+log_lacks green-light-no-close 'gh issue close'
+out_has green-light-says-why 'light|leicht|nicht gelaufen|skipped|run=false'
+
+# --- 5. cancelled run: no-op ------------------------------------------------
+expect_ok cancelled-noop refs/heads/main cancelled success true true mut-fake 0
+log_lacks cancelled-noop-no-issue 'gh issue (create|comment)'
+log_lacks cancelled-noop-no-freeze 'curl .*POST'
+
+# --- 6. red without MERGIFY_TOKEN: issue yes, freeze skipped with warning ---
+echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
+echo '[]' > "$tmp/issues.json"
+expect_ok red-no-token refs/heads/main failure success true true "" 0
+log_has red-no-token-creates-issue 'gh issue create'
+log_lacks red-no-token-no-curl 'curl'
+out_has red-no-token-warns 'warning|MERGIFY_TOKEN'
+
+# --- 7. red, freeze API fails WITH token: loud red --------------------------
+echo '{"scheduled_freezes":[]}' > "$tmp/freezes.json"
+echo '[]' > "$tmp/issues.json"
+expect_red red-freeze-api-fails "${RED_MAIN[@]}" 1
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
