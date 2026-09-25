import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const base = new URL('../../docs/dev-hq/concepts/', import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
const pkg = (id, deps = [], extra = {}) => ({ projectId: 'p1', planId: 'main', packageId: id, parentId: null, sourcePath: 'docs/PLAN.md', sourceRevision: 'sha-1', sourceLine: 3, title: id, dependencyIds: deps, acceptance: 'Check ' + id, removed: false, noNewDispatch: false, ...extra });
const projection = (projectId = 'p1', revision = 2, packages = [pkg('A'), pkg('B', ['A'], { parentId: 'A' }), pkg('C', ['A']), pkg('D', ['B', 'C'])]) => ({ contractVersion: 1, availability: 'available', projectId, sourceRevision: 'sha-1', projection: { projectId, planId: 'main', sourcePath: 'docs/PLAN.md', sourceRevision: 'sha-1', projectionRevision: revision, source: 'one\ntwo\n| A | <script>bad</script> |', importedAt: 42, rollbackReason: null, packages } });

test('diamond descendants are unique, hierarchy is separate, and tombstones do not enter the current graph', () => {
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('studio-roadmap.js', base), 'utf8'), { module });
  const { analyze } = module.exports;
  const result = analyze([pkg('A'), pkg('B', ['A'], { parentId: 'A' }), pkg('C', ['A']), pkg('D', ['B', 'C']), pkg('Old', ['D'], { removed: true, noNewDispatch: true })]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.nodes.map(x => [x.packageId, x.level, x.descendants]))), [['A', 0, 3], ['B', 1, 1], ['C', 1, 1], ['D', 2, 0]]);
  assert.deepEqual([...result.byId.get('A').children], ['B']);
  assert.deepEqual([...result.byId.get('A').dependents], ['B', 'C']);
  assert.equal(result.longestChain, 2);
  assert.deepEqual([...result.removed].map(x => x.packageId), ['Old']);
});

async function fixture(handler) {
  const html = readFileSync(new URL('hq2-studio.html', base), 'utf8').replace('<head>', '<head><meta name="hq-session" content="test-session">');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1:4187/concepts/hq2-studio.html' });
  const w = dom.window, requests = [];
  w.AbortSignal.timeout = () => undefined;
  w.fetch = async (url, options) => {
    requests.push({ url, options });
    const response = await handler(url, options);
    if (response?.ok === false) return { ok: false, status: response.status, json: async () => ({ error: response.error }) };
    return { ok: true, status: 200, json: async () => response ?? [] };
  };
  for (const file of ['studio-model.js', 'studio-roadmap.js', 'studio-workspace.js']) w.eval(readFileSync(new URL(file, base), 'utf8'));
  await w.Studio.ready;
  return { dom, w, requests, q: selector => w.document.querySelector(selector) };
}

const baseHandler = (url) => {
  if (url === '/__hq/api/projects') return [{ id: 'p1', name: 'First' }, { id: 'p2', name: 'Second' }];
  if (url === '/__hq/api/hq/v1/runtime') return { capabilities: { planProjection: { supported: true, contractVersion: 1 } } };
  if (url.startsWith('/__hq/api/hq/v1/plan?')) return projection(url.includes('projectId=p2') ? 'p2' : 'p1');
  if (url === '/__hq/profiles') return { profiles: [] };
  return [];
};

test('read is project scoped, source is escaped, and selection survives view changes', async t => {
  const f = await fixture(baseHandler); t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap');
  assert.ok(f.requests.some(x => x.url === '/__hq/api/hq/v1/plan?projectId=p1&planId=main'));
  assert.equal(f.w.document.querySelectorAll('.roadmap-edges path').length, 4, 'directed dependencies have visible connectors');
  assert.equal(f.q('#roadmap-source script'), null);
  assert.match(f.q('#roadmap-source').textContent, /<script>bad<\/script>/);
  f.q('[data-roadmap-package="B"]').click();
  assert.match(f.q('#roadmap-inspector').textContent, /Check B/);
  assert.ok(f.q('.roadmap-hierarchy li ul [data-roadmap-package="B"]'), 'parent hierarchy is rendered separately');
  f.q('#roadmap-view-table').click();
  assert.ok(f.q('table caption'));
  f.w.Studio.show('chat'); f.w.Studio.show('roadmap');
  assert.match(f.q('#roadmap-inspector').textContent, /Check B/);
});

