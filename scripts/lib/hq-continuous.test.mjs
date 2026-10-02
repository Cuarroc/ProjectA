import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runSetupChecks } from './hq-setup.mjs';

function fixture(api, initial = 'p1') {
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' });
  dom.window.eval(readFileSync('docs/dev-hq/continuous.js', 'utf8'));
  let project = initial;
  const controller = dom.window.createHQContinuous({ container: dom.window.document.querySelector('main'), api, project: () => project });
  return { dom, controller, setProject: value => { project = value; }, document: dom.window.document };
}

test('HQ setup rejects Node 22 because the repository requires Node 24', () => {
  assert.equal(runSetupChecks({ nodeVersion: 'v22.22.2' }).checks.find(x => x.id === 'node').state, 'fail');
  assert.equal(runSetupChecks({ nodeVersion: 'v24.0.0' }).checks.find(x => x.id === 'node').state, 'ok');
});

test('goal text is inert and offline refresh disables actions while preserving labelled stale data', async t => {
  let offline = false;
  const f = fixture(async () => {
    if (offline) throw new Error('offline');
    return { cursor: 3, snapshot: { sourceTimestamp: 'now', control: { status: 'paused' }, goals: [
      { id: 'g1', objective: '<img src=x onerror=alert(1)>', status: 'open', acceptanceCriteria: 'Tests pass' },
    ], tasks: [] } };
  }); t.after(() => f.dom.window.close());
  await f.controller.refresh();
  assert.equal(f.document.querySelector('img'), null);
  assert.match(f.document.querySelector('[data-goals]').textContent, /<img/);
  offline = true; await f.controller.refresh();
  assert.match(f.document.querySelector('[data-state]').textContent, /keine aktuellen/);
  assert.ok([...f.document.querySelectorAll('button')].every(x => x.disabled));
});

test('an old project response cannot overwrite the selected project', async t => {
  let complete;
  const f = fixture(path => path.includes('/context?projectId=p1') ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ cursor: 2, snapshot: { goals: [], tasks: [], control: { status: 'paused' } } }));
  t.after(() => f.dom.window.close());
  const first = f.controller.refresh();
  assert.ok([...f.document.querySelectorAll('button')].every(x => x.disabled));
  f.setProject('p2'); await f.controller.refresh();
  complete({ cursor: 1, snapshot: { goals: [{ id: 'wrong', objective: 'WRONG PROJECT' }], tasks: [] } });
  await first;
  assert.doesNotMatch(f.document.querySelector('[data-goals]').textContent, /WRONG PROJECT/);
});

