import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OPEN_POINT_TASKS, buildQueueRequests, chooseProject } from '../hq-queue-open-points.mjs';

test('every open point becomes one HQ-Bug queue request that names the bug log', () => {
  const requests = buildQueueRequests(OPEN_POINT_TASKS, 'pj-1', []);
  assert.equal(requests.length, OPEN_POINT_TASKS.length);
  for (const request of requests) {
    assert.equal(request.projectId, 'pj-1');
    assert.match(request.rawText, /^HQ-Bug: /);
    assert.match(request.rawText, /docs\/dev-hq\/BUGS\.md/);
    assert.equal(Number.isInteger(request.priority), true);
  }
  assert.equal(new Set(requests.map(r => r.rawText)).size, requests.length);
});

test('a task already queued for the project is skipped, a cancelled one is re-queued', () => {
  const [first, second] = OPEN_POINT_TASKS;
  const existing = [
    { projectId: 'pj-1', rawText: buildQueueRequests([first], 'pj-1', [])[0].rawText, status: 'queued' },
    { project_id: 'pj-1', raw_text: buildQueueRequests([second], 'pj-1', [])[0].rawText, status: 'cancelled' },
  ];
  const requests = buildQueueRequests(OPEN_POINT_TASKS, 'pj-1', existing);
  assert.equal(requests.length, OPEN_POINT_TASKS.length - 1);
  assert.equal(requests.some(r => r.rawText === existing[0].rawText), false);
  assert.equal(requests.some(r => r.rawText === existing[1].raw_text), true);
});

test('the project is taken from --project, else the single registered one, else refused', () => {
  assert.equal(chooseProject([{ id: 'pj-1' }, { id: 'pj-2' }], 'pj-2').id, 'pj-2');
  assert.equal(chooseProject([{ id: 'pj-1' }], null).id, 'pj-1');
  assert.throws(() => chooseProject([{ id: 'pj-1' }, { id: 'pj-2' }], null), /--project/);
  assert.throws(() => chooseProject([{ id: 'pj-1' }], 'pj-9'), /pj-9/);
});

// Dev-build isolation (docs/setup/dev-build.md, row 7): the queue tool must
// also find the descriptor of a running Dev build.
test('the descriptor search list also covers the dev build identifier', () => {
  const source = readFileSync(new URL('../hq-queue-open-points.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('com.projecta.dev'), 'descriptor candidates must include com.projecta.dev');
});
