// scripts/lib/hq-budget-live.test.mjs — W2-10b: the budget/routing section of
// the continuous card must be a real live view: a compact token-budget
// summary per root goal, policy routing and aggregated routing/usage receipts
// with provenance, a 5 s refresh that leaves the DOM alone while data is
// unchanged, and a keyboard shortcut that jumps to the section. Honest
// fallbacks only: nothing assumes a cost, model or balance that was not
// observed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = (path) => readFileSync(path, 'utf8');

// The route receipt uses the externally tagged Observation<T> shape the HQ
// v1 API really emits (src-tauri/src/development_policy.rs: enum Observation
// → {measured|configured|requested|estimated:{value}} or {unavailable:
// {reason}}). A fixture in the shorthand {value: ...} shape would pin a
// contract the API never sends.
const ROUTE_RECEIPT = JSON.stringify({
  selection: { resolved: { provider: 'kimi', profileId: 'kimi', resolvedModel: { measured: { value: 'kimi-k3' } }, effort: { requested: { value: 'high' } } } },
  executionObservation: { reason: 'exit 0 observed' },
});

const CONTEXT = {
  cursor: 7,
  snapshot: {
    sourceTimestamp: '2026-09-25T10:00:00Z',
    commit: 'abc1234',
    control: { status: 'paused' },
    goals: [
      { id: 'goal-1', projectId: 'p1', objective: 'Ship live budget view', acceptanceCriteria: 'Tests pass', status: 'open' },
    ],
    tasks: [
      {
        id: 'task-1', goalId: 'goal-1', objective: 'Render the budget', profileId: 'kimi',
        status: 'running', attempts: 1, ownedPaths: ['docs/dev-hq/continuous.js'], dependencies: [],
        claim: { owner: 'worker-1', fence: 3 },
        assignment: { teamId: 'development', role: 'implementer', assignee: 'worker-1', revision: 2 },
      },
    ],
    effectiveLimits: {
      rootPolicies: [{
        rootGoalId: 'root-1',
        source: 'projecta.dev.json',
        observedAt: 1758000000,
        policy: {
          teams: [{ id: 'development', roles: ['implementer', 'reviewer'] }],
          routing: { additionalPaidApi: false, quotaReservePercent: 20, billing: ['subscription', 'free', 'local'] },
          providers: ['claude', 'kimi'],
        },
        tokens: {
          allowance: { maxPerGoal: 200000, verificationReserve: 40000 },
          measuredTokens: 45000,
          reservedTokens: 10000,
          verificationRemaining: 40000,
          availableTokens: 145000,
          implementationAvailable: 105000,
          unresolvedOperations: 1,
          usageState: 'partial',
          exceeded: false,
          exhausted: false,
        },
      }],
    },
  },
};

const RUNS = {
  executionEnabled: false,
  approvalAuthority: { state: 'unavailable' },
  runs: [{
    run: { id: 'run-1', taskId: 'task-1', status: 'completed', claimOwner: 'worker-1', claimFence: 3 },
    candidate: { candidateCommit: 'def5678', source: 'worker-push' },
    launch: { routeJson: ROUTE_RECEIPT },
    evidence: [],
    reviews: [],
    tokens: { availableTokens: 145000, usageState: 'partial' },
    usage: {
      state: 'measured', tokens: 43210, reservation: 'settled',
      provenance: { collector: 'codex-exec-json-v1', measurement: 'live', source: 'process-owned stdout', sourceSha256: 'deadbeef', observedAt: 1758000100 },
    },
  }, {
    run: { id: 'run-2', taskId: 'task-1', status: 'failed', claimOwner: 'worker-2', claimFence: 1 },
    candidate: null,
    launch: { routeJson: '{broken json' },
    evidence: [],
    reviews: [],
    tokens: null,
    usage: { state: 'not_reported', reason: 'no trusted collector for provider kimi over transport headless_cli', reservation: 'retained', provenance: { collector: null, measurement: 'none', provider: 'kimi', transport: 'headless_cli' } },
  }],
};

function apiFor({ context = CONTEXT, runs = RUNS } = {}) {
  return async (path) => {
    if (path.startsWith('/api/hq/v1/context')) return context;
    if (path.startsWith('/api/hq/v1/runs')) return runs;
    if (path.startsWith('/api/hq/v1/runtime')) return { apiVersion: 1 };
    throw new Error(`unexpected api path ${path}`);
  };
}

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

