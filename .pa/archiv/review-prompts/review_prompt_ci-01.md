# Review request CI-01: Mergify merge queue and GitHub Actions minute savings

You are an independent reviewer (not the author). Review the diff below for
correctness bugs, gaps against the requirements, and safety regressions. Be
concrete: cite file and line, say what breaks and when. Rate each finding
high/medium/low. Do not restate the diff. If something is fine, say nothing
about it. Answer in English or German.

## Context

Repo: Tauri 2 app, private GitHub repo, GitHub Actions. Required checks on
`main`: `gates (linux)`, `gates (windows)`, `red-first`. The coordinator has
turned OFF branch protection "require branches to be up to date" (strict).
Measurements: ~3000 Windows-weighted minutes/day; gates (windows) = 70 % of
minutes; 39 % of PR runs were "merge main" updates forced by strict; green PR
run median Windows 15.3 min, Linux 7.0, red-first 8.0; Actions cache at
10.34/10 GB; no timeout-minutes existed.

`scripts/ci/gates.sh` is the single source of the gate list; ci.yml calls one
lane per job. `red-first` checks Test-First commit trailers against the merge
base (its script is owned by another session and deliberately unchanged).

## Requirements implemented (user decisions)

1. `.mergify.yml`: one queue `default`, merge_method merge, update_method
   merge, batch_size dynamic 1..4, batch_max_wait_time 10 min; merge_queue
   serial, max_parallel_checks 2, status_comments outcomes, queued label;
   automatic queueing of every non-draft PR to main with the three checks
   green, no conflict, no `do-not-merge` label, via
   `merge_protections_settings.auto_merge_conditions` (autoqueue is
   deprecated); merge conditions = the three checks + no do-not-merge; a merge
   protection that package branches must change `.pa/report_*.md`;
   priority_rules (label priority / head hotfix/); conflict label + comment.
   The file validates against https://docs.mergify.com/mergify-configuration-schema.json.
2. ci.yml: no CI on draft PRs (job-level if) except Mergify queue PRs on
   `mergify/merge-queue/*` (they are drafts and must run); `ready_for_review`
   trigger; concurrency cancel-in-progress for PRs but never main pushes or
   queue runs (a cancelled check dequeues as checks-interrupted);
   timeout-minutes linux 20 / red-first 25 / windows 35; rust-cache save-if
   only on main; Windows lane decided by a PLAN STEP
   (`scripts/ci/windows-plan.sh`) inside the job, not paths-ignore and not a
   job-level if, so the required check always reports success/failure; push to
   main and queue branches always run the full Windows lane.
3. dependabot monthly, grouped per ecosystem; security updates stay immediate.
4. JUnit upload (nextest + vitest) to Mergify Test Insights via
   `mergifyio/gha-mergify-ci` pinned by SHA, skipped without secret
   `MERGIFY_TOKEN`, runs on failure too, never fails the job.
5. gates.sh stays the single gate source; no CARGO_PROFILE_* env vars.

## Questions to answer explicitly

- Can any non-draft PR end up with a required check skipped or pending
  forever? Can a draft Mergify queue PR end up without CI?
- Can the Windows plan step say `run=false` for a change that affects what
  the windows lane (fmt, clippy, nextest suite, native tests) measures?
  Look for inputs outside `src-tauri/` the Rust build or tests read.
- Is the plan step's use of `HEAD^1` of the `refs/pull/N/merge` checkout
  correct with `fetch-depth: 2`? Any case where it silently yields a wrong
  (too small) change list?
- Are the Mergify keys and semantics right (auto_merge_conditions with a
  queue, merge_conditions evaluated on the draft batch PR, merge protection
  regex, toggle label + comment in one rule)?
- Could the Test Insights upload leak the token or fail the job?
- Anything that weakens red-first or the gates?

## Diff (git diff origin/main...HEAD)

