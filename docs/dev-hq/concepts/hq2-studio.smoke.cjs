const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'hq2-concept.html'), 'utf8');
let narrow = true;
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost/hq2-studio.html',
  beforeParse(window) {
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    window.matchMedia = query => ({ matches: narrow && query.includes('max-width: 1200px') });
  },
});
const d = dom.window.document;
dom.window.eval(fs.readFileSync(path.join(__dirname, 'studio-analysis.js'), 'utf8'));
const q = selector => d.querySelector(selector);
const change = element => element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const input = element => element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

// Every navigation destination must be in the same managed content region.
for (const button of d.querySelectorAll('.nav [data-view]')) {
  const section = d.getElementById(button.dataset.view);
  assert.equal(section?.parentElement, q('main'), button.dataset.view + ' must remain inside main');
  button.click();
  assert.equal(section.hidden, false, button.dataset.view + ' must open');
  assert.equal(d.querySelectorAll('main > .section:not([hidden])').length, 1);
}
q('[data-view="overview"]').click();

assert.match(q('#hero-task').textContent, /HQ-Kontextfluss/);
assert.equal(q('#overview .grid').firstElementChild.querySelector('h2').textContent, 'Als Nächstes');
assert.match(q('#brief-full').textContent, /docs\/PLAN.md/);

q('#work').hidden = false;
q('#work .row button.link').click();
assert.equal(d.activeElement, q('#task-action h2'));
assert.match(q('#task-action').textContent, /Aussage und Prüfstand/);
assert.match(q('#brief-full').textContent, /task_multi_harness/);
assert.doesNotMatch(q('#brief-full').textContent, /STAND.md/);
assert.equal(q('#task-action .btn.primary').disabled, true);
q('#tab-evidence').focus();
q('#tab-evidence').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
assert.equal(q('#tab-assist').getAttribute('aria-selected'), 'true');
assert.equal(d.activeElement, q('#tab-assist'));
q('#tab-assist').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
assert.equal(q('#tab-evidence').getAttribute('aria-selected'), 'true');

const ready = [...q('#task-list').querySelectorAll('.row')].find(row => row.textContent.includes('HQ-Kontextfluss'));
ready.querySelector('button.link').click();
assert.match(q('#brief-full').textContent, /STAND.md/);
assert.doesNotMatch(q('#brief-full').textContent, /task_multi_harness/);
assert.equal(q('#task-action .btn.primary').disabled, false);
q('#task-action .btn.primary').click();
assert.equal(q('#dispatch-dialog').open, true);
q('#dispatch-confirm').click();
assert.match(q('#fleet-list').textContent, /HQ-Kontextfluss/);

q('#search').focus(); q('#search').value = 'Multi-Harness'; input(q('#search'));
assert.match(q('#task-list').textContent, /Quelle/);
assert.equal(d.activeElement, q('#search'));
const sourceHit = [...q('#task-list').querySelectorAll('button')].find(button => button.textContent === 'Im Kontext öffnen');
sourceHit.click();
assert.equal(q('#context-dialog').open, true);
assert.match(q('#context-dialog-title').textContent, /Multi-Harness/);
q('#context-dialog').close();
q('#search').value = ''; input(q('#search'));
assert.equal(q('#task-list').querySelectorAll('.row').length, 3);

q('[data-view="decisions"]').click();
q('#decision-evidence').click();
assert.equal(q('#context-dialog').open, true);
assert.match(q('#context-dialog-sources').textContent, /Abnahmefolge/);
q('#context-dialog').close();
q('#decision-hold').click();
assert.equal(q('#metric-decisions').textContent, '0');
q('#project').value = 'devhq'; change(q('#project'));
assert.equal(q('#metric-decisions').textContent, '1');
q('#project').value = 'projecta'; change(q('#project'));
assert.equal(q('#metric-decisions').textContent, '0');
narrow = false;
q('[data-view="decisions"]').click();
q('#decision-evidence').click();
assert.equal(d.activeElement, q('#inspector-title'));

