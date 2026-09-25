import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';

test('hook installation preserves merge-driver registration, tracked modes and untracked hooks', () => {
  const root = mkdtempSync(join(tmpdir(), 'projecta-hooks-'));
  const repo = join(root, 'repo with spaces');
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) delete env[key];
  const bash = process.platform === 'win32'
    ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : 'bash';
  function run(command, args) {
    const result = spawnSync(command, args, { cwd: repo, env, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${command}: ${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  }
  try {
    for (const dir of ['.githooks', 'scripts/ci']) mkdirSync(join(repo, dir), { recursive: true });
    copyFileSync('scripts/install-hooks.sh', join(repo, 'scripts/install-hooks.sh'));
    const tracked = ['.githooks/pre-commit', 'scripts/ci/gates.sh', 'scripts/test-probe.sh'];
    for (const file of [...tracked, '.githooks/new-hook']) writeFileSync(join(repo, file), '#!/bin/sh\nexit 0\n');
    run('git', ['init', '-q']);
    run('git', ['config', 'core.fileMode', 'false']);
    run('git', ['add', '--', ...tracked]);
    run('git', ['update-index', '--chmod=-x', '--', ...tracked]);
    const output = run(bash, ['scripts/install-hooks.sh']);
    assert.match(output, /new-hook.*noch nicht im Index/);
    assert.equal(run('git', ['config', '--get', 'core.hooksPath']), '.githooks');
    assert.equal(run('git', ['config', '--get', 'merge.hqdata.driver']), '.githooks/merge-hqdata %O %A %B %P');
    for (const file of tracked) assert.match(run('git', ['ls-files', '-s', '--', file]), /^100755 /);
    assert.equal(run('git', ['ls-files', '--', '.githooks/new-hook']), '');
    run(bash, ['-c', 'test -x .githooks/new-hook']);
    const index = run('git', ['ls-files', '-s']);
    run(bash, ['scripts/install-hooks.sh']);
    assert.equal(run('git', ['ls-files', '-s']), index, 'reinstall leaves the index unchanged');
  } finally {
    const cleanupPath = realpathSync(root);
    const underTemp = relative(realpathSync(tmpdir()), cleanupPath);
    assert.ok(underTemp && !underTemp.startsWith('..') && !isAbsolute(underTemp));
    rmSync(cleanupPath, { recursive: true, force: true });
  }
});
