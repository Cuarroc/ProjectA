import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const base = new URL('../../docs/dev-hq/concepts/', import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture({ density, appearance, storageUnavailable = false } = {}) {
  const html = readFileSync(new URL('hq2-studio.html', base), 'utf8').replace('<head>', '<head><meta name="hq-session" content="test-session">');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1:4187/concepts/hq2-studio.html' });
  const w = dom.window, requests = [];
  if (density !== undefined) w.localStorage.setItem('studio-density', density);
  if (appearance !== undefined) w.localStorage.setItem('studio-chat-appearance', appearance);
  if (storageUnavailable) Object.defineProperty(w, 'localStorage', { get() { throw new w.DOMException('Storage disabled', 'SecurityError'); } });
  const profile = { id: 'codex', name: 'Codex', command: 'codex', args: [], enabled: true };
  const payloads = {
    '/__hq/api/projects': [{ id: 'p1', name: 'First', repoPath: '/first' }, { id: 'p2', name: 'Second', repoPath: '/second' }],
    '/__hq/profiles': { profiles: [profile], writable: true },
    '/__hq/api/workers?projectId=p1': [{ id: 'w1', projectId: 'p1', profileId: 'codex', task: 'First worker', status: 'working' }],
    '/__hq/api/questions?projectId=p1&status=open': [{ id: 'q1', question: 'First question', status: 'open' }],
    '/__hq/studio/routing': { version: 1, revision: 0, order: [], rules: { requireEvidence: true, maxAgeDays: 30, minimumSamples: 3, qualityWeight: 80 }, evidence: [] },
    '/__hq/studio/catalog': { skills: [], plugins: [] }, '/__hq/lessons?limit=100': { lessons: [] },
  };
  let handler;
  w.AbortSignal.timeout = () => undefined;
  w.fetch = async (url, options) => { requests.push({ url, options }); const data = handler ? await handler(url, options) : undefined; return { ok: true, json: async () => data ?? payloads[url] ?? [] }; };
  w.HTMLDialogElement.prototype.showModal = function () { this.returnValue = 'ok'; this.dispatchEvent(new w.Event('close')); };
  w.eval(readFileSync(new URL('studio-model.js', base), 'utf8'));
  w.eval(readFileSync(new URL('studio-roadmap.js', base), 'utf8'));
  w.eval(readFileSync(new URL('studio-workspace.js', base), 'utf8'));
  await w.Studio.ready;
  return { dom, w, requests, q: s => w.document.querySelector(s), setHandler: fn => { handler = fn; } };
}
test('chat appearance is local, persistent and separate from the executable profile', async t => {
  const f = await fixture(); t.after(() => f.w.close()); const { w, q } = f;
  w.Studio.show('chat');
  assert.equal(w.document.documentElement.dataset.chatAppearance, 'deepseek');
  assert.deepEqual([...w.document.querySelectorAll('input[name="chat-appearance"]')].map(input => input.value), ['codex', 'claude', 'deepseek']);
  assert.equal(q('fieldset#chat-appearance legend').textContent, 'Chat-Darstellung');
  assert.match(q('#chat-appearance-help').textContent, /Modell, Harness und Berechtigungen bleiben unverändert/);
  const profile = q('#chat-profile').value, mode = q('#chat-mode').value, requests = f.requests.length;
  const radio = q('input[name="chat-appearance"][value="claude"]'); radio.checked = true; radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(w.document.documentElement.dataset.chatAppearance, 'claude');
  assert.equal(w.localStorage.getItem('studio-chat-appearance'), 'claude');
  assert.equal(q('#chat-profile').value, profile); assert.equal(q('#chat-mode').value, mode);
  assert.equal(w.Studio.state.selectedProfile, profile); assert.equal(f.requests.length, requests);
  w.Studio.show('settings'); w.Studio.show('chat');
  assert.equal(q('input[name="chat-appearance"][value="claude"]').checked, true);
  const again = await fixture({ appearance: w.localStorage.getItem('studio-chat-appearance') }); t.after(() => again.w.close());
  again.w.Studio.show('chat');
  assert.equal(again.q('input[name="chat-appearance"][value="claude"]').checked, true);
});

test('chat appearance handles invalid or unavailable storage and survives theme, density and project changes', async t => {
  for (const options of [{ appearance: 'invalid' }, { storageUnavailable: true }]) {
    const f = await fixture(options); t.after(() => f.w.close()); const { w, q } = f;
    w.Studio.show('chat'); assert.equal(w.document.documentElement.dataset.chatAppearance, 'deepseek');
    const radio = q('input[name="chat-appearance"][value="codex"]'); radio.checked = true; radio.dispatchEvent(new w.Event('change', { bubbles: true }));
    q('#theme').click(); q('#density').value = 'compact'; q('#density').dispatchEvent(new w.Event('change'));
    q('#project').value = 'p2'; q('#project').dispatchEvent(new w.Event('change')); await tick();
    assert.equal(w.document.documentElement.dataset.chatAppearance, 'codex');
    assert.equal(q('input[name="chat-appearance"][value="codex"]').checked, true);
  }
});

test('appearance switch preserves live composer and pending request without a new API call', async t => {
  const f = await fixture(); t.after(() => f.w.close()); const { w, q } = f; let finish;
  f.setHandler(async (url, options) => url === '/__hq/api/workers' && options.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : undefined);
  w.Studio.show('chat'); const composer = q('#message'), log = q('#chat-log');
  composer.value = 'A draft with a selection'; composer.focus(); composer.setSelectionRange(2, 7);
  q('#chat-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  const requests = f.requests.length, session = w.Studio.state.session.p1;
  const radio = q('input[name="chat-appearance"][value="codex"]'); radio.checked = true; radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(f.requests.length, requests); assert.equal(w.Studio.state.session.p1, session);
  assert.equal(w.Studio.state.pending, true); assert.equal(q('#message'), composer); assert.equal(q('#chat-log'), log);
  assert.equal(composer.value, 'A draft with a selection'); assert.equal(composer.selectionStart, 2); assert.equal(composer.selectionEnd, 7);
  assert.equal(w.document.activeElement, composer);
  finish({ id: 'created-worker' }); await tick();
});

test('starting after an appearance switch sends only the selected executable profile', async t => {
  const f = await fixture(); t.after(() => f.w.close()); const { w, q } = f;
  w.Studio.show('chat');
  const radio = q('input[name="chat-appearance"][value="claude"]'); radio.checked = true; radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  f.setHandler(async (url, options) => url === '/__hq/api/workers' && options.method === 'POST' ? { id: 'new-worker' } : undefined);
  q('#message').value = 'Task'; q('#chat-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  const request = f.requests.find(item => item.url === '/__hq/api/workers' && item.options.method === 'POST');
  assert.ok(request);
  assert.equal(JSON.parse(request.options.body).profileId, 'codex');
  assert.doesNotMatch(request.options.body, /chat-appearance|claude|deepseek|ui_profile_id/);
});

test('appearance change retains the visible message anchor or follows the bottom', async t => {
  const f = await fixture(); t.after(() => f.w.close()); const { w, q } = f;
  w.Studio.show('chat'); const log = q('#chat-log');
  log.innerHTML = '<article class="message">First</article><article class="message">Second</article>';
  Object.defineProperties(log, { scrollHeight: { value: 1000 }, clientHeight: { value: 300 } });
  log.getBoundingClientRect = () => ({ top: 100 });
  const [first, second] = log.querySelectorAll('.message');
  first.getBoundingClientRect = () => ({ top: 60, bottom: 90 });
  second.getBoundingClientRect = () => ({ top: w.document.documentElement.dataset.chatAppearance === 'claude' ? 110 : 150, bottom: 190 });
  log.scrollTop = 200;
  let radio = q('input[name="chat-appearance"][value="claude"]'); radio.checked = true; radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(log.scrollTop, 160, 'same visible message keeps its viewport offset');
  assert.equal(log.children[0], first); assert.equal(log.children[1], second);
  log.scrollTop = 680;
  radio = q('input[name="chat-appearance"][value="codex"]'); radio.checked = true; radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(log.scrollTop, 1000, 'near-bottom reader stays at the bottom');
});

test('the three desktop appearances have distinct scoped layout rules', () => {
  const css = readFileSync(new URL('studio-workspace.css', base), 'utf8');
  for (const value of ['codex', 'claude', 'deepseek']) {
    assert.match(css, new RegExp(`html\\[data-chat-appearance=${value}\\] \\.chat-workspace \\.message`));
    assert.match(css, new RegExp(`html\\[data-chat-appearance=${value}\\] \\.chat-workspace \\.composer textarea`));
  }
  assert.match(css, /data-chat-appearance=codex[^\n]*\.message[^\n]*max-width:88ch/);
  assert.match(css, /data-chat-appearance=claude[^\n]*\.message[^\n]*max-width:70ch/);
  assert.match(css, /data-chat-appearance=deepseek[^\n]*\.message[^\n]*max-width:min\(82%,76ch\)/);
});
test('global density choice survives every view and a reload with the saved preference', async t => {
  const f = await fixture(); t.after(() => f.w.close());
  const control = f.q('header #density');
  assert.ok(control, 'density is available before opening any view');
  assert.equal(control.value, 'calm');
  assert.equal(f.q('label[for="density"]').textContent, 'Dichte');
  assert.equal(control.getAttribute('aria-label'), 'Dichte');
  const requestsBeforeDensityChange = f.requests.length;
  control.value = 'compact'; control.dispatchEvent(new f.w.Event('change'));
  await tick();
  assert.equal(f.requests.length, requestsBeforeDensityChange, 'density change makes no API request');
  for (const view of ['overview', 'roadmap', 'chat', 'teams', 'queue', 'lessons', 'capacity', 'stats', 'analysis', 'extensions', 'settings']) {
    f.w.Studio.show(view);
    assert.equal(f.w.document.querySelectorAll('#density').length, 1, view);
    assert.equal(f.q('#density'), control, view);
    assert.equal(control.value, 'compact', view);
    assert.ok(f.w.document.body.classList.contains('compact'), view);
  }
  const reloaded = await fixture({ density: f.w.localStorage.getItem('studio-density') }); t.after(() => reloaded.w.close());
  assert.equal(reloaded.q('#density').value, 'compact');
  assert.ok(reloaded.w.document.body.classList.contains('compact'));
  reloaded.q('#density').value = 'calm'; reloaded.q('#density').dispatchEvent(new reloaded.w.Event('change'));
  assert.equal(reloaded.w.document.body.classList.contains('compact'), false);
  assert.equal(reloaded.w.localStorage.getItem('studio-density'), 'calm');
  const comfortableReload = await fixture({ density: reloaded.w.localStorage.getItem('studio-density') }); t.after(() => comfortableReload.w.close());
  assert.equal(comfortableReload.q('#density').value, 'calm');
  assert.equal(comfortableReload.w.document.body.classList.contains('compact'), false);
});

test('density remains usable without browser storage and rejects unknown saved values', async t => {
  for (const options of [{ storageUnavailable: true }, { density: 'unknown' }]) {
    const f = await fixture(options); t.after(() => f.w.close());
    assert.equal(f.q('#density').value, 'calm');
    assert.equal(f.w.document.body.classList.contains('compact'), false);
    f.q('#density').value = 'compact'; f.q('#density').dispatchEvent(new f.w.Event('change'));
    f.w.Studio.show('analysis');
    assert.equal(f.q('#density').value, 'compact');
    assert.ok(f.w.document.body.classList.contains('compact'));
  }
});

test('chat context survives Skills navigation and is isolated between projects', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close()); const { w, q } = f;
  w.Studio.show('chat'); q('#message').value = 'Task'; q('#chat-files').value = 'src/a'; q('#chat-proof').value = 'Test'; q('#chat-goal').value = 'Goal';
  w.Studio.show('extensions'); w.Studio.show('chat');
  assert.equal(q('#chat-files').value, 'src/a'); assert.equal(q('#chat-proof').value, 'Test'); assert.equal(q('#chat-goal').value, 'Goal');
  q('#project').value = 'p2'; q('#project').dispatchEvent(new w.Event('change')); await tick();
  assert.equal(q('#message').value, ''); assert.equal(q('#chat-files').value, '');
});
test('successful send after navigation does not falsely report a delivery error', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close()); const { w, q } = f; let finish;
  f.setHandler(async (url, opts) => { if (url === '/__hq/api/workers' && opts.method === 'POST') return new Promise(resolve => { finish = resolve; }); });
  w.Studio.show('chat'); q('#message').value = 'Task'; q('#chat-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  w.Studio.show('teams'); finish({ id: 'created-worker' }); await tick();
  assert.equal(w.Studio.state.session.p1, 'created-worker'); assert.doesNotMatch(q('#notice').textContent, /unklar|Cannot set/);
});
test('sending does not delete newly typed text while waiting for the runtime', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close()); const { w, q } = f; let finish;
  f.setHandler(async (url, opts) => { if (url === '/__hq/api/workers' && opts.method === 'POST') return new Promise(resolve => { finish = resolve; }); });
  w.Studio.show('chat'); q('#message').value = 'First'; q('#chat-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  q('#message').value = 'Next message'; finish({ id: 'created-worker' }); await tick();
  assert.equal(q('#message').value, 'Next message');
});
test('project switch immediately removes previous project action IDs', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close()); const { w, q } = f;
  w.Studio.show('queue'); assert.ok(q('[data-id="q1"]'));
  f.setHandler(async url => { if (url.includes('p2')) return new Promise(() => {}); });
  q('#project').value = 'p2'; q('#project').dispatchEvent(new w.Event('change'));
  assert.equal(q('[data-id="q1"]'), null);
});
test('all native views render with no links to the previous HQ', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  for (const view of ['overview', 'chat', 'teams', 'queue', 'lessons', 'capacity', 'stats', 'analysis', 'extensions', 'settings']) { f.w.Studio.show(view); assert.ok(f.q('h1'), view); assert.equal(f.q('a[href*="live.html"]'), null); }
});
test('active chat profile is independent of the profile editor selection', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close()); const { w, q } = f;
  w.Studio.state.profiles.push({ id: 'other', name: 'Other', command: 'other', args: [] });
  w.Studio.show('teams'); q('[data-session="w1"]').click();
  w.Studio.show('settings'); q('#settings-profile').value = 'other'; q('#settings-profile').dispatchEvent(new w.Event('change'));
  w.Studio.show('chat'); assert.equal(q('#chat-profile').value, 'codex');
  await tick();
});
test('typing while a project loads survives completion of the project requests', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close()); const { w, q } = f; const pending = [];
  f.setHandler(async url => { if (url.includes('p2')) return new Promise(resolve => pending.push(resolve)); });
  w.Studio.show('chat'); q('#project').value = 'p2'; q('#project').dispatchEvent(new w.Event('change'));
  q('#message').value = 'New project draft'; q('#chat-proof').value = 'Acceptance';
  pending.forEach(resolve => resolve([])); await tick();
  assert.equal(q('#message').value, 'New project draft'); assert.equal(q('#chat-proof').value, 'Acceptance');
});
test('project registration forwards the verdict only as a transient header', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close()); const { w, q } = f;
  f.setHandler(async (url, options) => url === '/__hq/api/projects' && options.method === 'POST' ? { id: 'p1' } : undefined);
  w.Studio.show('settings'); q('#project-name').value = 'First'; q('#project-path').value = '/first'; q('#project-verdict').value = 'fixture-verdict';
  q('#project-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  const request = f.requests.find(r => r.url === '/__hq/api/projects' && r.options.method === 'POST');
  assert.equal(request.options.headers['x-hq-verdict-token'], 'fixture-verdict');
  assert.doesNotMatch(request.options.body, /fixture-verdict/); assert.doesNotMatch(JSON.stringify(w.Studio.state), /fixture-verdict/);
  assert.equal(q('#project-verdict').value, '');
});

test('runtime question optionsJson is rendered as safe text', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  f.w.Studio.state.cache.questions = [{ id: 'q', question: 'Choose', optionsJson: '["Plan","<script>bad</script>"]' }];
  f.w.Studio.show('queue');
  assert.match(f.q('main').textContent, /Optionen: Plan/);
  assert.equal(f.q('main script'), null);
});