test('budget summary shows limit, measured, reserved, available and verification guard per root policy', async (t) => {
  const f = continuousFixture(apiFor());
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const budget = f.document.querySelector('[data-budget]');
  assert.ok(budget, 'continuous card exposes a [data-budget] section');
  const text = budget.textContent;
  assert.match(text, /root-1/, 'root goal id is visible');
  assert.match(text, /200000/, 'allowance limit is visible');
  assert.match(text, /45000/, 'measured tokens are visible');
  assert.match(text, /10000/, 'reserved tokens are visible');
  assert.match(text, /145000/, 'available tokens are visible');
  assert.match(text, /105000/, 'implementation-available tokens are visible');
  assert.match(text, /40000/, 'verification guard is visible');
  assert.match(text, /teilweise belegt/, 'usage state is rendered as an honest label');
  assert.match(text, /1 offener Vorgang|1 offene/, 'unresolved operations are named');
  assert.equal(budget.querySelector('img'), null, 'budget text is inert');
});

test('budget flags exceeded and exhausted balances instead of hiding them', async (t) => {
  const blown = JSON.parse(JSON.stringify(CONTEXT));
  blown.snapshot.effectiveLimits.rootPolicies[0].tokens = {
    ...blown.snapshot.effectiveLimits.rootPolicies[0].tokens,
    measuredTokens: 250000, availableTokens: 0, implementationAvailable: 0,
    usageState: 'measured', exceeded: true, exhausted: true,
  };
  const f = continuousFixture(apiFor({ context: blown }));
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const text = f.document.querySelector('[data-budget]').textContent;
  assert.match(text, /[Üü]berschritten/, 'exceeded balance is flagged');
  assert.match(text, /erschöpft/, 'exhausted balance is flagged');
});

test('missing policies or balances produce honest fallbacks, never assumed costs', async (t) => {
  const empty = JSON.parse(JSON.stringify(CONTEXT));
  empty.snapshot.effectiveLimits.rootPolicies = [];
  const f = continuousFixture(apiFor({ context: empty }));
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  assert.match(
    f.document.querySelector('[data-budget]').textContent,
    /nicht verfügbar/,
    'absent policies state that no budget is assumed',
  );

  const noTokens = JSON.parse(JSON.stringify(CONTEXT));
  delete noTokens.snapshot.effectiveLimits.rootPolicies[0].tokens;
  const g = continuousFixture(apiFor({ context: noTokens }));
  t.after(() => g.dom.window.close());
  await g.controller.refresh();
  const text = g.document.querySelector('[data-budget]').textContent;
  assert.match(text, /nicht verfügbar/, 'absent balance is named');
  assert.doesNotMatch(text, /145000/, 'no balance is invented');
});

test('routing overview shows policy billing, quota reserve and aggregated receipts', async (t) => {
  const f = continuousFixture(apiFor());
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const routing = f.document.querySelector('[data-budget] [data-routing]');
  assert.ok(routing, 'budget section carries a [data-routing] region');
  const text = routing.textContent;
  assert.match(text, /subscription/, 'allowed billing sources are visible');
  assert.match(text, /20 ?%/, 'quota reserve percent is visible');
  assert.match(text, /kimi/, 'resolved provider is visible');
  assert.match(text, /kimi-k3/, 'resolved model is visible');
  assert.match(text, /high/, 'resolved effort is visible');
  assert.match(text, /exit 0 observed/, 'execution observation is visible');
  assert.match(text, /unlesbar/, 'the broken receipt is named as unreadable, not guessed');
});

test('usage receipts show provenance; missing receipts name their reason', async (t) => {
  const f = continuousFixture(apiFor());
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const text = f.document.querySelector('[data-budget]').textContent;
  assert.match(text, /43210/, 'measured receipt tokens are visible');
  assert.match(text, /codex-exec-json-v1/, 'collector provenance is visible');
  assert.match(text, /no trusted collector/, 'a missing receipt names its reason');
});

test('the reservation-kept suffix appears only where the reservation is really held', async (t) => {
  const runs = JSON.parse(JSON.stringify(RUNS));
  runs.runs = [
    { run: { id: 'run-free', taskId: 'task-1', status: 'completed' }, launch: null, usage: { state: 'not_reserved', reason: 'run holds no implementation token reservation' } },
    { run: { id: 'run-cancelled', taskId: 'task-1', status: 'cancelled' }, launch: null, usage: { state: 'cancelled', reason: 'reservation cancelled before work started' } },
    { run: { id: 'run-unclassified', taskId: 'task-1', status: 'completed' }, launch: null, usage: { state: 'unclassified', reason: 'settled ledger row lacks its tokens or source' } },
    { run: { id: 'run-held', taskId: 'task-1', status: 'failed' }, launch: null, usage: { state: 'not_reported', reason: 'no trusted collector', reservation: 'retained' } },
  ];
  const f = continuousFixture(apiFor({ runs }));
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const lines = [...f.document.querySelectorAll('[data-budget] p')].map((p) => p.textContent);
  const line = (id) => lines.find((l) => l.includes(id)) || '';
  assert.doesNotMatch(line('run-free'), /Reservierung bleibt bestehen/, 'a run without a reservation must not claim one remains');
  assert.doesNotMatch(line('run-cancelled'), /Reservierung bleibt bestehen/, 'a cancelled reservation does not remain');
  assert.doesNotMatch(line('run-unclassified'), /Reservierung bleibt bestehen/, 'a settled reservation is no longer held');
  assert.match(line('run-held'), /Reservierung bleibt bestehen/, 'a retained reservation keeps the suffix');
});

