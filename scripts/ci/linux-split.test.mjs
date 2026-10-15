import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gates = (lane) => execFileSync('bash', ['scripts/ci/gates.sh', '--list', lane], { encoding: 'utf8' }).trim().split('\n');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const job = (id) => ci.match(new RegExp(`^  ${id}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[1] ?? '';

test('Linux sub-lanes run every Linux gate exactly once', () => {
  const parts = [...gates('linux_1'), ...gates('linux_2')];
  assert.deepEqual(parts.sort(), gates('linux').sort());
  assert.equal(new Set(parts).size, parts.length);
});

test('Linux required check aggregates both legs and fails closed', () => {
  const aggregate = job('linux');
  assert.match(aggregate, /name: gates \(linux\)/);
  assert.match(aggregate, /needs: \[linux_1, linux_2\]/);
  assert.match(aggregate, /if:.*always\(\)/);
  assert.match(aggregate, /RUST_RESULT: \$\{\{ needs\.linux_1\.result \}\}/);
  assert.match(aggregate, /FRONTEND_RESULT: \$\{\{ needs\.linux_2\.result \}\}/);
  const verdict = aggregate.match(/run: (test .*success.*)/)?.[1];
  assert.ok(verdict);
  for (const rust of ['success', 'failure', 'cancelled', 'skipped', '']) {
    for (const frontend of ['success', 'failure', 'cancelled', 'skipped', '']) {
      assert.equal(spawnSync('bash', ['-c', verdict], {
        env: { ...process.env, RUST_RESULT: rust, FRONTEND_RESULT: frontend },
      }).status, rust === 'success' && frontend === 'success' ? 0 : 1);
    }
  }
  for (const lane of ['linux_1', 'linux_2']) {
    assert.match(job(lane), new RegExp(`gates.sh lane ${lane}`));
    assert.doesNotMatch(job(lane), /^    needs:/m);
  }
});
