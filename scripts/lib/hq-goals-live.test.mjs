// scripts/lib/hq-goals-live.test.mjs — W2-10a: the goals/teams card must be a
// real live view: a compact ownership summary per running goal, and a 5 s
// refresh that never throws the operator out of the UI (focus, open details
// and unsaved assignment drafts survive unchanged data), plus a keyboard
// shortcut that jumps to the card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = (path) => readFileSync(path, 'utf8');

const CONTEXT = {
  cursor: 7,
  snapshot: {
    sourceTimestamp: '2026-09-25T10:00:00Z',
    commit: 'abc1234',
    control: { status: 'paused' },
    goals: [
      { id: 'goal-1', projectId: 'p1', objective: 'Ship live goals view', acceptanceCriteria: 'Tests pass', status: 'open' },
      { id: 'goal-2', projectId: 'p1', objective: 'Closed paperwork', acceptanceCriteria: 'Done', status: 'closed' },
    ],
    tasks: [
      {
        id: 'task-1', goalId: 'goal-1', objective: 'Render ownership', profileId: 'codex',
        status: 'running', attempts: 1, ownedPaths: ['docs/dev-hq/continuous.js'], dependencies: [],
        claim: { owner: 'worker-1', fence: 3 },
        assignment: { teamId: 'development', role: 'implementer', assignee: 'worker-1', revision: 2 },
      },
      {
        id: 'task-2', goalId: 'goal-1', objective: 'Review the view', profileId: 'kimi',
        status: 'open', attempts: 0, ownedPaths: [], dependencies: ['task-1'],
      },
    ],
    effectiveLimits: {
      rootPolicies: [{ policy: { teams: [{ id: 'development', roles: ['implementer', 'reviewer'] }] } }],
    },
  },
};

function continuousFixture(api) {
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' });
  dom.window.eval(source('docs/dev-hq/continuous.js'));
  const controller = dom.window.createHQContinuous({
    container: dom.window.document.querySelector('main'),
    api,
    project: () => 'p1',
  });
  return { dom, controller, document: dom.window.document, window: dom.window };
}

test('ownership summary lists claim, team assignment and owned paths per running goal', async (t) => {
  const f = continuousFixture(async () => CONTEXT);
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const ownership = f.document.querySelector('[data-ownership]');
  assert.ok(ownership, 'goals card exposes a [data-ownership] summary region');
  const text = ownership.textContent;
  assert.match(text, /Ship live goals view/);
  assert.match(text, /worker-1/, 'claim owner is visible');
  assert.match(text, /development/, 'team is visible');
  assert.match(text, /implementer/, 'role is visible');
  assert.match(text, /docs\/dev-hq\/continuous\.js/, 'owned path is visible');
  assert.doesNotMatch(text, /Closed paperwork/, 'closed goals stay out of the running summary');
  assert.equal(ownership.querySelector('img'), null, 'summary text is inert');
});

test('refresh with unchanged data preserves open details, focus and form drafts', async (t) => {
  const f = continuousFixture(async () => CONTEXT);
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const details = [...f.document.querySelectorAll('[data-goals] details')]
    .find((node) => node.textContent.includes('Render ownership'));
  assert.ok(details, 'task details rendered');
  details.open = true;
  const assignee = details.querySelector('input[name=assignee]');
  assignee.value = 'worker-9';
  assignee.focus();
  assert.equal(f.document.activeElement, assignee);
  await f.controller.refresh();
  const again = [...f.document.querySelectorAll('[data-goals] details')]
    .find((node) => node.textContent.includes('Render ownership'));
  assert.ok(again.open, 'open details stay open across a no-change refresh');
  const assigneeAgain = again.querySelector('input[name=assignee]');
  assert.equal(assigneeAgain.value, 'worker-9', 'unsaved assignment draft survives');
  assert.equal(f.document.activeElement, assigneeAgain, 'focus stays on the drafted field');
});

test('changed-data rebuild restores focus to a submit button', async (t) => {
  let attempts = 0;
  const f = continuousFixture(async () => ({
    ...CONTEXT,
    snapshot: {
      ...CONTEXT.snapshot,
      tasks: CONTEXT.snapshot.tasks.map((task) => task.id === 'task-2' ? { ...task, attempts } : task),
    },
  }));
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const details = [...f.document.querySelectorAll('[data-goals] details')]
    .find((node) => node.textContent.includes('Review the view'));
  details.open = true;
  const submit = details.querySelector('button[type=submit]');
  assert.equal(submit.disabled, false, 'unlocked task has an enabled submit button');
  submit.focus();
  assert.equal(f.document.activeElement, submit);
  attempts = 1; // changed data forces a rebuild
  await f.controller.refresh();
  const again = [...f.document.querySelectorAll('[data-goals] details')]
    .find((node) => node.textContent.includes('Review the view'));
  assert.ok(again.open, 'open details stay open across a changed-data rebuild');
  assert.equal(f.document.activeElement, again.querySelector('button[type=submit]'), 'submit button focus is restored');
});

function liveFixture() {
  const dom = new JSDOM(source('docs/dev-hq/live.html'), { url: 'http://localhost/live.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.HQ_DATA = JSON.parse(source('docs/dev-hq/data.json'));
  window.fetch = () => new Promise(() => {});
  window.matchMedia = () => ({ matches: true });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.eval(source('docs/dev-hq/workspace.js'));
  window.eval(source('docs/dev-hq/continuous.js'));
  window.eval(source('docs/dev-hq/hq.js'));
  return { dom, window, document: window.document };
}

test('g key reveals and focuses the goals and teams card', async (t) => {
  const f = liveFixture();
  t.after(() => f.dom.window.close());
  const { document: d } = f;
  assert.equal(d.querySelector('#panel-teams').hidden, true, 'teams panel starts hidden on the overview tab');
  assert.equal(d.querySelector('#live-keys-enabled').checked, true, 'single-key shortcuts default to on (the g flow depends on it)');
  d.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'g', bubbles: true }));
  const card = d.querySelector('#hq-goals-live');
  assert.ok(card, 'goals/teams card carries the stable id hq-goals-live');
  assert.equal(d.querySelector('#panel-teams').hidden, false, 'teams panel is revealed');
  assert.equal(d.activeElement, card, 'keyboard focus lands on the card');
  assert.match(d.querySelector('#live-keys-help').innerHTML, /<kbd>g<\/kbd>/, 'keys help documents g');
});