test('a failed runs fetch is named as unavailable, never as an empty receipt list', async (t) => {
  const f = continuousFixture(async (path) => {
    if (path.startsWith('/api/hq/v1/context')) return CONTEXT;
    if (path.startsWith('/api/hq/v1/runs')) throw new Error('runs endpoint down');
    if (path.startsWith('/api/hq/v1/runtime')) return { apiVersion: 1 };
    throw new Error(`unexpected api path ${path}`);
  });
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const text = f.document.querySelector('[data-budget]').textContent;
  assert.match(text, /Run- und Kostenbelege nicht verfügbar/, 'a failed fetch is named as unavailable');
  assert.doesNotMatch(text, /Keine Routing-Belege vorhanden/, 'a failure must not be presented as an empty list');
});

test('switching projects clears the previous project runs from the card', async (t) => {
  let current = 'p1';
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(source('docs/dev-hq/continuous.js'));
  const controller = dom.window.createHQContinuous({
    container: dom.window.document.querySelector('main'),
    api: async (path) => {
      if (path.startsWith('/api/hq/v1/context') && path.includes('p2')) throw new Error('context endpoint down');
      if (path.startsWith('/api/hq/v1/context')) return CONTEXT;
      if (path.startsWith('/api/hq/v1/runs')) return RUNS;
      if (path.startsWith('/api/hq/v1/runtime')) return { apiVersion: 1 };
      throw new Error(`unexpected api path ${path}`);
    },
    project: () => current,
  });
  await controller.refresh();
  assert.match(dom.window.document.querySelector('[data-runs]').textContent, /run-1/, 'project p1 shows its runs');
  current = 'p2';
  await controller.refresh();
  assert.doesNotMatch(
    dom.window.document.querySelector('[data-runs]').textContent,
    /run-1/,
    'a failed load for the new project must not leave the previous project’s runs on the card',
  );
});

test('unresolved operations use the German plural for counts above one', async (t) => {
  const two = JSON.parse(JSON.stringify(CONTEXT));
  two.snapshot.effectiveLimits.rootPolicies[0].tokens.unresolvedOperations = 2;
  const f = continuousFixture(apiFor({ context: two }));
  t.after(() => f.dom.window.close());
  await f.controller.refresh();
  const text = f.document.querySelector('[data-budget]').textContent;
  assert.match(text, /2 offene Vorgänge/, 'two open operations use the plural');
  assert.doesNotMatch(text, /2 offener Vorgang/, 'the singular adjective must not pair with a plural count');
});

test('unchanged refresh leaves the budget DOM alone; changed balances rebuild it', async (t) => {
  let measured = 45000;
  const context = () => {
    const value = JSON.parse(JSON.stringify(CONTEXT));
    value.snapshot.effectiveLimits.rootPolicies[0].tokens.measuredTokens = measured;
    return value;
  };
  const g = continuousFixture(async (path) => {
    if (path.startsWith('/api/hq/v1/context')) return context();
    if (path.startsWith('/api/hq/v1/runs')) return RUNS;
    if (path.startsWith('/api/hq/v1/runtime')) return { apiVersion: 1 };
    throw new Error(`unexpected api path ${path}`);
  });
  t.after(() => g.dom.window.close());
  await g.controller.refresh();
  const before = g.document.querySelector('[data-budget] article');
  assert.ok(before, 'budget article rendered');
  await g.controller.refresh();
  assert.strictEqual(
    g.document.querySelector('[data-budget] article'),
    before,
    'unchanged data keeps the existing budget DOM nodes',
  );
  measured = 46000;
  await g.controller.refresh();
  const rebuilt = g.document.querySelector('[data-budget] article');
  assert.notStrictEqual(rebuilt, before, 'changed balances rebuild the section');
  assert.match(rebuilt.textContent, /46000/, 'new balance is rendered');
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

test('b key reveals and focuses the budget and routing section', async (t) => {
  const f = liveFixture();
  t.after(() => f.dom.window.close());
  const { document: d } = f;
  assert.equal(d.querySelector('#panel-teams').hidden, true, 'teams panel starts hidden on the overview tab');
  assert.equal(d.querySelector('#live-keys-enabled').checked, true, 'single-key shortcuts default to on (the b flow depends on it)');
  d.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
  const section = d.querySelector('#hq-budget-live');
  assert.ok(section, 'budget/routing section carries the stable id hq-budget-live');
  assert.equal(d.querySelector('#panel-teams').hidden, false, 'teams panel is revealed');
  assert.equal(d.activeElement, section, 'keyboard focus lands on the budget section');
  assert.match(d.querySelector('#live-keys-help').innerHTML, /<kbd>b<\/kbd>/, 'keys help documents b');
});
