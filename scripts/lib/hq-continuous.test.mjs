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

test('budget panel labels missing policy data without inventing routing capability', async t => {
  const f = fixture(async () => ({ snapshot: { goals: [], tasks: [], control: { status: 'paused' }, effectiveLimits: { rootPolicies: [] } } }));
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  assert.match(f.document.querySelector('[data-budget]').textContent, /nicht verfügbar/);
  assert.match(f.document.querySelector('[data-budget]').textContent, /keine Kosten- oder Modellfähigkeit/);
});