test('control action uses selected project and surfaces backend refusal', async t => {
  const calls = [];
  const f = fixture(async (path, options) => {
    calls.push({ path, options });
    if (options) throw new Error('runtime adapters not attested');
    return { snapshot: { goals: [], tasks: [], control: { status: 'paused' } } };
  }); t.after(() => f.dom.window.close());
  await f.controller.refresh();
  f.document.querySelector('[data-action=resume]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { projectId: 'p1', action: 'resume' });
  assert.match(f.document.querySelector('[data-error]').textContent, /not attested/);
});

test('continuous panel surfaces a runtime manifest mismatch as a hard warning', async t => {
  const f = fixture(async path => path.includes('/runtime')
    ? { apiVersion: 1, manifest: { state: 'mismatch' } }
    : { snapshot: { goals: [], tasks: [], control: { status: 'paused' } } });
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  assert.match(f.document.querySelector('[data-runtime]').textContent, /abweichend/);
  assert.match(f.document.querySelector('[data-runtime]').textContent, /Keine Provider-Fähigkeiten/);
});

test('team assignment form uses policy roles and optimistic revision', async t => {
  const calls = [];
  const context = {
    snapshot: {
      control: { status: 'paused' },
      effectiveLimits: { rootPolicies: [{ policy: { teams: [{ id: 'development', roles: ['implementer', 'reviewer'] }] } }] },
      goals: [{ id: 'g1', objective: 'Ship', status: 'open', acceptanceCriteria: 'Checks pass' }],
      tasks: [{ id: 't1', goalId: 'g1', objective: 'Implement', status: 'open', attempts: 0, ownedPaths: ['src/lib.ts'], dependencies: [] }],
    },
  };
  const f = fixture(async (path, options) => {
    calls.push({ path, options });
    return options ? { assignment: { revision: 1 } } : context;
  }); t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const form = f.document.querySelector('.continuous-assignment');
  assert.ok(form);
  assert.deepEqual([...form.elements.role.options].map(option => option.value), ['implementer', 'reviewer']);
  form.elements.assignee.value = 'worker-1';
  form.dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  const request = calls.find(call => call.options);
  assert.equal(request.path, '/api/hq/v1/tasks/t1/assignment');
  assert.deepEqual(JSON.parse(request.options.body), { teamId: 'development', role: 'implementer', assignee: 'worker-1', expectedRevision: 0 });
});

test('run panel keeps candidate, evidence and delivery authority explicit', async t => {
  const f = fixture(async path => {
    if (path.includes('/runtime')) return { apiVersion: 1, manifest: { state: 'matched' } };
    if (path.includes('/runs')) return {
      executionEnabled: false,
      approvalAuthority: { state: 'unavailable' },
      runs: [{ run: { id: 'run-1', taskId: 't1', status: 'reconciling', claimOwner: 'worker-1', claimFence: 2 }, launch: { routeJson: JSON.stringify({ selection: { resolved: { provider: 'ollama', profileId: 'ollama-local', resolvedModel: { measured: { value: 'qwen2.5-coder' } }, effort: { unavailable: { reason: 'no effort was requested' } } } }, executionObservation: { reason: 'execution unobserved' } }) }, tokens: { availableTokens: 1200, usageState: 'partial' }, candidate: null, evidence: [], reviews: [] }],
    };
    return { snapshot: { goals: [], tasks: [], control: { status: 'paused' } } };
  }); t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const panel = f.document.querySelector('[data-runs]');
  assert.match(panel.textContent, /reconciling/);
  assert.match(panel.textContent, /Candidate nicht gebunden/);
  assert.match(panel.textContent, /Routing ollama/);
  assert.match(panel.textContent, /execution unobserved/);
  assert.match(panel.textContent, /Ausführung deaktiviert/);
  assert.match(panel.textContent, /Budget 1200 verfügbar/);
  assert.match(panel.textContent, /Freigabeautorität: unavailable/);
});

test('review and delivery view shows open reviews, verdict validity and PR delivery state', async t => {
  const calls = [];
  const f = fixture(async path => {
    calls.push(path);
    if (path.includes('/runtime')) return { apiVersion: 1 };
    if (path.includes('/runs')) return {
      approvalAuthority: { state: 'unavailable' },
      executionEnabled: false,
      runs: [
        {
          run: { id: 'run-open', taskId: 't1', workerId: 'wk-1', status: 'completed' },
          candidate: { candidateCommit: 'abc123', source: 'worker-push' }, evidence: [], reviews: [],
        },
        {
          run: { id: 'run-approved', taskId: 't2', workerId: 'wk-2', status: 'completed' },
          candidate: { candidateCommit: 'def456', source: 'worker-push' }, evidence: [],
          reviews: [{ candidateCommit: 'def456', disposition: 'approved', status: 'valid', reviewerIdentity: 'codex:gpt', approvalEligible: false }],
        },
        {
          run: { id: 'run-rework', taskId: 't3', workerId: 'wk-3', status: 'completed' },
          candidate: { candidateCommit: '987fed', source: 'worker-push' }, evidence: [],
          reviews: [{ candidateCommit: '987fed', disposition: 'changes_requested', status: 'valid', reviewerIdentity: 'reviewer:glm', approvalEligible: false }],
        },
      ],
    };
    if (path.includes('/board')) return [
      { worker: { id: 'wk-1' }, column: 'in_review', testStatus: 'pass', prUrl: 'https://github.com/example/project/pull/7' },
      { worker: { id: 'wk-2' }, column: 'ready_to_merge', testStatus: 'pass', prUrl: 'https://github.com/example/project/pull/8' },
      { worker: { id: 'wk-3' }, column: 'working', testStatus: 'fail', prUrl: null },
    ];
    return { snapshot: { goals: [], tasks: [], control: { status: 'paused' } } };
  }); t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const panel = f.document.querySelector('#hq-review-delivery-live');
  assert.ok(panel, 'review/delivery has a stable live-view target');
  assert.match(panel.textContent, /Offene Reviews 1/);
  assert.match(panel.textContent, /run-open[\s\S]*Review offen/);
  assert.match(panel.textContent, /run-approved[\s\S]*Review gültig[\s\S]*nicht freigabeberechtigt/);
  assert.match(panel.textContent, /run-rework[\s\S]*Nacharbeit angefordert/);
  assert.match(panel.textContent, /ready_to_merge[\s\S]*Tests pass[\s\S]*pull\/8/);
  assert.match(panel.textContent, /PR nicht erfasst/);
  assert.equal(panel.querySelector('img'), null, 'runtime values remain inert text');
  assert.ok(calls.some(path => path.includes('/api/board') && path.includes('projectId=p1')),
    'delivery status comes from the existing HQ backend');
});

test('review view ignores reviews bound to an older candidate and labels a missing board', async t => {
  const f = fixture(async path => {
    if (path.includes('/runtime')) return { apiVersion: 1 };
    if (path.includes('/runs')) return {
      approvalAuthority: { state: 'unavailable' }, executionEnabled: false,
      runs: [{
        run: { id: 'run-stale', taskId: 't1', workerId: 'wk-1', status: 'completed' },
        candidate: { candidateCommit: 'new111', source: 'worker-push' }, evidence: [],
        reviews: [{ candidateCommit: 'old000', disposition: 'approved', status: 'valid', reviewerIdentity: 'codex:gpt', approvalEligible: true }],
      }],
    };
    if (path.includes('/board')) throw new Error('board down');
    return { snapshot: { goals: [], tasks: [], control: { status: 'paused' } } };
  }); t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const panel = f.document.querySelector('#hq-review-delivery-live');
  assert.match(panel.textContent, /Offene Reviews 1 · Nacharbeit 0 · Gültig 0/);
  assert.doesNotMatch(panel.textContent, /Review gültig/);
  assert.match(panel.textContent, /Delivery-\/PR-Stand nicht verfügbar/);
});

test('budget panel labels missing policy data without inventing routing capability', async t => {
  const f = fixture(async () => ({ snapshot: { goals: [], tasks: [], control: { status: 'paused' }, effectiveLimits: { rootPolicies: [] } } }));
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  assert.match(f.document.querySelector('[data-budget]').textContent, /nicht verfügbar/);
  assert.match(f.document.querySelector('[data-budget]').textContent, /keine Kosten- oder Modellfähigkeit/);
});
