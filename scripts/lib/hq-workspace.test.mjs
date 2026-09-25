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
