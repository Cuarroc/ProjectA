# Review request PR #13 (W2-10a): goals/teams live view in the Dev-HQ — stage B, final candidate

You are an independent reviewer (not the author; the author is a Kimi model).
Review the COMPLETE final candidate below for correctness bugs, gaps against
the requirements, and safety regressions. Be concrete: cite file and line,
say what breaks and when. Rate each finding high/medium/low. Do not restate
the diff. If something is fine, say nothing about it. Answer in English or
German. This is a READ-ONLY review: do not modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/,
public GitHub repo). The Dev-HQ is a local live website (scripts/hq-live.mjs
proxy + static pages under docs/dev-hq/) that mirrors the runtime state of
agent workers. This package (W2-10a, first child of W2-10 "live HQ views")
turns the "Agenten-Teams" panel of the live page into a real live view fed by
the existing HQ v1 API (/api/hq/v1/context) — no new backend function.

## Package requirement

- One compact ownership line per running (non-closed) goal: status, claim
  owner, team seat (team/role), owned file areas. Rendered inertly
  (textContent, no innerHTML with live data).
- The 5-second refresh must no longer destroy operator state: when data is
  unchanged the DOM is not rebuilt at all (signature over
  {goals, tasks, teams, controlStatus}); when data changes, open <details>,
  unsaved assignment drafts (dirty fields) and focus (named fields, summary,
  submit button) are preserved and restored.
- Keyboard shortcut `g` jumps from any tab to the goals/teams card and
  focuses it (#hq-goals-live, tabindex="-1"); documented in the `?` help;
  the existing typing guard must keep it from firing inside inputs.
- Budget/routing (W2-10b) and runs/review/delivery (W2-10c) stay untouched.

## Review history (already addressed — verify, don't just re-report)

Stage A reviewer glm-5.2 approved with four low findings; all were answered
in commit ae41907 and re-approved. Verify the fixes are actually correct and
hunt for NEW bugs anywhere in the candidate:

- F1 (low): the `g`-key test assumed the keys-enabled default without
  asserting it. Fix: the test asserts the default before dispatching keydown.
- F2 (low): focus restore mapped a nameless <button> to part="button", which
  matched nothing and silently dropped focus. Fix: nameless buttons map to
  part='submit' and are re-found via button[type="submit"].
- F3 (low): reviewer could not see where `teams` is assigned inside
  refresh() and suspected a stale signature. Answer: teams is fetched and
  assigned in the same refresh() before the signature is computed.
- F4 (low, noted only): a missing/empty goal.status is treated as running —
  deliberate (unknown != closed).

## Merge note

This candidate includes a merge of current main (base fix #4). The merge
conflict in scripts/lib/hq-routes.test.mjs was resolved by keeping main's
refactored helpers (spawnHq(dir, extraEnv), syntheticRepo) and pointing
HQ_ACTIVITY_FILE into each temp dir WITHOUT writing a journal fixture
(activity stays empty), so main's insights assertion (1.8 h from synthetic
git sittings) still holds. docs/dev-hq/hq.js merged cleanly: main's safeUrl()
(http/https-only links) and this branch's ownership rendering are both
present. The full prepush gate lane is green on this exact candidate.

## Diff (git diff origin/main...HEAD, complete final candidate; .pa/* documentation files — report, stage-A review records, this prompt — are excluded as non-code review targets)

```diff
diff --git a/docs/dev-hq/continuous.js b/docs/dev-hq/continuous.js
index 632a4d5..7ecefbd 100644
--- a/docs/dev-hq/continuous.js
+++ b/docs/dev-hq/continuous.js
@@ -3,11 +3,14 @@
   window.createHQContinuous = function ({ container, api, project }) {
     const card = document.createElement('section');
     card.className = 'live-card continuous-card';
+    card.id = 'hq-goals-live';
+    card.tabIndex = -1;
     card.innerHTML = `
       <h2>Ziele & kontinuierliche Entwicklung</h2>
       <p data-state role="status" aria-live="polite">Projekt auswählen.</p>
       <p data-runtime role="status" aria-live="polite" class="muted">Runtime-Identität wird geprüft.</p>
       <p data-source class="muted"></p>
+      <div data-ownership class="continuous-ownership" aria-label="Besetzung laufender Ziele"></div>
       <section data-budget><h2>Budget & Routing</h2></section>
       <p class="muted">Diese Steuerung betrifft die HQ-Planung. Bestehende Worker und der bisherige Dispatcher laufen unabhängig weiter. Automatisches Starten und Ausliefern sind noch nicht freigegeben.</p>
       <div class="continuous-actions">
@@ -44,6 +47,7 @@
     const budgetList = card.querySelector('[data-budget]');
     const errorBox = card.querySelector('[data-error]');
     const list = card.querySelector('[data-goals]');
+    const ownership = card.querySelector('[data-ownership]');
     const runsList = card.querySelector('[data-runs]');
     const select = card.querySelector('[name=goalId]');
     let sequence = 0;
@@ -51,6 +55,7 @@
     let online = false;
     let busy = false;
     let teams = [];
+    let lastSignature = null;
     function error(value) { errorBox.hidden = !value; errorBox.textContent = value?.message || ''; }
     function enable(available) {
       card.querySelectorAll('button').forEach(button => { button.disabled = !available || busy || button.dataset.locked === 'true'; });
@@ -75,11 +80,74 @@
         return 'Routingbeleg unlesbar; kein Modell oder Preis wird angenommen.';
       }
     }
