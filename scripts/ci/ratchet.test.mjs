import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const script = resolve('scripts/ci/ratchet.mjs');
const defaults = { 'ts-suppress': 1, 'eslint\u002ddisable': 0, 'rust-allow': 0, 'ts-any': 0, 'state-token': 1 };
function fixture(t, ceilings = defaults) {
  const cwd = mkdtempSync(join(tmpdir(), 'ratchet-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  const put = (path, text) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  const run = (mode = 'check') => spawnSync(process.execPath, [script, mode], { cwd, encoding: 'utf8' });
  git('init', '-q');
  put('scripts/ci/ratchets.json', JSON.stringify(ceilings));
  put('src/base.ts', '// @ts-ignore old\n');
  put('src/styles.css', ':root { --state-fg: red; }\n');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=invalid', 'commit', '-qm', 'fixture');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { cwd, git, put, run };
}

test('count above ceiling fails with the new findings', t => {
  const { put, run } = fixture(t);
  put('src/base.ts', '\n// @ts-ignore old\n// @ts-expect-error new\n');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /ts-suppress: 2 > 1/);
  assert.match(result.stdout, /src\/base.ts:3:4.*@ts-expect-error new/);
  assert.doesNotMatch(result.stdout, /@ts-ignore old/);
});

test('update lowers a ceiling but never raises it', t => {
  const { cwd, put, run } = fixture(t, { ...defaults, 'ts-suppress': 2 });
  assert.equal(run('update').status, 0);
  const path = join(cwd, 'scripts/ci/ratchets.json');
  const lowered = readFileSync(path, 'utf8');
  assert.equal(JSON.parse(lowered)['ts-suppress'], 1);
  assert.equal(lowered, JSON.stringify(defaults, null, 2) + '\n');
  put('src/base.ts', '// @ts-ignore twice @ts-ignore\n');
  assert.equal(run('update').status, 1);
  assert.equal(readFileSync(path, 'utf8'), lowered);
});

test('count below ceiling passes with a lower hint', t => {
  const { run } = fixture(t, { ...defaults, 'ts-suppress': 2 });
  const result = run();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ts-suppress: 1 < 2/);
  assert.match(result.stdout, /Grenze senken: node scripts\/ci\/ratchet.mjs update/);
});

test('untracked files do not count and repeated checks are deterministic', t => {
  const { put, run } = fixture(t);
  put('src/untracked.ts', '// @ts-ignore\n');
  const first = run();
  assert.equal(first.status, 0);
  assert.equal(run().stdout, first.stdout);
});

test('empty and incomplete ceilings fail closed', t => {
  const { put, run } = fixture(t, {});
  assert.equal(run().status, 1);
  assert.match(run().stderr, /keine Zähler/);
  put('scripts/ci/ratchets.json', '');
  assert.match(run().stderr, /keine Zähler/);
  for (const value of ['', '{', '{"ts-suppress": 9}', JSON.stringify({ ...defaults, 'ts-any': -1 })]) {
    put('scripts/ci/ratchets.json', value);
    assert.equal(run().status, 1);
  }
});

test('missing origin main reports all findings and staged files count', t => {
  const { git, put, run } = fixture(t);
  git('update-ref', '-d', 'refs/remotes/origin/main');
  put('src/new file.ts', '// @ts-expect-error added\n');
  git('add', 'src/new file.ts');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /origin\/main.*all findings/);
  assert.match(result.stdout, /src\/base.ts:1:4/);
  assert.match(result.stdout, /src\/new file.ts:1:4/);
});

test('a second --state- definition outside src/design turns the check red', t => {
  const { git, put, run } = fixture(t);
  assert.equal(run().status, 0);
  put('src/design/state/tokens.css', ':root { --state-fg: red; --state-new: 1; }\n');
  git('add', '.');
  assert.equal(run().status, 0, 'src/design is the one dictionary and stays uncounted');
  put('src/components/Badge.css', '.badge { --state-foo: x; }\n');
  git('add', '.');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /state-token: 2 > 1/);
  assert.match(result.stdout, /src\/components\/Badge.css:1:10.*--state-foo: x;/);
});

test('pure counters honor paths and occurrences and test exclusions', async () => {
  const { countFiles, counters } = await import('./ratchet.mjs');
  const files = [
    ['src/a.tsx', '// @ts-ignore @ts-expect-error\nlet x: any; x as any;'],
    ['src/a.test.ts', 'let x: any; // @ts-ignore'],
    ['src/a.css', 'eslint\u002ddisable eslint\u002ddisable-next-line'],
    ['scripts/nested/a.mjs', 'eslint\u002ddisable-line'],
    ['src-tauri/src/a.rs', '#[allow(dead_code)] #![allow(unused)]'],
    ['other/a.ts', '@ts-ignore : any'], ['scripts/a.ts', 'eslint\u002ddisable'],
    ['src/no.ts', 'let x: anyone; x as anything;'],
    ['src/folder.test.data/production.ts', 'let x: any;'],
    ['src/a.css', 'a { color: var(--state-fg); --state-bg: red; }'],
    ['src/design/state/a.css', '--state-fg: red;'], ['docs/a.md', '--state-fg'],
  ];
  assert.deepEqual(Object.fromEntries(Object.entries(countFiles(files)).map(([k, v]) => [k, v.length])),
    { 'ts-suppress': 3, 'eslint\u002ddisable': 3, 'rust-allow': 2, 'ts-any': 3, 'state-token': 2 });
  assert.deepEqual(countFiles(files), countFiles([...files].reverse()));
  assert.equal(counters.length, 5);
  assert.ok(counters.every(c => c.name && c.pathFilter && c.regex && c.reason));
});
