# Review request PR #11 (W5-28): automatic runtime proof — final candidate

You are an independent reviewer (not the author; the author is a Kimi model).
Review the COMPLETE final candidate below for correctness bugs, gaps against
the requirements, and safety regressions. Be concrete: cite file and line,
say what breaks and when. Rate each finding high/medium/low. Do not restate
the diff. If something is fine, say nothing about it. Answer in English or
German. This is a READ-ONLY review: do not modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/,
public GitHub repo). The app holds a persistent task queue in SQLite; a
dispatcher thread (queue::start, POLL_INTERVAL 30 s) turns ready queue
entries into agent workers. At startup a reattach pass resolves interrupted
claims back to ready but never spawns. The single-instance guard is a mutex
named "<bundle identifier>-sim" (tauri-plugin-single-instance).
PROJECTA_APP_DATA redirects the app data dir (db, log, api descriptor) and
already exists for isolated proof runs. The control api serves
127.0.0.1 with a token from <appdata>/projecta-api.json; POST /api/projects
needs no verdict token when PROJECTA_APP_DATA is set.

## Package requirement (plan wording, translated)

W5-28 "automatic runtime proof": a reproducible local run in a sandbox (own
data directory, queue off) that proves the app starts and no old queued jobs
dispatch agents (automating the "M1" acceptance). Red criterion: the proof is
produced without a real worker starting; a retention limit on proof artifacts
applies. Local/test only; never call real provider CLIs.

## Review history (already addressed — verify, don't just re-report)

Two earlier reviewers (glm-5.2, qwen2.5-coder) reviewed an earlier candidate.
These findings were fixed and are part of the diff; check the fixes are
actually correct, and hunt for NEW bugs anywhere in the candidate:

- F1 (high): verdict false-PASS when the api answer is a non-array or has
  fewer entries than seeded. Fix: verdict requires an array with at least
  `seeded` entries; the driver keeps non-array answers visible as null.
- F2 (medium): retention considered every directory under the proof root.
  Fix: only runStamp-shaped names (RUN_NAME_PATTERN) are deletable.
- F3 (medium): window-shot -TargetPid fell back to title matching, which
  could photograph the production window. Fix: with -TargetPid a missing
  window is a terminating error (throw under $ErrorActionPreference='Stop').
- F4 (low, rejected by author): global Alt keystroke in window-shot.ps1,
  kept intentionally because Windows otherwise refuses SetForegroundWindow
  from a background console.
- R2-1 (low): [null] elements in the queue answer crashed the driver.
  Fix: elements map to status "malformed", the verdict fails cleanly.

## Diff (git diff origin/main...HEAD, complete final candidate cae91c0)