test('missing projection alone permits expected zero; failed read and unsupported runtime never mutate', async t => {
  let mode = 'missing';
  const f = await fixture((url, options) => {
    if (url === '/__hq/api/hq/v1/runtime' && mode === 'unsupported') return { capabilities: { planProjection: { supported: false } } };
    if (url.startsWith('/__hq/api/hq/v1/plan?')) return mode === 'missing' ? { ok: false, status: 404, error: 'unknown project or plan' } : { ok: false, status: 503, error: 'offline' };
    if (url === '/__hq/api/hq/v1/plan/import') return projection('p1', 1);
    return baseHandler(url, options);
  }); t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap');
  assert.ok(f.q('#roadmap-import'));
  f.q('#roadmap-import').click(); await tick();
  assert.deepEqual(JSON.parse(f.requests.find(x => x.url.endsWith('/plan/import')).options.body), { projectId: 'p1', planId: 'main', expectedProjectionRevision: 0 });
  mode = 'failed'; await f.w.Studio.refresh();
  assert.equal(f.q('#roadmap-import')?.disabled, true);
  assert.equal(f.requests.filter(x => x.url.endsWith('/plan/import')).length, 1);
  mode = 'unsupported'; await f.w.Studio.refresh();
  assert.equal(f.q('#roadmap-import'), null);
  assert.equal(f.requests.filter(x => x.url.endsWith('/plan/import')).length, 1);
});

test('409 keeps the visible snapshot and blocks import until an explicit successful reload', async t => {
  let revision = 2, conflict = true;
  const f = await fixture((url, options) => {
    if (url.startsWith('/__hq/api/hq/v1/plan?')) return projection('p1', revision);
    if (url === '/__hq/api/hq/v1/plan/import') return conflict ? { ok: false, status: 409, error: 'plan projection revision conflict' } : projection('p1', revision + 1);
    return baseHandler(url, options);
  }); t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap');
  f.q('#roadmap-import').click(); await tick();
  assert.match(f.q('.roadmap-header').textContent, /Projektion 2/);
  assert.equal(f.q('#roadmap-import').disabled, true);
  revision = 3; f.q('#roadmap-reload').click(); await tick();
  assert.match(f.q('.roadmap-header').textContent, /Projektion 3/);
  assert.equal(f.q('#roadmap-import').disabled, false);
  conflict = false; f.q('#roadmap-import').click(); await tick();
  const bodies = f.requests.filter(x => x.url.endsWith('/plan/import')).map(x => JSON.parse(x.options.body));
  assert.deepEqual(bodies.map(x => x.expectedProjectionRevision), [2, 3]);
});

test('late A response cannot replace A after switching through B', async t => {
  let oldResolve, hold = false, aCount = 0;
  const f = await fixture((url, options) => {
    if (url.startsWith('/__hq/api/hq/v1/plan?projectId=p1')) {
      if (hold && ++aCount === 1) return new Promise(resolve => { oldResolve = resolve; });
      return projection('p1', 4);
    }
    if (url.startsWith('/__hq/api/hq/v1/plan?projectId=p2')) return projection('p2', 8, []);
    return baseHandler(url, options);
  }); t.after(() => f.dom.window.close());
  hold = true; f.w.Studio.show('roadmap'); f.q('#roadmap-reload').click(); await tick();
  f.q('#project').value = 'p2'; f.q('#project').dispatchEvent(new f.w.Event('change')); await tick();
  f.q('#project').value = 'p1'; f.q('#project').dispatchEvent(new f.w.Event('change')); await tick();
  oldResolve(projection('p1', 99)); await tick();
  assert.match(f.q('.roadmap-header').textContent, /Projektion 4/);
  assert.doesNotMatch(f.q('.roadmap-header').textContent, /Projektion 99/);
});

