import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackLesson } from './hq-lessons.mjs';
test('repeated feedback from a single run cannot inflate lesson confidence', () => {
  const initial = [{ id: 'L-one', hits: 1 }];
  assert.throws(() => feedbackLesson(initial, 'L-one', 'worked'), /runId/);
  const once = feedbackLesson(initial, 'L-one', 'worked', '2026-09-10', 'run-1');
  const twice = feedbackLesson(once, 'L-one', 'worked', '2026-09-11', 'run-1');
  assert.deepEqual(twice, once);
  assert.throws(() => feedbackLesson(once, 'L-one', 'failed', '2026-09-11', 'run-1'), /already/);
  assert.equal(feedbackLesson(once, 'L-one', 'worked', '2026-09-11', 'run-2')[0].worked, 2);
});