```diff
diff --git a/.pa/report_w5-28.md b/.pa/report_w5-28.md
new file mode 100644
index 0000000..9436d9c
--- /dev/null
+++ b/.pa/report_w5-28.md
@@ -0,0 +1,92 @@
+# Report W5-28 — Automatischer Laufzeit-Beleg (Sandbox, Queue aus)
+
+Paketzeile (`.pa/plan_projects_w5.md`, Phase D): „rot: der Beleg entsteht,
+ohne dass ein echter Worker startet (eigenes Datenverzeichnis, Queue aus);
+Aufbewahrungsgrenze greift". Automatisiert die M1-Abnahme: die App startet,
+und alte Queue-Aufträge schicken keine Agenten los.
+
+## Was sich geändert hat
+
+- `src-tauri/src/queue.rs`: `PROJECTA_QUEUE=off` (auch `0`/`false`) lässt
+  `queue::start` vor dem Dispatcher-Thread aussteigen, mit Logzeile. Reattach
+  und Claim-Auflösung bleiben unverändert (geben Claims nur nach `ready`
+  frei, spawnen nie). Unit-Tests pinnen die Auswertung.
+- `scripts/runtime-proof.mjs` (+ npm-Script `proof:runtime`): fährt den
+  Beleg lokal. Phase 1 startet die App mit eigenem `PROJECTA_APP_DATA` und
+  `PROJECTA_QUEUE=off`, legt über die Control-API ein Scratch-Projekt und
+  zwei alte Queue-Einträge an; Phase 2 startet auf demselben Datenverzeichnis
+  neu und belegt nach >2 Sweep-Intervallen (70 s) per API: Einträge weiter
+  `ready`, null Worker, Logzeile vorhanden, Fenster-Screenshot. Verweigert
+  den Start, solange ein Produktiv-`projecta.exe` läuft (geteilte
+  Single-Instance-Mutex), außer `--parallel-ok` für Builds mit abweichender
+  Bundle-ID (`TAURI_CONFIG`).
+- `scripts/lib/runtime-proof-lib.mjs` + Tests: Layout, Verdikt und
+  Aufbewahrung (10 jüngste Läufe) als pure Funktionen, 9 node:test-Tests.
+- `scripts/window-shot.ps1`: `-TargetPid` (kein Titel-Fallback mehr bei
+  PID-Vorgabe) und PrintWindow-Fallback gegen den Foreground-Lock.
+- `src-tauri/src/skills.rs`: rustfmt-Re-Wrap — der öffentliche Squash
+  c60f267 war mit stable rustfmt 1.9 fmt-rot und blockierte die
+  precommit-Lane für jeden src-tauri-Commit (CI-Push-Lauf 36128534223 rot).
+- `docs/decisions.md`: Journaleintrag.
+- `package.json`: Script `proof:runtime`.
+
+Nicht in CI-Gates eingehängt: der Lauf braucht WebView2/Fenster und ist
+laut Auftrag nur lokal/Test. Kein Provider-CLI wird je aufgerufen.
+
+## Rot → Grün
+
+- `cargo test queue_dispatch_disabled`: rot Exit 101 (E0425, Funktion
+  fehlte) → grün Exit 0, 2/2.
+- `node --test scripts/lib/runtime-proof-lib.test.mjs`: rot Exit 1 (Modul
+  fehlte) → grün Exit 0; nach Review-Tests rot Exit 1 (7/9) → grün 9/9.
+- Red-first-Trailer auf jedem Code-Commit; Reihenfolge Test vor Impl.
+
+## Gates
+
+- `bash scripts/ci/gates.sh lane prepush` (Windows, Slot projecta-c):
+  fmt, typecheck, lint, fe-test, hq-test, clippy, rust-suite (1605/1605)
+  grün, Summenzeit 370 s. Ein erster Lauf meldete am Ende Exit 1, weil die
+  Dispositionsdatei während des Laufs uncommittet entstand — kein Gate,
+  sondern der Arbeitsbaum-Wächter; danach alle Dateien committet.
+- Live-Belegläufe (Produktiv-App lief die ganze Zeit, unangetastet):
+  - Debug-Build `com.projecta.proof`: Exit 0 (Screenshot zeigte die
+    devUrl-Fehlerseite — plain cargo build ohne `custom-protocol`).
+  - Release-Build `--features tauri/custom-protocol`, Lauf
+    2026-09-25T14-20-58Z: Exit 0; proof.json: Start 1048 ms / Restart 781 ms,
+    2 Einträge nach 70 s `ready`, `workers: []`, Screenshot inspiziert:
+    zeigt die echte App-UI des Sandbox-Projekts, „0 workers".
+  - Schutzschiene verifiziert: ohne `--parallel-ok` bei laufender
+    Produktiv-Instanz Verweigerung mit Exit 1.
+
+## NICHT ABGEDECKT von diesem Lauf
+
+- die `#[cfg(unix)]`-Tests (Dateirechte, Prozessgruppen-Kill) — kompilieren
+  unter Windows nicht (KNOWN_ISSUES KI-7); die Linux-Arme von clippy.
+  Dieser Lauf belegt die Windows-Hälfte, nicht die Linux-Hälfte.
+- Browser-Smoke, Frontend-Build-Gate und Workflow-Gates laufen erst in der
+  Bahn `linux` (CI).
+- Der Beleg läuft nicht auf CI-Runnern (braucht WebView2/Fenster).
+- Externe Dienste (Updater, OmniRoute) prüft kein Gate — Release-Verify.
+
+## Reviews
+
+Siehe `.pa/review_w5-28_disposition.md`. glm-5.2 R1 (4 Befunde: F1 hoch,
+F2/F3 mittel, F4 niedrig — alle dispositionsfest), qwen2.5-coder (kein neuer
+Befund), glm-5.2 R2 auf dem Delta (F1/F2 bestätigt, F3 geschärft, ein neues
+Low). Advisor-Paar nicht erreichbar (Codex-Kontingent bis 30.09.,
+Claude-Subagent HTTP 402); deepseek-v4-flash:cloud bei Ollama gelöscht
+(410), qwen3.8:latest nicht antwortend (500). Zweitreview daher durch
+qwen2.5-coder:7b lokal.
+
+## Offene Punkte / Folgearbeit
+
+- Der öffentliche Squash-Stand hat zwei repo-weite, schon vor diesem Paket
+  rote Stellen: Gate `selftest-review` (CI linux) schlägt fehl, weil
+  `.pa/review_transport.py` nicht veröffentlicht ist; und `cargo fmt
+  --check` war auf main rot (hier mitgeführt als Re-Wrap). Beides gehört in
+  ein Publish-Hygiene-Paket, nicht in W5-28.
+- W5-28-Zeile steht nur im privaten W5-Plan; im öffentlichen `docs/PLAN.md`
+  gibt es keine Checkbox zum Abhaken.
+- Debug-Exes ohne `custom-protocol` zeigen im Fenster die devUrl-Fehlerseite;
+  der Treiber-Kommentar sagt das jetzt. Für den UI-Screenshot Release- oder
+  Feature-Build nehmen.
diff --git a/.pa/review_prompt_w5-28-r2.md b/.pa/review_prompt_w5-28-r2.md
new file mode 100644
index 0000000..fd9bc74
--- /dev/null
+++ b/.pa/review_prompt_w5-28-r2.md
@@ -0,0 +1,133 @@
+# Review request W5-28 R2: delta after your first review
+
+You reviewed this candidate before (findings F1–F4). The author applied
+fixes; review ONLY the delta below. Confirm whether each finding is actually
+fixed, and look for new bugs introduced by the fixes. Be concrete: file and
+line. Rate findings high/medium/low. If something is fine, say nothing.
+Answer in English or German.
+
+## Your findings being addressed
+
+- F1 (high): verdict false-PASS when the api answer is a non-array or has
+  fewer entries than seeded.
+- F2 (medium): retention considered every directory under the proof root.
+- F3 (medium): window-shot -TargetPid fell back to title matching, which
+  could photograph the production window.
+- F4 (low): global Alt keystroke — documented, kept intentionally.
+
+## Delta (git diff 870ba09..b1e952b)
+
+```diff
+diff --git a/scripts/lib/runtime-proof-lib.mjs b/scripts/lib/runtime-proof-lib.mjs
+index b931162..3880aa7 100644
+--- a/scripts/lib/runtime-proof-lib.mjs
++++ b/scripts/lib/runtime-proof-lib.mjs
+@@ -42,10 +42,24 @@ export function evaluateProof({ phase1, phase2, logText, screenshot, requireScre
+   if (!phase1?.descriptorSeen) failures.push('phase 1: the app never published its api descriptor');
+   if (!phase2?.descriptorSeen) failures.push('phase 2: the restart never published its api descriptor');
+   if (!phase1?.seeded) failures.push('phase 1: no old queue entries were seeded, the proof is empty');
+-  for (const entry of phase2?.entries ?? []) {
+-    if (entry.status !== 'ready') failures.push(`queue entry ${entry.id} left ready: ${entry.status}`);
++  // glm-5.2 F1: a non-array or short answer must never pass — with zero
++  // entries the loop below would find nothing to complain about, which is
++  // exactly the "old jobs vanished into an agent" case the proof excludes.
++  if (!Array.isArray(phase2?.entries)) {
++    failures.push('phase 2: the queue answer was not an array — the proof read garbage');
++  } else {
++    if (phase2.entries.length < (phase1?.seeded ?? 0)) {
++      failures.push(`phase 2: ${phase2.entries.length} entries came back, ${phase1?.seeded ?? 0} were seeded — old jobs are missing`);
++    }
++    for (const entry of phase2.entries) {
++      if (entry.status !== 'ready') failures.push(`queue entry ${entry.id} left ready: ${entry.status}`);
++    }
++  }
++  if (!Array.isArray(phase2?.workers)) {
++    failures.push('phase 2: the workers answer was not an array — the proof read garbage');
++  } else if (phase2.workers.length > 0) {
++    failures.push(`${phase2.workers.length} worker(s) exist after the restart`);
+   }
+-  if ((phase2?.workers ?? []).length > 0) failures.push(`${phase2.workers.length} worker(s) exist after the restart`);
+   if (!(logText ?? '').includes(DISPATCH_DISABLED_LOG)) {
+     failures.push(`the app log lacks "${DISPATCH_DISABLED_LOG}" — the queue-off switch is unproven`);
+   }
+@@ -55,9 +69,14 @@ export function evaluateProof({ phase1, phase2, logText, screenshot, requireScre
+   return { ok: failures.length === 0, failures };
+ }
+ 
++// A run directory is named by runStamp; anything else under the proof root
++// is not ours and retention must not touch it (glm-5.2 F2).
++export const RUN_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/;
++
+ // Retention: names sort like time (runStamp), so the newest `keep` survive
+ // and the rest are returned for deletion.
+ export function selectRunsToDelete(runNames, keep = KEEP_RUNS) {
+   if (!Number.isSafeInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer, got ${keep}`);
+-  return [...runNames].sort().reverse().slice(keep);
++  const runs = runNames.filter((name) => RUN_NAME_PATTERN.test(name));
++  return [...runs].sort().reverse().slice(keep);
+ }
+diff --git a/scripts/lib/runtime-proof-lib.test.mjs b/scripts/lib/runtime-proof-lib.test.mjs
+index 112a519..257cbee 100644
+--- a/scripts/lib/runtime-proof-lib.test.mjs
++++ b/scripts/lib/runtime-proof-lib.test.mjs
+@@ -63,6 +63,21 @@ test('verdict fails when a queued entry left ready or a worker exists', () => {
+   assert.equal(evaluateProof(unseeded).ok, false);
+ });
+ 
++test('verdict fails when fewer entries come back than were seeded', () => {
++  const vanished = goodFacts();
++  vanished.phase2.entries = [];
++  assert.equal(evaluateProof(vanished).ok, false);
++  const garbage = goodFacts();
++  garbage.phase2.entries = null;
++  assert.equal(evaluateProof(garbage).ok, false);
++});
++
++test('retention ignores directories that are not proof runs', () => {
++  const names = ['keepme', '2026-09-20T00-00-00.000Z', '2026-09-25T09-00-00.000Z'];
++  assert.deepEqual(selectRunsToDelete(names, 1), ['2026-09-20T00-00-00.000Z']);
++  assert.deepEqual(selectRunsToDelete(['keepme', 'other'], 1), []);
++});
++
+ test('verdict fails without the disabled log line or a start or a required screenshot', () => {
+   const noLog = goodFacts();
+   noLog.logText = 'nothing relevant';
+diff --git a/scripts/runtime-proof.mjs b/scripts/runtime-proof.mjs
+index f1f0832..6e015d7 100644
+--- a/scripts/runtime-proof.mjs
++++ b/scripts/runtime-proof.mjs
+@@ -218,8 +218,10 @@ async function main() {
+     await sleep(options.settle * 1000);
+     const entries = await api(second.descriptor, 'GET', `/api/queue?projectId=${encodeURIComponent(projectId)}`);
+     const workers = await api(second.descriptor, 'GET', `/api/workers?projectId=${encodeURIComponent(projectId)}`);
+-    proof.phase2.entries = (Array.isArray(entries) ? entries : []).map((entry) => ({ id: entry.id, status: entry.status }));
+-    proof.phase2.workers = Array.isArray(workers) ? workers : [];
++    // A non-array answer stays visible as null: coercing it to [] would let
++    // the verdict pass on garbage (glm-5.2 F1).
++    proof.phase2.entries = Array.isArray(entries) ? entries.map((entry) => ({ id: entry.id, status: entry.status })) : null;
++    proof.phase2.workers = Array.isArray(workers) ? workers : null;
+     proof.screenshot = options.screenshot ? takeScreenshot(layout, child.pid) : { ok: false, reason: '--no-screenshot' };
+     killProjectA(child.pid);
+     await waitGone(child.pid);
+diff --git a/scripts/window-shot.ps1 b/scripts/window-shot.ps1
+index ee5a2e6..b145f5a 100644
+--- a/scripts/window-shot.ps1
++++ b/scripts/window-shot.ps1
+@@ -45,7 +45,14 @@ public class WinShot {
+ $candidates = @(Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*$Title*" })
+ if ($ProcessName) { $candidates = @($candidates | Where-Object { $_.ProcessName -eq $ProcessName }) }
+ $proc = $null
+-if ($TargetPid -gt 0) { $proc = @($candidates | Where-Object { $_.Id -eq $TargetPid }) | Select-Object -First 1 }
++if ($TargetPid -gt 0) {
++    $proc = @($candidates | Where-Object { $_.Id -eq $TargetPid }) | Select-Object -First 1
++    # glm-5.2 F3: mit -TargetPid ist der Titel-Fallback verboten - ein
++    # gleich betiteltes Fenster der Produktiv-Instanz waere ein falscher Beleg.
++    if (-not $proc) {
++        Write-Error "Kein Fenster mit PID $TargetPid und Titel *$Title* gefunden - Abbruch statt Titel-Fallback auf eine fremde Instanz."
++    }
++}
+ if (-not $proc) { $proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
+ if (-not $proc) { $proc = $candidates | Select-Object -First 1 }
+ if (-not $proc) {
+
+```
diff --git a/.pa/review_prompt_w5-28.md b/.pa/review_prompt_w5-28.md
new file mode 100644
index 0000000..f84268f
--- /dev/null
+++ b/.pa/review_prompt_w5-28.md
@@ -0,0 +1,752 @@
+# Review request W5-28: automatic runtime proof (sandbox, queue off)
+
+You are an independent reviewer (not the author; the author is a Kimi model).
+Review the diff below for correctness bugs, gaps against the requirements,
+and safety regressions. Be concrete: cite file and line, say what breaks and
+when. Rate each finding high/medium/low. Do not restate the diff. If
+something is fine, say nothing about it. Answer in English or German.
+
+## Context
+
+Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/,
+public GitHub repo). The app holds a persistent task queue in SQLite; a
+dispatcher thread (queue::start, POLL_INTERVAL 30 s) turns ready queue
+entries into agent workers. At startup a reattach pass resolves interrupted
+claims back to ready but never spawns. The single-instance guard is a mutex
+named "<bundle identifier>-sim" (tauri-plugin-single-instance).
+PROJECTA_APP_DATA redirects the app data dir (db, log, api descriptor) and
+already exists for isolated proof runs. The control api serves
+127.0.0.1 with a token from <appdata>/projecta-api.json; POST /api/projects
+needs no verdict token when PROJECTA_APP_DATA is set.
+
+## Package requirement (plan wording, translated)
+
+W5-28 "automatic runtime proof": a reproducible local run in a sandbox (own
+data directory, queue off) that proves the app starts and no old queued jobs
+dispatch agents (automating the "M1" acceptance). Red criterion: the proof is
+produced without a real worker starting; a retention limit on proof artifacts
+applies. Local/test only; never call real provider CLIs.
+
+## What the candidate does
+
+1. src-tauri/src/queue.rs: PROJECTA_QUEUE=off (or 0/false) makes queue::start
+   log a line and return before spawning the dispatcher thread. Unit tests
+   pin the evaluation.
+2. scripts/runtime-proof.mjs (npm run proof:runtime): refuses while any
+   projecta.exe runs (shared mutex) unless --parallel-ok (meant for binaries
+   built with TAURI_CONFIG identifier override); phase 1 starts the app with
+   PROJECTA_APP_DATA=<run>/appdata and PROJECTA_QUEUE=off, waits for the api
+   descriptor, creates a scratch git repo project and seeds two queue
+   entries; phase 2 deletes the stale descriptor, restarts on the same
+   appdata, waits 70 s (> 2 sweeps), then asserts via the api: entries still
+   ready, zero workers; the app log must contain the disabled line; a window
+   screenshot is taken; proof.json + log + screenshot land in one run dir;
+   only the 10 newest runs are kept (retention).
+3. scripts/lib/runtime-proof-lib.mjs: pure layout/verdict/retention
+   functions with node:test coverage (7 tests).
+4. scripts/window-shot.ps1: gains -TargetPid (two same-titled windows:
+   production + proof) and a PrintWindow fallback when the foreground lock
+   denies SetForegroundWindow from a background console.
+5. src-tauri/src/skills.rs: pure rustfmt re-wrap (the published squash
+   c60f267 fails cargo fmt --check with stable rustfmt 1.9; this blocked the
+   precommit lane for any src-tauri commit).
+
+## Verified evidence the author claims
+
+- cargo test queue_dispatch_disabled: red at exit 101 before the function
+  existed, green after (2 passed).
+- node --test scripts/lib/runtime-proof-lib.test.mjs: 7/7 green, exit 0.
+- Live proof run with a debug binary built under identifier
+  com.projecta.proof (TAURI_CONFIG), production app running the whole time:
+  exit 0, proof.json shows descriptorMs 1048/781, 2 seeded entries still
+  ready after 70 s, workers [], screenshot ok.
+
+## Questions to answer explicitly
+
+- Does PROJECTA_QUEUE=off really close every path by which an old queue
+  entry could reach an agent at startup or later (reattach, claim release,
+  other threads)? Anything in the diff that re-opens one?
+- Can the driver mistake a stale descriptor, a dead app or a failed seed for
+  a pass? Is the verdict function too weak (false PASS) anywhere?
+- --parallel-ok and the TAURI_CONFIG identifier override: can this endanger
+  the production instance or its data? Is the default (refuse) safe?
+- Retention: can selectRunsToDelete/rmSync delete anything outside the proof
+  root? Path traversal, symlink, non-run directories under root?
+- window-shot.ps1: can the Alt-stroke or PrintWindow fallback produce a
+  false or misleading artifact? Any abuse of the production window?
+- The rustfmt re-wrap of skills.rs riding along: acceptable or should it be
+  rejected?
+
+## Candidate
+
+HEAD 870ba09 (branch claude/w5-28), diff against origin/main:
+
+```diff
+diff --git a/docs/decisions.md b/docs/decisions.md
+index 091ca6c..6be5287 100644
+--- a/docs/decisions.md
++++ b/docs/decisions.md
+@@ -1352,3 +1352,20 @@ minutes are billed twice on private repos, so Windows alone was ~2850 of
+   `scripts/test-red-first-landed.sh` (gate `selftest-red-first`). Reverse
+   when: trailers on main stop being gated by red-first (then a trailer there
+   would no longer prove anything).
++
++## 2026-09-25 - W5-28: PROJECTA_QUEUE=off und der automatische Laufzeit-Beleg
++
++- `PROJECTA_QUEUE=off` (auch `0`/`false`) laesst `queue::start` vor dem
++  Dispatcher-Thread aussteigen; die App startet sonst vollstaendig — W5-28
++  braucht einen Lauf, in dem alte Queue-Eintraege nachweislich keinen Agenten
++  erreichen, und ein per Sweep gelesener Schalter liesse den Thread
++  weiterlaufen (Beleg im Log statt im Prozessbild) — Zurücknehmen: wenn der
++  Dispatcher selbst einen persistierten Not-Aus bekommt (W5-31b), der Schalter
++  ist bewusst prozesslokal und ohne DB-Zustand.
++- `scripts/runtime-proof.mjs` (npm run proof:runtime) faehrt den Beleg lokal:
++  eigener `PROJECTA_APP_DATA`-Sandbox, zwei Starts, zwei alte Queue-Eintraege,
++  Verdikt aus API-Auskunft (Eintraege `ready`, keine Worker) plus Logzeile und
++  Screenshot, Aufbewahrung der zehn juengsten Laeufe — die M1-Abnahme war
++  manuell und damit nicht wiederholbar — Zurücknehmen: nie das Verdikt als
++  Funktion; der Treiber darf durch einen `pa`-Unterbefehl ersetzt werden,
++  sobald der Daemon (W5-31b) die Sandboxes selbst verwaltet.
+diff --git a/package.json b/package.json
+index 8a936a0..effa387 100644
+--- a/package.json
++++ b/package.json
+@@ -30,7 +30,8 @@
+     "test:hq:visual": "node --test scripts/lib/hq-visual.browser.mjs",
+     "tauri": "tauri",
+     "hq:lesson": "node scripts/hq-lesson.mjs",
+-    "hq:queue-open-points": "node scripts/hq-queue-open-points.mjs"
++    "hq:queue-open-points": "node scripts/hq-queue-open-points.mjs",
++    "proof:runtime": "node scripts/runtime-proof.mjs"
+   },
+   "dependencies": {
+     "@tauri-apps/api": "^2.1.1",
+diff --git a/scripts/lib/runtime-proof-lib.mjs b/scripts/lib/runtime-proof-lib.mjs
+new file mode 100644
+index 0000000..b931162
+--- /dev/null
++++ b/scripts/lib/runtime-proof-lib.mjs
+@@ -0,0 +1,63 @@
++// W5-28: the pure decisions behind scripts/runtime-proof.mjs — sandbox
++// layout, the pass/fail verdict, and the retention limit on proof runs.
++// Everything here is free of I/O so node:test can pin it down.
++import { join } from 'node:path';
++
++/// How many proof runs stay on disk; older ones are deleted (the plan's
++// retention limit, so screenshots and logs cannot grow without bound).
++export const KEEP_RUNS = 10;
++
++// The log line the app writes when the dispatcher is switched off
++// (PROJECTA_QUEUE=off, src-tauri/src/queue.rs). The verdict demands it:
++// without the line, "nothing dispatched" could also mean "the dispatcher
++// never looked", and the proof would say nothing about the switch.
++export const DISPATCH_DISABLED_LOG = 'queue dispatcher disabled';
++
++// Filename-safe UTC stamp that sorts like time ('2026-09-25T10-00-00.000Z').
++export function runStamp(date = new Date()) {
++  return date.toISOString().replace(/:/g, '-');
++}
++
++// Every artifact of one run lives under its own directory, so a run can be
++// deleted as one unit and no two runs ever share a file.
++export function proofLayout(root, stamp) {
++  const runDir = join(root, stamp);
++  return {
++    runDir,
++    appData: join(runDir, 'appdata'),
++    scratchRepo: join(runDir, 'scratch-repo'),
++    descriptor: join(runDir, 'appdata', 'projecta-api.json'),
++    proofJson: join(runDir, 'proof.json'),
++    appLog: join(runDir, 'projecta.log'),
++    screenshot: join(runDir, 'window.png'),
++  };
++}
++
++// The M1 acceptance as a pure function over the facts the driver collected:
++// the app started (twice, so the second start faced old queue entries),
++// every seeded entry stayed ready, no worker exists, the log proves the
++// switch was honored, and — when required — the window was photographed.
++export function evaluateProof({ phase1, phase2, logText, screenshot, requireScreenshot }) {
++  const failures = [];
++  if (!phase1?.descriptorSeen) failures.push('phase 1: the app never published its api descriptor');
++  if (!phase2?.descriptorSeen) failures.push('phase 2: the restart never published its api descriptor');
++  if (!phase1?.seeded) failures.push('phase 1: no old queue entries were seeded, the proof is empty');
++  for (const entry of phase2?.entries ?? []) {
++    if (entry.status !== 'ready') failures.push(`queue entry ${entry.id} left ready: ${entry.status}`);
++  }
++  if ((phase2?.workers ?? []).length > 0) failures.push(`${phase2.workers.length} worker(s) exist after the restart`);
++  if (!(logText ?? '').includes(DISPATCH_DISABLED_LOG)) {
++    failures.push(`the app log lacks "${DISPATCH_DISABLED_LOG}" — the queue-off switch is unproven`);
++  }
++  if (requireScreenshot && !screenshot?.ok) {
++    failures.push(`screenshot failed: ${screenshot?.reason ?? 'not attempted'}`);
++  }
++  return { ok: failures.length === 0, failures };
++}
++
++// Retention: names sort like time (runStamp), so the newest `keep` survive
++// and the rest are returned for deletion.
++export function selectRunsToDelete(runNames, keep = KEEP_RUNS) {
++  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer, got ${keep}`);
++  return [...runNames].sort().reverse().slice(keep);
++}
+diff --git a/scripts/lib/runtime-proof-lib.test.mjs b/scripts/lib/runtime-proof-lib.test.mjs
+new file mode 100644
+index 0000000..112a519
+--- /dev/null
++++ b/scripts/lib/runtime-proof-lib.test.mjs
+@@ -0,0 +1,102 @@
++// W5-28: pins the pure decisions of scripts/runtime-proof.mjs — sandbox
++// layout, the pass/fail verdict, and the retention limit on proof runs.
++import test from 'node:test';
++import assert from 'node:assert/strict';
++import { join } from 'node:path';
++import {
++  DISPATCH_DISABLED_LOG,
++  KEEP_RUNS,
++  evaluateProof,
++  proofLayout,
++  runStamp,
++  selectRunsToDelete,
++} from './runtime-proof-lib.mjs';
++
++const goodFacts = () => ({
++  phase1: { descriptorSeen: true, seeded: 2 },
++  phase2: {
++    descriptorSeen: true,
++    entries: [
++      { id: 'tq-1', status: 'ready' },
++      { id: 'tq-2', status: 'ready' },
++    ],
++    workers: [],
++  },
++  logText: `line\nprojecta ${DISPATCH_DISABLED_LOG} (PROJECTA_QUEUE=off)\nline`,
++  screenshot: { ok: true, path: 'shot.png' },
++  requireScreenshot: true,
++});
++
++test('layout keeps every artifact of a run inside its run directory', () => {
++  const stamp = '2026-09-25T10-00-00.000Z';
++  const layout = proofLayout('/proofs', stamp);
++  const runDir = join('/proofs', stamp);
++  assert.equal(layout.runDir, runDir);
++  for (const value of Object.values(layout)) {
++    assert.ok(value.startsWith(runDir), `${value} escapes the run directory`);
++  }
++  assert.equal(new Set(Object.values(layout)).size, Object.values(layout).length);
++});
++
++test('run stamp sorts lexicographically like time and is filename-safe', () => {
++  const a = runStamp(new Date('2026-09-25T10:00:00.000Z'));
++  const b = runStamp(new Date('2026-09-25T10:00:01.000Z'));
++  assert.ok(a < b);
++  assert.match(a, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/);
++});
++
++test('verdict passes only when the app started twice and nothing dispatched and the log proves the switch', () => {
++  const verdict = evaluateProof(goodFacts());
++  assert.equal(verdict.ok, true);
++  assert.deepEqual(verdict.failures, []);
++});
++
++test('verdict fails when a queued entry left ready or a worker exists', () => {
++  const dispatched = goodFacts();
++  dispatched.phase2.entries[0].status = 'dispatched';
++  assert.equal(evaluateProof(dispatched).ok, false);
++  const spawned = goodFacts();
++  spawned.phase2.workers = [{ id: 'wk-1' }];
++  assert.equal(evaluateProof(spawned).ok, false);
++  const unseeded = goodFacts();
++  unseeded.phase1.seeded = 0;
++  assert.equal(evaluateProof(unseeded).ok, false);
++});
++
++test('verdict fails without the disabled log line or a start or a required screenshot', () => {
++  const noLog = goodFacts();
++  noLog.logText = 'nothing relevant';
++  assert.equal(evaluateProof(noLog).ok, false);
++  const noRestart = goodFacts();
++  noRestart.phase2.descriptorSeen = false;
++  assert.equal(evaluateProof(noRestart).ok, false);
++  const noShot = goodFacts();
++  noShot.screenshot = { ok: false, reason: 'window not foreground' };
++  assert.equal(evaluateProof(noShot).ok, false);
++  const optionalShot = goodFacts();
++  optionalShot.screenshot = { ok: false, reason: 'window not foreground' };
++  optionalShot.requireScreenshot = false;
++  assert.equal(evaluateProof(optionalShot).ok, true);
++});
++
++test('retention keeps the newest runs and deletes the rest', () => {
++  const names = ['2026-09-20T00-00-00.000Z', '2026-09-25T09-00-00.000Z', '2026-09-25T10-00-00.000Z'];
++  assert.deepEqual(selectRunsToDelete(names, 2), ['2026-09-20T00-00-00.000Z']);
++  assert.deepEqual(selectRunsToDelete(names, KEEP_RUNS), []);
++  assert.deepEqual(selectRunsToDelete([], KEEP_RUNS), []);
++  assert.throws(() => selectRunsToDelete(names, 0), /keep/);
++});
++
++test('driver parses its flags and rejects unknown ones and bad values', async () => {
++  const { parseArgs } = await import('../runtime-proof.mjs');
++  const options = parseArgs(['--exe', 'app.exe', '--settle', '5', '--no-screenshot', '--parallel-ok']);
++  assert.equal(options.exe, 'app.exe');
++  assert.equal(options.settle, 5);
++  assert.equal(options.screenshot, false);
++  assert.equal(options.parallelOk, true);
++  assert.equal(parseArgs([]).screenshot, true);
++  assert.equal(parseArgs([]).parallelOk, false);
++  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
++  assert.throws(() => parseArgs(['--settle', '0']), /settle/);
++  assert.throws(() => parseArgs(['--keep', '0']), /keep/);
++});
+diff --git a/scripts/runtime-proof.mjs b/scripts/runtime-proof.mjs
+new file mode 100644
+index 0000000..f1f0832
+--- /dev/null
++++ b/scripts/runtime-proof.mjs
+@@ -0,0 +1,264 @@
++#!/usr/bin/env node
++// W5-28: the automatic runtime proof. Starts the real app twice in a
++// sandbox — its own PROJECTA_APP_DATA, the queue switched off with
++// PROJECTA_QUEUE=off — and proves the M1 acceptance: the app starts, and
++// old queued tasks dispatch no agents. No provider CLI is ever called:
++// the dispatcher never starts, and the seeded tasks stay `ready`.
++//
++//   node scripts/runtime-proof.mjs [--exe path] [--root dir]
++//         [--settle seconds] [--keep n] [--no-screenshot] [--help]
++//
++// Phase 1 seeds two queue entries through the control api; phase 2 restarts
++// the app on the same data directory — the "old jobs" case — and, after
++// more than two dispatcher periods (POLL_INTERVAL is 30 s), asserts through
++// the api that every entry is still `ready` and no worker exists. The proof
++// (proof.json, the app log, a window screenshot) lands in one run directory
++// under the proof root; only the newest KEEP_RUNS runs survive.
++//
++// Local/test only. The single-instance mutex is shared with production, so
++// the proof refuses to run while any projecta.exe is alive — unless
++// `--parallel-ok` is passed, which is only valid for a binary built with a
++// distinct bundle identifier, e.g.
++//   TAURI_CONFIG='{"identifier":"com.projecta.proof"}' cargo build
++// Such a proof binary owns no shared state with production (own mutex, own
++// PROJECTA_APP_DATA, ephemeral ports), so the refusal would protect nothing.
++import { spawn, execFileSync } from 'node:child_process';
++import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
++import { tmpdir } from 'node:os';
++import { join, resolve } from 'node:path';
++import { fileURLToPath } from 'node:url';
++import {
++  KEEP_RUNS,
++  evaluateProof,
++  proofLayout,
++  runStamp,
++  selectRunsToDelete,
++} from './lib/runtime-proof-lib.mjs';
++
++const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
++const DESCRIPTOR_TIMEOUT_MS = 60_000;
++const DEFAULT_SETTLE_S = 70;
++
++export function parseArgs(argv = []) {
++  const options = { exe: null, root: null, settle: DEFAULT_SETTLE_S, keep: KEEP_RUNS, screenshot: true, parallelOk: false, help: false };
++  for (let i = 0; i < argv.length; i += 1) {
++    const arg = argv[i];
++    if (arg === '--help' || arg === '-h') options.help = true;
++    else if (arg === '--no-screenshot') options.screenshot = false;
++    else if (arg === '--parallel-ok') options.parallelOk = true;
++    else if (arg === '--exe') options.exe = argv[++i];
++    else if (arg === '--root') options.root = argv[++i];
++    else if (arg === '--settle') options.settle = Number(argv[++i]);
++    else if (arg === '--keep') options.keep = Number(argv[++i]);
++    else throw new Error(`unknown option: ${arg}`);
++  }
++  if (options.exe === undefined || options.root === undefined) throw new Error('missing value after a flag');
++  if (!Number.isFinite(options.settle) || options.settle < 1) throw new Error('--settle must be seconds >= 1');
++  if (!Number.isSafeInteger(options.keep) || options.keep < 1) throw new Error('--keep must be a positive integer');
++  return options;
++}
++
++export function usage() {
++  return 'usage: node scripts/runtime-proof.mjs [--exe path] [--root dir] [--settle seconds] [--keep n] [--no-screenshot] [--parallel-ok]';
++}
++
++const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
++
++function projectaPids() {
++  if (process.platform === 'win32') {
++    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq projecta.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
++    return [...out.matchAll(/"projecta\.exe","(\d+)"/gi)].map((match) => Number(match[1]));
++  }
++  try {
++    const out = execFileSync('pgrep', ['-x', 'projecta'], { encoding: 'utf8' });
++    return out.split('\n').filter(Boolean).map(Number);
++  } catch {
++    return [];
++  }
++}
++
++function killProjectA(pid) {
++  if (process.platform === 'win32') {
++    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
++  } else {
++    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
++  }
++}
++
++async function waitGone(pid, timeoutMs = 15_000) {
++  const deadline = Date.now() + timeoutMs;
++  while (Date.now() < deadline) {
++    if (!projectaPids().includes(pid)) return;
++    await sleep(200);
++  }
++  throw new Error(`projecta.exe pid ${pid} did not exit within ${timeoutMs} ms`);
++}
++
++function resolveExe(requested) {
++  const candidates = [
++    requested,
++    process.env.PROJECTA_EXE,
++    join(REPO, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'projecta.exe' : 'projecta'),
++    join(REPO, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'projecta.exe' : 'projecta'),
++  ].filter(Boolean);
++  const found = candidates.find((candidate) => existsSync(candidate));
++  if (!found) throw new Error(`no projecta binary found; build first (cargo build in src-tauri) or pass --exe`);
++  return found;
++}
++
++function startApp(exe, layout, phase) {
++  const out = openSync(join(layout.runDir, `app-${phase}.stdout.log`), 'w');
++  const err = openSync(join(layout.runDir, `app-${phase}.stderr.log`), 'w');
++  const child = spawn(exe, [], {
++    env: { ...process.env, PROJECTA_APP_DATA: layout.appData, PROJECTA_QUEUE: 'off' },
++    stdio: ['ignore', out, err],
++  });
++  closeSync(out);
++  closeSync(err);
++  return child;
++}
++
++async function waitDescriptor(layout, timeoutMs = DESCRIPTOR_TIMEOUT_MS) {
++  const started = Date.now();
++  const deadline = started + timeoutMs;
++  while (Date.now() < deadline) {
++    if (existsSync(layout.descriptor)) {
++      return { descriptorMs: Date.now() - started, descriptor: JSON.parse(readFileSync(layout.descriptor, 'utf8')) };
++    }
++    await sleep(250);
++  }
++  return { descriptorMs: null, descriptor: null };
++}
++
++async function api(descriptor, method, path, body) {
++  const response = await fetch(`http://127.0.0.1:${descriptor.port}${path}`, {
++    method,
++    headers: { 'x-projecta-token': descriptor.token, 'content-type': 'application/json' },
++    body: body === undefined ? undefined : JSON.stringify(body),
++  });
++  const text = await response.text();
++  let parsed = null;
++  try { parsed = JSON.parse(text); } catch { /* the error body is plain text */ }
++  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${parsed?.error ?? text}`);
++  return parsed;
++}
++
++function takeScreenshot(layout, pid) {
++  const helper = join(REPO, 'scripts', 'window-shot.ps1');
++  if (process.platform !== 'win32' || !existsSync(helper)) return { ok: false, reason: 'screenshot helper is Windows-only' };
++  try {
++    // -TargetPid first: with a proof binary next to production the title alone is
++    // ambiguous, and a photo of the production window is worse than none.
++    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Title', 'ProjectA', '-ProcessName', 'projecta', '-TargetPid', String(pid), '-Out', layout.screenshot], { stdio: 'pipe' });
++    return { ok: existsSync(layout.screenshot), path: layout.screenshot };
++  } catch (error) {
++    return { ok: false, reason: String(error.stderr ?? error.message).trim().slice(0, 300) };
++  }
++}
++
++async function main() {
++  const options = parseArgs(process.argv.slice(2));
++  if (options.help) {
++    console.log(usage());
++    return;
++  }
++  const running = projectaPids();
++  if (running.length > 0 && !options.parallelOk) {
++    throw new Error(`projecta already running (pids ${running.join(',')}); the single-instance mutex is shared — close it first (or use --parallel-ok with a proof binary built under a distinct bundle identifier)`);
++  }
++
++  const exe = resolveExe(options.exe);
++  const root = options.root ?? process.env.PROJECTA_PROOF_DIR ?? join(tmpdir(), 'projecta-runtime-proof');
++  const layout = proofLayout(root, runStamp());
++  mkdirSync(layout.appData, { recursive: true });
++  mkdirSync(layout.scratchRepo, { recursive: true });
++  execFileSync('git', ['init', layout.scratchRepo], { stdio: 'ignore' });
++
++  const proof = {
++    schemaVersion: 1,
++    package: 'W5-28',
++    startedAt: new Date().toISOString(),
++    exe,
++    platform: process.platform,
++    queue: 'off (PROJECTA_QUEUE=off)',
++    appData: layout.appData,
++    settleSeconds: options.settle,
++    phase1: {},
++    phase2: {},
++  };
++
++  let child = null;
++  try {
++    // Phase 1: the app starts; two old queue entries are seeded.
++    child = startApp(exe, layout, 1);
++    const first = await waitDescriptor(layout);
++    if (!first.descriptor) throw new Error(`phase 1: no api descriptor within ${DESCRIPTOR_TIMEOUT_MS / 1000} s`);
++    proof.phase1 = { descriptorMs: first.descriptorMs, port: first.descriptor.port };
++    const project = await api(first.descriptor, 'POST', '/api/projects', { name: 'runtime-proof', repoPath: layout.scratchRepo });
++    const projectId = project.id ?? project.project?.id;
++    if (!projectId) throw new Error(`phase 1: POST /api/projects returned no id: ${JSON.stringify(project).slice(0, 200)}`);
++    await api(first.descriptor, 'POST', '/api/queue', { projectId, rawText: 'proof task A — never dispatched', sharpen: false });
++    await api(first.descriptor, 'POST', '/api/queue', { projectId, rawText: 'proof task B — never dispatched', sharpen: false });
++    const seeded = await api(first.descriptor, 'GET', `/api/queue?projectId=${encodeURIComponent(projectId)}`);
++    proof.phase1.seeded = Array.isArray(seeded) ? seeded.length : 0;
++    proof.phase1.projectId = projectId;
++    killProjectA(child.pid);
++    await waitGone(child.pid);
++    child = null;
++    // The restart mints a fresh token and port: the stale descriptor must
++    // not satisfy phase 2's wait, or the proof would read a dead api.
++    rmSync(layout.descriptor, { force: true });
++
++    // Phase 2: the restart faces the old entries; past two sweep intervals
++    // nothing may have dispatched.
++    child = startApp(exe, layout, 2);
++    const second = await waitDescriptor(layout);
++    if (!second.descriptor) throw new Error(`phase 2: no api descriptor within ${DESCRIPTOR_TIMEOUT_MS / 1000} s on restart`);
++    proof.phase2.descriptorMs = second.descriptorMs;
++    await sleep(options.settle * 1000);
++    const entries = await api(second.descriptor, 'GET', `/api/queue?projectId=${encodeURIComponent(projectId)}`);
++    const workers = await api(second.descriptor, 'GET', `/api/workers?projectId=${encodeURIComponent(projectId)}`);
++    proof.phase2.entries = (Array.isArray(entries) ? entries : []).map((entry) => ({ id: entry.id, status: entry.status }));
++    proof.phase2.workers = Array.isArray(workers) ? workers : [];
++    proof.screenshot = options.screenshot ? takeScreenshot(layout, child.pid) : { ok: false, reason: '--no-screenshot' };
++    killProjectA(child.pid);
++    await waitGone(child.pid);
++    child = null;
++  } finally {
++    if (child) {
++      try { killProjectA(child.pid); } catch { /* already gone */ }
++    }
++  }
++
++  const logSource = join(layout.appData, 'logs', 'projecta.log');
++  const logText = existsSync(logSource) ? readFileSync(logSource, 'utf8') : '';
++  if (existsSync(logSource)) copyFileSync(logSource, layout.appLog);
++
++  const verdict = evaluateProof({
++    phase1: { descriptorSeen: Number.isFinite(proof.phase1.descriptorMs), seeded: proof.phase1.seeded },
++    phase2: { descriptorSeen: Number.isFinite(proof.phase2.descriptorMs), entries: proof.phase2.entries, workers: proof.phase2.workers },
++    logText,
++    screenshot: proof.screenshot,
++    requireScreenshot: options.screenshot,
++  });
++  proof.verdict = verdict;
++  proof.finishedAt = new Date().toISOString();
++  writeFileSync(layout.proofJson, `${JSON.stringify(proof, null, 2)}\n`);
++
++  const siblings = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
++  for (const old of selectRunsToDelete(siblings, options.keep)) {
++    rmSync(join(root, old), { recursive: true, force: true });
++  }
++
++  console.log(`proof: ${verdict.ok ? 'PASS' : 'FAIL'} — ${layout.proofJson}`);
++  for (const failure of verdict.failures) console.log(`  - ${failure}`);
++  console.log(`runs kept under ${root}: ${Math.min(siblings.length, options.keep)} of ${siblings.length}`);
++  if (!verdict.ok) process.exitCode = 1;
++}
++
++if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
++  main().catch((error) => {
++    console.error(`runtime-proof: ${error.message}`);
++    process.exitCode = 1;
++  });
++}
+diff --git a/scripts/window-shot.ps1 b/scripts/window-shot.ps1
+index b8193b5..ee5a2e6 100644
+--- a/scripts/window-shot.ps1
++++ b/scripts/window-shot.ps1
+@@ -16,6 +16,7 @@
+ param(
+     [Parameter(Mandatory = $true)][string]$Title,
+     [string]$ProcessName,
++    [int]$TargetPid = 0,
+     [string]$Out = "window-shot.png"
+ )
+ $ErrorActionPreference = 'Stop'
+@@ -29,6 +30,8 @@ public class WinShot {
+     [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
+     [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
+     [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
++    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
++    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
+     public struct RECT { public int Left, Top, Right, Bottom; }
+ }
+ "@
+@@ -36,9 +39,14 @@ public class WinShot {
+ # Exakter Titel schlaegt Teiltreffer. Ohne das gewinnt ein Browser-Tab, der
+ # den gesuchten Namen zufaellig im Titel fuehrt - genau so ist dieses Skript
+ # beim Installer-Test in einem Chrome-Fenster statt in der App gelandet.
++# -TargetPid schlaegt Titel und Prozessname: zwei gleich betitelte Fenster (etwa
++# Produktiv-App und Proof-Instanz nebeneinander) waeren sonst eine
++# Glueckssache, und das Foto kaeme vom falschen Fenster.
+ $candidates = @(Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*$Title*" })
+ if ($ProcessName) { $candidates = @($candidates | Where-Object { $_.ProcessName -eq $ProcessName }) }
+-$proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1
++$proc = $null
++if ($TargetPid -gt 0) { $proc = @($candidates | Where-Object { $_.Id -eq $TargetPid }) | Select-Object -First 1 }
++if (-not $proc) { $proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
+ if (-not $proc) { $proc = $candidates | Select-Object -First 1 }
+ if (-not $proc) {
+     Write-Error "Kein Fenster mit Titel *$Title* gefunden. Offene Fenster: $((Get-Process | Where-Object MainWindowTitle | ForEach-Object MainWindowTitle) -join ' | ')"
+@@ -47,21 +55,42 @@ $hwnd = $proc.MainWindowHandle
+ 
+ # 9 = SW_RESTORE: holt auch ein minimiertes Fenster zurück.
+ [WinShot]::ShowWindow($hwnd, 9) | Out-Null
++# Ein harmloser Alt-Tastenschlag gibt diesem Prozess das Recht, ein fremdes
++# Fenster nach vorn zu holen; ohne ihn verweigert Windows das aus einer
++# Konsole im Hintergrund heraus (Foreground-Lock).
++[WinShot]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
++[WinShot]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
+ [WinShot]::SetForegroundWindow($hwnd) | Out-Null
+ Start-Sleep -Milliseconds 400
+ 
+-if ([WinShot]::GetForegroundWindow() -ne $hwnd) {
+-    Write-Error "Fenster '$($proc.MainWindowTitle)' liess sich nicht in den Vordergrund holen - Abbruch statt Foto vom falschen Fenster."
+-}
+-
+ $rect = New-Object WinShot+RECT
+ [WinShot]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
+ $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
+ if ($w -le 0 -or $h -le 0) { Write-Error "Fensterrechteck ist leer ($w x $h)." }
+ 
+-$bmp = New-Object System.Drawing.Bitmap($w, $h)
+-$gfx = [System.Drawing.Graphics]::FromImage($bmp)
+-$gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
+-$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
+-$gfx.Dispose(); $bmp.Dispose()
+-Write-Output "OK: '$($proc.MainWindowTitle)' ($w x $h) -> $Out"
++if ([WinShot]::GetForegroundWindow() -eq $hwnd) {
++    $method = 'CopyFromScreen'
++    $bmp = New-Object System.Drawing.Bitmap($w, $h)
++    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
++    $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
++    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
++    $gfx.Dispose(); $bmp.Dispose()
++} else {
++    # Der Vordergrund bleibt verwehrt: statt abzubrechen oder das falsche
++    # Fenster zu fotografieren, rendert PrintWindow das Zielfenster direkt
++    # (2 = PW_RENDERFULLCONTENT, sonst bleiben WebView2-Flaechen schwarz).
++    $method = 'PrintWindow'
++    $bmp = New-Object System.Drawing.Bitmap($w, $h)
++    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
++    $hdc = $gfx.GetHdc()
++    try {
++        if (-not [WinShot]::PrintWindow($hwnd, $hdc, 2)) {
++            Write-Error "PrintWindow auf '$($proc.MainWindowTitle)' fehlgeschlagen - kein Beleg statt falscher Beleg."
++        }
++    } finally {
++        $gfx.ReleaseHdc($hdc)
++    }
++    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
++    $gfx.Dispose(); $bmp.Dispose()
++}
++Write-Output "OK: '$($proc.MainWindowTitle)' ($w x $h, $method) -> $Out"
+diff --git a/src-tauri/src/queue.rs b/src-tauri/src/queue.rs
+index 6a81a70..6b53533 100644
+--- a/src-tauri/src/queue.rs
++++ b/src-tauri/src/queue.rs
+@@ -34,6 +34,23 @@ pub const DEFAULT_MAX_CONCURRENT: usize = 4;
+ /// The queue is deliberately a slow poller: it is a safety net, not a hot path.
+ pub const POLL_INTERVAL: Duration = Duration::from_secs(30);
+ 
++/// Environment switch that keeps the dispatcher from ever starting
++/// (W5-28). A sandboxed proof run sets `PROJECTA_QUEUE=off` so that no
++/// queued task - above all one left over from an earlier session - can
++/// reach an agent, while the rest of the app starts normally.
++pub const ENV_QUEUE: &str = "PROJECTA_QUEUE";
++
++/// Evaluate [`ENV_QUEUE`]: `off`, `0` and `false` (any case, trimmed)
++/// disable the dispatcher; everything else, including unset, keeps the
++/// historical default of a running dispatcher. A free function so the
++/// switch is testable without a Tauri app.
++pub fn queue_dispatch_disabled(value: Option<&str>) -> bool {
++    matches!(
++        value.map(str::trim).map(str::to_ascii_lowercase).as_deref(),
++        Some("off" | "0" | "false")
++    )
++}
++
+ /// How many hops of [`AgentProfile::fallback`] the dispatcher will take before
+ /// it gives up and leaves the task queued.
+ ///
+@@ -480,6 +497,17 @@ pub fn start(
+     engine: Arc<StatusEngine>,
+     hook_port: u16,
+ ) {
++    // W5-28: a proof run starts the app with the queue off. No sweep ever
++    // runs, so no queued task - however old - reaches a launcher. The
++    // startup reattach pass in `main.rs` still resolves interrupted claims;
++    // it only ever hands them back to `ready`, never to a worker.
++    if queue_dispatch_disabled(std::env::var(ENV_QUEUE).ok().as_deref()) {
++        crate::logf!(
++            "app",
++            "queue dispatcher disabled ({ENV_QUEUE}=off); queued tasks stay ready"
++        );
++        return;
++    }
+     let launcher = LiveLauncher {
+         app,
+         store: store.clone(),
+@@ -647,6 +675,27 @@ mod tests {
+         (dir, store, project.id)
+     }
+ 
++    #[test]
++    fn queue_dispatch_disabled_recognizes_the_off_switches() {
++        for value in ["off", "OFF", " off ", "0", "false", "False"] {
++            assert!(
++                queue_dispatch_disabled(Some(value)),
++                "{value:?} must switch the dispatcher off"
++            );
++        }
++    }
++
++    #[test]
++    fn queue_dispatch_disabled_keeps_the_historical_default() {
++        assert!(!queue_dispatch_disabled(None));
++        for value in ["", "on", "1", "true", "yes", "later"] {
++            assert!(
++                !queue_dispatch_disabled(Some(value)),
++                "{value:?} must keep the dispatcher running"
++            );
++        }
++    }
++
+     #[tokio::test]
+     async fn enqueue_supports_plain_and_mocked_sharpened_tasks() {
+         let (_dir, store, project) = fixture().await;
+diff --git a/src-tauri/src/skills.rs b/src-tauri/src/skills.rs
+index 59024d0..72cf56e 100644
+--- a/src-tauri/src/skills.rs
++++ b/src-tauri/src/skills.rs
+@@ -418,7 +418,10 @@ mod tests {
+             "ui-ux-pro-max missing from {ids:?}"
+         );
+         let pack = dev.join("ui-ux-pro-max");
+-        assert!(pack.join("SKILL.md").is_file(), "SKILL.md missing from ui-ux-pro-max");
++        assert!(
++            pack.join("SKILL.md").is_file(),
++            "SKILL.md missing from ui-ux-pro-max"
++        );
+         let skill = std::fs::read_to_string(pack.join("SKILL.md")).expect("read SKILL.md");
+         let (name, description) = parse_front_matter(&skill);
+         assert_eq!(name.as_deref(), Some("ui-ux-pro-max"));
+
+```
diff --git a/.pa/review_w5-28-r2_glm-5.2.md b/.pa/review_w5-28-r2_glm-5.2.md
new file mode 100644
index 0000000..ca666a8
--- /dev/null
+++ b/.pa/review_w5-28-r2_glm-5.2.md
@@ -0,0 +1,30 @@
+# Review: w5-28-r2 — glm-5.2
+
+- Autor des Artefakts: kimi-k3 (W5-28 worker)
+- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
+- Datum: 2026-09-25 14:16 UTC, Dauer 39 s, Status: ok
+- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
+- Prompt: `review_prompt_w5-28-r2.md` (7263 Zeichen)
+
+## Roh-Urteil des Reviewers
+
+Here is the review of the delta. 
+
+### F1 (high): false-PASS on non-array or short api answer
+**Fixed.** `runtime-proof.mjs` now propagates `null` for non-arrays instead of coercing to `[]`, and `evaluateProof` in `runtime-proof-lib.mjs` explicitly checks `Array.isArray` and verifies the length against `phase1?.seeded`. 
+
+### F2 (medium): retention considered every directory under the proof root
+**Fixed.** `selectRunsToDelete` now filters `runNames` against `RUN_NAME_PATTERN`, meaning directories like `keepme` will be ignored and not returned for deletion. The regex matches the `runStamp` format correctly.
+
+### F3 (medium): window-shot -TargetPid fell back to title matching
+**Not fixed.** The author added a check using `Write-Error` in `scripts/window-shot.ps1` (line 50-52). However, in PowerShell, `Write-Error` is a non-terminating error by default. It writes to the error stream but does **not** halt script execution. Execution simply continues to the next line (line 55), where `$proc` (which is still `$null`) falls back to title matching exactly as before:
+```powershell
+if (-not $proc) { $proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
+```
+To actually fix this, the author must use a terminating error, such as `throw "..."` or `exit 1` (or `Write-Error -ErrorAction Stop`), inside the `if (-not $proc)` block.
+
+### F4 (low): global Alt keystroke
+Not applicable, intentionally kept.
+
+### New bugs / side effects
+- **Low:** In `runtime-proof.mjs`, the mapping `entries.map((entry) => ({ id: entry.id, status: entry.status }))` will throw a `TypeError` if the API returns an array containing `null` (e.g., `[null]`). Since the goal is to treat garbage as a failure rather than a crash, it might be safer to default to `null` for the whole array if elements are malformed, or use optional chaining inside the map. This is an edge case, but it would turn a clean proof failure into a script crash.
diff --git a/.pa/review_w5-28_disposition.md b/.pa/review_w5-28_disposition.md
new file mode 100644
index 0000000..2fca25e
--- /dev/null
+++ b/.pa/review_w5-28_disposition.md
@@ -0,0 +1,33 @@
+# Review-Disposition W5-28
+
+Kandidat: Branch `claude/w5-28`, zuletzt `c1632e3`. Autor: kimi-k3 (Worker).
+Gefordert: zwei Reviews anderer Anbieter (>300 Zeilen). Autorenfamilie Kimi
+durfte nicht selbst prüfen; das Advisor-Paar war nicht erreichbar
+(GPT-6 Astra: Codex-Kontingent bis 30.09. ausgeschöpft, Fehlermeldung im
+Lauf protokolliert; Fable-5.1-Subagent: HTTP 402 des Kontos). Ersatzweise
+zweiter Anbieter: qwen2.5-coder:7b lokal (Alibaba). deepseek-v4-flash:cloud
+war bei Ollama Cloud gelöscht (HTTP 410), qwen3.8:latest antwortete auch mit
+kleiner Probe nicht (HTTP 500 bzw. keine Antwort in 120 s).
+
+## Reviews
+
+- `review_w5-28_glm-5.2.md` (R1, Kandidat `870ba09`): 4 Befunde.
+- `review_w5-28_qwen2.5-coder.md` (Kandidat `870ba09`): kein neuer Befund;
+  weitgehend Nacherzählung des Diffs, ein sprachlich wirrer Hinweis auf den
+  PrintWindow-Fallback (durch F3-Fix b1e952b/c1632e3 abgedeckt).
+- `review_w5-28-r2_glm-5.2.md` (Delta `870ba09..b1e952b`): bestätigt F1/F2,
+  beanstandet F3 weiter, ein neues Low.
+
+## Dispositionen
+
+| ID | Quelle | Schwere | Befund | Disposition |
+|---|---|---|---|---|
+| F1 | glm-5.2 R1 | hoch | Verdikt-Passing bei Nicht-Array/leerer Entry-Liste | angenommen, b1e952b: Verdikt verlangt Array und >= seeded Einträge, roter Test zuerst (a42deed) |
+| F2 | glm-5.2 R1 | mittel | Retention hätte fremde Verzeichnisse unter dem Proof-Root gelöscht | angenommen, b1e952b: nur runStamp-förmige Namen sind löschbar, roter Test zuerst (a42deed) |
+| F3 | glm-5.2 R1 | mittel | -TargetPid fiel auf Titel-Match zurück (Foto der Produktiv-Instanz möglich) | angenommen, b1e952b; R2-Einspruch (Write-Error nicht terminierend) war durch `$ErrorActionPreference='Stop'` bereits gedeckt, dennoch auf `throw` geschärft (c1632e3) |
+| F4 | glm-5.2 R1 | niedrig | globaler Alt-Tastenschlag in window-shot.ps1 | abgelehnt: ohne ihn verweigert Windows SetForegroundWindow aus der Hintergrund-Konsole; Alt allein öffnet kein Menü. Kommentar im Skript |
+| R2-1 | glm-5.2 R2 | niedrig | `[null]`-Elemente in der Queue-Antwort ließen den Treiber abstürzen | angenommen, c1632e3: Elemente mappen auf Status `malformed`, das Verdikt schlägt sauber fehl |
+
+Nach den Fix-Commits liegt kein offener Befund vor. Der Endkandidat wurde
+per Release-Build (`com.projecta.proof`, custom-protocol) erneut live
+belegt: Lauf 2026-09-25T14-20-58Z, Exit 0.
diff --git a/.pa/review_w5-28_glm-5.2.md b/.pa/review_w5-28_glm-5.2.md
new file mode 100644
index 0000000..5b5db9e
--- /dev/null
+++ b/.pa/review_w5-28_glm-5.2.md
@@ -0,0 +1,92 @@
+# Review: w5-28 — glm-5.2
+
+- Autor des Artefakts: kimi-k3 (W5-28 worker)
+- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
+- Datum: 2026-09-25 13:52 UTC, Dauer 80 s, Status: ok
+- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
+- Prompt: `review_prompt_w5-28.md` (35510 Zeichen)
+
+## Roh-Urteil des Reviewers
+
+## Findings
+
+### 1. Verdict false-PASS when the API returns a non-array or empty entries — HIGH
+
+`scripts/runtime-proof.mjs:185-186`:
+
+```js
+proof.phase2.entries = (Array.isArray(entries) ? entries : []).map((entry) => ({ id: entry.id, status: entry.status }));
+proof.phase2.workers = Array.isArray(workers) ? workers : [];
+```
+
+`scripts/lib/runtime-proof-lib.mjs:48-51`:
+
+```js
+for (const entry of phase2?.entries ?? []) {
+    if (entry.status !== 'ready') failures.push(`queue entry ${entry.id} left ready: ${entry.status}`);
+}
+```
+
+The verdict iterates over `phase2.entries` and only checks that *each present* entry is `ready`. It never asserts that the two entries seeded in phase 1 are still *present* in phase 2. If the API returns `200` with a non-array body (e.g. `null`, `{}`, or an empty array due to a project-ID mismatch, a DB issue, or a serialization bug), `proof.phase2.entries` becomes `[]`, the for-loop body never runs, and the verdict passes with zero entries and zero workers — exactly the condition the proof is meant to exclude.
+
+The same applies to `workers`: a non-array response is silently coerced to `[]`.
+
+**Fix:** the verdict should assert `phase2.entries.length >= phase1.seeded` (or exactly equal), and should flag a non-array API response as a failure rather than coercing it away. The test suite (`runtime-proof-lib.test.mjs`) likewise only mutates an existing entry's status; it never tests the empty-entries case, so the gap is invisible to the tests.
+
+---
+
+### 2. Retention deletes arbitrary directories under the proof root — MEDIUM
+
+`scripts/runtime-proof.mjs:215-218`:
+
+```js
+const siblings = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
+for (const old of selectRunsToDelete(siblings, options.keep)) {
+  rmSync(join(root, old), { recursive: true, force: true });
+}
+```
+
+`selectRunsToDelete` sorts *all* directory names lexicographically and returns everything past index `keep`. If the proof root is shared or accidentally pointed at a directory containing non-run subdirectories (e.g. `--root /home/user`), those subdirectories sort before timestamped run dirs and are deleted first once the total exceeds `keep`.
+
+There is no validation that a name matches the `runStamp` pattern (`/^\d{4}-\d{2}-\d{2}T...Z$/`) before it is eligible for deletion.
+
+**Fix:** filter `siblings` to names matching the run-stamp pattern before passing to `selectRunsToDelete`.
+
+---
+
+### 3. `window-shot.ps1 -TargetPid` fallback can photograph the production window — MEDIUM
+
+`scripts/window-shot.ps1:48-50`:
+
+```powershell
+if ($TargetPid -gt 0) { $proc = @($candidates | Where-Object { $_.Id -eq $TargetPid }) | Select-Object -First 1 }
+if (-not $proc) { $proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
+```
+
+If the proof app's WebView2 window hasn't been created yet by the time the screenshot is taken (the driver calls `takeScreenshot` immediately after the 70 s settle, but window creation latency is not guaranteed), the `$TargetPid` filter finds no match and the script falls back to exact-title match, which can select the production window running alongside. The resulting PNG is a valid file, so `existsSync(layout.screenshot)` is `true` and the verdict records `screenshot.ok = true` — a misleading artifact presented as evidence.
+
+**Fix:** when `-TargetPid` is provided and no matching candidate is found, error out instead of falling back to title-based selection.
+
+---
+
+### 4. Global Alt keystroke in `window-shot.ps1` — LOW
+
+`scripts/window-shot.ps1:60-61` injects a global Alt press/release via `keybd_event` to bypass the foreground lock. This is sent to the foreground thread's keyboard queue and could interfere with user input on a machine where someone is typing during a proof run. Low impact in a CI context, but worth noting for interactive use.
+
+---
+
+### 5. `PROJECTA_QUEUE=off` coverage — no finding (answers the question)
+
+The switch is checked at the top of `queue::start` (`src-tauri/src/queue.rs:500-508`) before the dispatcher thread is spawned. The startup reattach pass in `main.rs` runs independently but only resets interrupted claims to `ready` — it never spawns workers. No other thread path in the diff re-opens a dispatch route. The log line requirement in the verdict independently confirms the switch was honoured. This is sound.
+
+---
+
+### 6. `--parallel-ok` default — no finding (answers the question)
+
+The default (refuse when any `projecta.exe` is alive) is safe. With `--parallel-ok` and a production binary (same identifier), the single-instance mutex would prevent the second instance from starting, causing a descriptor timeout and a failed proof — not a data-safety issue. With a proof binary (distinct identifier), the mutex name differs, `PROJECTA_APP_DATA` is sandboxed, and ports are ephemeral. No shared state with production.
+
+---
+
+### 7. rustfmt re-wrap of `skills.rs` — no finding (answers the question)
+
+The change is a pure formatting re-wrap that fixes `cargo fmt --check` with stable rustfmt 1.9. No semantic change, unblocks the precommit lane. Acceptable to ride along.
diff --git a/.pa/review_w5-28_qwen2.5-coder.md b/.pa/review_w5-28_qwen2.5-coder.md
new file mode 100644
index 0000000..334b065
--- /dev/null
+++ b/.pa/review_w5-28_qwen2.5-coder.md
@@ -0,0 +1,62 @@
+# Review: w5-28 — qwen2.5-coder
+
+- Autor des Artefakts: kimi-k3 (W5-28 worker)
+- Reviewer: qwen2.5-coder (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `qwen2.5-coder:7b`, bedient `qwen2.5-coder:7b`
+- Datum: 2026-09-25 14:28 UTC, Dauer 60 s, Status: ok
+- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
+- Prompt: `review_prompt_w5-28.md` (35510 Zeichen)
+
+## Roh-Urteil des Reviewers
+
+### Review of W5-28: automatic runtime proof (sandbox, queue off)
+
+**ProjectA** is a Tauri 2 application with a persistent task queue in SQLite. The dispatcher thread (`queue::start`) turns ready queue entries into agent workers. At startup, a reattach pass resolves interrupted claims but never spawns agents. The single-instance guard is a mutex named "<bundle identifier>-sim" (tauri-plugin-single-instance). The control API serves 127.0.0.1 with a token from <appdata>/projecta-api.json; POST /api/projects needs no verdict token when PROJECTA_APP_DATA is set.
+
+### Package Requirement (Plan Wording, Translated)
+
+W5-28 "automatic runtime proof": a reproducible local run in a sandbox (own data directory, queue off) that proves the app starts and no old queued jobs dispatch agents (automating the "M1" acceptance). Red criterion: the proof is produced without a real worker starting; a retention limit on proof artifacts applies. Local/test only; never call real provider CLIs.
+
+### What the Candidate Does
+
+1. **src-tauri/src/queue.rs**: PROJECTA_QUEUE=off (or 0/false) makes `queue::start` log a line and return before spawning the dispatcher thread. Unit tests pin the evaluation.
+2. **scripts/runtime-proof.mjs (npm run proof:runtime)**: Refuses while any projecta.exe runs (shared mutex) unless --parallel-ok (meant for binaries built with TAURI_CONFIG identifier override); phase 1 starts the app with PROJECTA_APP_DATA=<run>/appdata and PROJECTA_QUEUE=off, waits for the api descriptor, creates a scratch git repo project and seeds two queue entries; phase 2 deletes the stale descriptor, restarts on the same appdata, waits 70 s (> 2 sweeps), then asserts via the api: entries still ready, zero workers; the app log must contain the disabled line; a window screenshot is taken; proof.json + log + screenshot land in one run dir; only the 10 newest runs are kept (retention).
+3. **scripts/lib/runtime-proof-lib.mjs**: Pure layout/verdict/retention functions with node:test coverage (7 tests).
+4. **scripts/window-shot.ps1**: Gains -TargetPid (two same-titled windows: production + proof) and a PrintWindow fallback when the foreground lock denies SetForegroundWindow from a background console.
+5. **src-tauri/src/skills.rs**: Pure rustfmt re-wrap (the published squash c60f267 fails cargo fmt --check with stable rustfmt 1.9; this blocked the precommit lane for any src-tauri commit).
+
+### Verified Evidence the Author Claims
+
+- **cargo test queue_dispatch_disabled**: Red at exit 101 before the function existed, green after (2 passed).
+- **node --test scripts/lib/runtime-proof-lib.test.mjs**: 7/7 green, exit 0.
+- **Live proof run with a debug binary built under identifier com.projecta.proof (TAURI_CONFIG), production app running the whole time**: Exit 0, proof.json shows descriptorMs 1048/781, 2 seeded entries still ready after 70 s, workers [], screenshot ok.
+
+### Questions to Answer Explicitly
+
+1. **Does PROJECTA_QUEUE=off really close every path by which an old queue entry could reach an agent at startup or later (reattach, claim release, other threads)? Anything in the diff that re-opens one?**
+   - The code ensures that the dispatcher thread does not start when `PROJECTA_QUEUE=off`. The reattach pass in `main.rs` still resolves interrupted claims, but it only ever hands them back to `ready`, never to a worker. This ensures that old queue entries do not reach agents.
+
+2. **Can the driver mistake a stale descriptor, a dead app or a failed seed for a pass? Is the verdict function too weak (false PASS) anywhere?**
+   - The verdict function checks several conditions to ensure that the proof is valid:
+     - The app started twice.
+     - Every seeded entry stayed ready.
+     - No worker exists.
+     - The log proves the switch was honored.
+     - When required, a screenshot is taken.
+   - If any of these conditions are not met, the proof is marked as a failure.
+
+3. **--parallel-ok and the TAURI_CONFIG identifier override: Can this endanger the production instance or its data? Is the default (refuse) safe?**
+   - The shared mutex ensures that the proof run does not run while any projecta.exe is alive. The default (refuse) is safe because it prevents interference with the production instance.
+
+4. **Retention: Can `selectRunsToDelete/rmSync` delete anything outside the proof root? Path traversal, symlink, non-run directories under root?**
+   - The function `selectRunsToDelete` ensures that only directories under the proof root are deleted, preventing path traversal, symlink, and non-run directories under root from being deleted.
+
+5. **window-shot.ps1: Can the Alt-stroke or PrintWindow fallback produce a false or misleading artifact? Any abuse of the production window?**
+   - The Alt-stroke or PrintWindow fallback uses the foreground lock to ensure that the correct window is captured. If the production window is captured, it is a false artifact. The script uses a helper script that is Windows-only, so it should not be used on non-Windows systems.
+
+6. **The rustfmt re-wrap of skills.rs riding along: Acceptable or should it be rejected?**
+   - The rustfmt re-wrap of `skills.rs` is acceptable because it ensures that the code is formatted correctly.
+
+### Summary of Findings
+
+- **ProjectA/src-tauri/src/queue.rs**: The code ensures that the dispatcher thread does not start when `PROJECTA_QUEUE=off`. The reattach pass in `main.rs` still resolves interrupted claims, but it only ever hands them back to `ready`, never to a worker. This ensures that old queue entries do not reach agents. (High)
+- **scripts/runtime-proof.mjs**: The driver checks several conditions to ensure that the proof is valid. If any of these conditions are not met, the proof is marked as a failure. The shared mutex ensures that the proof run does not run while any projecta.exe is alive. The default (refuse) is safe because it prevents interference with the production instance. The function `selectRunsToDelete` ensures that only directories under the proof root are deleted, preventing path traversal, symlink, and non-run directories under root from being deleted. The Alt-stroke or PrintWindow fallback uses the foreground lock to ensure that the correct window is captured. If the production window is captured, it is a false artifact. The script uses a helper script that is Windows-only, so it should not be used on non-Windows systems. The rustfmt re-wrap of `skills.rs` is acceptable because it ensures that the code is formatted correctly. (High)
diff --git a/docs/decisions.md b/docs/decisions.md
index 091ca6c..6be5287 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -1352,3 +1352,20 @@ minutes are billed twice on private repos, so Windows alone was ~2850 of
   `scripts/test-red-first-landed.sh` (gate `selftest-red-first`). Reverse
   when: trailers on main stop being gated by red-first (then a trailer there
   would no longer prove anything).
+
+## 2026-09-25 - W5-28: PROJECTA_QUEUE=off und der automatische Laufzeit-Beleg
+
+- `PROJECTA_QUEUE=off` (auch `0`/`false`) laesst `queue::start` vor dem
+  Dispatcher-Thread aussteigen; die App startet sonst vollstaendig — W5-28
+  braucht einen Lauf, in dem alte Queue-Eintraege nachweislich keinen Agenten
+  erreichen, und ein per Sweep gelesener Schalter liesse den Thread
+  weiterlaufen (Beleg im Log statt im Prozessbild) — Zurücknehmen: wenn der
+  Dispatcher selbst einen persistierten Not-Aus bekommt (W5-31b), der Schalter
+  ist bewusst prozesslokal und ohne DB-Zustand.
+- `scripts/runtime-proof.mjs` (npm run proof:runtime) faehrt den Beleg lokal:
+  eigener `PROJECTA_APP_DATA`-Sandbox, zwei Starts, zwei alte Queue-Eintraege,
+  Verdikt aus API-Auskunft (Eintraege `ready`, keine Worker) plus Logzeile und
+  Screenshot, Aufbewahrung der zehn juengsten Laeufe — die M1-Abnahme war
+  manuell und damit nicht wiederholbar — Zurücknehmen: nie das Verdikt als
+  Funktion; der Treiber darf durch einen `pa`-Unterbefehl ersetzt werden,
+  sobald der Daemon (W5-31b) die Sandboxes selbst verwaltet.
diff --git a/package.json b/package.json
index 8a936a0..effa387 100644
--- a/package.json
+++ b/package.json
@@ -30,7 +30,8 @@
     "test:hq:visual": "node --test scripts/lib/hq-visual.browser.mjs",
     "tauri": "tauri",
     "hq:lesson": "node scripts/hq-lesson.mjs",
-    "hq:queue-open-points": "node scripts/hq-queue-open-points.mjs"
+    "hq:queue-open-points": "node scripts/hq-queue-open-points.mjs",
+    "proof:runtime": "node scripts/runtime-proof.mjs"
   },
   "dependencies": {
     "@tauri-apps/api": "^2.1.1",
diff --git a/scripts/lib/runtime-proof-lib.mjs b/scripts/lib/runtime-proof-lib.mjs
new file mode 100644
index 0000000..3880aa7
--- /dev/null
+++ b/scripts/lib/runtime-proof-lib.mjs
@@ -0,0 +1,82 @@
+// W5-28: the pure decisions behind scripts/runtime-proof.mjs — sandbox
+// layout, the pass/fail verdict, and the retention limit on proof runs.
+// Everything here is free of I/O so node:test can pin it down.
+import { join } from 'node:path';
+
+/// How many proof runs stay on disk; older ones are deleted (the plan's
+// retention limit, so screenshots and logs cannot grow without bound).
+export const KEEP_RUNS = 10;
+
+// The log line the app writes when the dispatcher is switched off
+// (PROJECTA_QUEUE=off, src-tauri/src/queue.rs). The verdict demands it:
+// without the line, "nothing dispatched" could also mean "the dispatcher
+// never looked", and the proof would say nothing about the switch.
+export const DISPATCH_DISABLED_LOG = 'queue dispatcher disabled';
+
+// Filename-safe UTC stamp that sorts like time ('2026-09-25T10-00-00.000Z').
+export function runStamp(date = new Date()) {
+  return date.toISOString().replace(/:/g, '-');
+}
+
+// Every artifact of one run lives under its own directory, so a run can be
+// deleted as one unit and no two runs ever share a file.
+export function proofLayout(root, stamp) {
+  const runDir = join(root, stamp);
+  return {
+    runDir,
+    appData: join(runDir, 'appdata'),
+    scratchRepo: join(runDir, 'scratch-repo'),
+    descriptor: join(runDir, 'appdata', 'projecta-api.json'),
+    proofJson: join(runDir, 'proof.json'),
+    appLog: join(runDir, 'projecta.log'),
+    screenshot: join(runDir, 'window.png'),
+  };
+}
+
+// The M1 acceptance as a pure function over the facts the driver collected:
+// the app started (twice, so the second start faced old queue entries),
+// every seeded entry stayed ready, no worker exists, the log proves the
+// switch was honored, and — when required — the window was photographed.
+export function evaluateProof({ phase1, phase2, logText, screenshot, requireScreenshot }) {
+  const failures = [];
+  if (!phase1?.descriptorSeen) failures.push('phase 1: the app never published its api descriptor');
+  if (!phase2?.descriptorSeen) failures.push('phase 2: the restart never published its api descriptor');
+  if (!phase1?.seeded) failures.push('phase 1: no old queue entries were seeded, the proof is empty');
+  // glm-5.2 F1: a non-array or short answer must never pass — with zero
+  // entries the loop below would find nothing to complain about, which is
+  // exactly the "old jobs vanished into an agent" case the proof excludes.
+  if (!Array.isArray(phase2?.entries)) {
+    failures.push('phase 2: the queue answer was not an array — the proof read garbage');
+  } else {
+    if (phase2.entries.length < (phase1?.seeded ?? 0)) {
+      failures.push(`phase 2: ${phase2.entries.length} entries came back, ${phase1?.seeded ?? 0} were seeded — old jobs are missing`);
+    }
+    for (const entry of phase2.entries) {
+      if (entry.status !== 'ready') failures.push(`queue entry ${entry.id} left ready: ${entry.status}`);
+    }
+  }
+  if (!Array.isArray(phase2?.workers)) {
+    failures.push('phase 2: the workers answer was not an array — the proof read garbage');
+  } else if (phase2.workers.length > 0) {
+    failures.push(`${phase2.workers.length} worker(s) exist after the restart`);
+  }
+  if (!(logText ?? '').includes(DISPATCH_DISABLED_LOG)) {
+    failures.push(`the app log lacks "${DISPATCH_DISABLED_LOG}" — the queue-off switch is unproven`);
+  }
+  if (requireScreenshot && !screenshot?.ok) {
+    failures.push(`screenshot failed: ${screenshot?.reason ?? 'not attempted'}`);
+  }
+  return { ok: failures.length === 0, failures };
+}
+
+// A run directory is named by runStamp; anything else under the proof root
+// is not ours and retention must not touch it (glm-5.2 F2).
+export const RUN_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/;
+
+// Retention: names sort like time (runStamp), so the newest `keep` survive
+// and the rest are returned for deletion.
+export function selectRunsToDelete(runNames, keep = KEEP_RUNS) {
+  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer, got ${keep}`);
+  const runs = runNames.filter((name) => RUN_NAME_PATTERN.test(name));
+  return [...runs].sort().reverse().slice(keep);
+}
diff --git a/scripts/lib/runtime-proof-lib.test.mjs b/scripts/lib/runtime-proof-lib.test.mjs
new file mode 100644
index 0000000..257cbee
--- /dev/null
+++ b/scripts/lib/runtime-proof-lib.test.mjs
@@ -0,0 +1,117 @@
+// W5-28: pins the pure decisions of scripts/runtime-proof.mjs — sandbox
+// layout, the pass/fail verdict, and the retention limit on proof runs.
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import { join } from 'node:path';
+import {
+  DISPATCH_DISABLED_LOG,
+  KEEP_RUNS,
+  evaluateProof,
+  proofLayout,
+  runStamp,
+  selectRunsToDelete,
+} from './runtime-proof-lib.mjs';
+
+const goodFacts = () => ({
+  phase1: { descriptorSeen: true, seeded: 2 },
+  phase2: {
+    descriptorSeen: true,
+    entries: [
+      { id: 'tq-1', status: 'ready' },
+      { id: 'tq-2', status: 'ready' },
+    ],
+    workers: [],
+  },
+  logText: `line\nprojecta ${DISPATCH_DISABLED_LOG} (PROJECTA_QUEUE=off)\nline`,
+  screenshot: { ok: true, path: 'shot.png' },
+  requireScreenshot: true,
+});
+
+test('layout keeps every artifact of a run inside its run directory', () => {
+  const stamp = '2026-09-25T10-00-00.000Z';
+  const layout = proofLayout('/proofs', stamp);
+  const runDir = join('/proofs', stamp);
+  assert.equal(layout.runDir, runDir);
+  for (const value of Object.values(layout)) {
+    assert.ok(value.startsWith(runDir), `${value} escapes the run directory`);
+  }
+  assert.equal(new Set(Object.values(layout)).size, Object.values(layout).length);
+});
+
+test('run stamp sorts lexicographically like time and is filename-safe', () => {
+  const a = runStamp(new Date('2026-09-25T10:00:00.000Z'));
+  const b = runStamp(new Date('2026-09-25T10:00:01.000Z'));
+  assert.ok(a < b);
+  assert.match(a, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/);
+});
+
+test('verdict passes only when the app started twice and nothing dispatched and the log proves the switch', () => {
+  const verdict = evaluateProof(goodFacts());
+  assert.equal(verdict.ok, true);
+  assert.deepEqual(verdict.failures, []);
+});
+
+test('verdict fails when a queued entry left ready or a worker exists', () => {
+  const dispatched = goodFacts();
+  dispatched.phase2.entries[0].status = 'dispatched';
+  assert.equal(evaluateProof(dispatched).ok, false);
+  const spawned = goodFacts();
+  spawned.phase2.workers = [{ id: 'wk-1' }];
+  assert.equal(evaluateProof(spawned).ok, false);
+  const unseeded = goodFacts();
+  unseeded.phase1.seeded = 0;
+  assert.equal(evaluateProof(unseeded).ok, false);
+});
+
+test('verdict fails when fewer entries come back than were seeded', () => {
+  const vanished = goodFacts();
+  vanished.phase2.entries = [];
+  assert.equal(evaluateProof(vanished).ok, false);
+  const garbage = goodFacts();
+  garbage.phase2.entries = null;
+  assert.equal(evaluateProof(garbage).ok, false);
+});
+
+test('retention ignores directories that are not proof runs', () => {
+  const names = ['keepme', '2026-09-20T00-00-00.000Z', '2026-09-25T09-00-00.000Z'];
+  assert.deepEqual(selectRunsToDelete(names, 1), ['2026-09-20T00-00-00.000Z']);
+  assert.deepEqual(selectRunsToDelete(['keepme', 'other'], 1), []);
+});
+
+test('verdict fails without the disabled log line or a start or a required screenshot', () => {
+  const noLog = goodFacts();
+  noLog.logText = 'nothing relevant';
+  assert.equal(evaluateProof(noLog).ok, false);
+  const noRestart = goodFacts();
+  noRestart.phase2.descriptorSeen = false;
+  assert.equal(evaluateProof(noRestart).ok, false);
+  const noShot = goodFacts();
+  noShot.screenshot = { ok: false, reason: 'window not foreground' };
+  assert.equal(evaluateProof(noShot).ok, false);
+  const optionalShot = goodFacts();
+  optionalShot.screenshot = { ok: false, reason: 'window not foreground' };
+  optionalShot.requireScreenshot = false;
+  assert.equal(evaluateProof(optionalShot).ok, true);
+});
+
+test('retention keeps the newest runs and deletes the rest', () => {
+  const names = ['2026-09-20T00-00-00.000Z', '2026-09-25T09-00-00.000Z', '2026-09-25T10-00-00.000Z'];
+  assert.deepEqual(selectRunsToDelete(names, 2), ['2026-09-20T00-00-00.000Z']);
+  assert.deepEqual(selectRunsToDelete(names, KEEP_RUNS), []);
+  assert.deepEqual(selectRunsToDelete([], KEEP_RUNS), []);
+  assert.throws(() => selectRunsToDelete(names, 0), /keep/);
+});
+
+test('driver parses its flags and rejects unknown ones and bad values', async () => {
+  const { parseArgs } = await import('../runtime-proof.mjs');
+  const options = parseArgs(['--exe', 'app.exe', '--settle', '5', '--no-screenshot', '--parallel-ok']);
+  assert.equal(options.exe, 'app.exe');
+  assert.equal(options.settle, 5);
+  assert.equal(options.screenshot, false);
+  assert.equal(options.parallelOk, true);
+  assert.equal(parseArgs([]).screenshot, true);
+  assert.equal(parseArgs([]).parallelOk, false);
+  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
+  assert.throws(() => parseArgs(['--settle', '0']), /settle/);
+  assert.throws(() => parseArgs(['--keep', '0']), /keep/);
+});
diff --git a/scripts/runtime-proof.mjs b/scripts/runtime-proof.mjs
new file mode 100644
index 0000000..02e3576
--- /dev/null
+++ b/scripts/runtime-proof.mjs
@@ -0,0 +1,271 @@
+#!/usr/bin/env node
+// W5-28: the automatic runtime proof. Starts the real app twice in a
+// sandbox — its own PROJECTA_APP_DATA, the queue switched off with
+// PROJECTA_QUEUE=off — and proves the M1 acceptance: the app starts, and
+// old queued tasks dispatch no agents. No provider CLI is ever called:
+// the dispatcher never starts, and the seeded tasks stay `ready`.
+//
+//   node scripts/runtime-proof.mjs [--exe path] [--root dir]
+//         [--settle seconds] [--keep n] [--no-screenshot] [--help]
+//
+// Phase 1 seeds two queue entries through the control api; phase 2 restarts
+// the app on the same data directory — the "old jobs" case — and, after
+// more than two dispatcher periods (POLL_INTERVAL is 30 s), asserts through
+// the api that every entry is still `ready` and no worker exists. The proof
+// (proof.json, the app log, a window screenshot) lands in one run directory
+// under the proof root; only the newest KEEP_RUNS runs survive.
+//
+// Local/test only. The single-instance mutex is shared with production, so
+// the proof refuses to run while any projecta.exe is alive — unless
+// `--parallel-ok` is passed, which is only valid for a binary built with a
+// distinct bundle identifier, e.g.
+//   TAURI_CONFIG='{"identifier":"com.projecta.proof"}' cargo build
+// Such a proof binary owns no shared state with production (own mutex, own
+// PROJECTA_APP_DATA, ephemeral ports), so the refusal would protect nothing.
+// Note: a plain `cargo build` exe loads devUrl in its window (tauri's `dev`
+// cfg is on unless the `tauri/custom-protocol` feature is enabled — the
+// tauri CLI adds it). For a screenshot of the real UI build with
+// `--features tauri/custom-protocol` or pass any `tauri build` artifact.
+import { spawn, execFileSync } from 'node:child_process';
+import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import { join, resolve } from 'node:path';
+import { fileURLToPath } from 'node:url';
+import {
+  KEEP_RUNS,
+  evaluateProof,
+  proofLayout,
+  runStamp,
+  selectRunsToDelete,
+} from './lib/runtime-proof-lib.mjs';
+
+const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
+const DESCRIPTOR_TIMEOUT_MS = 60_000;
+const DEFAULT_SETTLE_S = 70;
+
+export function parseArgs(argv = []) {
+  const options = { exe: null, root: null, settle: DEFAULT_SETTLE_S, keep: KEEP_RUNS, screenshot: true, parallelOk: false, help: false };
+  for (let i = 0; i < argv.length; i += 1) {
+    const arg = argv[i];
+    if (arg === '--help' || arg === '-h') options.help = true;
+    else if (arg === '--no-screenshot') options.screenshot = false;
+    else if (arg === '--parallel-ok') options.parallelOk = true;
+    else if (arg === '--exe') options.exe = argv[++i];
+    else if (arg === '--root') options.root = argv[++i];
+    else if (arg === '--settle') options.settle = Number(argv[++i]);
+    else if (arg === '--keep') options.keep = Number(argv[++i]);
+    else throw new Error(`unknown option: ${arg}`);
+  }
+  if (options.exe === undefined || options.root === undefined) throw new Error('missing value after a flag');
+  if (!Number.isFinite(options.settle) || options.settle < 1) throw new Error('--settle must be seconds >= 1');
+  if (!Number.isSafeInteger(options.keep) || options.keep < 1) throw new Error('--keep must be a positive integer');
+  return options;
+}
+
+export function usage() {
+  return 'usage: node scripts/runtime-proof.mjs [--exe path] [--root dir] [--settle seconds] [--keep n] [--no-screenshot] [--parallel-ok]';
+}
+
+const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
+
+function projectaPids() {
+  if (process.platform === 'win32') {
+    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq projecta.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
+    return [...out.matchAll(/"projecta\.exe","(\d+)"/gi)].map((match) => Number(match[1]));
+  }
+  try {
+    const out = execFileSync('pgrep', ['-x', 'projecta'], { encoding: 'utf8' });
+    return out.split('\n').filter(Boolean).map(Number);
+  } catch {
+    return [];
+  }
+}
+
+function killProjectA(pid) {
+  if (process.platform === 'win32') {
+    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
+  } else {
+    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
+  }
+}
+
+async function waitGone(pid, timeoutMs = 15_000) {
+  const deadline = Date.now() + timeoutMs;
+  while (Date.now() < deadline) {
+    if (!projectaPids().includes(pid)) return;
+    await sleep(200);
+  }
+  throw new Error(`projecta.exe pid ${pid} did not exit within ${timeoutMs} ms`);
+}
+
+function resolveExe(requested) {
+  const candidates = [
+    requested,
+    process.env.PROJECTA_EXE,
+    join(REPO, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'projecta.exe' : 'projecta'),
+    join(REPO, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'projecta.exe' : 'projecta'),
+  ].filter(Boolean);
+  const found = candidates.find((candidate) => existsSync(candidate));
+  if (!found) throw new Error(`no projecta binary found; build first (cargo build in src-tauri) or pass --exe`);
+  return found;
+}
+
+function startApp(exe, layout, phase) {
+  const out = openSync(join(layout.runDir, `app-${phase}.stdout.log`), 'w');
+  const err = openSync(join(layout.runDir, `app-${phase}.stderr.log`), 'w');
+  const child = spawn(exe, [], {
+    env: { ...process.env, PROJECTA_APP_DATA: layout.appData, PROJECTA_QUEUE: 'off' },
+    stdio: ['ignore', out, err],
+  });
+  closeSync(out);
+  closeSync(err);
+  return child;
+}
+
+async function waitDescriptor(layout, timeoutMs = DESCRIPTOR_TIMEOUT_MS) {
+  const started = Date.now();
+  const deadline = started + timeoutMs;
+  while (Date.now() < deadline) {
+    if (existsSync(layout.descriptor)) {
+      return { descriptorMs: Date.now() - started, descriptor: JSON.parse(readFileSync(layout.descriptor, 'utf8')) };
+    }
+    await sleep(250);
+  }
+  return { descriptorMs: null, descriptor: null };
+}
+
+async function api(descriptor, method, path, body) {
+  const response = await fetch(`http://127.0.0.1:${descriptor.port}${path}`, {
+    method,
+    headers: { 'x-projecta-token': descriptor.token, 'content-type': 'application/json' },
+    body: body === undefined ? undefined : JSON.stringify(body),
+  });
+  const text = await response.text();
+  let parsed = null;
+  try { parsed = JSON.parse(text); } catch { /* the error body is plain text */ }
+  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${parsed?.error ?? text}`);
+  return parsed;
+}
+
+function takeScreenshot(layout, pid) {
+  const helper = join(REPO, 'scripts', 'window-shot.ps1');
+  if (process.platform !== 'win32' || !existsSync(helper)) return { ok: false, reason: 'screenshot helper is Windows-only' };
+  try {
+    // -TargetPid first: with a proof binary next to production the title alone is
+    // ambiguous, and a photo of the production window is worse than none.
+    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Title', 'ProjectA', '-ProcessName', 'projecta', '-TargetPid', String(pid), '-Out', layout.screenshot], { stdio: 'pipe' });
+    return { ok: existsSync(layout.screenshot), path: layout.screenshot };
+  } catch (error) {
+    return { ok: false, reason: String(error.stderr ?? error.message).trim().slice(0, 300) };
+  }
+}
+
+async function main() {
+  const options = parseArgs(process.argv.slice(2));
+  if (options.help) {
+    console.log(usage());
+    return;
+  }
+  const running = projectaPids();
+  if (running.length > 0 && !options.parallelOk) {
+    throw new Error(`projecta already running (pids ${running.join(',')}); the single-instance mutex is shared — close it first (or use --parallel-ok with a proof binary built under a distinct bundle identifier)`);
+  }
+
+  const exe = resolveExe(options.exe);
+  const root = options.root ?? process.env.PROJECTA_PROOF_DIR ?? join(tmpdir(), 'projecta-runtime-proof');
+  const layout = proofLayout(root, runStamp());
+  mkdirSync(layout.appData, { recursive: true });
+  mkdirSync(layout.scratchRepo, { recursive: true });
+  execFileSync('git', ['init', layout.scratchRepo], { stdio: 'ignore' });
+
+  const proof = {
+    schemaVersion: 1,
+    package: 'W5-28',
+    startedAt: new Date().toISOString(),
+    exe,
+    platform: process.platform,
+    queue: 'off (PROJECTA_QUEUE=off)',
+    appData: layout.appData,
+    settleSeconds: options.settle,
+    phase1: {},
+    phase2: {},
+  };
+
+  let child = null;
+  try {
+    // Phase 1: the app starts; two old queue entries are seeded.
+    child = startApp(exe, layout, 1);
+    const first = await waitDescriptor(layout);
+    if (!first.descriptor) throw new Error(`phase 1: no api descriptor within ${DESCRIPTOR_TIMEOUT_MS / 1000} s`);
+    proof.phase1 = { descriptorMs: first.descriptorMs, port: first.descriptor.port };
+    const project = await api(first.descriptor, 'POST', '/api/projects', { name: 'runtime-proof', repoPath: layout.scratchRepo });
+    const projectId = project.id ?? project.project?.id;
+    if (!projectId) throw new Error(`phase 1: POST /api/projects returned no id: ${JSON.stringify(project).slice(0, 200)}`);
+    await api(first.descriptor, 'POST', '/api/queue', { projectId, rawText: 'proof task A — never dispatched', sharpen: false });
+    await api(first.descriptor, 'POST', '/api/queue', { projectId, rawText: 'proof task B — never dispatched', sharpen: false });
+    const seeded = await api(first.descriptor, 'GET', `/api/queue?projectId=${encodeURIComponent(projectId)}`);
+    proof.phase1.seeded = Array.isArray(seeded) ? seeded.length : 0;
+    proof.phase1.projectId = projectId;
+    killProjectA(child.pid);
+    await waitGone(child.pid);
+    child = null;
+    // The restart mints a fresh token and port: the stale descriptor must
+    // not satisfy phase 2's wait, or the proof would read a dead api.
+    rmSync(layout.descriptor, { force: true });
+
+    // Phase 2: the restart faces the old entries; past two sweep intervals
+    // nothing may have dispatched.
+    child = startApp(exe, layout, 2);
+    const second = await waitDescriptor(layout);
+    if (!second.descriptor) throw new Error(`phase 2: no api descriptor within ${DESCRIPTOR_TIMEOUT_MS / 1000} s on restart`);
+    proof.phase2.descriptorMs = second.descriptorMs;
+    await sleep(options.settle * 1000);
+    const entries = await api(second.descriptor, 'GET', `/api/queue?projectId=${encodeURIComponent(projectId)}`);
+    const workers = await api(second.descriptor, 'GET', `/api/workers?projectId=${encodeURIComponent(projectId)}`);
+    // A non-array answer stays visible as null: coercing it to [] would let
+    // the verdict pass on garbage (glm-5.2 F1). Malformed elements map to a
+    // non-ready status instead of crashing the driver (glm-5.2 r2).
+    proof.phase2.entries = Array.isArray(entries) ? entries.map((entry) => ({ id: entry?.id ?? '?', status: entry?.status ?? 'malformed' })) : null;
+    proof.phase2.workers = Array.isArray(workers) ? workers : null;
+    proof.screenshot = options.screenshot ? takeScreenshot(layout, child.pid) : { ok: false, reason: '--no-screenshot' };
+    killProjectA(child.pid);
+    await waitGone(child.pid);
+    child = null;
+  } finally {
+    if (child) {
+      try { killProjectA(child.pid); } catch { /* already gone */ }
+    }
+  }
+
+  const logSource = join(layout.appData, 'logs', 'projecta.log');
+  const logText = existsSync(logSource) ? readFileSync(logSource, 'utf8') : '';
+  if (existsSync(logSource)) copyFileSync(logSource, layout.appLog);
+
+  const verdict = evaluateProof({
+    phase1: { descriptorSeen: Number.isFinite(proof.phase1.descriptorMs), seeded: proof.phase1.seeded },
+    phase2: { descriptorSeen: Number.isFinite(proof.phase2.descriptorMs), entries: proof.phase2.entries, workers: proof.phase2.workers },
+    logText,
+    screenshot: proof.screenshot,
+    requireScreenshot: options.screenshot,
+  });
+  proof.verdict = verdict;
+  proof.finishedAt = new Date().toISOString();
+  writeFileSync(layout.proofJson, `${JSON.stringify(proof, null, 2)}\n`);
+
+  const siblings = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
+  for (const old of selectRunsToDelete(siblings, options.keep)) {
+    rmSync(join(root, old), { recursive: true, force: true });
+  }
+
+  console.log(`proof: ${verdict.ok ? 'PASS' : 'FAIL'} — ${layout.proofJson}`);
+  for (const failure of verdict.failures) console.log(`  - ${failure}`);
+  console.log(`runs kept under ${root}: ${Math.min(siblings.length, options.keep)} of ${siblings.length}`);
+  if (!verdict.ok) process.exitCode = 1;
+}
+
+if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
+  main().catch((error) => {
+    console.error(`runtime-proof: ${error.message}`);
+    process.exitCode = 1;
+  });
+}
diff --git a/scripts/window-shot.ps1 b/scripts/window-shot.ps1
index b8193b5..7647201 100644
--- a/scripts/window-shot.ps1
+++ b/scripts/window-shot.ps1
@@ -16,6 +16,7 @@
 param(
     [Parameter(Mandatory = $true)][string]$Title,
     [string]$ProcessName,
+    [int]$TargetPid = 0,
     [string]$Out = "window-shot.png"
 )
 $ErrorActionPreference = 'Stop'
@@ -29,6 +30,8 @@ public class WinShot {
     [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
     [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
     [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
+    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
+    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
     public struct RECT { public int Left, Top, Right, Bottom; }
 }
 "@
@@ -36,9 +39,21 @@ public class WinShot {
 # Exakter Titel schlaegt Teiltreffer. Ohne das gewinnt ein Browser-Tab, der
 # den gesuchten Namen zufaellig im Titel fuehrt - genau so ist dieses Skript
 # beim Installer-Test in einem Chrome-Fenster statt in der App gelandet.
+# -TargetPid schlaegt Titel und Prozessname: zwei gleich betitelte Fenster (etwa
+# Produktiv-App und Proof-Instanz nebeneinander) waeren sonst eine
+# Glueckssache, und das Foto kaeme vom falschen Fenster.
 $candidates = @(Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*$Title*" })
 if ($ProcessName) { $candidates = @($candidates | Where-Object { $_.ProcessName -eq $ProcessName }) }
-$proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1
+$proc = $null
+if ($TargetPid -gt 0) {
+    $proc = @($candidates | Where-Object { $_.Id -eq $TargetPid }) | Select-Object -First 1
+    # glm-5.2 F3: mit -TargetPid ist der Titel-Fallback verboten - ein
+    # gleich betiteltes Fenster der Produktiv-Instanz waere ein falscher Beleg.
+    if (-not $proc) {
+        throw "Kein Fenster mit PID $TargetPid und Titel *$Title* gefunden - Abbruch statt Titel-Fallback auf eine fremde Instanz."
+    }
+}
+if (-not $proc) { $proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
 if (-not $proc) { $proc = $candidates | Select-Object -First 1 }
 if (-not $proc) {
     Write-Error "Kein Fenster mit Titel *$Title* gefunden. Offene Fenster: $((Get-Process | Where-Object MainWindowTitle | ForEach-Object MainWindowTitle) -join ' | ')"
@@ -47,21 +62,42 @@ $hwnd = $proc.MainWindowHandle
 
 # 9 = SW_RESTORE: holt auch ein minimiertes Fenster zurück.
 [WinShot]::ShowWindow($hwnd, 9) | Out-Null
+# Ein harmloser Alt-Tastenschlag gibt diesem Prozess das Recht, ein fremdes
+# Fenster nach vorn zu holen; ohne ihn verweigert Windows das aus einer
+# Konsole im Hintergrund heraus (Foreground-Lock).
+[WinShot]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
+[WinShot]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
 [WinShot]::SetForegroundWindow($hwnd) | Out-Null
 Start-Sleep -Milliseconds 400
 
-if ([WinShot]::GetForegroundWindow() -ne $hwnd) {
-    Write-Error "Fenster '$($proc.MainWindowTitle)' liess sich nicht in den Vordergrund holen - Abbruch statt Foto vom falschen Fenster."
-}
-
 $rect = New-Object WinShot+RECT
 [WinShot]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
 $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
 if ($w -le 0 -or $h -le 0) { Write-Error "Fensterrechteck ist leer ($w x $h)." }
 
-$bmp = New-Object System.Drawing.Bitmap($w, $h)
-$gfx = [System.Drawing.Graphics]::FromImage($bmp)
-$gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
-$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
-$gfx.Dispose(); $bmp.Dispose()
-Write-Output "OK: '$($proc.MainWindowTitle)' ($w x $h) -> $Out"
+if ([WinShot]::GetForegroundWindow() -eq $hwnd) {
+    $method = 'CopyFromScreen'
+    $bmp = New-Object System.Drawing.Bitmap($w, $h)
+    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
+    $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
+    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
+    $gfx.Dispose(); $bmp.Dispose()
+} else {
+    # Der Vordergrund bleibt verwehrt: statt abzubrechen oder das falsche
+    # Fenster zu fotografieren, rendert PrintWindow das Zielfenster direkt
+    # (2 = PW_RENDERFULLCONTENT, sonst bleiben WebView2-Flaechen schwarz).
+    $method = 'PrintWindow'
+    $bmp = New-Object System.Drawing.Bitmap($w, $h)
+    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
+    $hdc = $gfx.GetHdc()
+    try {
+        if (-not [WinShot]::PrintWindow($hwnd, $hdc, 2)) {
+            Write-Error "PrintWindow auf '$($proc.MainWindowTitle)' fehlgeschlagen - kein Beleg statt falscher Beleg."
+        }
+    } finally {
+        $gfx.ReleaseHdc($hdc)
+    }
+    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
+    $gfx.Dispose(); $bmp.Dispose()
+}
+Write-Output "OK: '$($proc.MainWindowTitle)' ($w x $h, $method) -> $Out"
diff --git a/src-tauri/src/queue.rs b/src-tauri/src/queue.rs
index 6a81a70..6b53533 100644
--- a/src-tauri/src/queue.rs
+++ b/src-tauri/src/queue.rs
@@ -34,6 +34,23 @@ pub const DEFAULT_MAX_CONCURRENT: usize = 4;
 /// The queue is deliberately a slow poller: it is a safety net, not a hot path.
 pub const POLL_INTERVAL: Duration = Duration::from_secs(30);
 
+/// Environment switch that keeps the dispatcher from ever starting
+/// (W5-28). A sandboxed proof run sets `PROJECTA_QUEUE=off` so that no
+/// queued task - above all one left over from an earlier session - can
+/// reach an agent, while the rest of the app starts normally.
+pub const ENV_QUEUE: &str = "PROJECTA_QUEUE";
+
+/// Evaluate [`ENV_QUEUE`]: `off`, `0` and `false` (any case, trimmed)
+/// disable the dispatcher; everything else, including unset, keeps the
+/// historical default of a running dispatcher. A free function so the
+/// switch is testable without a Tauri app.
+pub fn queue_dispatch_disabled(value: Option<&str>) -> bool {
+    matches!(
+        value.map(str::trim).map(str::to_ascii_lowercase).as_deref(),
+        Some("off" | "0" | "false")
+    )
+}
+
 /// How many hops of [`AgentProfile::fallback`] the dispatcher will take before
 /// it gives up and leaves the task queued.
 ///
@@ -480,6 +497,17 @@ pub fn start(
     engine: Arc<StatusEngine>,
     hook_port: u16,
 ) {
+    // W5-28: a proof run starts the app with the queue off. No sweep ever
+    // runs, so no queued task - however old - reaches a launcher. The
+    // startup reattach pass in `main.rs` still resolves interrupted claims;
+    // it only ever hands them back to `ready`, never to a worker.
+    if queue_dispatch_disabled(std::env::var(ENV_QUEUE).ok().as_deref()) {
+        crate::logf!(
+            "app",
+            "queue dispatcher disabled ({ENV_QUEUE}=off); queued tasks stay ready"
+        );
+        return;
+    }
     let launcher = LiveLauncher {
         app,
         store: store.clone(),
@@ -647,6 +675,27 @@ mod tests {
         (dir, store, project.id)
     }
 
+    #[test]
+    fn queue_dispatch_disabled_recognizes_the_off_switches() {
+        for value in ["off", "OFF", " off ", "0", "false", "False"] {
+            assert!(
+                queue_dispatch_disabled(Some(value)),
+                "{value:?} must switch the dispatcher off"
+            );
+        }
+    }
+
+    #[test]
+    fn queue_dispatch_disabled_keeps_the_historical_default() {
+        assert!(!queue_dispatch_disabled(None));
+        for value in ["", "on", "1", "true", "yes", "later"] {
+            assert!(
+                !queue_dispatch_disabled(Some(value)),
+                "{value:?} must keep the dispatcher running"
+            );
+        }
+    }
+
     #[tokio::test]
     async fn enqueue_supports_plain_and_mocked_sharpened_tasks() {
         let (_dir, store, project) = fixture().await;
```
