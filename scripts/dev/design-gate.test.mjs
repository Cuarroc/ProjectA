import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { measure, ratchet } from './design-gate.mjs';

let browser, page;
before(async () => {
  browser = await chromium.launch({ args: ['--disable-gpu', '--disable-dev-shm-usage'] });
  page = await browser.newPage();
});
after(async () => { await browser?.close(); });
async function inspect(html) {
  await page.setContent(`<style>body{margin:0}.box{background:#eee} .row{height:40px}</style>${html}`);
  return page.evaluate(measure);
}

test('600px panel with two 40px rows has 520px slack', async () => {
  const result = await inspect('<section class="box" style="height:600px"><div class="row"><button style="height:40px">One</button></div><div class="row"><button style="height:40px">Two</button></div></section>');
  assert.equal(result.slack.length, 1);
  assert.equal(result.slack[0].slack, 520);
});
test('three nested boxes exceed depth two', async () => {
  const result = await inspect('<section class="box"><div class="box"><span class="box">Content</span></div></section>');
  assert.equal(result.nesting.length, 1);
  assert.equal(result.nesting[0].depth, 3);
});
test('selected empty and placeholder tabs are violations', async () => {
  const result = await inspect('<button role="tab" aria-selected="true" aria-controls="empty">Empty</button><div id="empty" role="tabpanel"></div><section class="g-shell-panel"><nav class="g-shell-tabs"><a aria-current="page">Later</a></nav><h1>Later</h1><p class="g-shell-note">Not connected</p></section>');
  assert.equal(result.tabs.length, 2);
});
test('compact lists and two boxes are not violations', async () => {
  const result = await inspect('<section class="box" style="height:80px"><div class="box row">One</div><div class="row">Two</div></section><button role="tab" aria-selected="true" aria-controls="full">Full</button><div id="full" role="tabpanel"><p>Useful content</p></div><button role="tab" aria-selected="false" aria-controls="lazy">Lazy</button><div id="lazy" hidden></div><button role="tab" aria-selected="true">Unassociated legacy tab</button>');
  assert.deepEqual(Object.values(result).map(v => v.length), [0, 0, 0, 0, 0]);
});
test('hidden text cannot conceal slack and thresholds are strict', async () => {
  const result = await inspect('<section class="box" style="height:600px"><button style="height:40px">One</button><p style="visibility:hidden;margin-top:480px">Hidden</p></section><section class="box" style="height:200px"><button style="height:80px">Boundary</button></section>');
  assert.equal(result.slack.length, 1);
  assert.equal(result.slack[0].slack, 560);
});
test('uppercase eyebrows and equal fractional grids are reported', async () => {
  const result = await inspect('<h2 style="font-size:12px;text-transform:uppercase">Section</h2><div style="display:grid;grid-template-columns:1fr 1fr"><div>One</div><div>Two</div></div>');
  assert.equal(result.eyebrows.length, 1);
  assert.equal(result.grids.length, 1);
});

test('slack must exceed 120px even when its share exceeds 35 percent', async () => {
  const result = await inspect('<section id="at" class="box" style="height:300px"><button style="height:180px">At</button></section><section id="over" class="box" style="height:300px"><button style="height:179px">Over</button></section>');
  assert.deepEqual(result.slack, [{ element: '#over', height: 300, slack: 121, percent: 40 }]);
});
test('slack must exceed 35 percent even when it exceeds 120px', async () => {
  const result = await inspect('<section id="at" class="box" style="height:400px"><button style="height:260px">At</button></section><section id="over" class="box" style="height:400px"><button style="height:259px">Over</button></section>');
  assert.deepEqual(result.slack, [{ element: '#over', height: 400, slack: 141, percent: 35 }]);
});
test('nesting counts the element itself as the first box level', async () => {
  const result = await inspect('<section class="box"><div class="box"><button id="third">Three</button></div></section>');
  assert.deepEqual(result.nesting, [{ element: '#third', depth: 3 }]);
});
test('uppercase eyebrows include 14px but exclude 15px and mixed case', async () => {
  const result = await inspect('<span id="at" style="font-size:14px">LABEL</span><span style="font-size:15px">LABEL</span><span style="font-size:14px">Label</span>');
  assert.deepEqual(result.eyebrows, [{ element: '#at', text: 'LABEL' }]);
});
test('grids require equal tracks and an authored 1fr rule', async () => {
  const result = await inspect('<div id="equal" style="display:grid;width:400px;grid-template-columns:1fr 1fr">Equal</div><div style="display:grid;width:400px;grid-template-columns:1fr 2fr">Unequal</div><div style="display:grid;grid-template-columns:200px 200px">Fixed</div>');
  assert.deepEqual(result.grids, [{ element: '#equal', columns: 2 }]);
});
test('ratchet rejects rises and missing cases but accepts falls', () => {
  assert.equal(ratchet({ screen: [2, 0, 0, 0, 0] }, { screen: [1, 0, 0, 0, 0] }).length, 1);
  assert.deepEqual(ratchet({ screen: [0, 0, 0, 0, 0] }, { screen: [1, 0, 0, 0, 0] }), []);
  assert.equal(ratchet({}, { screen: [1, 0, 0, 0, 0] }).length, 1);
  assert.equal(ratchet({ extra: [0, 0, 0, 0, 0] }, {}).length, 1);
  assert.throws(() => ratchet({ screen: [NaN] }, { screen: [1, 0, 0, 0, 0] }), /invalid/i);
});

test('update accepts changed case sets but rejects rises on retained cases', () => {
  const baseline = { retained: [1, 0, 0, 0, 0], removed: [2, 0, 0, 0, 0] };
  const current = { retained: [0, 0, 0, 0, 0], added: [3, 0, 0, 0, 0] };
  assert.deepEqual(ratchet(current, baseline, true), []);
  assert.equal(ratchet(current, baseline).length, 2);
  assert.deepEqual(ratchet({ ...current, retained: [2, 0, 0, 0, 0] }, baseline, true), ['retained slack: 2 > 1']);
  assert.throws(() => ratchet({ added: [-1, 0, 0, 0, 0] }, baseline, true), /invalid/i);
});
test('unrendered app content cannot produce a green snapshot', async () => {
  await assert.rejects(inspect('<main class="g-shell-content"><div hidden>Legacy</div></main>'), /not ready/i);
});
