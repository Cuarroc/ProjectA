import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const script = resolve('scripts/ci/package-size.mjs');
const configPath = 'scripts/ci/package-size.json';
const config = { schemaVersion: 1, maximumLines: 300 };
function fixture(t, bootstrap = false, overrides = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'package-size-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of Object.keys(env).filter(key => /^(GIT_|GITHUB_|BASE_SHA$|HEAD_SHA$|PA_SIZE_BASE$|EVENT_NAME$)/.test(key))) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  const put = (path, content) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@noreply.local',
      'commit', '-qm', 'fixture', '--allow-empty');
    return git('rev-parse', 'HEAD');
  };
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  if (!bootstrap) put(configPath, JSON.stringify({ ...config, ...overrides }) + '\n');
  put('old.txt', 'old\n'.repeat(12));
  const base = commit();
  env.BASE_SHA = base;
  git('update-ref', 'refs/remotes/origin/main', base);
  return { cwd, git, put, commit, run, base, env };
}
function expectResult(result, status, additions, deletions) {
  assert.equal(result.status, status, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`additions=${additions} deletions=${deletions} total=${additions + deletions} maximumLines=300`));
}

test('package size accepts 300 lines and rejects the 417 line regression', t => {
  const { put, commit, run, base } = fixture(t);
  expectResult(run(), 0, 0, 0);
  for (const lines of [300, 301, 417]) {
    put('new.txt', 'added\n'.repeat(lines));
    const head = commit();
    const result = run('--base', 'origin/main', '--head', head);
    expectResult(result, lines === 300 ? 0 : 1, lines, 0);
    assert.match(result.stdout, new RegExp(`base=${base} mergeBase=${base} head=${head}`));
  }
  expectResult(run('--base', 'HEAD', '--head', 'HEAD'), 0, 0, 0);
});

test('package size counts additions deletions tests and renames against the merge base', t => {
  const { cwd, git, put, commit, run, base } = fixture(t);
  renameSync(join(cwd, 'old.txt'), join(cwd, 'renamed.txt'));
  put('tests/new.test.mjs', '// test\n'.repeat(3));
  put('docs/space tab\tnewline\n.md', 'doc\n'.repeat(4));
  put(configPath, JSON.stringify(config, null, 2) + '\n');
  const head = commit();
  expectResult(run(), 0, 23, 13);
  git('checkout', '-q', '--detach', base);
  put('base-only.txt', 'unrelated\n'.repeat(500));
  const diverged = commit();
  const result = run('--base', diverged, '--head', head);
  expectResult(result, 0, 23, 13);
  assert.match(result.stdout, new RegExp(`base=${diverged} mergeBase=${base} head=${head}`));
});

test('package size fails closed for raised limits binary changes and invalid refs', t => {
  const { put, commit, run, git, base } = fixture(t);
  expectResult(run(), 0, 0, 0);
  for (const args of [['--base', 'missing-ref'], ['--head', 'missing-ref'],
    ['--base', '--help'], ['--maximumLines', '999'], ['--head']]) {
    assert.equal(run(...args).status, 2);
  }
  put('binary.dat', Buffer.from([0, 1, 2]));
  commit();
  const binary = run();
  assert.equal(binary.status, 1);
  assert.match(binary.stderr, /BLOCKIERT.*not numerically measurable.*binary.dat/);
  assert.match(binary.stdout, /additions=unmeasurable deletions=unmeasurable total=unmeasurable/);
  git('checkout', '-q', '--detach', base);
  for (const content of [JSON.stringify({ ...config, maximumLines: 301 }),
    JSON.stringify({ ...config, schemaVersion: 2 }), '{', '{}']) {
    put(configPath, content);
    commit();
    assert.equal(run().status, 2);
  }
  git('checkout', '-q', '--detach', base);
  renameSync(join(git('rev-parse', '--show-toplevel'), configPath),
    join(git('rev-parse', '--show-toplevel'), 'removed-config.json'));
  commit();
  assert.equal(run().status, 2);

  const fresh = fixture(t, true);
  expectResult(fresh.run(), 0, 0, 0);
  fresh.put(configPath, JSON.stringify({ ...config, maximumLines: 301 }));
  fresh.commit();
  assert.equal(fresh.run().status, 2);
  fresh.put(configPath, JSON.stringify(JSON.parse(readFileSync(configPath, 'utf8'))) + '\n');
  fresh.commit();
  expectResult(fresh.run(), 0, 1, 0);
});

test('package size skips merge_group and other non PR events', t => {
  const { cwd, put, commit, run, env, base } = fixture(t);
  put('large.txt', 'line\n'.repeat(417));
  const head = commit();
  for (const event of ['merge_group', 'push', 'schedule', 'workflow_dispatch']) {
    env.GITHUB_EVENT_NAME = event;
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`package-size: skipped \\(${event}\\)`));
  }
  env.GITHUB_EVENT_NAME = 'pull_request';
  assert.equal(run().status, 1);
  delete env.BASE_SHA;
  assert.equal(run().status, 2);
  env.GITHUB_EVENT_PATH = join(cwd, 'event.json');
  put('event.json', JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }));
  env.PA_SIZE_BASE = head;
  expectResult(run('--base', head, '--head', base), 1, 417, 0);
});

test('package size warns locally without an explicit base', t => {
  const { put, commit, run, env, base } = fixture(t);
  put('stack.txt', 'line\n'.repeat(417));
  const stack = commit();
  delete env.BASE_SHA;
  const result = run();
  expectResult(result, 0, 417, 0);
  assert.match(result.stdout + result.stderr, /WARNING/);
  env.PA_SIZE_BASE = base;
  assert.equal(run().status, 1);
  env.PA_SIZE_BASE = stack;
  expectResult(run(), 0, 0, 0);
});

test('package size excludes lockfiles and validates trusted exclusions', t => {
  const excludedPaths = ['package-lock.json', 'Cargo.lock', 'src-tauri/Cargo.lock', 'docs/dev-hq/data.*'];
  const { put, commit, run, git, base } = fixture(t, false, { excludedPaths });
  for (const path of ['package-lock.json', 'Cargo.lock', 'src-tauri/Cargo.lock', 'docs/dev-hq/data.js', 'docs/dev-hq/data.json']) put(path, 'line\n'.repeat(100));
  put('code.js', '// code\n'.repeat(300));
  commit();
  const result = run();
  expectResult(result, 0, 300, 0);
  assert.match(result.stdout, /excludedLines=500/);
  put('code.js', '// code\n'.repeat(301));
  commit();
  assert.equal(run().status, 1);
  git('checkout', '-q', '--detach', base);
  for (const paths of [[...excludedPaths, '*'], 'Cargo.lock', [null], ['../*']]) {
    put(configPath, JSON.stringify({ ...config, excludedPaths: paths }));
    commit();
    assert.equal(run().status, 2);
  }
});

test('package size accepts the PR size exception label', t => {
  const { cwd, put, commit, run, env } = fixture(t);
  put('large.txt', 'line\n'.repeat(417));
  commit();
  env.GITHUB_EVENT_NAME = 'pull_request';
  env.GITHUB_EVENT_PATH = join(cwd, 'event.json');
  for (const name of ['size-ok', 'size-exception']) {
    put('event.json', JSON.stringify({ pull_request: { labels: [{ name }] } }));
    const result = run();
    assert.equal(result.status, name === 'size-exception' ? 0 : 1);
    if (name === 'size-exception') assert.match(result.stdout, /package-size: exception label present/);
  }
});
