# Delta review request PR #13 (W2-10a): fixes for your stage-B findings

You reviewed this candidate before (stage B, author is a Kimi model) and
reported three findings: focused buttons blurred on every 5 s refresh tick
(high), phantom drafts from never-synced defaultValue/defaultSelected plus a
dropped cleared assignee (medium), and a restored team draft keeping the
previous team's role list (medium). All three were accepted. Below is the
COMPLETE delta that implements the fixes (two commits: red tests first, then
the fix in docs/dev-hq/continuous.js).

Verify, against the delta:

- Does captureFocus/restoreFocus actually fix the blur on both the unchanged
  and the rebuild path, in refresh() and in mutate()?
- Does syncing defaultValue/defaultSelected to the server values make draft
  detection honest (untouched = no draft, cleared assignee = draft)?
- Does dispatching change on a restored teamId refill the role list before
  the role draft is applied?
- Any NEW bug introduced by the delta (focus stealing, missed edge, broken
  lock/disabled semantics, event-ordering issue)?

Be concrete: cite file and line, say what breaks and when. Rate each finding
high/medium/low. If the fixes are correct and you find nothing new, say so
explicitly. Answer in English or German. READ-ONLY: do not modify any files.

## Delta (git diff a344fb2..9899641)

```diff
diff --git a/docs/dev-hq/continuous.js b/docs/dev-hq/continuous.js
index 7ecefbd..672d48e 100644
--- a/docs/dev-hq/continuous.js
+++ b/docs/dev-hq/continuous.js
@@ -100,7 +100,33 @@
       }
     }
     // The 5 s tick must not throw the operator out of the card: capture the
-    // interactive state before a rebuild, hand it back afterwards.
+    // interactive state before a rebuild, hand it back afterwards. Focus is
+    // separate on purpose: enable(false) blurs a focused button in real
+    // browsers, so focus must be captured before the network wait starts.
+    function captureFocus() {
+      const active = document.activeElement;
+      if (!active || !card.contains(active)) return null;
+      const host = active.closest('details[data-task-id]');
+      const part = active.name || (active.tagName === 'BUTTON' ? 'submit' : active.tagName.toLowerCase());
+      return { taskId: host?.dataset.taskId || null, part, element: active };
+    }
+    function restoreFocus(savedFocus) {
+      if (!savedFocus) return;
+      // Only take focus back when the tick itself took it (blur to body);
+      // if the operator moved focus somewhere else, leave it alone.
+      const active = document.activeElement;
+      if (active && active !== document.body) return;
+      let target = null;
+      if (savedFocus.taskId) {
+        const host = list.querySelector(`details[data-task-id="${savedFocus.taskId}"]`);
+        target = host?.querySelector(`[name="${savedFocus.part}"]`)
+          || (savedFocus.part === 'summary' ? host?.querySelector('summary') : null)
+          || (savedFocus.part === 'submit' ? host?.querySelector('button[type="submit"]') : null);
+      }
+      // Buttons outside the task list survive a rebuild; use the node itself.
+      if (!target && savedFocus.element?.isConnected) target = savedFocus.element;
+      target?.focus();
+    }
     function captureListState() {
       const openTasks = new Set([...list.querySelectorAll('details[data-task-id][open]')].map(node => node.dataset.taskId));
       const drafts = new Map();
@@ -114,14 +140,7 @@
         }
         if (Object.keys(draft).length) drafts.set(form.dataset.taskId, draft);
       }
-      const active = document.activeElement;
-      let focus = null;
-      if (active && list.contains(active)) {
-        const host = active.closest('details[data-task-id]');
-        const part = active.name || (active.tagName === 'BUTTON' ? 'submit' : active.tagName.toLowerCase());
-        focus = { taskId: host?.dataset.taskId || null, part };
-      }
-      return { openTasks, drafts, focus };
+      return { openTasks, drafts };
     }
     function restoreListState(saved) {
       for (const node of list.querySelectorAll('details[data-task-id]')) {
@@ -132,20 +151,18 @@
         if (!draft) continue;
         for (const [name, value] of Object.entries(draft)) {
           const field = form.elements[name];
-          if (field) field.value = value;
+          if (!field) continue;
+          field.value = value;
+          // A restored team draft must refill the role list for that team;
+          // setting .value alone fires no change event.
+          if (name === 'teamId') field.dispatchEvent(new Event('change'));
         }
       }
-      if (saved.focus?.taskId) {
-        const host = list.querySelector(`details[data-task-id="${saved.focus.taskId}"]`);
-        const target = host?.querySelector(`[name="${saved.focus.part}"]`)
-          || (saved.focus.part === 'summary' ? host?.querySelector('summary') : null)
-          || (saved.focus.part === 'submit' ? host?.querySelector('button[type="submit"]') : null);
-        target?.focus();
-      }
     }
     async function refresh() {
       const current = project();
       const generation = ++sequence;
+      const savedFocus = captureFocus();
       online = false; enable(false);
       if (current !== loadedProject) { list.replaceChildren(); select.replaceChildren(); ownership.replaceChildren(); loadedProject = null; lastSignature = null; }
       if (!current) { state.textContent = 'Projekt auswählen, um Ziele und Arbeitspakete zu sehen.'; source.textContent = ''; enable(false); return; }
@@ -234,14 +251,18 @@
             for (const team of allowedTeams) { const option = document.createElement('option'); option.value = team.id; option.textContent = team.id; teamSelect.append(option); }
             const currentTeam = task.assignment?.teamId || allowedTeams[0]?.id;
             if (currentTeam) teamSelect.value = currentTeam;
-            const fillRoles = () => {
+            // Draft detection compares against the defaults, so the defaults
+            // must be the server values, not the initial markup state.
+            for (const option of teamSelect.options) option.defaultSelected = option.selected;
+            const fillRoles = (syncDefaults = false) => {
               roleSelect.replaceChildren();
               const team = allowedTeams.find(item => item.id === teamSelect.value);
               for (const role of team?.roles || []) { const option = document.createElement('option'); option.value = role; option.textContent = role; roleSelect.append(option); }
               if (task.assignment?.role && [...roleSelect.options].some(option => option.value === task.assignment.role)) roleSelect.value = task.assignment.role;
+              if (syncDefaults) for (const option of roleSelect.options) option.defaultSelected = option.selected;
             };
-            teamSelect.addEventListener('change', fillRoles); fillRoles();
-            if (task.assignment?.assignee) assignee.value = task.assignment.assignee;
+            teamSelect.addEventListener('change', () => fillRoles()); fillRoles(true);
+            if (task.assignment?.assignee) assignee.value = assignee.defaultValue = task.assignment.assignee;
             const revision = task.assignment?.revision || 0;
             teamLabel.append(teamSelect); roleLabel.append(roleSelect); assigneeLabel.append(assignee);
             assignmentForm.append(teamLabel, roleLabel, assigneeLabel, assignButton);
@@ -289,6 +310,7 @@
           }
         }
         enable(true);
+        restoreFocus(savedFocus);
       } catch (failure) {
         if (generation !== sequence || current !== project()) return;
         runtime.textContent = 'Runtime-Identität nicht verfügbar; angezeigte Fähigkeiten sind nicht bestätigt.';
@@ -299,12 +321,14 @@
     async function mutate(path, body, form) {
       if (busy || !online || loadedProject !== project()) return;
       const current = project();
+      const savedFocus = captureFocus();
       busy = true; enable(false); error(null);
       try {
         await api(path, { method: 'POST', body: JSON.stringify(body) });
         if (current === project()) form?.reset();
-      } catch (failure) { if (current === project()) error(failure); busy = false; enable(online && loadedProject === project()); return; }
+      } catch (failure) { if (current === project()) error(failure); busy = false; enable(online && loadedProject === project()); restoreFocus(savedFocus); return; }
       busy = false; await refresh();
+      restoreFocus(savedFocus);
     }
     const confirmations = {
       cancel: 'Kontinuierlichen Lauf wirklich beenden? Laufende Arbeit wird nicht mehr fortgesetzt.',
diff --git a/scripts/lib/hq-goals-live.test.mjs b/scripts/lib/hq-goals-live.test.mjs
index 44fd059..5c71546 100644
--- a/scripts/lib/hq-goals-live.test.mjs
+++ b/scripts/lib/hq-goals-live.test.mjs
@@ -33,7 +33,10 @@ const CONTEXT = {
       },
     ],
     effectiveLimits: {
-      rootPolicies: [{ policy: { teams: [{ id: 'development', roles: ['implementer', 'reviewer'] }] } }],
+      rootPolicies: [{ policy: { teams: [
+        { id: 'development', roles: ['implementer', 'reviewer'] },
+        { id: 'ops', roles: ['planner'] },
+      ] } }],
     },
   },
 };
@@ -112,6 +115,80 @@ test('changed-data rebuild restores focus to a submit button', async (t) => {
   assert.equal(f.document.activeElement, again.querySelector('button[type=submit]'), 'submit button focus is restored');
 });
 
+test('rebuild after a server-side seat change shows the new seat, not a phantom draft', async (t) => {
+  let seat = { teamId: 'development', role: 'implementer', assignee: 'worker-1', revision: 2 };
+  const f = continuousFixture(async () => ({
+    ...CONTEXT,
+    snapshot: {
+      ...CONTEXT.snapshot,
+      tasks: CONTEXT.snapshot.tasks.map((task) => task.id === 'task-1' ? { ...task, assignment: seat } : task),
+    },
+  }));
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  // The operator never touches the assignment form, so nothing may be
+  // captured as a draft and painted over the next server state.
+  seat = { teamId: 'development', role: 'reviewer', assignee: 'worker-2', revision: 3 };
+  await f.controller.refresh();
+  const details = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Render ownership'));
+  const form = details.querySelector('form.continuous-assignment');
+  assert.equal(form.elements.assignee.value, 'worker-2', 'untouched assignee follows the server');
+  assert.equal(form.elements.role.value, 'reviewer', 'untouched role follows the server');
+  assert.equal(form.elements.teamId.value, 'development', 'untouched team follows the server');
+});
+
+test('a deliberately cleared assignee survives a rebuild as a draft', async (t) => {
+  let attempts = 0;
+  const f = continuousFixture(async () => ({
+    ...CONTEXT,
+    snapshot: {
+      ...CONTEXT.snapshot,
+      tasks: CONTEXT.snapshot.tasks.map((task) => task.id === 'task-2' ? { ...task, attempts } : task),
+    },
+  }));
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const details = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Render ownership'));
+  const assignee = details.querySelector('input[name=assignee]');
+  assert.equal(assignee.value, 'worker-1', 'assignee starts prefilled from the server');
+  assignee.value = ''; // the operator clears the field on purpose
+  attempts = 1; // changed data forces a rebuild
+  await f.controller.refresh();
+  const again = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Render ownership'));
+  assert.equal(again.querySelector('input[name=assignee]').value, '', 'the cleared field is a draft and survives the rebuild');
+});
+
+test('a drafted team switch keeps the matching role list across a rebuild', async (t) => {
+  let attempts = 0;
+  const f = continuousFixture(async () => ({
+    ...CONTEXT,
+    snapshot: {
+      ...CONTEXT.snapshot,
+      tasks: CONTEXT.snapshot.tasks.map((task) => task.id === 'task-2' ? { ...task, attempts } : task),
+    },
+  }));
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const details = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Render ownership'));
+  const form = details.querySelector('form.continuous-assignment');
+  form.elements.teamId.value = 'ops';
+  form.elements.teamId.dispatchEvent(new f.window.Event('change'));
+  assert.equal(form.elements.role.value, 'planner', 'switching the team refills the role list');
+  attempts = 1; // changed data forces a rebuild
+  await f.controller.refresh();
+  const again = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Render ownership'));
+  const formAgain = again.querySelector('form.continuous-assignment');
+  assert.equal(formAgain.elements.teamId.value, 'ops', 'drafted team survives the rebuild');
+  assert.deepEqual([...formAgain.elements.role.options].map((option) => option.value), ['planner'],
+    'the role list matches the drafted team, not the server team');
+  assert.equal(formAgain.elements.role.value, 'planner', 'drafted role survives the rebuild');
+});
+
 function liveFixture() {
   const dom = new JSDOM(source('docs/dev-hq/live.html'), { url: 'http://localhost/live.html', runScripts: 'outside-only' });
   const { window } = dom;
diff --git a/scripts/lib/hq-visual.browser.mjs b/scripts/lib/hq-visual.browser.mjs
index 408b7f6..a55e400 100644
--- a/scripts/lib/hq-visual.browser.mjs
+++ b/scripts/lib/hq-visual.browser.mjs
@@ -34,7 +34,9 @@ function startMockApi() {
       effectiveLimits: { rootPolicies: [{ policy: { teams: [{ id: "development", roles: ["coordinator", "implementer", "reviewer", "integrator"] }] } }] },
       tasks: [{ id: "task-1", goalId: "goal-1", objective: "Check ownership", profileId: "codex", status: "pending", attempts: 0, ownedPaths: ["src-tauri/src/queue.rs"], dependencies: [],
         claim: { owner: "worker-1", fence: 2 },
-        assignment: { teamId: "development", role: "implementer", assignee: "worker-1", revision: 1 } }] } },
+        assignment: { teamId: "development", role: "implementer", assignee: "worker-1", revision: 1 } },
+      { id: "task-2", goalId: "goal-1", objective: "Open follow-up", profileId: "kimi", status: "open", attempts: 0, ownedPaths: [], dependencies: [],
+        assignment: { teamId: "development", role: "reviewer", assignee: "worker-2", revision: 1 } }] } },
     "/api/hq/v1/runs": { executionEnabled: false, approvalAuthority: { state: "unavailable" }, runs: [] },
     "/api/projects": [{ id: "pj-1", name: "ProjectA" }],
     "/api/board": [
@@ -226,8 +228,8 @@ test("continuous goals use the selected project and show blocked runtime honestl
   await page.click('#tab-teams');
   await page.waitForFunction(() => document.querySelector('[data-goals]')?.textContent.includes('Verify continuous development'));
   assert.match(await page.textContent('[data-goals]'), /Check ownership/);
-  assert.deepEqual(await page.locator('.continuous-assignment select[name="role"] option').allTextContents(), ['coordinator', 'implementer', 'reviewer', 'integrator']);
-  assert.equal(await page.locator('.continuous-assignment button[type="submit"]').isDisabled(), true);
+  assert.deepEqual(await page.locator('details[data-task-id="task-1"] .continuous-assignment select[name="role"] option').allTextContents(), ['coordinator', 'implementer', 'reviewer', 'integrator']);
+  assert.equal(await page.locator('details[data-task-id="task-1"] .continuous-assignment button[type="submit"]').isDisabled(), true);
   await page.locator('[data-action=resume]').click();
   await page.waitForFunction(() => document.querySelector('[data-error]')?.textContent.includes('not attested'));
   assert.match(await page.textContent('[data-state]'), /paused/);
@@ -261,6 +263,35 @@ test("goals live view renders ownership and the g key jumps to the card", async
   await page.close();
 });
 
+test("an unchanged refresh tick keeps focus on the submit button", async () => {
+  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
+  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
+  await page.waitForSelector('.live-status.ok', { timeout: 20000 });
+  await page.selectOption('#live-project', 'pj-1');
+  await page.click('#tab-teams');
+  await page.waitForFunction(() => document.querySelector('[data-goals]')?.textContent.includes('Open follow-up'), { timeout: 10000 });
+  // Count the continuous card's ticks: the source line is rewritten on every refresh.
+  await page.evaluate(() => {
+    window.__ticks = 0;
+    new MutationObserver(() => window.__ticks++).observe(document.querySelector('[data-source]'), { childList: true, characterData: true, subtree: true });
+  });
+  const submit = page.locator('details[data-task-id="task-2"] button[type="submit"]');
+  assert.equal(await submit.isDisabled(), false, 'open, unclaimed task has an enabled submit button');
+  await page.locator('details[data-task-id="task-2"] summary').click();
+  await submit.evaluate((node) => node.focus());
+  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Zuweisung aktualisieren');
+  const ticks = await page.evaluate(() => window.__ticks);
+  await page.waitForFunction((n) => window.__ticks > n, ticks, { timeout: 15000 });
+  const focused = await page.evaluate(() => {
+    const active = document.activeElement;
+    return { tag: active?.tagName, text: active?.textContent, task: active?.closest('details')?.dataset.taskId || null };
+  });
+  assert.equal(focused.task, 'task-2', 'an unchanged tick must not blur the focused submit button');
+  assert.match(focused.text, /Zuweisung aktualisieren/);
+  await page.locator('#hq-goals-live').screenshot({ path: join(shotDir, 'goals-teams-focus-tick.png') });
+  await page.close();
+});
+
 test("worker detail opens on click, shows messages, sends a reply", async () => {
   const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
   await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
```