```diff
diff --git a/.github/actions/setup-linux/action.yml b/.github/actions/setup-linux/action.yml
index 0cb5c32..3588576 100644
--- a/.github/actions/setup-linux/action.yml
+++ b/.github/actions/setup-linux/action.yml
@@ -50,6 +50,13 @@ runs:
       with:
         workspaces: src-tauri
         shared-key: linux-gates
+        # Nur main schreibt den Cache (CI-01, 24.09.): der Speicher lag bei
+        # 10,34 von 10 GB, und Eintraege aus PR-Laeufen verdraengten die von
+        # main, die jeder PR tatsaechlich wiederherstellt. Preis: red-first
+        # laeuft nie auf main, seine beiden Baum-Verzeichnisse unten werden
+        # also nicht mehr gespeichert und bauen kalt, WENN ein PR Test-First-
+        # Belege hat (docs/decisions.md 2026-09-24).
+        save-if: ${{ github.ref == 'refs/heads/main' }}
         # red-first baut den Merge-Base-Baum in ein eigenes, stabiles
         # Verzeichnis (scripts/ci/red-first.sh: ein GETEILTES target/ liesse
         # den Kopf-Lauf das Binary der Merge-Base ausfuehren). Ohne diese
diff --git a/.github/dependabot.yml b/.github/dependabot.yml
index edd8122..2b68295 100644
--- a/.github/dependabot.yml
+++ b/.github/dependabot.yml
@@ -1,18 +1,31 @@
-# Woechentliche, gruppierte Dependency-Updates (Config-Audit 02.09.).
-# Das woechentliche audit.yml (.github/workflows/audit.yml) deckt nur CVEs ab;
-# Dependabot macht den Update-Drift sichtbar. Bewusste Ausnahmen: glib/gtk
-# (siehe src-tauri/audit.toml - RUSTSEC-2024-0429, gtk-Bump als eigene Aufgabe).
+# Monatliche, je Oekosystem gebuendelte Dependency-Updates.
+#
+# Seit CI-01 (Nutzer-Entscheidung 24.09.2026, docs/decisions.md) MONATLICH
+# statt woechentlich und je Oekosystem EIN Sammel-PR: jeder Dependabot-PR
+# kostet einen vollen CI-Lauf inklusive Windows (Cargo.lock ist eine Eingabe
+# der Windows-Bahn), und drei woechentliche PRs waren zwoelf Laeufe im Monat
+# fuer Aenderungen, die niemand in der Woche braucht.
+#
+# Sicherheits-Updates bleiben SOFORT: sie sind in GitHub ein eigener
+# Mechanismus ("Dependabot security updates", Settings > Code security) und
+# richten sich nicht nach `schedule`. `groups` hier gilt nur fuer
+# Versions-Updates (applies-to: version-updates ist der Standard); ein
+# Security-Update kommt also weiterhin einzeln und ohne Wartezeit. Dazu
+# deckt das woechentliche audit.yml die CVEs ab.
+#
+# Bewusste Ausnahmen: glib/gtk (siehe src-tauri/audit.toml -
+# RUSTSEC-2024-0429, gtk-Bump als eigene Aufgabe).
 version: 2
 updates:
   - package-ecosystem: "cargo"
     directory: "/src-tauri"
     schedule:
-      interval: "weekly"
+      interval: "monthly"
     groups:
-      minor-and-patch:
-        update-types:
-          - "minor"
-          - "patch"
+      cargo:
+        applies-to: version-updates
+        patterns:
+          - "*"
     ignore:
       # Dokumentierte Ausnahme, analog audit.toml: gtk/glib-Stack erst mit der
       # geplanten Dependency-Hebung anfassen.
@@ -27,12 +40,12 @@ updates:
   - package-ecosystem: "npm"
     directory: "/"
     schedule:
-      interval: "weekly"
+      interval: "monthly"
     groups:
-      minor-and-patch:
-        update-types:
-          - "minor"
-          - "patch"
+      npm:
+        applies-to: version-updates
+        patterns:
+          - "*"
     ignore:
       # Siehe cargo: Majors (react, vite, typescript, eslint, ...) nur geplant.
       - dependency-name: "*"
@@ -47,8 +60,9 @@ updates:
   - package-ecosystem: "github-actions"
     directory: "/"
     schedule:
-      interval: "weekly"
+      interval: "monthly"
     groups:
-      all-actions:
+      github-actions:
+        applies-to: version-updates
         patterns:
           - "*"
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 88017bd..61daedd 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -23,6 +23,11 @@ on:
     branches: [main]
   pull_request:
     branches: [main]
+    # CI-01 (24.09.): Entwuerfe laufen nicht (Job-`if` unten). Damit ein
+    # Entwurf beim "Ready for review" seine Checks bekommt, muss dieses
+    # Ereignis ausdruecklich dabei sein - die ersten drei sind GitHubs
+    # Standardmenge.
+    types: [opened, synchronize, reopened, ready_for_review]
 
 # Kein `paths-ignore` mehr. Es war am 03.09. als Ersparnis gedacht und hat in
 # diesem PR zweimal ein Gate blind gemacht: `**.md` und `.pa/**` sind die
@@ -34,8 +39,21 @@ on:
 # wird abgebrochen) und ueber die Arbeitsteilung Linux/Windows.
 #
 # Seit 22.09. sind gates (linux), gates (windows) und red-first Required
-# Checks auf main (strict, auch fuer Admins, keine Force-Pushes). Keine
-# Pfadfilter einfuehren, die einen dieser Checks dauerhaft pending lassen.
+# Checks auf main (auch fuer Admins, keine Force-Pushes; "strict" ist seit
+# 24.09. AUS, die Aktualitaet gegen main garantiert jetzt die Mergify-Queue,
+# siehe .mergify.yml). Keine Pfadfilter einfuehren, die einen dieser Checks
+# dauerhaft pending lassen.
+#
+# CI-01 (Nutzer-Entscheidung 24.09., docs/decisions.md): Die Windows-Bahn
+# entscheidet per PLAN-SCHRITT (scripts/ci/windows-plan.sh), ob sie laufen
+# muss - kein paths-ignore, kein Job-`if`. Der Job meldet deshalb immer
+# success/failure, nie "pending". Auf main-Pushes und in der Merge-Queue
+# laeuft er immer voll.
+#
+# Entwuerfe: jeder Job ueberspringt Draft-PRs - AUSSER den Queue-PRs von
+# Mergify (Kopf-Branch mergify/merge-queue/*): die sind technisch Entwuerfe
+# und muessen genau dann laufen. Ein Nicht-Entwurf-PR bekommt alle drei
+# Checks; der Wechsel Entwurf -> bereit loest `ready_for_review` aus.
 
 permissions:
   contents: read
@@ -43,12 +61,19 @@ permissions:
   # Actions API when the reference is not a Git object.
   actions: read
 
-# Ein zweiter Push auf denselben Ref macht den ersten Lauf wertlos - Windows-
-# Minuten kosten doppelt, also abbrechen. `main` bleibt ausgenommen: dort ist
-# jeder Lauf der Beleg fuer genau einen Merge.
+# Ein zweiter Push auf denselben PR macht den ersten Lauf wertlos - Windows-
+# Minuten kosten doppelt, also abbrechen. Die Gruppe ist `github.ref`, bei
+# pull_request also refs/pull/<N>/merge: je PR eine Gruppe.
+#
+# Nie abgebrochen wird:
+#   - ein Push auf main: dort ist jeder Lauf der Beleg fuer genau einen Merge;
+#   - ein Queue-Lauf von Mergify (mergify/merge-queue/*): einen abgebrochenen
+#     Check wertet die Queue als "checks-interrupted" und wirft den PR hinaus
+#     (docs.mergify.com/merge-queue/lifecycle#interrupted-checks). Veraltete
+#     Queue-Laeufe raeumt Mergify selbst ab, indem es den Draft-PR schliesst.
 concurrency:
   group: ci-${{ github.ref }}
-  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
+  cancel-in-progress: ${{ github.event_name == 'pull_request' && !startsWith(github.head_ref, 'mergify/merge-queue/') }}
 
 # `run:`-Schritte laufen ohne diese Zeilen als `bash -e {0}` — OHNE `pipefail`.
 # Der Status einer Pipe ist dann der ihres LETZTEN Glieds, und ein
@@ -76,7 +101,23 @@ defaults:
 jobs:
   linux:
     name: gates (linux)
+    # Entwurf -> aus; Queue-Entwurf von Mergify -> an (Kopfkommentar).
+    if: github.event_name != 'pull_request' || !github.event.pull_request.draft || startsWith(github.head_ref, 'mergify/merge-queue/')
     runs-on: ubuntu-latest
+    # Gruener Lauf im Median 7,0 min (Messung 24.09.). Ohne Grenze liefe ein
+    # haengender Job bis zum GitHub-Maximum von 6 h - zwei Laeufe mit
+    # "607 Minuten" gab es schon (dort ein Spending-Limit, kein Haenger, aber
+    # die Grenze fehlte trotzdem).
+    timeout-minutes: 20
+    env:
+      # Nur "true"/"false", nie das Secret selbst: so sieht kein Gate-Schritt
+      # den Token, und der Upload-Schritt kann sich selbst abschalten, solange
+      # der Nutzer MERGIFY_TOKEN noch nicht angelegt hat (auch in Dependabot-
+      # PRs, die keine Actions-Secrets bekommen).
+      MERGIFY_UPLOAD: ${{ secrets.MERGIFY_TOKEN != '' }}
+      # vitest.config.ts schreibt damit zusaetzlich .junit/vitest.xml
+      # (gitignored), fuer den Test-Insights-Upload unten.
+      PA_JUNIT: "1"
     steps:
       - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 
@@ -105,39 +146,132 @@ jobs:
       # billig -> teuer ist in gates.sh dieselbe wie vorher hier.
       #
       # Derselbe Befehl laeuft auf dem Entwickler-PC: bash scripts/ci/gates.sh lane linux
+      #
+      # Der rust-cache kann einen JUnit-Bericht aus einem frueheren Lauf
+      # mitbringen. Weg damit, sonst laede der Upload unten bei einem Lauf,
+      # der vor rust-suite abbricht, alte Ergebnisse als neue hoch.
+      - name: Alte JUnit-Berichte entfernen
+        run: rm -f src-tauri/target/nextest/ci/junit.xml .junit/vitest.xml
+
       - name: Gates (linux)
         run: bash scripts/ci/gates.sh lane linux
 
+      # Test Insights (CI-01): die JUnit-Berichte DIESES Laufs an Mergify -
+      # kein zusaetzlicher Lauf, nur ein Upload. `!cancelled()`, damit auch
+      # rote Laeufe gemeldet werden (genau die braucht die Flaky-Erkennung).
+      # `continue-on-error`: ein nicht erreichbares Mergify oder ein
+      # abgelehnter Upload darf den Job nie rot faerben - das Urteil ueber den
+      # Lauf faellt oben in gates.sh, nicht hier. Ohne Secret (Nutzer hat es
+      # noch nicht angelegt, Dependabot-PR) laeuft der Schritt gar nicht.
+      - name: Test Insights - nextest
+        if: ${{ !cancelled() && env.MERGIFY_UPLOAD == 'true' && hashFiles('src-tauri/target/nextest/ci/junit.xml') != '' }}
+        continue-on-error: true
+        timeout-minutes: 5
+        uses: mergifyio/gha-mergify-ci@5e8176734bc525c7fd8b2e812f0fa47246f601b7 # v25
+        with:
+          token: ${{ secrets.MERGIFY_TOKEN }}
+          report_path: src-tauri/target/nextest/ci/junit.xml
+
+      - name: Test Insights - vitest
+        if: ${{ !cancelled() && env.MERGIFY_UPLOAD == 'true' && hashFiles('.junit/vitest.xml') != '' }}
+        continue-on-error: true
+        timeout-minutes: 5
+        uses: mergifyio/gha-mergify-ci@5e8176734bc525c7fd8b2e812f0fa47246f601b7 # v25
+        with:
+          token: ${{ secrets.MERGIFY_TOKEN }}
+          report_path: .junit/vitest.xml
+
   windows:
     name: gates (windows)
+    # Entwurf -> aus; Queue-Entwurf von Mergify -> an (Kopfkommentar). Das ist
+    # die EINZIGE Job-Bedingung hier - ob die Bahn fachlich laufen muss,
+    # entscheidet der Plan-Schritt unten, damit der Required Check immer
+    # success/failure meldet.
+    if: github.event_name != 'pull_request' || !github.event.pull_request.draft || startsWith(github.head_ref, 'mergify/merge-queue/')
     runs-on: windows-latest
+    # Gruener PR-Lauf im Median 15,3 min (Messung 24.09.); 35 lassen Luft fuer
+    # einen kalten Cache, beenden aber einen Haenger nach einem Neuntel der
+    # 6 h, die GitHub sonst zulaesst.
+    timeout-minutes: 35
+    env:
+      MERGIFY_UPLOAD: ${{ secrets.MERGIFY_TOKEN != '' }}
     steps:
+      # fetch-depth 2: im pull_request-Checkout ist HEAD der Merge-Commit
+      # refs/pull/<N>/merge, und sein erster Elternteil ist die Spitze von
+      # main. Mehr Historie braucht der Plan-Schritt nicht.
       - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
+        with:
+          fetch-depth: 2
+
+      # Braucht dieser Lauf die Windows-Bahn? Entscheidung und ausloesender
+      # Pfad stehen im Log; die Eingabeliste und das Sicherheitsnetz (Push,
+      # Queue, unklare Aenderungsmenge -> immer voll) stehen im Skript und
+      # sind in scripts/test-windows-plan.sh festgenagelt.
+      #
+      # Die folgenden Schritte laufen bei `run != 'false'`, nicht bei
+      # `run == 'true'`: faellt der Plan aus irgendeinem Grund ohne Ausgabe
+      # aus, laeuft die volle Bahn statt keiner.
+      - name: Plan - muss die Windows-Bahn laufen?
+        id: plan
+        env:
+          EVENT_NAME: ${{ github.event_name }}
+          HEAD_REF: ${{ github.head_ref }}
+        run: |
+          # Erst in eine Datei, dann anhaengen - eine Pipe nach $GITHUB_OUTPUT
+          # verschluckt den Exit-Code links davon (scripts/ci/no-masked-output.sh).
+          bash scripts/ci/windows-plan.sh > "$RUNNER_TEMP/windows-plan.out"
+          cat "$RUNNER_TEMP/windows-plan.out"
+          grep -E '^run=(true|false)$' "$RUNNER_TEMP/windows-plan.out" > "$RUNNER_TEMP/windows-plan.kv"
+          cat "$RUNNER_TEMP/windows-plan.kv" >> "$GITHUB_OUTPUT"
+
+      - name: Windows-Bahn nicht noetig
+        if: steps.plan.outputs.run == 'false'
+        run: |
+          echo "::notice title=gates (windows)::Keine Eingabe der Windows-Bahn geaendert - fmt/clippy/rust-suite/native-tests nicht gelaufen. Die Merge-Queue und der Push auf main fahren sie voll."
+          {
+            echo "### gates (windows): Bahn nicht noetig"
+            echo
+            echo '```'
+            cat "$RUNNER_TEMP/windows-plan.out"
+            echo '```'
+          } >> "$GITHUB_STEP_SUMMARY"
 
       # The native ConPTY argv fixture launches node. Pin the same Node major
       # required by the repo and used by the Linux job instead of inheriting
       # the runner image's currently installed version.
       - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
+        if: steps.plan.outputs.run != 'false'
         with:
           node-version: 24
 
       # `@stable` war ein BRANCH, kein Tag - er aenderte sich ohne Commit im
       # Repo. Gepinnt auf master; die Toolchain steht jetzt sichtbar hier.
       - uses: dtolnay/rust-toolchain@02cb101ec7c40f2c49e1d9714d64511d8e1b74de # master
+        if: steps.plan.outputs.run != 'false'
         with:
           toolchain: stable
 
+      # save-if: nur main schreibt den Cache (CI-01). Der Cache-Speicher lag
+      # am 24.09. bei 10,34 von 10 GB; Eintraege aus PR-Laeufen verdraengten
+      # die von main, die jeder PR tatsaechlich wiederherstellt.
       - uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2.9.2
+        if: steps.plan.outputs.run != 'false'
         with:
           workspaces: src-tauri
           shared-key: windows-gates
+          save-if: ${{ github.ref == 'refs/heads/main' }}
 
       # `@nextest` war ein wandernder Tag. Gepinnt auf v2 mit `tool:` -
       # dieselbe Schreibweise wie in audit.yml, statt zweier Muster.
       - uses: taiki-e/install-action@9114bf4d891761788c546334fd37538eae1bf8b3 # v2.87.16
+        if: steps.plan.outputs.run != 'false'
         with:
           tool: nextest
 
+      - name: Alte JUnit-Berichte entfernen
+        if: steps.plan.outputs.run != 'false'
+        run: rm -f src-tauri/target/nextest/ci/junit.xml
+
       # Uebersteuert bewusst Spec-Entscheidung 4 aus release.yml (nur Tags):
       # die cfg(windows)-Arme kompilieren sonst erst am Release-Tag
       # (Sanierungsplan Phase A.4).
@@ -155,15 +289,31 @@ jobs:
       # Bahn windows - dieselbe Drift-Klasse (Gate-Liste ausserhalb von
       # gates.sh), die diese Datei laut ihrem Kopfkommentar vermeiden soll.
       - name: Gates (windows)
+        if: steps.plan.outputs.run != 'false'
         run: bash scripts/ci/gates.sh lane windows
 
+      # Wie im Job linux: Upload der Ergebnisse DIESES Laufs, nie ein Grund
+      # fuer Rot.
+      - name: Test Insights - nextest
+        if: ${{ !cancelled() && steps.plan.outputs.run != 'false' && env.MERGIFY_UPLOAD == 'true' && hashFiles('src-tauri/target/nextest/ci/junit.xml') != '' }}
+        continue-on-error: true
+        timeout-minutes: 5
+        uses: mergifyio/gha-mergify-ci@5e8176734bc525c7fd8b2e812f0fa47246f601b7 # v25
+        with:
+          token: ${{ secrets.MERGIFY_TOKEN }}
+          report_path: src-tauri/target/nextest/ci/junit.xml
+
   # Woertlich aus #31 uebernommen (main, 13db97b). Der Job prueft die
   # Test-First-Trailer gegen die Merge-Base und ist nicht meiner - er wird hier
   # nicht umgebaut, nur mitgefuehrt.
   red-first:
     name: red-first
-    if: github.event_name == 'pull_request'
+    # CI-01: wie die anderen Jobs keine Entwuerfe, ausser Mergify-Queue-PRs.
+    if: github.event_name == 'pull_request' && (!github.event.pull_request.draft || startsWith(github.head_ref, 'mergify/merge-queue/'))
     runs-on: ubuntu-latest
+    # Gruener Lauf im Median 8,0 min (Messung 24.09.); baut im schlimmsten
+    # Fall Merge-Base UND Kopf.
+    timeout-minutes: 25
     steps:
       - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
         with:
diff --git a/.gitignore b/.gitignore
index 4faa7ba..00fdaf3 100644
--- a/.gitignore
+++ b/.gitignore
@@ -3,6 +3,8 @@
 /coverage
 /playwright-report
 /test-results
+# JUnit-Berichte fuer Mergify Test Insights (CI-01, vitest.config.ts)
+/.junit
 /src-tauri/target
 /src-tauri/gen/schemas
 
diff --git a/.mergify.yml b/.mergify.yml
new file mode 100644
index 0000000..0de9ace
--- /dev/null
+++ b/.mergify.yml
@@ -0,0 +1,142 @@
+# Mergify: Merge-Queue fuer main (CI-01, Nutzer-Entscheidung 24.09.2026).
+#
+# Warum es diese Datei gibt: Bis zum 24.09. verlangte die Branch Protection
+# "strict" (Branch muss auf dem Stand von main sein). 39 % aller PR-Laeufe
+# waren dadurch reine "merge main"-Aktualisierungen - jede davon ein voller
+# Windows-Lauf. "strict" ist jetzt AUS; die Garantie "main bleibt gruen"
+# uebernimmt diese Queue: sie testet PRs (gebuendelt) gegen den aktuellen
+# main, bevor sie mergt. Begruendung und Messwerte: docs/decisions.md
+# (2026-09-24).
+#
+# Jeder Schluessel ist gegen das offizielle JSON-Schema geprueft
+# (https://docs.mergify.com/mergify-configuration-schema.json), nicht aus dem
+# Gedaechtnis geschrieben. `autoqueue` ist veraltet und wird zusammen mit
+# `auto_merge_conditions` sogar abgelehnt - daher unten
+# merge_protections_settings.auto_merge_conditions.
+#
+# Die drei Required Checks heissen exakt so, wie ci.yml sie meldet:
+#   gates (linux), gates (windows), red-first
+# Eine Umbenennung dort muss HIER nachgezogen werden, sonst wartet die Queue
+# auf einen Check, der nie kommt.
+
+queue_rules:
+  - name: default
+    # Merge-Commits bleiben: die red->green-Commits mit Test-First-Trailern
+    # muessen in der Historie von main sichtbar bleiben (red-first,
+    # AGENTS.md). squash/rebase wuerden sie einebnen bzw. neu schreiben.
+    merge_method: merge
+    # Nur relevant, wenn Mergify einen PR selbst aktualisiert: Merge statt
+    # Rebase, damit die Commit-SHAs (und ihre Belege) stabil bleiben.
+    update_method: merge
+    # Dynamische Buendel: bei leerer Queue einzeln (schnelles Feedback), bei
+    # Stau bis zu vier PRs in EINEM CI-Lauf - das ist die eigentliche
+    # Minuten-Ersparnis gegenueber "jeder PR einzeln gegen main".
+    batch_size:
+      min: 1
+      max: 4
+    batch_max_wait_time: 10 min
+    # Fester Wert statt `auto`: `auto` greift erst nach ~20 Laeufen
+    # Historie, eine neue Queue haette bis dahin GAR kein Timeout
+    # (docs.mergify.com/merge-queue/lifecycle#checks-timeout). Der langsamste
+    # Job hat timeout-minutes 35 (ci.yml); 60 min lassen Platz fuer
+    # Runner-Wartezeit.
+    checks_timeout: 60 min
+    # Wird ein PR aufgenommen, wenn ...
+    queue_conditions:
+      - base = main
+      - -draft
+      - -conflict
+      - label != do-not-merge
+      - check-success = gates (linux)
+      - check-success = gates (windows)
+      - check-success = red-first
+    # ... und gemergt, wenn der Queue-Lauf (Draft-PR auf
+    # mergify/merge-queue/*) dieselben drei Checks gruen meldet. Fuer die
+    # Checks wertet Mergify hier den temporaeren Draft-PR aus, nicht den
+    # Original-PR (Schema-Beschreibung von merge_conditions).
+    merge_conditions:
+      - label != do-not-merge
+      - check-success = gates (linux)
+      - check-success = gates (windows)
+      - check-success = red-first
+
+merge_queue:
+  # serial: PRs werden kumulativ getestet (Buendel n enthaelt alles davor),
+  # gemergt wird in Queue-Reihenfolge. `parallel` (Stub aus #105) verlangt
+  # Scopes und testet unabhaengige PRs NICHT gegeneinander - fuer ein Repo,
+  # dessen Nahtstellen (api.rs, store.rs, ...) fast jeder PR beruehrt, die
+  # falsche Wahl.
+  mode: serial
+  # Hoechstens zwei spekulative Queue-Laeufe gleichzeitig. Jeder davon ist ein
+  # voller Windows-Lauf; mehr Parallelitaet kauft Durchsatz mit Minuten, die
+  # verworfen werden, sobald ein Buendel davor scheitert.
+  max_parallel_checks: 2
+  # Nur Endergebnisse kommentieren (gemergt / mit Grund entfernt), nicht jeden
+  # Zwischenschritt.
+  status_comments: outcomes
+  queued_label: queued
+
+merge_protections_settings:
+  # Automatisch einreihen: jeder PR auf main, der kein Entwurf ist, keinen
+  # Konflikt hat, kein `do-not-merge` traegt und dessen drei Checks gruen
+  # sind. Das ersetzt das veraltete `queue_rules[].autoqueue`
+  # (docs.mergify.com/merge-protections/auto-merge). Die aktiven
+  # merge_protections unten muessen zusaetzlich erfuellt sein.
+  auto_merge_conditions:
+    - base = main
+    - -draft
+    - -conflict
+    - label != do-not-merge
+    - check-success = gates (linux)
+    - check-success = gates (windows)
+    - check-success = red-first
+
+merge_protections:
+  # Ein Arbeitspaket ist erst fertig, wenn sein Bericht im Repo liegt
+  # (.pa/report_<paket>.md). Paket-Branches erkennt die Regel am Namen:
+  # Anbieter-Praefix plus Paket-ID aus docs/PLAN.md - w<N>-, df<N>, ki-<N>,
+  # hq2-. Gross-/Kleinschreibung egal.
+  #
+  # Bewusst NICHT erfasst (kein Paket, kein Bericht verlangt):
+  #   - Doku-/Infra-Branches desselben Anbieters, z. B. claude/masterplan,
+  #     claude/ci-01-..., kimi/release-141
+  #   - mergify/merge-queue/* (Queue-Laeufe) und mergify/* (Konfig-PRs)
+  #   - dependabot/*
+  # Die Regel steht auch in AGENTS.md, damit Worker sie kennen.
+  - name: Paket-PR bringt seinen Bericht mit
+    description: >-
+      Package branches (w<N>-, df<N>, ki-<N>, hq2-) must add or change
+      .pa/report_*.md before merging.
+    if:
+      - base = main
+      - head ~= (?i)^(claude|codex|kimi|opencode|glm)/(w\d+-|df\d+|ki-\d+|hq2-)
+    success_conditions:
+      - files ~= ^\.pa/report_.*\.md$
+
+priority_rules:
+  - name: Dringend (Label priority oder hotfix-Branch)
+    conditions:
+      - or:
+          - label = priority
+          - head ~= ^hotfix/
+    priority: high
+
+pull_request_rules:
+  # Konflikt sichtbar machen. `toggle` setzt das Label, solange die
+  # Bedingungen gelten, und nimmt es wieder ab, sobald der Konflikt geloest
+  # ist. Der Kommentar faellt einmal je Konfliktphase an.
+  - name: Konflikt markieren
+    conditions:
+      - base = main
+      - -closed
+      - conflict
+    actions:
+      label:
+        toggle:
+          - conflict
+      comment:
+        message: >-
+          @{{author}} Dieser PR hat einen Konflikt mit main und kann nicht in
+          die Merge-Queue. Bitte main hineinmergen (kein Rebase, kein
+          Force-Push) und den Konflikt loesen; das Label `conflict`
+          verschwindet danach von selbst.
diff --git a/AGENTS.md b/AGENTS.md
index 423feab..415cb27 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -78,6 +78,29 @@ the shared native capture tests run once in the `projecta_capture` library.
 CI gates run on main pushes and PRs; installer builds run on release tags.
 Use appropriate Test-First/Regression-For/No-Test trailers; never `--no-verify`.
 
+## Merging (Mergify queue, since 2026-09-24)
+
+`main` is merged only through the Mergify merge queue (`.mergify.yml`). Every
+non-draft PR to `main` whose three required checks — `gates (linux)`,
+`gates (windows)`, `red-first` — are green, that has no conflict and no
+`do-not-merge` label is queued automatically and merged with a merge commit.
+Branches no longer have to be up to date with `main`: do not merge `main` into
+your branch just to refresh it (that was 39 % of all CI runs); merge it only to
+resolve a real conflict (Mergify labels those `conflict`).
+
+- Draft PRs get no CI. Open as draft while working, mark ready when done.
+- `do-not-merge` label: keeps a green PR out of the queue.
+- `priority` label or a `hotfix/` branch: queued ahead of others.
+- Package branches must ship their report. A branch is a package branch when
+  it matches `^(claude|codex|kimi|opencode|glm)/(w<N>-|df<N>|ki-<N>|hq2-)`
+  (case-insensitive), e.g. `claude/w2-07-credential-acl`, `codex/df09a-...`,
+  `claude/ki-23-...`. Such a PR must add or change a `.pa/report_*.md`, or the
+  `Mergify Merge Protections` check stays red. Docs/infra branches
+  (`claude/masterplan`, `claude/ci-01-...`) are not packages.
+- `gates (windows)` skips its lane when no Windows input changed
+  (`scripts/ci/windows-plan.sh` lists them and logs the decision); the queue
+  and every push to `main` always run it in full.
+
 ## Record and learn
 
 Before debugging: `npm run hq:lesson -- search "<symptom>"`. Report worked/failed
diff --git a/docs/decisions.md b/docs/decisions.md
index 596e366..c0e3bf1 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -1083,3 +1083,63 @@ No deletion/backfill of historical identities is introduced. Future retention mu
   der Scrollbar liegt. Beleg: `src/components/xtermFitCompat.test.ts`
   (echtes Paket, rot mit 0.11, gruen mit 0.10). Lockfile per `npm install`.
   Zuruecknehmen: beim geschlossenen Sprung auf `@xterm/xterm` 6.x, wie oben.
+
+## 2026-09-24 - CI-01: Mergify-Queue und Actions-Minuten (Nutzer-Entscheidung)
+
+Messbasis (Analyse 24.09.): ~3000 Windows-gewichtete Actions-Minuten/Tag;
+`gates (windows)` = 70 % davon; 39 % aller PR-Laeufe waren reine
+"merge main"-Aktualisierungen, erzwungen durch "strict" (Branch muss aktuell
+sein); gruener PR-Lauf im Median Windows 15,3 min, Linux 7,0, red-first 8,0;
+Cache-Speicher 10,34 von 10 GB; die zwei "607-Minuten-Laeufe" waren ein
+Spending-Limit-Abbruch plus ein Rerun 10 h spaeter, kein Haenger - aber
+`timeout-minutes` fehlte ueberall.
+
+- "strict" ist aus (Koordinator, 24.09.), `main` wird nur noch ueber die
+  Mergify-Queue gemergt (`.mergify.yml`: serial, Buendel 1-4 dynamisch,
+  10 min Wartezeit, max. 2 parallele Queue-Laeufe, merge_method `merge`,
+  Auto-Queue ueber `merge_protections_settings.auto_merge_conditions`, weil
+  `autoqueue` veraltet ist) - Warum: die Queue testet gegen den aktuellen
+  main, ohne dass jeder PR sich selbst per "merge main" aktualisieren muss;
+  Buendel teilen sich einen Lauf; Merge-Commits halten die Test-First-
+  Historie sichtbar - Zuruecknehmen: wenn die Queue-Laeufe (Draft-PRs auf
+  `mergify/merge-queue/*`) mehr Minuten kosten als die eingesparten
+  Aktualisierungen; Messreihe ueber mehrere Wochen, kein Einzelwert.
+- **Teilweise Ruecknahme von 2026-09-09 ("Die Windows-Kuerzung kommt
+  nicht"):** `gates (windows)` laeuft auf PRs nur noch, wenn eine Eingabe der
+  Bahn geaendert ist - entschieden von einem PLAN-SCHRITT
+  (`scripts/ci/windows-plan.sh`) im Job, nicht von `paths-ignore` und nicht
+  von einem Job-`if`; der Required Check meldet also immer success/failure.
+  Die Eingabeliste ist aus `gates.sh` (fmt, clippy, rust-suite, native-tests)
+  abgeleitet und nennt ausdruecklich die Dateien ausserhalb des Crates
+  (`docs/PLAN.md` per include_str!, `docs/agents-json.md` per Testlesung,
+  `.gitattributes`, npm-Manifeste); neue include_str!-Ziele findet das Skript
+  bei jedem Lauf selbst. Queue-Laeufe und Pushes auf main fahren IMMER voll -
+  die Windows-Regression wird damit spaetestens vor dem Merge sichtbar, nicht
+  erst danach. Das war der Einwand vom 09.09., und die damalige
+  Ruecknahmebedingung ("wenn die Minuten knapp werden; mit Messreihe, nicht
+  Einzelwert") ist mit der Messbasis oben erfuellt; die Bedingung vom 04.09.
+  fuer Pfadfilter ("Liste der Eingaben je Gate, nicht nach Dateiendung") auch.
+  Selbsttest `scripts/test-windows-plan.sh` (Gate `selftest-windows-plan`) -
+  Zuruecknehmen: sobald eine Windows-Regression durch einen PR rutscht, den
+  der Plan als "nicht noetig" eingestuft hat; dann zuerst die Eingabeliste
+  pruefen, nicht den Plan-Schritt entfernen.
+- Keine CI auf Draft-PRs (Job-`if`, ausser Mergify-Queue-Entwuerfen),
+  `ready_for_review` als Ausloeser; `concurrency` bricht ueberholte PR-Laeufe
+  ab, aber nie Laeufe auf main und nie Queue-Laeufe (die Queue wertet einen
+  abgebrochenen Check als "checks-interrupted" und wirft den PR hinaus);
+  `timeout-minutes` linux 20, red-first 25, windows 35; rust-cache speichert
+  nur noch auf main (`save-if`) - Warum: Minuten und der ueberlaufende
+  Cache-Speicher. Preis: red-first laeuft nie auf main, seine beiden stabilen
+  Baum-Verzeichnisse werden nicht mehr gespeichert und bauen kalt, wenn ein
+  PR Test-First-Belege hat - Zuruecknehmen: `save-if` fuer red-first, wenn
+  dessen Median dadurch spuerbar steigt.
+- Dependabot monatlich, je Oekosystem ein Sammel-PR; Security-Updates
+  bleiben sofort (eigener GitHub-Mechanismus, nicht `schedule`) - Warum: jeder
+  Dependabot-PR ist ein voller Lauf inkl. Windows - Zuruecknehmen: wenn ein
+  Monatsbuendel regelmaessig an einer einzelnen Abhaengigkeit scheitert;
+  dann diese als eigene Gruppe.
+- JUnit-Berichte (nextest-Profil `ci`, Vitest bei `PA_JUNIT=1`) gehen per
+  `mergifyio/gha-mergify-ci` (SHA-gepinnt, v25) an Mergify Test Insights,
+  ohne zusaetzlichen Lauf; der Upload ist `continue-on-error`, laeuft auch
+  bei roten Laeufen und schaltet sich ohne Secret `MERGIFY_TOKEN` ab -
+  Zuruecknehmen: wenn Test Insights nicht genutzt wird.
diff --git a/scripts/ci/gates.sh b/scripts/ci/gates.sh
index e837cbb..b553178 100755
--- a/scripts/ci/gates.sh
+++ b/scripts/ci/gates.sh
@@ -75,6 +75,11 @@ GATES=(
   # Laeuft gegen einen lokalen Server: kein Netz, kein Secret, keine
   # Modellminute.
   "selftest-review|linux,release|.|bash scripts/test-review-transport.sh"
+  # CI-01: der Plan-Schritt des Windows-Jobs entscheidet, ob die Bahn
+  # `windows` laufen muss. Ein falsches "false" waere ein Windows-Gate, das
+  # gruen durch Abwesenheit ist - deshalb belegt der Selbsttest beide
+  # Richtungen (Rust-Aenderung -> voll, Doku -> aus, Queue/Push -> voll).
+  "selftest-windows-plan|linux,release|.|bash scripts/test-windows-plan.sh"
 
   # --- schnell: Form und Typen --------------------------------------------
   "fmt|precommit,prepush,linux,windows,release|src-tauri|cargo fmt --check"
diff --git a/scripts/ci/windows-plan.sh b/scripts/ci/windows-plan.sh
new file mode 100644
index 0000000..8c1c227
--- /dev/null
+++ b/scripts/ci/windows-plan.sh
@@ -0,0 +1,216 @@
+#!/usr/bin/env bash
+# windows-plan.sh — braucht dieser Lauf die Windows-Bahn ueberhaupt?
+#
+# Herkunft: CI-01 (Nutzer-Entscheidung 24.09.2026, docs/decisions.md).
+# gates (windows) macht 70 % der Actions-Minuten aus (Windows zaehlt doppelt,
+# gruener PR-Lauf im Median 15,3 min). Ein PR, der nur Doku, Frontend oder
+# Berichte aendert, kann auf Windows nichts beweisen, was die Bahn `windows`
+# misst: fmt, clippy, Rust-Suite und native-tests lesen keine dieser Dateien.
+#
+# Warum ein PLAN-SCHRITT und kein `paths-ignore` / kein Job-`if`:
+#   - `paths-ignore` war am 03.09. schon einmal da und hat zwei Gates blind
+#     gemacht (docs/decisions.md 2026-09-04): es filtert nach Dateiendung,
+#     nicht nach den Eingaben eines Gates, und ein Required Check, dessen
+#     Workflow gar nicht startet, bleibt fuer immer "pending".
+#   - Ein Job-`if` meldet "skipped"; ob das den Required Check erfuellt, ist
+#     GitHub-Semantik, die sich aendern kann, und im Log steht kein Grund.
+#   - Hier entscheidet das Gate selbst anhand einer EXPLIZITEN Liste seiner
+#     Eingaben, protokolliert die Entscheidung und den ausloesenden Pfad, und
+#     `gates (windows)` endet immer mit success oder failure. Dasselbe Muster
+#     wie `red-first.sh --plan`.
+#
+# Sicherheitsnetz, in dieser Reihenfolge:
+#   1. Jedes Ereignis ausser pull_request (Push auf main, workflow_dispatch)
+#      -> immer volle Bahn.
+#   2. Queue-Laeufe von Mergify (Kopf-Branch mergify/merge-queue/*) -> immer
+#      volle Bahn. Die Queue ist der letzte Halt vor main.
+#   3. Die Liste der geaenderten Dateien laesst sich nicht bestimmen -> volle
+#      Bahn. Nie "gruen durch Abwesenheit" (AGENTS.md).
+#   4. Sonst: volle Bahn genau dann, wenn eine geaenderte Datei eine Eingabe
+#      der Bahn ist.
+#
+# Eingaben der Bahn `windows` (abgeleitet aus scripts/ci/gates.sh, Gates fmt,
+# clippy, rust-suite, native-tests):
+#   src-tauri/**               der ganze Crate: Quelltext, Cargo.toml/.lock,
+#                              build.rs, tauri.conf.json, resources/,
+#                              testdata/, .config/nextest.toml, icons/
+#   scripts/ci/**              gates.sh, native-tests.sh, dieses Skript
+#   .github/**                 der Job selbst und seine Actions
+#   .config/**                 Werkzeug-Konfiguration auf Wurzelebene
+#   rust-toolchain, rust-toolchain.toml
+#   .cargo/**, rustfmt.toml, .rustfmt.toml, clippy.toml, .clippy.toml
+#                              cargo/rustfmt/clippy suchen sie auch in den
+#                              Elternverzeichnissen des Crates
+#   .gitattributes             Zeilenenden auf dem Windows-Checkout -> fmt
+#   package.json, package-lock.json
+#                              native-tests startet node (ConPTY-Fixture)
+#   docs/PLAN.md               include_str! in src/development_plan.rs
+#   docs/agents-json.md        zur Laufzeit gelesen von einem Test in
+#                              src/profiles.rs (CARGO_MANIFEST_DIR/../docs)
+#   + jede Datei ausserhalb von src-tauri/, die ein `include_str!`/
+#     `include_bytes!` im Crate referenziert. Die werden bei JEDEM Lauf frisch
+#     aus dem Quelltext ermittelt - ein neues include_str!("../../x") braucht
+#     also keine Pflege dieser Liste. Festgenagelt in
+#     scripts/test-windows-plan.sh.
+#
+# Ausgabe (stdout), fuer $GITHUB_OUTPUT gedacht:
+#   run=true|false
+#   reason=<ein Satz>
+# Davor stehen menschenlesbare Zeilen mit dem Praefix "windows-plan:".
+#
+# Umgebung:
+#   EVENT_NAME   github.event_name        (Pflicht)
+#   HEAD_REF     github.head_ref          (bei pull_request)
+#   PLAN_BASE    Vergleichsbasis; Standard: erster Elternteil von HEAD. Im
+#                pull_request-Checkout ist HEAD der Merge-Commit
+#                refs/pull/N/merge, sein erster Elternteil ist die Spitze von
+#                main - der Diff ist also genau das, was der PR an main
+#                aendert, ohne Merge-Base-Suche und mit fetch-depth 2.
+#   PLAN_HEAD    Standard: HEAD
+#
+# Selbsttest: scripts/test-windows-plan.sh
+set -uo pipefail
+
+ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
+cd "$ROOT" || exit 2
+
+say() { echo "windows-plan: $*"; }
+
+decide() { # run reason
+  say "Entscheidung: run=$1 - $2"
+  echo "run=$1"
+  echo "reason=$2"
+  exit 0
+}
+
+# Statische Eingaben als erweiterte Muster (bash `case`-Glob, `*` passt auch
+# ueber `/` hinweg).
+STATIC_INPUTS=(
+  "src-tauri/*"
+  "scripts/ci/*"
+  ".github/*"
+  ".config/*"
+  "rust-toolchain"
+  "rust-toolchain.toml"
+  ".cargo/*"
+  "rustfmt.toml"
+  ".rustfmt.toml"
+  "clippy.toml"
+  ".clippy.toml"
+  ".gitattributes"
+  "package.json"
+  "package-lock.json"
+  "docs/PLAN.md"
+  "docs/agents-json.md"
+)
+
+# Alle Dateien ausserhalb von src-tauri/, die der Crate per include_str!/
+# include_bytes! einbindet. Relative Pfade werden vom Verzeichnis der
+# einbindenden Datei aus aufgeloest.
+dynamic_inputs() {
+  local f dir rel resolved
+  while IFS= read -r f; do
+    dir="$(dirname "$f")"
+    while IFS= read -r rel; do
+      [ -n "$rel" ] || continue
+      resolved="$(normalize "$dir/$rel")"
+      case "$resolved" in
+        src-tauri/*) ;;          # schon durch src-tauri/* gedeckt
+        ../*|/*) ;;              # ausserhalb des Repos - nicht unser Diff
+        *) echo "$resolved" ;;
+      esac
+    done < <(grep -oE 'include_(str|bytes)!\("[^"]+"\)' "$f" 2>/dev/null |
+               sed -E 's/^include_(str|bytes)!\("//; s/"\)$//')
+  done < <(find src-tauri/src -type f -name '*.rs' 2>/dev/null | sort)
+}
+
+# a/b/../c -> a/c, ohne das Dateisystem zu fragen (die Datei muss nicht
+# existieren; realpath -m gibt es auf macOS nicht).
+normalize() {
+  local IFS=/ part out=()
+  for part in $1; do
+    case "$part" in
+      "" | .) ;;
+      ..)
+        if [ "${#out[@]}" -gt 0 ] && [ "${out[${#out[@]}-1]}" != ".." ]; then
+          unset 'out[${#out[@]}-1]'
+        else
+          out+=("..")
+        fi
+        ;;
+      *) out+=("$part") ;;
+    esac
+  done
+  printf '%s' "${out[*]}"
+}
+
+is_input() { # pfad
+  local p
+  for p in "${STATIC_INPUTS[@]}" "${DYNAMIC[@]+"${DYNAMIC[@]}"}"; do
+    # shellcheck disable=SC2254
+    case "$1" in $p) return 0 ;; esac
+  done
+  return 1
+}
+
+if [ "${1:-}" = "--list-inputs" ]; then
+  DYNAMIC=()
+  while IFS= read -r d; do [ -n "$d" ] && DYNAMIC+=("$d"); done < <(dynamic_inputs | sort -u)
+  printf '%s\n' "${STATIC_INPUTS[@]}" "${DYNAMIC[@]+"${DYNAMIC[@]}"}"
+  exit 0
+fi
+
+EVENT_NAME="${EVENT_NAME:-}"
+HEAD_REF="${HEAD_REF:-}"
+[ -n "$EVENT_NAME" ] || { echo "::error::windows-plan.sh: EVENT_NAME fehlt" >&2; exit 2; }
+
+if [ "$EVENT_NAME" != "pull_request" ]; then
+  decide true "Ereignis '$EVENT_NAME' ist kein pull_request - volle Windows-Bahn als Sicherheitsnetz"
+fi
+
+case "$HEAD_REF" in
+  mergify/merge-queue/*)
+    decide true "Merge-Queue-Lauf ($HEAD_REF) - volle Windows-Bahn vor dem Merge auf main"
+    ;;
+esac
+
+PLAN_HEAD="${PLAN_HEAD:-HEAD}"
+if [ -z "${PLAN_BASE:-}" ]; then
+  if ! PLAN_BASE="$(git rev-parse --verify --quiet "${PLAN_HEAD}^1")"; then
+    decide true "Vergleichsbasis ${PLAN_HEAD}^1 nicht verfuegbar (Checkout zu flach?) - volle Bahn"
+  fi
+  # Nur ein Merge-Commit (refs/pull/N/merge) hat einen zweiten Elternteil.
+  # Ohne ihn ist ^1 der Vorgaenger-Commit und der Diff nur der letzte
+  # Commit des PRs - zu wenig, also volle Bahn.
+  if ! git rev-parse --verify --quiet "${PLAN_HEAD}^2" > /dev/null; then
+    decide true "$PLAN_HEAD ist kein PR-Merge-Commit - Aenderungsmenge unklar, volle Bahn"
+  fi
+fi
+
+if ! changed="$(git diff --name-only "$PLAN_BASE" "$PLAN_HEAD" 2>&1)"; then
+  say "git diff scheiterte: $changed"
+  decide true "Aenderungsliste nicht bestimmbar - volle Bahn"
+fi
+
+if [ -z "$changed" ]; then
+  decide true "leere Aenderungsliste - das ist verdaechtig, also volle Bahn"
+fi
+
+DYNAMIC=()
+while IFS= read -r d; do [ -n "$d" ] && DYNAMIC+=("$d"); done < <(dynamic_inputs | sort -u)
+if [ "${#DYNAMIC[@]}" -gt 0 ]; then
+  say "per include_str!/include_bytes! eingebunden (ausserhalb src-tauri/): ${DYNAMIC[*]}"
+fi
+
+count=0
+while IFS= read -r f; do
+  [ -n "$f" ] || continue
+  count=$((count + 1))
+  if is_input "$f"; then
+    decide true "$f ist eine Eingabe der Windows-Bahn"
+  fi
+done <<< "$changed"
+
+say "$count geaenderte Datei(en), keine davon ist eine Eingabe der Windows-Bahn:"
+while IFS= read -r f; do [ -n "$f" ] && say "  $f"; done <<< "$changed"
+decide false "keine der $count geaenderten Dateien ist eine Eingabe von fmt/clippy/rust-suite/native-tests"
diff --git a/scripts/test-gates.sh b/scripts/test-gates.sh
index f35e424..196a2b3 100755
--- a/scripts/test-gates.sh
+++ b/scripts/test-gates.sh
@@ -69,9 +69,9 @@ fi
 # Variable, dann pruefen.
 pflicht_precommit="fmt cargo-check typecheck"
 pflicht_prepush="fmt typecheck lint fe-test hq-test clippy rust-suite"
-pflicht_linux="no-masked wf-shell wf-pinned selftest-gates selftest-red-first selftest-review fmt typecheck lint fe-test hq-test hq-visual fe-build e2e clippy rust-suite"
+pflicht_linux="no-masked wf-shell wf-pinned selftest-gates selftest-red-first selftest-review selftest-windows-plan fmt typecheck lint fe-test hq-test hq-visual fe-build e2e clippy rust-suite"
 pflicht_windows="fmt clippy rust-suite native-tests"
-pflicht_release="no-masked wf-shell wf-pinned selftest-gates selftest-red-first selftest-review fmt typecheck lint fe-test hq-test hq-visual fe-build e2e clippy rust-suite"
+pflicht_release="no-masked wf-shell wf-pinned selftest-gates selftest-red-first selftest-review selftest-windows-plan fmt typecheck lint fe-test hq-test hq-visual fe-build e2e clippy rust-suite"
 pflicht_audit="audit-rust audit-npm"
 
 for lane in $LANES; do
diff --git a/scripts/test-windows-plan.sh b/scripts/test-windows-plan.sh
new file mode 100644
index 0000000..1d701e8
--- /dev/null
+++ b/scripts/test-windows-plan.sh
@@ -0,0 +1,162 @@
+#!/usr/bin/env bash
+# Selbsttest fuer scripts/ci/windows-plan.sh (CI-01).
+#
+# Beweist in einem Wegwerf-Repo mit echtem PR-Merge-Commit (wie
+# refs/pull/N/merge im Actions-Checkout):
+#   - eine Rust-Aenderung loest die Windows-Bahn aus,
+#   - eine reine Doku-/Frontend-Aenderung laesst sie aus,
+#   - eine Datei, die der Crate per include_str! einbindet, loest sie aus,
+#     obwohl sie unter docs/ liegt (dynamische Eingaben),
+#   - Push-Ereignisse, Merge-Queue-Branches, ein Nicht-Merge-Commit und ein
+#     zu flacher Checkout fuehren IMMER zur vollen Bahn (Sicherheitsnetz),
+#   - die Ausgabe hat genau die zwei Schluesselzeilen run=/reason=.
+# Und dass der Detektor scheitern KANN: jeder Fall prueft beide Richtungen
+# (AGENTS.md, Regel 2).
+set -uo pipefail
+
+HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
+PLAN="$HERE/scripts/ci/windows-plan.sh"
+tmp="$(mktemp -d "${TMPDIR:-/tmp}/windows-plan.XXXXXX")"
+trap 'rm -rf "$tmp"' EXIT
+fails=0
+
+[ -f "$PLAN" ] || { echo "FEHLER: $PLAN fehlt"; exit 1; }
+
+repo="$tmp/repo"
+mkdir -p "$repo"
+cd "$repo" || exit 1
+git init -q -b main
+git config user.email "probe@example.test"
+git config user.name "windows-plan probe"
+git config commit.gpgsign false
+git config core.hooksPath /dev/null
+git config core.autocrlf false
+
+mkdir -p scripts/ci src-tauri/src docs src .github/workflows
+cp "$PLAN" scripts/ci/windows-plan.sh
+printf 'fn main() {}\n' > src-tauri/src/main.rs
+# Eine Datei ausserhalb des Crates, eingebunden per include_str! - genau die
+# Klasse von docs/PLAN.md in src/development_plan.rs.
+printf 'const X: &str = include_str!("../../docs/EINGEBUNDEN.md");\n' > src-tauri/src/plan.rs
+printf '# eingebunden\n' > docs/EINGEBUNDEN.md
+printf '# frei\n' > docs/frei.md
+printf 'export {};\n' > src/App.tsx
+printf 'name: ci\n' > .github/workflows/ci.yml
+git add -A
+git commit -q -m "basis"
+
+# Legt einen PR-Branch mit genau einer geaenderten Datei an und baut daraus
+# einen Merge-Commit wie GitHubs refs/pull/N/merge (erster Elternteil = main).
+pr_merge() { # name datei
+  git checkout -q -B "pr-$1" main
+  mkdir -p "$(dirname "$2")"
+  printf 'aenderung %s\n' "$1" >> "$2"
+  git add -A
+  git commit -q -m "pr $1"
+  git checkout -q --detach main
+  git merge -q --no-ff --no-edit "pr-$1" -m "Merge pr-$1 into main"
+}
+
+run_plan() { # event head_ref -> Ausgabe in $tmp/out
+  EVENT_NAME="$1" HEAD_REF="$2" bash scripts/ci/windows-plan.sh > "$tmp/out" 2>&1
+}
+
+expect() { # fall erwartet(true|false)
+  local got
+  got="$(grep -E '^run=' "$tmp/out" | tail -1)"
+  if [ "$got" = "run=$2" ]; then
+    echo "ok   $1 ($got)"
+  else
+    echo "FEHLER $1: '$got', erwartet run=$2"
+    sed 's/^/    /' "$tmp/out"
+    fails=$((fails + 1))
+  fi
+}
+
+case_pr() { # fall datei erwartet [head_ref]
+  pr_merge "$1" "$2"
+  run_plan pull_request "${4:-pr-$1}"
+  expect "$1" "$3"
+  git checkout -q main
+}
+
+case_pr rust-aenderung      src-tauri/src/main.rs  true
+case_pr doku-aenderung      docs/frei.md           false
+case_pr frontend-aenderung  src/App.tsx            false
+case_pr bericht             .pa/report_x.md        false
+case_pr eingebunden         docs/EINGEBUNDEN.md    true
+case_pr workflow-aenderung  .github/workflows/ci.yml true
+case_pr gate-skript         scripts/ci/gates.sh    true
+case_pr lockfile            package-lock.json      true
+case_pr zeilenenden         .gitattributes         true
+case_pr crate-ressource     src-tauri/resources/a.json true
+# Queue-Lauf: dieselbe Doku-Aenderung, aber auf einem mergify-Branch -> voll.
+case_pr queue-doku          docs/frei.md           true  mergify/merge-queue/0123456789
+
+# Push auf main -> immer voll, ohne ueberhaupt zu diffen.
+run_plan push ""
+expect push-auf-main true
+
+# Kein Merge-Commit (HEAD hat nur einen Elternteil): Aenderungsmenge unklar.
+git checkout -q -B einzeln main
+printf 'x\n' >> docs/frei.md
+git add -A
+git commit -q -m "einzelner commit"
+run_plan pull_request einzeln
+expect kein-merge-commit true
+git checkout -q main
+
+# Zu flacher Checkout: der erste Elternteil fehlt.
+pr_merge flach docs/frei.md
+git branch -q -f merge-flach HEAD
+git checkout -q main
+git clone -q --depth 1 --no-local --branch merge-flach "file://$repo" "$tmp/flach" 2> /dev/null
+(
+  cd "$tmp/flach" || exit 1
+  EVENT_NAME=pull_request HEAD_REF=pr-flach bash scripts/ci/windows-plan.sh > "$tmp/out" 2>&1
+)
+expect flacher-checkout true
+# ... und zwar aus dem richtigen Grund, nicht zufaellig ueber einen anderen
+# Zweig des Sicherheitsnetzes.
+if grep -E '^reason=.*nicht verfuegbar' "$tmp/out" > /dev/null; then
+  echo "ok   flacher-checkout-grund"
+else
+  echo "FEHLER flacher-checkout-grund:"; sed 's/^/    /' "$tmp/out"; fails=$((fails + 1))
+fi
+
+# Ohne EVENT_NAME ist das ein Aufruffehler, kein stilles "false".
+if EVENT_NAME="" bash scripts/ci/windows-plan.sh > "$tmp/out" 2>&1; then
+  echo "FEHLER ohne-event: Exit 0, erwartet Abbruch"
+  fails=$((fails + 1))
+else
+  echo "ok   ohne-event (Abbruch)"
+fi
+
+# Ausgabeform: genau eine run=- und eine reason=-Zeile; alle anderen Zeilen
+# tragen das Praefix, damit ci.yml nur die Schluessel nach $GITHUB_OUTPUT
+# schreibt (dieselbe Regel wie beim red-first-Plan).
+pr_merge format docs/frei.md
+run_plan pull_request pr-format
+if [ "$(grep -cE '^run=(true|false)$' "$tmp/out")" -eq 1 ] &&
+   [ "$(grep -cE '^reason=.+' "$tmp/out")" -eq 1 ] &&
+   ! grep -vE '^(run=|reason=|windows-plan: )' "$tmp/out" > /dev/null; then
+  echo "ok   ausgabeform"
+else
+  echo "FEHLER ausgabeform:"; sed 's/^/    /' "$tmp/out"; fails=$((fails + 1))
+fi
+git checkout -q main
+
+# Im ECHTEN Repo: die include_str!-Suche findet docs/PLAN.md. Faellt diese
+# Zeile, ist die dynamische Eingabeliste blind geworden.
+(cd "$HERE" && bash scripts/ci/windows-plan.sh --list-inputs) > "$tmp/inputs" 2>&1
+if grep -x 'docs/PLAN.md' "$tmp/inputs" > /dev/null; then
+  echo "ok   echtes-repo-findet-docs/PLAN.md"
+else
+  echo "FEHLER echtes-repo: docs/PLAN.md fehlt in --list-inputs"; fails=$((fails + 1))
+fi
+
+if [ "$fails" -gt 0 ]; then
+  echo "test-windows-plan: $fails Fehler"
+  exit 1
+fi
+echo "test-windows-plan: alle Faelle gruen"
diff --git a/src-tauri/.config/nextest.toml b/src-tauri/.config/nextest.toml
index a1d8cc0..984e0e7 100644
--- a/src-tauri/.config/nextest.toml
+++ b/src-tauri/.config/nextest.toml
@@ -9,3 +9,10 @@ fail-fast = false
 slow-timeout = { period = "60s", terminate-after = 2 }
 failure-output = "immediate-final"
 final-status-level = "flaky"
+
+# JUnit-Bericht fuer Mergify Test Insights (CI-01, 24.09.). Landet unter
+# <target>/nextest/ci/junit.xml - im ignorierten target/, also kein
+# Seiteneffekt auf den Arbeitsbaum (gates.sh prueft das). ci.yml laedt ihn
+# nach der Bahn hoch; lokal bleibt er einfach liegen.
+[profile.ci.junit]
+path = "junit.xml"
diff --git a/vitest.config.ts b/vitest.config.ts
index 6527198..c82cc69 100644
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -6,9 +6,23 @@ import { configDefaults, defineConfig } from "vitest/config";
 // build. Testing Library's act() support then fails before tests can run.
 process.env.NODE_ENV = "test";
 
+// JUnit fuer Mergify Test Insights (CI-01). Nur wenn der CI-Job `gates
+// (linux)` PA_JUNIT=1 setzt - lokal und in red-first bleibt die Ausgabe
+// unveraendert (red-first liest die Zusammenfassung des default-Reporters).
+// `github-actions` steht mit drin, weil eine explizite Reporter-Liste den
+// automatisch aktivierten Annotations-Reporter sonst verdraengen wuerde.
+const junitReporters =
+  process.env.PA_JUNIT === "1"
+    ? {
+        reporters: ["default", "github-actions", "junit"],
+        outputFile: { junit: ".junit/vitest.xml" },
+      }
+    : {};
+
 export default defineConfig({
   plugins: [react()],
   test: {
+    ...junitReporters,
     include: ["src/**/*.{test,spec}.{ts,tsx}"],
     environment: "jsdom",
     globals: true,
```