q('[data-view="settings"]').click();
q('#density').value = 'compact'; change(q('#density'));
assert.equal(d.documentElement.dataset.density, 'compact');
q('#typeface').value = 'recursive'; change(q('#typeface'));
assert.equal(d.documentElement.dataset.type, 'recursive');
q('#inspector-setting').checked = false; change(q('#inspector-setting'));
assert.equal(q('#inspector').hidden, true);
assert.equal(d.documentElement.dataset.inspector, 'off');
narrow = false;
q('[data-view="decisions"]').click();
q('#decision-evidence').click();
assert.equal(q('#context-dialog').open, true);
q('#context-dialog').close();
q('#hide-guide').focus();
q('#hide-guide').click();
assert.equal(q('#guidance').hidden, true);
assert.equal(d.activeElement, q('.nav button[aria-current=page]'));

q('[data-view="chat"]').click();
q('#chat-provider').value = 'Codex Max'; change(q('#chat-provider'));
assert.equal(q('#handoff-banner').hidden, false);
q('#handoff-open').click();
assert.match(q('#handoff-brief').textContent, /Aussage/);
q('#handoff-confirm').click();
assert.match(q('#chat-log').textContent, /Übergebenes Briefing/);
q('#chat-provider').value = 'Claude Max'; change(q('#chat-provider'));
assert.doesNotMatch(q('#chat-log').textContent, /Übergebenes Briefing/);

assert.ok(fs.existsSync(path.join(__dirname, 'dev-hq-mark-v1.png')));
assert.ok(fs.existsSync(path.join(__dirname, 'dev-hq-convergence-v1.png')));
q('#project').value = 'projecta'; change(q('#project'));
q('[data-view="analysis"]').click();
assert.match(q('#analysis-kind').textContent, /Tauri/);
q('[data-analysis="structure"]').click();
assert.equal(q('[data-analysis-panel="structure"]').hidden, false);
q('#analysis-map button:nth-child(2)').click();
assert.match(q('#analysis-detail').textContent, /Runtime/);
q('#analysis-context').click();
assert.match(q('#context-dialog-body').textContent, /src-tauri\/src/);
q('#context-dialog').close();
q('#analysis-draft').click();
assert.equal(q('#task-dialog').open, true);
assert.equal(q('#task-owner').value, 'src-tauri/src/');
assert.match(q('#task-proof').value, /Quelle:/);
q('#task-dialog').close();
q('#add-task').click();
assert.equal(q('#task-owner').value, '', 'manual draft cannot reuse cancelled analysis ownership');
q('#task-dialog').close();
q('[data-analysis="summary"]').click();
q('#analysis-next button').click();
assert.equal(d.activeElement, q('[data-analysis="gates"]'));
q('[data-analysis="gates"]').click();
assert.equal(q('#analysis-gates').children.length, 5);
q('#project').value = 'devhq'; change(q('#project'));
q('[data-view="analysis"]').click();
assert.equal(q('#analysis-gates').children.length, 3);
assert.doesNotMatch(q('#analysis-gates').textContent, /Recovery/);
q('[data-view="live-hq"]').click();
assert.equal(q('#legacy-links').querySelectorAll('a').length, 8);
q('#live-base').value = 'https://example.org/live.html'; q('#live-apply').click();
assert.match(q('#live-link-status').textContent, /Bitte eine lokale/);
q('#live-base').value = 'http://127.0.0.1:4173/live.html'; q('#live-apply').click();
assert.equal(q('#legacy-links a').href, 'http://127.0.0.1:4173/live.html#teams');
// Every source route points to an actual existing anchor in the legacy document.
const hqSource = fs.readFileSync(path.join(__dirname, '../hq.js'), 'utf8');
const workspaceSource = fs.readFileSync(path.join(__dirname, '../workspace.js'), 'utf8');
for (const a of q('#legacy-links').querySelectorAll('a')) {
  const hash = new URL(a.href).hash.slice(1);
  assert.ok(hqSource.includes('id="' + hash + '"') || workspaceSource.includes("['" + hash + "',"), a.href);
}
assert.ok(fs.existsSync(path.join(__dirname, 'studio-premium.css')));
q('#new-project').click();
q('#project-name').value = 'Fresh'; q('#project-path').value = 'C:\\Fresh'; q('#project-create').click();
q('[data-view="analysis"]').click();
assert.equal(q('#analysis-map').children.length, 0);
q('[data-analysis="compare"]').click(); q('#analysis-benchmark').click();
assert.equal(q('#task-owner').value, 'C:\\Fresh');
assert.match(q('#task-proof').value, /Quellenzuordnung offen/);
q('#task-dialog').close();
console.log('HQ2 Studio DOM smoke OK');
dom.window.close();