+    function renderOwnership(goals, tasks) {
+      ownership.replaceChildren();
+      const closed = new Set(['closed', 'completed', 'done', 'cancelled']);
+      const running = goals.filter(goal => !closed.has(String(goal.status || '').toLowerCase()));
+      if (!running.length) { text(ownership, 'p', 'Keine laufenden Ziele.', 'muted'); return; }
+      for (const goal of running) {
+        const ownTasks = tasks.filter(task => task.goalId === goal.id);
+        const owners = [...new Set(ownTasks.map(task => task.claim?.owner || task.assignment?.assignee).filter(Boolean))];
+        const seats = [...new Set(ownTasks.map(task => task.assignment ? `${task.assignment.teamId}/${task.assignment.role}` : null).filter(Boolean))];
+        const paths = [...new Set(ownTasks.flatMap(task => task.ownedPaths || []))];
+        const line = document.createElement('p');
+        line.className = 'continuous-ownership-line';
+        line.textContent = `${goal.status || 'unbekannt'} · ${goal.objective} · ${ownTasks.length} Arbeitspakete`
+          + ` · ${owners.length ? `Besetzt: ${owners.join(', ')}` : 'unbesetzt'}`
+          + `${seats.length ? ` · ${seats.join(', ')}` : ''}`
+          + `${paths.length ? ` · Bereiche: ${paths.join(', ')}` : ''}`;
+        ownership.append(line);
+      }
+    }
+    // The 5 s tick must not throw the operator out of the card: capture the
+    // interactive state before a rebuild, hand it back afterwards.
+    function captureListState() {
+      const openTasks = new Set([...list.querySelectorAll('details[data-task-id][open]')].map(node => node.dataset.taskId));
+      const drafts = new Map();
+      for (const form of list.querySelectorAll('form.continuous-assignment')) {
+        const draft = {};
+        const assignee = form.elements.assignee;
+        if (assignee && assignee.value !== assignee.defaultValue) draft.assignee = assignee.value;
+        for (const name of ['teamId', 'role']) {
+          const field = form.elements[name];
+          if (field && [...field.options].some(option => option.selected !== option.defaultSelected)) draft[name] = field.value;
+        }
+        if (Object.keys(draft).length) drafts.set(form.dataset.taskId, draft);
+      }
+      const active = document.activeElement;
+      let focus = null;
+      if (active && list.contains(active)) {
+        const host = active.closest('details[data-task-id]');
+        const part = active.name || (active.tagName === 'BUTTON' ? 'submit' : active.tagName.toLowerCase());
+        focus = { taskId: host?.dataset.taskId || null, part };
+      }
+      return { openTasks, drafts, focus };
+    }
+    function restoreListState(saved) {
+      for (const node of list.querySelectorAll('details[data-task-id]')) {
+        if (saved.openTasks.has(node.dataset.taskId)) node.open = true;
+      }
+      for (const form of list.querySelectorAll('form.continuous-assignment')) {
+        const draft = saved.drafts.get(form.dataset.taskId);
+        if (!draft) continue;
+        for (const [name, value] of Object.entries(draft)) {
+          const field = form.elements[name];
+          if (field) field.value = value;
+        }
+      }
+      if (saved.focus?.taskId) {
+        const host = list.querySelector(`details[data-task-id="${saved.focus.taskId}"]`);
+        const target = host?.querySelector(`[name="${saved.focus.part}"]`)
+          || (saved.focus.part === 'summary' ? host?.querySelector('summary') : null)
+          || (saved.focus.part === 'submit' ? host?.querySelector('button[type="submit"]') : null);
+        target?.focus();
+      }
+    }
     async function refresh() {
       const current = project();
       const generation = ++sequence;
       online = false; enable(false);
-      if (current !== loadedProject) { list.replaceChildren(); select.replaceChildren(); loadedProject = null; }
+      if (current !== loadedProject) { list.replaceChildren(); select.replaceChildren(); ownership.replaceChildren(); loadedProject = null; lastSignature = null; }
       if (!current) { state.textContent = 'Projekt auswählen, um Ziele und Arbeitspakete zu sehen.'; source.textContent = ''; enable(false); return; }
       try {
         const [value, runtimeValue, records] = await Promise.all([
@@ -105,9 +173,15 @@
         state.textContent = `Zustand: ${control.status || 'unbekannt'} · ${goals.length} Ziele · ${tasks.length} Arbeitspakete`;
         source.textContent = `Quelle: Rust/SQLite · ${snapshot.sourceTimestamp || value.observedAt || 'Zeitpunkt unbekannt'} · Cursor ${value.cursor ?? 'unbekannt'}. ${snapshot.commit ? `Commit ${snapshot.commit}` : 'Commit nicht gemessen.'}`;
         error(null);
+        const signature = JSON.stringify({ goals, tasks, teams, controlStatus: control.status || null });
+        const rebuildGoals = signature !== lastSignature;
+        const saved = rebuildGoals ? captureListState() : null;
         const previous = select.value;
-        select.replaceChildren();
-        list.replaceChildren();
+        if (rebuildGoals) {
+          select.replaceChildren();
+          list.replaceChildren();
+          renderOwnership(goals, tasks);
+        }
         budgetList.replaceChildren();
         text(budgetList, 'h2', 'Budget & Routing');
         const policies = Array.isArray(effectiveLimits.rootPolicies) ? effectiveLimits.rootPolicies : [];
@@ -130,7 +204,7 @@
         }
         runsList.replaceChildren();
         text(runsList, 'h2', 'Runs, Evidenz & Lieferung');
-        for (const goal of goals) {
+        if (rebuildGoals) for (const goal of goals) {
           const option = document.createElement('option'); option.value = goal.id; option.textContent = goal.objective; select.append(option);
           const section = document.createElement('article'); section.className = 'continuous-goal'; list.append(section);
           text(section, 'h3', goal.objective);
@@ -140,6 +214,7 @@
           if (!ownTasks.length) text(section, 'p', 'Noch keine Arbeitspakete.', 'muted');
           for (const task of ownTasks) {
             const details = document.createElement('details'); section.append(details);
+            details.dataset.taskId = task.id;
             text(details, 'summary', `${task.status} · ${task.objective}`);
             text(details, 'p', `ID ${task.id} · Profil ${task.profileId || 'nicht zugewiesen'} · Versuche ${task.attempts ?? 0}`);
             text(details, 'p', `Bereiche: ${(task.ownedPaths || []).join(', ') || 'keine'} · Abhängigkeiten: ${(task.dependencies || []).join(', ') || 'keine'}`);
@@ -147,6 +222,7 @@
             if (task.assignment) text(details, 'p', `Team ${task.assignment.teamId} · Rolle ${task.assignment.role} · ${task.assignment.assignee} · Revision ${task.assignment.revision}`, 'muted');
             const assignmentForm = document.createElement('form');
             assignmentForm.className = 'continuous-assignment';
+            assignmentForm.dataset.taskId = task.id;
             const teamLabel = document.createElement('label'); teamLabel.textContent = 'Team';
             const teamSelect = document.createElement('select'); teamSelect.name = 'teamId'; teamSelect.required = true;
             const roleLabel = document.createElement('label'); roleLabel.textContent = 'Rolle';
@@ -183,8 +259,12 @@
             if (task.detail || task.checkpoint) text(details, 'pre', task.detail || task.checkpoint);
           }
         }
-        if ([...select.options].some(option => option.value === previous)) select.value = previous;
-        if (!goals.length) text(list, 'p', 'Noch keine Ziele. Ein Ziel beschreibt Ergebnis und überprüfbare Abnahme.', 'muted');
+        if (rebuildGoals) {
+          if ([...select.options].some(option => option.value === previous)) select.value = previous;
+          if (!goals.length) text(list, 'p', 'Noch keine Ziele. Ein Ziel beschreibt Ergebnis und überprüfbare Abnahme.', 'muted');
+          restoreListState(saved);
+          lastSignature = signature;
+        }
         if (!records) {
           text(runsList, 'p', 'Run- und Lieferstatus nicht verfügbar; keine Evidenz wird angenommen.', 'muted');
         } else if (!Array.isArray(records.runs) || !records.runs.length) {
diff --git a/docs/dev-hq/hq.js b/docs/dev-hq/hq.js
index 3548323..5ed24a3 100644
--- a/docs/dev-hq/hq.js
+++ b/docs/dev-hq/hq.js
@@ -270,7 +270,7 @@
         </div>
       </div>
       <div id="live-error" class="live-error" role="alert" hidden></div>
-      <div id="live-keys-help" class="keys-help" lang="en" hidden><b>Keys</b> <kbd>/</kbd> search memory · <kbd>f</kbd> filter fleet · <kbd>r</kbd> refresh · <kbd>?</kbd> this help · <kbd>Esc</kbd> close panels <label class="keys-toggle"><input type="checkbox" id="live-keys-enabled"> single-key shortcuts on</label></div>
+      <div id="live-keys-help" class="keys-help" lang="en" hidden><b>Keys</b> <kbd>/</kbd> search memory · <kbd>f</kbd> filter fleet · <kbd>g</kbd> goals &amp; teams · <kbd>r</kbd> refresh · <kbd>?</kbd> this help · <kbd>Esc</kbd> close panels <label class="keys-toggle"><input type="checkbox" id="live-keys-enabled"> single-key shortcuts on</label></div>
 
       ${section("01", "What matters now", "Ranked from the live fleet, capacity, questions, the lesson memory and the repository.", '<ol id="live-signals" class="signals" tabindex="0" aria-label="What matters now"><li class="muted">Reading the desk…</li></ol>', "live-signals-section", "paper")}
 
@@ -1029,6 +1029,7 @@
       if (typing || event.metaKey || event.ctrlKey || event.altKey || !keysToggle.checked) return;
       if (event.key === "/") { event.preventDefault(); workspace.reveal("#lesson-query"); el.querySelector("#lesson-query").focus(); }
       else if (event.key === "f") { event.preventDefault(); workspace.reveal("#live-fleet-filter"); el.querySelector("#live-fleet-filter").focus(); }
+      else if (event.key === "g") { event.preventDefault(); const goalsCard = el.querySelector("#hq-goals-live"); if (goalsCard) { workspace.reveal(goalsCard); goalsCard.focus(); } }
       else if (event.key === "r") { event.preventDefault(); refresh(); }
       else if (event.key === "?") { event.preventDefault(); keysHelp.hidden = !keysHelp.hidden; }
     });
diff --git a/scripts/hq-live.mjs b/scripts/hq-live.mjs
index b930949..85537da 100644
--- a/scripts/hq-live.mjs
+++ b/scripts/hq-live.mjs
@@ -289,7 +289,7 @@ function repositoryInsights() {
   if (Date.now() - insightsCache.at < 60000 && insightsCache.value) return insightsCache.value;
   const timestamps = tryGit(["log", "--format=%at"]).split(/\r?\n/).filter(Boolean).map(Number);
   const git = workSessions(timestamps);
-  const activityPath = join(root, ".pa", "ACTIVITY.md");
+  const activityPath = process.env.HQ_ACTIVITY_FILE || join(root, ".pa", "ACTIVITY.md");
   const activity = existsSync(activityPath) ? activitySessions(readFileSync(activityPath, "utf8")) : [];
   const volume = diffVolume(tryGit(["log", "--numstat", "--format="]));
   insightsCache = { at: Date.now(), value: { timestamps, git, activity, volume, heat: heatmap(timestamps) } };
diff --git a/scripts/lib/hq-goals-live.test.mjs b/scripts/lib/hq-goals-live.test.mjs
new file mode 100644
index 0000000..44fd059
--- /dev/null
+++ b/scripts/lib/hq-goals-live.test.mjs
@@ -0,0 +1,140 @@
+// scripts/lib/hq-goals-live.test.mjs — W2-10a: the goals/teams card must be a
+// real live view: a compact ownership summary per running goal, and a 5 s
+// refresh that never throws the operator out of the UI (focus, open details
+// and unsaved assignment drafts survive unchanged data), plus a keyboard
+// shortcut that jumps to the card.
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import { readFileSync } from 'node:fs';
+import { JSDOM } from 'jsdom';
+
+const source = (path) => readFileSync(path, 'utf8');
+
+const CONTEXT = {
+  cursor: 7,
+  snapshot: {
+    sourceTimestamp: '2026-09-25T10:00:00Z',
+    commit: 'abc1234',
+    control: { status: 'paused' },
+    goals: [
+      { id: 'goal-1', projectId: 'p1', objective: 'Ship live goals view', acceptanceCriteria: 'Tests pass', status: 'open' },
+      { id: 'goal-2', projectId: 'p1', objective: 'Closed paperwork', acceptanceCriteria: 'Done', status: 'closed' },
+    ],
+    tasks: [
+      {
+        id: 'task-1', goalId: 'goal-1', objective: 'Render ownership', profileId: 'codex',
+        status: 'running', attempts: 1, ownedPaths: ['docs/dev-hq/continuous.js'], dependencies: [],
+        claim: { owner: 'worker-1', fence: 3 },
+        assignment: { teamId: 'development', role: 'implementer', assignee: 'worker-1', revision: 2 },
+      },
+      {
+        id: 'task-2', goalId: 'goal-1', objective: 'Review the view', profileId: 'kimi',
+        status: 'open', attempts: 0, ownedPaths: [], dependencies: ['task-1'],
+      },
+    ],
+    effectiveLimits: {
+      rootPolicies: [{ policy: { teams: [{ id: 'development', roles: ['implementer', 'reviewer'] }] } }],
+    },
+  },
+};
+
+function continuousFixture(api) {
+  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' });
+  dom.window.eval(source('docs/dev-hq/continuous.js'));
+  const controller = dom.window.createHQContinuous({
+    container: dom.window.document.querySelector('main'),
+    api,
+    project: () => 'p1',
+  });
+  return { dom, controller, document: dom.window.document, window: dom.window };
+}
+
+test('ownership summary lists claim, team assignment and owned paths per running goal', async (t) => {
+  const f = continuousFixture(async () => CONTEXT);
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const ownership = f.document.querySelector('[data-ownership]');
+  assert.ok(ownership, 'goals card exposes a [data-ownership] summary region');
+  const text = ownership.textContent;
+  assert.match(text, /Ship live goals view/);
+  assert.match(text, /worker-1/, 'claim owner is visible');
+  assert.match(text, /development/, 'team is visible');
+  assert.match(text, /implementer/, 'role is visible');
+  assert.match(text, /docs\/dev-hq\/continuous\.js/, 'owned path is visible');
+  assert.doesNotMatch(text, /Closed paperwork/, 'closed goals stay out of the running summary');
+  assert.equal(ownership.querySelector('img'), null, 'summary text is inert');
+});
+
+test('refresh with unchanged data preserves open details, focus and form drafts', async (t) => {
+  const f = continuousFixture(async () => CONTEXT);
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const details = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Render ownership'));
+  assert.ok(details, 'task details rendered');
+  details.open = true;
+  const assignee = details.querySelector('input[name=assignee]');
+  assignee.value = 'worker-9';
+  assignee.focus();
+  assert.equal(f.document.activeElement, assignee);
+  await f.controller.refresh();
+  const again = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Render ownership'));
+  assert.ok(again.open, 'open details stay open across a no-change refresh');
+  const assigneeAgain = again.querySelector('input[name=assignee]');
+  assert.equal(assigneeAgain.value, 'worker-9', 'unsaved assignment draft survives');
+  assert.equal(f.document.activeElement, assigneeAgain, 'focus stays on the drafted field');
+});
+
+test('changed-data rebuild restores focus to a submit button', async (t) => {
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
+    .find((node) => node.textContent.includes('Review the view'));
+  details.open = true;
+  const submit = details.querySelector('button[type=submit]');
+  assert.equal(submit.disabled, false, 'unlocked task has an enabled submit button');
+  submit.focus();
+  assert.equal(f.document.activeElement, submit);
+  attempts = 1; // changed data forces a rebuild
+  await f.controller.refresh();
+  const again = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Review the view'));
+  assert.ok(again.open, 'open details stay open across a changed-data rebuild');
+  assert.equal(f.document.activeElement, again.querySelector('button[type=submit]'), 'submit button focus is restored');
+});
+
+function liveFixture() {
+  const dom = new JSDOM(source('docs/dev-hq/live.html'), { url: 'http://localhost/live.html', runScripts: 'outside-only' });
+  const { window } = dom;
+  window.HQ_DATA = JSON.parse(source('docs/dev-hq/data.json'));
+  window.fetch = () => new Promise(() => {});
+  window.matchMedia = () => ({ matches: true });
+  window.HTMLElement.prototype.scrollIntoView = function () {};
+  window.eval(source('docs/dev-hq/workspace.js'));
+  window.eval(source('docs/dev-hq/continuous.js'));
+  window.eval(source('docs/dev-hq/hq.js'));
+  return { dom, window, document: window.document };
+}
+
+test('g key reveals and focuses the goals and teams card', async (t) => {
+  const f = liveFixture();
+  t.after(() => f.dom.window.close());
+  const { document: d } = f;
+  assert.equal(d.querySelector('#panel-teams').hidden, true, 'teams panel starts hidden on the overview tab');
+  assert.equal(d.querySelector('#live-keys-enabled').checked, true, 'single-key shortcuts default to on (the g flow depends on it)');
+  d.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'g', bubbles: true }));
+  const card = d.querySelector('#hq-goals-live');
+  assert.ok(card, 'goals/teams card carries the stable id hq-goals-live');
+  assert.equal(d.querySelector('#panel-teams').hidden, false, 'teams panel is revealed');
+  assert.equal(d.activeElement, card, 'keyboard focus lands on the card');
+  assert.match(d.querySelector('#live-keys-help').innerHTML, /<kbd>g<\/kbd>/, 'keys help documents g');
+});
diff --git a/scripts/lib/hq-routes.test.mjs b/scripts/lib/hq-routes.test.mjs
index 0310382..7dd46e8 100644
--- a/scripts/lib/hq-routes.test.mjs
+++ b/scripts/lib/hq-routes.test.mjs
@@ -53,6 +53,12 @@ function spawnHq(dir, extraEnv = {}) {
         PROJECTA_API_DESCRIPTOR: join(dir, "descriptor.json"),
         PROJECTA_AGENTS_FILE: join(dir, "agents.json"),
         HQ_LESSONS_FILE: join(dir, "lessons.json"),
+        // The insights estimate reads the agent journal `.pa/ACTIVITY.md`,
+        // which is deliberately untracked (instance-local append log). Point
+        // it into the temp dir (no fixture written: journal stays empty) so
+        // a host journal can never leak into a test — hermetic instead of
+        // host state.
+        HQ_ACTIVITY_FILE: join(dir, "ACTIVITY.md"),
       },
       stdio: ["ignore", "pipe", "pipe"],
     });
