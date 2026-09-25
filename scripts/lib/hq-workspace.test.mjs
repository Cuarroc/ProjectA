import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { validateProfile, upsertProfile } from './hq-live-lib.mjs';

const source = path => readFileSync(path, 'utf8');
function fixture(hash = '') {
  const dom = new JSDOM(source('docs/dev-hq/live.html'), { url: `http://localhost/live.html${hash}`, runScripts: 'outside-only' });
  const { window } = dom;
  window.HQ_DATA = JSON.parse(source('docs/dev-hq/data.json'));
  window.fetch = () => new Promise(() => {});
  window.matchMedia = () => ({ matches: true });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.eval(source('docs/dev-hq/workspace.js'));
  const create = window.createHQWorkspace;
  let controller;
  window.createHQWorkspace = (...args) => (controller = create(...args));
  window.eval(source('docs/dev-hq/hq.js'));
  return { dom, window, document: window.document, controller };
}

test('live tabs preserve every mounted control and draft while switching with keyboard', t => {
  const f = fixture(); t.after(() => f.dom.window.close());
  const { document: d, window: w } = f;
  assert.equal(d.querySelectorAll('[role=tab]').length, 5);
  const input = d.querySelector('#live-queue-text');
  input.value = 'Keep this draft';
  d.querySelector('#tab-teams').click();
  assert.equal(d.querySelector('#panel-teams').hidden, false);
  assert.equal(d.querySelector('#panel-overview').hidden, true);
  d.querySelector('#tab-teams').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(d.activeElement.id, 'tab-stats');
  d.querySelector('#tab-stats').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(d.activeElement.id, 'tab-overview');
  assert.equal(d.querySelector('#live-queue-text'), input);
  assert.equal(input.value, 'Keep this draft');
  const ids = [...d.querySelectorAll('[id]')].map(n => n.id);
  assert.equal(ids.length, new Set(ids).size, 'no duplicated form IDs');
});

test('cross-tab reveal opens controls, shortcuts reveal hidden lessons, and hash initializes selection', t => {
  const f = fixture('#teams'); t.after(() => f.dom.window.close());
  const d = f.document;
  assert.equal(d.querySelector('#panel-teams').hidden, false);
  f.controller.reveal('#live-queue-text');
  assert.equal(d.querySelector('#panel-overview').hidden, false);
  assert.equal(d.querySelector('.workspace-controls').open, true);
  d.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: '/', bubbles: true }));
  assert.equal(d.activeElement.id, 'lesson-query');
  assert.equal(d.querySelector('#panel-evidence').hidden, false);
});

test('team selection and keyboard focus survive a profile-count refresh', t => {
  const f = fixture('#teams'); t.after(() => f.dom.window.close());
  const host = f.document.querySelector('#live-teams');
  host.innerHTML = '<div class="team-group"><h3>Review</h3><article class="live-row">One</article></div>';
  f.controller.teamsChanged();
  f.document.querySelector('[data-team="Review"]').click();
  f.document.querySelector('[data-team="Review"]').focus();
  host.innerHTML = '<div class="team-group"><h3>Review</h3><article class="live-row">One</article><article class="live-row">Two</article></div>';
  f.controller.teamsChanged();
  assert.equal(f.document.activeElement.dataset.team, 'Review');
  assert.match(f.document.activeElement.textContent, /2/);
  f.document.querySelector('[data-team="Debug"]').click();
  f.document.querySelector('#live-new-team').click();
  assert.equal(f.document.querySelector('#team-team').value, 'Debug');
  assert.equal(f.document.querySelector('#team-editor').hidden, false);
});

test('briefing persists with profile without dropping caps and rejects invalid fields', () => {
  const briefing = { purpose: 'Find regressions', role: 'Reviewer', effort: 'Hoch', tools: 'Diff, tests' };
  const profile = { id: 'claude-review', name: 'Reviewer', command: 'claude', team: 'Review', briefing };
  assert.equal(validateProfile(profile), null);
  const doc = upsertProfile({ profiles: [{ ...profile, caps: { dialect: 'claude' } }] }, profile);
  assert.deepEqual(doc.profiles[0].briefing, briefing);
  assert.deepEqual(doc.profiles[0].caps, { dialect: 'claude' });
  assert.match(validateProfile({ ...profile, briefing: { ...briefing, role: 42 } }), /briefing.role/);
});

