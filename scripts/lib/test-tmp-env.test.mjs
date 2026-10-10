// KI-TMP: node tests must not leave directories in the real temp dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRELOAD = './scripts/lib/test-tmp-env.mjs';

// Runs `code` in a child with the preload; the child's real temp dir is a
// private sandbox, so anything left behind is visible here.
function runWithPreload(code, extraEnv = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'ki-tmp-sandbox-'));
  try {
    const env = { ...process.env, TMPDIR: sandbox, TMP: sandbox, TEMP: sandbox, ...extraEnv };
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(join(root, PRELOAD)).href, '-e', code], { cwd: root, env, encoding: 'utf8' });
    return { run, left: readdirSync(sandbox) };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

const MAKE_DIRS = `
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-'));
  fs.writeFileSync(path.join(d, 'f'), 'x');
  fs.mkdirSync(path.join(d, 'sub'));
  fs.promises.mkdtemp(path.join(os.tmpdir(), 'leak-async-')).then((a) => console.log(d + '\\n' + a));
`;

test('test-tmp preload removes temp dirs created by the test process on exit', () => {
  const { run, left } = runWithPreload(MAKE_DIRS);
  assert.equal(run.status, 0, run.stderr);
  const [sync, async] = run.stdout.trim().split('\n');
  assert.ok(sync && async, 'child printed both dirs');
  assert.deepEqual(left, [], 'nothing stays in the real temp dir');
  assert.equal(existsSync(sync), false);
  assert.equal(existsSync(async), false);
});

test('test-tmp preload redirects os.tmpdir() into a private directory', () => {
  const { run } = runWithPreload(`console.log(require('node:os').tmpdir())`);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout.trim(), /pa-test-[^/\\]+$/);
});

test('test-tmp preload cleans up when the test process fails', () => {
  const { run, left } = runWithPreload(`${MAKE_DIRS}; setTimeout(() => process.exit(3), 50);`);
  assert.equal(run.status, 3);
  assert.deepEqual(left, []);
});

test('test-tmp preload removes a sandbox that holds an unreadable (mode 000) directory', { skip: process.platform === 'win32' && 'chmod 000 has no effect on Windows' }, () => {
  const { run, left } = runWithPreload(`
    const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'locked-'));
    fs.mkdirSync(path.join(d, 'inner', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(d, 'inner', 'f'), 'x');
    fs.chmodSync(path.join(d, 'inner', 'deep'), 0o000);
    fs.chmodSync(path.join(d, 'inner'), 0o000);
    console.log(d);
  `);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(left, [], 'sandbox with mode-000 subdirectories is removed');
  assert.equal(existsSync(run.stdout.trim()), false);
});

// A forgotten `--import` silently brings the leak back, so every node test
// runner in package.json is checked, not a hand-picked list.
test('every node --test script in package.json loads the temp-dir preload', () => {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  const runners = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const part of cmd.split('&&')) {
      if (/\bnode\b[^&|]*\s--test\b/.test(part)) runners.push([name, part]);
    }
  }
  const names = runners.map(([name]) => name);
  for (const expected of ['test:hq', 'test:denkraum', 'test:hq:visual']) {
    assert.ok(names.includes(expected), `${expected} runs node --test (guard would be vacuous otherwise)`);
  }
  for (const [name, part] of runners) {
    assert.ok(part.includes(`--import ${PRELOAD}`), `${name} must run node --test with --import ${PRELOAD}`);
  }
});

test('node test runners for scripts/lib and tools/denkraum load the temp-dir preload', () => {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  for (const name of ['test:hq', 'test:denkraum']) {
    assert.ok(scripts[name].includes(`--import ${PRELOAD}`), `${name} must run node --test with --import ${PRELOAD}`);
  }
});
