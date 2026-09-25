import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256File } from '../dev-setup.mjs';

test('manifest digest ignores checkout line endings like the compiled runtime does', t => {
  const root = mkdtempSync(join(tmpdir(), 'hq-runtime-crlf-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lf = join(root, 'lf.json');
  const crlf = join(root, 'crlf.json');
  writeFileSync(lf, '{\n  "profiles": []\n}\n');
  writeFileSync(crlf, '{\r\n  "profiles": []\r\n}\r\n');
  assert.equal(sha256File(crlf), sha256File(lf));
});