diff --git a/scripts/lib/hq-visual.browser.mjs b/scripts/lib/hq-visual.browser.mjs
index ab9a2d0..408b7f6 100644
--- a/scripts/lib/hq-visual.browser.mjs
+++ b/scripts/lib/hq-visual.browser.mjs
@@ -32,7 +32,9 @@ function startMockApi() {
     "/api/hq/v1/context": { cursor: 1, snapshot: { sourceTimestamp: "2026-09-10T12:00:00Z", commit: null,
       control: { status: "paused" }, goals: [{ id: "goal-1", projectId: "pj-1", objective: "Verify continuous development", acceptanceCriteria: "Claims and restart tests pass", status: "open" }],
       effectiveLimits: { rootPolicies: [{ policy: { teams: [{ id: "development", roles: ["coordinator", "implementer", "reviewer", "integrator"] }] } }] },
-      tasks: [{ id: "task-1", goalId: "goal-1", objective: "Check ownership", profileId: "codex", status: "pending", attempts: 0, ownedPaths: ["src-tauri/src/queue.rs"], dependencies: [] }] } },
+      tasks: [{ id: "task-1", goalId: "goal-1", objective: "Check ownership", profileId: "codex", status: "pending", attempts: 0, ownedPaths: ["src-tauri/src/queue.rs"], dependencies: [],
+        claim: { owner: "worker-1", fence: 2 },
+        assignment: { teamId: "development", role: "implementer", assignee: "worker-1", revision: 1 } }] } },
     "/api/hq/v1/runs": { executionEnabled: false, approvalAuthority: { state: "unavailable" }, runs: [] },
     "/api/projects": [{ id: "pj-1", name: "ProjectA" }],
     "/api/board": [
@@ -235,6 +237,30 @@ test("continuous goals use the selected project and show blocked runtime honestl
   await page.close();
 });
 
