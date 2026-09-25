# Review request W5-28 R2: delta after your first review

You reviewed this candidate before (findings F1–F4). The author applied
fixes; review ONLY the delta below. Confirm whether each finding is actually
fixed, and look for new bugs introduced by the fixes. Be concrete: file and
line. Rate findings high/medium/low. If something is fine, say nothing.
Answer in English or German.

## Your findings being addressed

- F1 (high): verdict false-PASS when the api answer is a non-array or has
  fewer entries than seeded.
- F2 (medium): retention considered every directory under the proof root.
- F3 (medium): window-shot -TargetPid fell back to title matching, which
  could photograph the production window.
- F4 (low): global Alt keystroke — documented, kept intentionally.

## Delta (git diff 870ba09..b1e952b)

```diff
diff --git a/scripts/lib/runtime-proof-lib.mjs b/scripts/lib/runtime-proof-lib.mjs
index b931162..3880aa7 100644
--- a/scripts/lib/runtime-proof-lib.mjs
+++ b/scripts/lib/runtime-proof-lib.mjs
@@ -42,10 +42,24 @@ export function evaluateProof({ phase1, phase2, logText, screenshot, requireScre
   if (!phase1?.descriptorSeen) failures.push('phase 1: the app never published its api descriptor');
   if (!phase2?.descriptorSeen) failures.push('phase 2: the restart never published its api descriptor');
   if (!phase1?.seeded) failures.push('phase 1: no old queue entries were seeded, the proof is empty');
-  for (const entry of phase2?.entries ?? []) {
-    if (entry.status !== 'ready') failures.push(`queue entry ${entry.id} left ready: ${entry.status}`);
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
   }
-  if ((phase2?.workers ?? []).length > 0) failures.push(`${phase2.workers.length} worker(s) exist after the restart`);
   if (!(logText ?? '').includes(DISPATCH_DISABLED_LOG)) {
     failures.push(`the app log lacks "${DISPATCH_DISABLED_LOG}" — the queue-off switch is unproven`);
   }
@@ -55,9 +69,14 @@ export function evaluateProof({ phase1, phase2, logText, screenshot, requireScre
   return { ok: failures.length === 0, failures };
 }
 
+// A run directory is named by runStamp; anything else under the proof root
+// is not ours and retention must not touch it (glm-5.2 F2).
+export const RUN_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/;
+
 // Retention: names sort like time (runStamp), so the newest `keep` survive
 // and the rest are returned for deletion.
 export function selectRunsToDelete(runNames, keep = KEEP_RUNS) {
   if (!Number.isSafeInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer, got ${keep}`);
-  return [...runNames].sort().reverse().slice(keep);
+  const runs = runNames.filter((name) => RUN_NAME_PATTERN.test(name));
+  return [...runs].sort().reverse().slice(keep);
 }
diff --git a/scripts/lib/runtime-proof-lib.test.mjs b/scripts/lib/runtime-proof-lib.test.mjs
index 112a519..257cbee 100644
--- a/scripts/lib/runtime-proof-lib.test.mjs
+++ b/scripts/lib/runtime-proof-lib.test.mjs
@@ -63,6 +63,21 @@ test('verdict fails when a queued entry left ready or a worker exists', () => {
   assert.equal(evaluateProof(unseeded).ok, false);
 });
 
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
 test('verdict fails without the disabled log line or a start or a required screenshot', () => {
   const noLog = goodFacts();
   noLog.logText = 'nothing relevant';
diff --git a/scripts/runtime-proof.mjs b/scripts/runtime-proof.mjs
index f1f0832..6e015d7 100644
--- a/scripts/runtime-proof.mjs
+++ b/scripts/runtime-proof.mjs
@@ -218,8 +218,10 @@ async function main() {
     await sleep(options.settle * 1000);
     const entries = await api(second.descriptor, 'GET', `/api/queue?projectId=${encodeURIComponent(projectId)}`);
     const workers = await api(second.descriptor, 'GET', `/api/workers?projectId=${encodeURIComponent(projectId)}`);
-    proof.phase2.entries = (Array.isArray(entries) ? entries : []).map((entry) => ({ id: entry.id, status: entry.status }));
-    proof.phase2.workers = Array.isArray(workers) ? workers : [];
+    // A non-array answer stays visible as null: coercing it to [] would let
+    // the verdict pass on garbage (glm-5.2 F1).
+    proof.phase2.entries = Array.isArray(entries) ? entries.map((entry) => ({ id: entry.id, status: entry.status })) : null;
+    proof.phase2.workers = Array.isArray(workers) ? workers : null;
     proof.screenshot = options.screenshot ? takeScreenshot(layout, child.pid) : { ok: false, reason: '--no-screenshot' };
     killProjectA(child.pid);
     await waitGone(child.pid);
diff --git a/scripts/window-shot.ps1 b/scripts/window-shot.ps1
index ee5a2e6..b145f5a 100644
--- a/scripts/window-shot.ps1
+++ b/scripts/window-shot.ps1
@@ -45,7 +45,14 @@ public class WinShot {
 $candidates = @(Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*$Title*" })
 if ($ProcessName) { $candidates = @($candidates | Where-Object { $_.ProcessName -eq $ProcessName }) }
 $proc = $null
-if ($TargetPid -gt 0) { $proc = @($candidates | Where-Object { $_.Id -eq $TargetPid }) | Select-Object -First 1 }
+if ($TargetPid -gt 0) {
+    $proc = @($candidates | Where-Object { $_.Id -eq $TargetPid }) | Select-Object -First 1
+    # glm-5.2 F3: mit -TargetPid ist der Titel-Fallback verboten - ein
+    # gleich betiteltes Fenster der Produktiv-Instanz waere ein falscher Beleg.
+    if (-not $proc) {
+        Write-Error "Kein Fenster mit PID $TargetPid und Titel *$Title* gefunden - Abbruch statt Titel-Fallback auf eine fremde Instanz."
+    }
+}
 if (-not $proc) { $proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
 if (-not $proc) { $proc = $candidates | Select-Object -First 1 }
 if (-not $proc) {

```
