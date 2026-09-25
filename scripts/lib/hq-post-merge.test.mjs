import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-post-merge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  function run(exe, args) {
    const env = { ...process.env };
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[name];
    const result = spawnSync(exe, args, { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout + result.stderr;
  }
  const git = (...args) => run('git', args);
  git('init', '-q');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'core.autocrlf', 'false');
  mkdirSync(join(dir, '.githooks'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'docs/dev-hq'), { recursive: true });
  copyFileSync(join(root, '.githooks/post-merge'), join(dir, '.githooks/post-merge'));
  copyFileSync(join(root, '.githooks/merge-hqdata'), join(dir, '.githooks/merge-hqdata'));
  writeFileSync(join(dir, 'STAND.md'), 'base');
  writeFileSync(join(dir, 'scripts/dev-hq.mjs'), `
    import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
    import { join } from 'node:path';
    const i = process.argv.indexOf('--out');
    const out = i < 0 ? 'docs/dev-hq' : process.argv[i + 1];
    mkdirSync(out, {recursive: true});
    const json = JSON.stringify({generatedAt: 'new', commit: 'new', value: readFileSync('STAND.md', 'utf8')}, null, 2);
    writeFileSync(join(out, 'data.json'), json + '\\n');
    writeFileSync(join(out, 'data.js'), 'window.HQ_DATA = ' + json + ';\\n');
  `);
  run('node', ['scripts/dev-hq.mjs']);
  git('add', '.'); git('commit', '-qm', 'base');
  const initial = git('rev-parse', 'HEAD').trim();
  const hook = () => run(bash, ['.githooks/post-merge']);
  return {dir, git, run, hook, initial};
}

test('post-merge regenerates when the merge driver retained our snapshot', t => {
  const f = fixture(t);
  writeFileSync(join(f.dir, '.gitattributes'), 'docs/dev-hq/data.* merge=hqdata\n');
  f.git('add', '.'); f.git('commit', '-qm', 'attributes');
  f.git('config', 'merge.hqdata.driver', 'bash .githooks/merge-hqdata %O %A %B %P');
  f.git('checkout', '-qb', 'topic');
  writeFileSync(join(f.dir, 'STAND.md'), 'topic');
  f.run('node', ['scripts/dev-hq.mjs']);
  f.git('commit', '-qam', 'topic snapshot');
  f.git('checkout', '-q', '-');
  for (const name of ['data.json', 'data.js']) {
    const path = join(f.dir, 'docs/dev-hq', name);
    writeFileSync(path, readFileSync(path, 'utf8').replace('"base"', '"ours"'));
  }
  f.git('commit', '-qam', 'ours snapshot');
  f.git('merge', '--no-edit', 'topic');
  assert.equal(f.git('diff', '--name-only', 'ORIG_HEAD', 'HEAD', '--', 'docs/dev-hq').trim(), '');
  f.hook();
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'docs/dev-hq/data.json'), 'utf8')).value, 'topic');
});

test('post-merge preserves pre-existing snapshot edits', t => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'docs/dev-hq/data.json'), '{"committed":true}\n');
  f.git('commit', '-qam', 'snapshot');
  f.git('update-ref', 'ORIG_HEAD', f.initial);
  const path = join(f.dir, 'docs/dev-hq/data.json');
  writeFileSync(path, 'uncommitted user work\n');
  const other = readFileSync(join(f.dir, 'docs/dev-hq/data.js'), 'utf8');
  const output = f.hook();
  assert.equal(readFileSync(path, 'utf8'), 'uncommitted user work\n');
  assert.equal(readFileSync(join(f.dir, 'docs/dev-hq/data.js'), 'utf8'), other);
  assert.match(output, /lokale|local|dirty/i);
});

test('post-merge ignores only generation metadata and notices source-only changes', t => {
  const f = fixture(t);
  for (const name of ['data.js', 'data.json']) {
    const path = join(f.dir, 'docs/dev-hq', name);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('"new"', '"old"'));
  }
  f.git('commit', '-qam', 'old generation stamps');
  f.git('update-ref', 'ORIG_HEAD', f.initial);
  f.hook();
  assert.equal(f.git('status', '--porcelain').trim(), '');
  writeFileSync(join(f.dir, 'STAND.md'), 'updated');
  f.git('commit', '-qam', 'source only');
  f.hook();
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'docs/dev-hq/data.json'), 'utf8')).value, 'updated');
});

test('post-merge preserves staged snapshot edits', t => {
  const f = fixture(t);
  const path = join(f.dir, 'docs/dev-hq/data.json');
  writeFileSync(path, 'staged user work\n');
  f.git('add', 'docs/dev-hq/data.json');
  f.hook();
  assert.equal(readFileSync(path, 'utf8'), 'staged user work\n');
  assert.equal(f.git('show', ':docs/dev-hq/data.json'), 'staged user work\n');
});

test('post-merge generator failure cannot publish a partial pair', t => {
  const f = fixture(t);
  const before = readFileSync(join(f.dir, 'docs/dev-hq/data.json'), 'utf8');
  writeFileSync(join(f.dir, 'scripts/dev-hq.mjs'), `
    import {writeFileSync} from 'node:fs';
    import {join} from 'node:path';
    writeFileSync(join(process.argv[process.argv.indexOf('--out') + 1], 'data.json'), 'partial');
    process.exit(1);
  `);
  const result = spawnSync(bash, ['.githooks/post-merge'], {cwd: f.dir, encoding: 'utf8'});
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(readFileSync(join(f.dir, 'docs/dev-hq/data.json'), 'utf8'), before);
});

test('post-merge retains lessons with the real HQ generator', t => {
  const f = fixture(t);
  copyFileSync(join(root, 'docs/dev-hq/lessons.json'), join(f.dir, 'docs/dev-hq/lessons.json'));
  writeFileSync(join(f.dir, 'scripts/dev-hq.mjs'), `
    import {spawnSync} from 'node:child_process';
    const result = spawnSync(process.execPath, [${JSON.stringify(join(root, 'scripts/dev-hq.mjs'))}, '--root', ${JSON.stringify(root)}, ...process.argv.slice(2)], {stdio: 'inherit'});
    process.exit(result.status ?? 1);
  `);
  f.git('add', '.'); f.git('commit', '-qm', 'real generator');
  f.hook();
  const actual = JSON.parse(readFileSync(join(f.dir, 'docs/dev-hq/data.json'), 'utf8'));
  const source = JSON.parse(readFileSync(join(root, 'docs/dev-hq/lessons.json'), 'utf8'));
  assert.ok(actual.lessons.length > 0);
  assert.equal(actual.lessons.length, Array.isArray(source) ? source.length : source.lessons.length);
});
