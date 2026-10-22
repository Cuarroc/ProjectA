import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('CLI help succeeds without output or baseline side effects', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'design-gate-help-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('./design-gate.mjs', import.meta.url));
  const baselinePath = new URL('./design-gate.baseline.json', import.meta.url);
  const baseline = readFileSync(baselinePath);
  for (const args of [['--help'], ['-h'], ['--help', '--update', '--out', join(cwd, 'custom output')]]) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    assert.equal(result.stderr, '');
    for (const expected of [
      'Usage: npm run design:gate -- [--update] [--out <directory>]',
      'Developer DOM heuristic, not a visual verdict.',
      '-h, --help',
      '--update',
      'Initialize or replace the baseline after validation',
      'never raise ceilings on retained cases',
      '--out <directory>',
      'Write table, PNGs and JSON (default: .pa/design-gate)',
    ]) assert.ok(result.stdout.includes(expected), `Missing help text: ${expected}`);
    assert.deepEqual(readdirSync(cwd), [], 'help must not create default or custom output');
    assert.deepEqual(readFileSync(baselinePath), baseline, 'help must not update the baseline');
  }
  const unknown = spawnSync(process.execPath, [script, '--unknown-option'], { cwd, encoding: 'utf8' });
  assert.ifError(unknown.error);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /Unknown option '--unknown-option'/);
  assert.deepEqual(readdirSync(cwd), []);
  assert.deepEqual(readFileSync(baselinePath), baseline);
});