test('table keyboard focus, selected detail, and historical source provenance stay truthful', async t => {
  const old = pkg('Old', [], { removed: true, noNewDispatch: true, sourceRevision: 'sha-old', title: '<img src=x onerror=bad()>' });
  const f = await fixture((url, options) => url.startsWith('/__hq/api/hq/v1/plan?') ? projection('p1', 2, [pkg('A'), old]) : baseHandler(url, options)); t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap'); f.q('#roadmap-view-table').click();
  assert.equal(f.q('#roadmap-view-table'), f.w.document.activeElement);
  assert.equal(f.q('.roadmap-table th[scope="row"] button')?.tagName, 'BUTTON');
  f.q('[data-roadmap-package="Old"]').click();
  assert.match(f.q('#roadmap-inspector').textContent, /Historische Quellbytes sind nicht geladen/);
  assert.match(f.q('#roadmap-inspector').textContent, /sha-old/);
  assert.equal(f.q('#roadmap-open-source'), null);
  assert.equal(f.q('#roadmap-inspector img'), null);
  f.q('[data-roadmap-package="A"]').click(); f.q('#roadmap-open-source').click();
  assert.ok(f.q('#roadmap-source').open);
  assert.ok(f.q('#roadmap-line-3').classList.contains('is-target'));
});

test('malformed available envelope cannot become an empty success', async t => {
  const f = await fixture((url, options) => url.startsWith('/__hq/api/hq/v1/plan?') ? { contractVersion: 1, availability: 'available', projectId: 'p1', sourceRevision: 'sha-1', projection: { packages: [] } } : baseHandler(url, options)); t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap');
  assert.match(f.q('main').textContent, /Ungültige Plan/);
  assert.equal(f.q('#roadmap-import').disabled, true);
});

test('available projection has no choose-project warning and a cyclic projection is invalid without crashing', async t => {
  let cycle = false;
  const f = await fixture((url, options) => url.startsWith('/__hq/api/hq/v1/plan?')
    ? projection('p1', 2, cycle ? [pkg('A', ['B']), pkg('B', ['A'])] : [pkg('A')])
    : baseHandler(url, options));
  t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap');
  assert.doesNotMatch(f.q('main').textContent, /Projekt auswählen/);
  cycle = true;
  await f.w.Studio.refresh();
  assert.match(f.q('main').textContent, /Ungültig|Abhängigkeitskreis/);
  assert.equal(f.q('#roadmap-import').disabled, true);
});

test('reload cannot overtake a pending import and expose the old projection as current', async t => {
  let finishImport;
  const f = await fixture((url, options) => {
    if (url === '/__hq/api/hq/v1/plan/import') return new Promise(resolve => { finishImport = resolve; });
    return baseHandler(url, options);
  }); t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap');
  f.q('#roadmap-import').click(); await tick();
  assert.equal(f.q('#roadmap-reload').disabled, true);
  finishImport(projection('p1', 3)); await tick();
  assert.match(f.q('.roadmap-header').textContent, /Projektion 3/);
});

test('table shows a title once and keeps lengthy acceptance in the inspector', async t => {
  const longAcceptance = 'Proof '.repeat(55);
  const f = await fixture((url, options) => url.startsWith('/__hq/api/hq/v1/plan?')
    ? projection('p1', 2, [pkg('A', [], { title: 'Unique package title', acceptance: longAcceptance })])
    : baseHandler(url, options));
  t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap'); f.q('#roadmap-view-table').click();
  const row = f.q('.roadmap-table tbody tr');
  assert.equal(row.textContent.split('Unique package title').length - 1, 1);
  assert.ok(row.cells[6].textContent.length <= 91);
  assert.match(f.q('#roadmap-inspector').textContent, /Proof Proof Proof/);
  assert.match(f.q('.roadmap-hierarchy').textContent, /Keine Eltern-Unterpaket-Beziehungen/);
  assert.equal(f.q('.roadmap-hierarchy-scroll'), null);
  f.w.document.body.classList.add('compact');
  assert.ok(f.q('.roadmap-table tbody tr'), 'compact mode retains the complete semantic row');
});

test('active dependency and parent references, duplicates, and both cycle types reject before render', () => {
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('studio-roadmap.js', base), 'utf8'), { module });
  const { validate } = module.exports;
  const badCases = [
    [pkg('A', ['Missing'])],
    [pkg('A', ['Old']), pkg('Old', [], { removed: true, noNewDispatch: true })],
    [pkg('A'), pkg('B', ['A', 'A'])],
    [pkg('A', [], { parentId: 'Missing' })],
    [pkg('A', [], { parentId: 'Old' }), pkg('Old', [], { removed: true, noNewDispatch: true })],
    [pkg('A', ['A'])],
    [pkg('A', ['B']), pkg('B', ['A'])],
    [pkg('A', [], { parentId: 'B' }), pkg('B', [], { parentId: 'A' })],
  ];
  for (const packages of badCases) {
    assert.throws(() => validate(projection('p1', 2, packages), 'p1'), { code: 'invalid_projection' });
  }
});

