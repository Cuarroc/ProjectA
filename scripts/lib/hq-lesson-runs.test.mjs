import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('search excludes the value of --limit from its query', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-lesson-cli-'));
  try {
    const file = join(dir, 'lessons.json');
    writeFileSync(file, JSON.stringify({ lessons: [
      { id: 'L-updater', hits: 1, symptom: 'updater returns 404', cause: 'release manifest is missing', fix: 'publish a complete release manifest', tags: [] },
      { id: 'L-twelve', hits: 1, symptom: 'build error 12', cause: 'fixture contains a numeric code', fix: 'inspect the numeric build code', tags: [] },
    ] }));
    const result = spawnSync(process.execPath, ['scripts/hq-lesson.mjs', 'search', 'updater 404', '--limit', '12'], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, HQ_LESSONS_FILE: file },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /L-updater/);
    assert.doesNotMatch(result.stdout, /L-twelve/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
