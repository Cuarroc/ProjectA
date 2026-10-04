import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBundle, defaultOutDir, redact, sha256 } from './drill-kit.mjs';
test('redact masks descriptor tokens and bearer headers', () => {
  const out = redact('{"port":4711,"token":"abc123SECRETvalue"}\nAuthorization: Bearer abcdef0123456789');
  assert.ok(!out.includes('abc123SECRETvalue') && !out.includes('abcdef0123456789'));
  assert.match(out, /"port":4711/);
  assert.match(out, /"token":"\[REDACTED\]"/);
});
test('redact replaces the user profile directory', () => {
  assert.equal(redact('C:\\Users\\someone\\AppData\\x'), '%USERPROFILE%\\AppData\\x');
});
test('bundle manifest lists steps and hashes of the written bytes with a verdict', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'drill-')), 'out');
  const bundle = createBundle({ outDir: dir, drill: 'backup', appVersion: '1.4.1', commit: 'abc', platform: 'win32' });
  bundle.step('copy', { command: 'cp a b', exitCode: 0 });
  bundle.addFile('log.txt', 'token=hunter2hunter2');
  const manifest = bundle.finish(['GUI']);
  const onDisk = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(onDisk, manifest);
  assert.equal(manifest.result, 'pass');
  assert.equal(manifest.files[0].sha256, sha256(readFileSync(join(dir, 'log.txt'))));
  assert.ok(!readFileSync(join(dir, 'log.txt'), 'utf8').includes('hunter2'));
  assert.deepEqual(manifest.notCovered, ['GUI']);
});
test('a failing step or an empty drill is a failed result', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'drill-')), 'o');
  const b = createBundle({ outDir: dir, drill: 'x' });
  assert.equal(b.finish().result, 'fail');
  b.step('boom', { exitCode: 1 });
  assert.equal(b.finish().result, 'fail');
});
test('default output folder is timestamped under the given directory', () => {
  assert.equal(defaultOutDir('backup-drill', '/w', new Date('2026-10-04T10:00:00.000Z')), join('/w', 'backup-drill-2026-10-04T10-00-00-000Z'));
});