test('reason-required 409 opens the advanced field and an explicit retry sends the reason', async t => {
  const f = await fixture((url, options) => {
    if (url === '/__hq/api/hq/v1/plan/import') {
      const body = JSON.parse(options.body);
      return body.rollbackReason ? projection('p1', 3) : { ok: false, status: 409, error: 'reimport of historic source requires a nonempty rollback reason' };
    }
    return baseHandler(url, options);
  }); t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap'); f.q('#roadmap-import').click(); await tick();
  assert.equal(f.q('#roadmap-advanced').open, true);
  assert.equal(f.q('#roadmap-import').disabled, false);
  f.q('#roadmap-advanced').open = false;
  f.q('#roadmap-advanced').dispatchEvent(new f.w.Event('toggle'));
  f.q('.roadmap-graph [data-roadmap-package="B"]').click();
  assert.equal(f.q('#roadmap-advanced').open, false, 'backend requirement opens once; user may close it');
  f.q('#roadmap-advanced').open = true;
  f.q('#roadmap-advanced').dispatchEvent(new f.w.Event('toggle'));
  f.q('#roadmap-reason').value = 'Restore prior source for review';
  f.q('#roadmap-import').click(); await tick();
  const bodies = f.requests.filter(x => x.url.endsWith('/plan/import')).map(x => JSON.parse(x.options.body));
  assert.equal(bodies[1].rollbackReason, 'Restore prior source for review');
  assert.equal(bodies[1].expectedProjectionRevision, 2);
  assert.match(f.q('.roadmap-header').textContent, /Projektion 3/);
});

test('unknown POST outcome and failed cached reload keep snapshot visible but disable mutation', async t => {
  let failRead = false;
  const f = await fixture((url, options) => {
    if (url === '/__hq/api/hq/v1/plan/import') return { ok: false, status: 500, error: 'connection lost' };
    if (url.startsWith('/__hq/api/hq/v1/plan?') && failRead) return { ok: false, status: 503, error: 'offline' };
    return baseHandler(url, options);
  }); t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap'); f.q('#roadmap-import').click(); await tick();
  assert.match(f.q('main').textContent, /Import-Ergebnis unbekannt/);
  assert.doesNotMatch(f.q('main').textContent, /Gezeigte Projektion ist veraltet/);
  assert.match(f.q('.roadmap-header').textContent, /Projektion 2/);
  assert.equal(f.q('#roadmap-import').disabled, true);
  failRead = true; f.q('#roadmap-reload').click(); await tick();
  assert.match(f.q('main').textContent, /Gezeigte Projektion ist veraltet/);
  assert.match(f.q('.roadmap-header').textContent, /Projektion 2/);
  assert.equal(f.requests.filter(x => x.url.endsWith('/plan/import')).length, 1);
});

test('source disclosure follows user toggles and downstream sort changes table order and caption', async t => {
  const packages = [pkg('D', ['B', 'C']), pkg('C', ['A']), pkg('B', ['A']), pkg('A')];
  const f = await fixture((url, options) => url.startsWith('/__hq/api/hq/v1/plan?') ? projection('p1', 2, packages) : baseHandler(url, options));
  t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap');
  f.q('#roadmap-source').open = true;
  f.q('#roadmap-source').dispatchEvent(new f.w.Event('toggle'));
  f.q('[data-roadmap-package="C"]').click();
  assert.equal(f.q('#roadmap-source').open, true);
  f.q('#roadmap-source').open = false;
  f.q('#roadmap-source').dispatchEvent(new f.w.Event('toggle'));
  f.q('#roadmap-view-table').click();
  assert.equal(f.q('#roadmap-source').open, false);
  assert.deepEqual([...f.w.document.querySelectorAll('.roadmap-table tbody th button')].map(x => x.textContent.trim()), ['D', 'C', 'B', 'A']);
  f.q('#roadmap-sort').value = 'downstream'; f.q('#roadmap-sort').dispatchEvent(new f.w.Event('change'));
  assert.deepEqual([...f.w.document.querySelectorAll('.roadmap-table tbody th button')].map(x => x.textContent.trim()), ['A', 'C', 'B', 'D']);
  assert.match(f.q('.roadmap-table caption').textContent, /Nachfolgern sortiert/);
});