+test("goals live view renders ownership and the g key jumps to the card", async () => {
+  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
+  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
+  await page.waitForSelector('.live-status.ok', { timeout: 20000 });
+  await page.selectOption('#live-project', 'pj-1');
+  await page.waitForFunction(() => document.querySelector('[data-ownership]')?.textContent.includes('Verify continuous development'), { timeout: 10000 });
+  const ownership = await page.textContent('[data-ownership]');
+  assert.match(ownership, /Besetzt: worker-1/);
+  assert.match(ownership, /development\/implementer/);
+  assert.match(ownership, /src-tauri\/src\/queue\.rs/);
+  await page.click('#tab-teams');
+  await page.locator('#hq-goals-live').scrollIntoViewIfNeeded();
+  await page.locator('#hq-goals-live').screenshot({ path: join(shotDir, 'goals-teams-ownership.png') });
+  // Keyboard flow: from another tab, with focus outside any typing context,
+  // g reveals the teams panel and focuses the goals/teams card.
+  await page.click('#tab-overview');
+  await page.evaluate(() => document.activeElement?.blur());
+  await page.keyboard.press('g');
+  await page.waitForSelector('#panel-teams:not([hidden])', { timeout: 5000 });
+  assert.equal(await page.evaluate(() => document.activeElement?.id), 'hq-goals-live');
+  await page.screenshot({ path: join(shotDir, 'goals-teams-keyboard-g.png'), fullPage: false });
+  await page.close();
+});
+
 test("worker detail opens on click, shows messages, sends a reply", async () => {
   const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
   await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
```