// The live page boots fully against a fetch stub, so renderRecommendations
// runs on data of the test's choosing. Every endpoint the boot sequence does
// not care about answers with an empty array; its local catch keeps the
// recommendations card untouched.
function liveFixture({ recommendations = [] } = {}) {
  const dom = new JSDOM(source('docs/dev-hq/live.html'), { url: 'http://localhost/live.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.HQ_DATA = JSON.parse(source('docs/dev-hq/data.json'));
  const payloads = {
    '/api/projects': [],
    '/api/recommendations': recommendations,
    '/profiles': { profiles: [] },
    '/lessons': { lessons: [], stats: { tags: [], count: 0, hits: 0 } },
    '/stats': {
      commitsPerDay: [],
      snapshot: { findings: { total: 0 }, specs: { total: 0, startable: 0, locked: 0, serial: 0, parallel: 0 } },
      tests: { rustTests: 0, frontendTestFiles: 0, rustFiles: 0 },
      lessons: { count: 0, hits: 0, tags: [] },
      authors: [],
      branch: 'main',
      head: 'test',
      dirtyFiles: 0,
    },
    '/insights': {
      effort: {
        time: { hours: 0, low: 0, high: 0, basis: '' },
        tokens: { value: 0, low: 0, high: 0, basis: '', source: 'estimate' },
        costUsd: null,
      },
      firstCommit: null,
      lastCommit: null,
      sittings: { count: 0, journalSessions: 0, instances: 0 },
      volume: { insertions: 0, deletions: 0 },
      heat: { grid: Array.from({ length: 7 }, () => Array(24).fill(0)), max: 0 },
      signals: [],
    },
  };
  window.fetch = (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/__hq/, '').split('?')[0];
    const body = Object.prototype.hasOwnProperty.call(payloads, path) ? payloads[path] : [];
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  window.matchMedia = () => ({ matches: true });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.eval(source('docs/dev-hq/workspace.js'));
  window.eval(source('docs/dev-hq/hq.js'));
  return { dom, window, document: window.document };
}

async function waitFor(check, tries = 100) {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(check(), 'condition never became true');
}

// A recommendation whose url is a javascript: (or any non-http(s)) link is a
// stored XSS one click away: escape() protects the markup, not the scheme.
// Only http(s) urls may become links; everything else renders without one.
test('recommendation links render only for http(s) urls', async (t) => {
  const f = liveFixture({
    recommendations: [
      { id: 'rc-evil', title: 'shady', rationale: 'xss attempt', status: 'new', url: 'javascript:alert(1)' },
      { id: 'rc-data', title: 'inline', rationale: 'data url attempt', status: 'new', url: 'data:text/html,<script>alert(1)</script>' },
      { id: 'rc-good', title: 'useful', rationale: 'worth a look', status: 'new', url: 'https://example.com/spec' },
    ],
  });
  t.after(() => f.dom.window.close());
  const host = f.document.querySelector('#live-recommendations');
  await waitFor(() => host.innerHTML.includes('shady'));
  assert.ok(!host.innerHTML.includes('javascript:'), host.innerHTML);
  const rows = [...host.querySelectorAll('article')];
  for (const title of ['shady', 'inline']) {
    const evilRow = rows.find((a) => a.textContent.includes(title));
    assert.equal(evilRow.querySelector('a'), null, `a non-http url gets no link (${title})`);
  }
  const goodRow = rows.find((a) => a.textContent.includes('useful'));
  const link = goodRow.querySelector('a');
  assert.equal(link.getAttribute('href'), 'https://example.com/spec');
  assert.equal(link.getAttribute('rel'), 'noopener');
});