test('density change recomputes connector geometry and selected B highlights its two incident edges', async t => {
  const f = await fixture(baseHandler); t.after(() => f.dom.window.close());
  const positions = { A: [10, 40], B: [130, 40], C: [130, 110], D: [250, 80] };
  f.w.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('roadmap-graph')) return { left: 0, top: 0, right: 400, height: 300 };
    const [left, top] = positions[this.dataset.roadmapPackage] || [0, 0];
    const height = f.w.document.body.classList.contains('compact') ? 30 : 50;
    return { left, top, right: left + 90, height };
  };
  f.w.Studio.show('roadmap');
  const before = [...f.w.document.querySelectorAll('.roadmap-edges path')].map(path => path.getAttribute('d'));
  assert.equal(before.length, 4);
  assert.ok([...f.w.document.querySelectorAll('.roadmap-edges path')].every(path => path.getAttribute('marker-end')), 'every connector has a visible direction marker');
  f.q('.roadmap-graph [data-roadmap-package="B"]').click();
  assert.equal(f.w.document.querySelectorAll('.roadmap-edges path.related').length, 2, 'A→B and B→D touch B');
  f.q('#density').value = 'compact'; f.q('#density').dispatchEvent(new f.w.Event('change'));
  const after = [...f.w.document.querySelectorAll('.roadmap-edges path')].map(path => path.getAttribute('d'));
  assert.notDeepEqual(after, before);
});

test('advanced reason disclosure and hierarchy focus survive a package re-render', async t => {
  const f = await fixture(baseHandler); t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap');
  f.q('#roadmap-advanced').open = true;
  f.q('#roadmap-advanced').dispatchEvent(new f.w.Event('toggle'));
  f.q('.roadmap-hierarchy [data-roadmap-package="B"]').click();
  assert.equal(f.q('#roadmap-advanced').open, true);
  assert.ok(f.w.document.activeElement.closest('.roadmap-hierarchy'));
  f.q('#roadmap-advanced').open = false;
  f.q('#roadmap-advanced').dispatchEvent(new f.w.Event('toggle'));
  f.q('.roadmap-hierarchy [data-roadmap-package="A"]').click();
  assert.equal(f.q('#roadmap-advanced').open, false);
  assert.ok(f.w.document.activeElement.closest('.roadmap-hierarchy'));
  f.q('#roadmap-view-table').click();
  f.q('.roadmap-table [data-roadmap-package="B"]').click();
  assert.ok(f.w.document.activeElement.closest('.roadmap-table'));
  f.q('#roadmap-inspector [data-roadmap-package="A"]').click();
  assert.equal(f.w.document.activeElement, f.q('#roadmap-inspector-title'));
});

test('selecting a tombstone keeps its disclosure open and focus on the visible package', async t => {
  const packages = [pkg('A'), pkg('Old', [], { removed: true, noNewDispatch: true, sourceRevision: 'sha-old' })];
  const f = await fixture((url, options) => url.startsWith('/__hq/api/hq/v1/plan?')
    ? projection('p1', 2, packages)
    : baseHandler(url, options));
  t.after(() => f.dom.window.close());
  f.w.Studio.show('roadmap');
  const removedDetails = f.q('.roadmap-removed').closest('details');
  removedDetails.open = true;
  removedDetails.dispatchEvent(new f.w.Event('toggle'));
  f.q('.roadmap-removed [data-roadmap-package="Old"]').click();
  assert.equal(f.q('.roadmap-removed').closest('details').open, true);
  assert.equal(f.w.document.activeElement, f.q('.roadmap-removed [data-roadmap-package="Old"]'));
  assert.match(f.q('#roadmap-inspector').textContent, /Entferntes Paket/);
  f.q('#project').value = 'p2';
  f.q('#project').dispatchEvent(new f.w.Event('change'));
  assert.equal(f.w.Studio.state.roadmap.removedOpen, false, 'project change resets the old disclosure state');
  await tick();
});
