import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check } from './rules-guard.mjs';

const cli = fileURLToPath(new URL('./rules-guard.mjs', import.meta.url));
const settingsPath = fileURLToPath(new URL('../../.claude/settings.json', import.meta.url));
const blocked = (cmd) => check(cmd).blocked === true;
const run = (input) => spawnSync(process.execPath, [cli], { input, encoding: 'utf8' });

test('rule 1 blocks --no-verify on git commit/push/merge', () => {
  for (const cmd of ['git commit --no-verify -m x', 'git commit -m x --no-verify', 'git push --no-verify origin main', 'git merge --no-verify topic']) {
    assert.equal(blocked(cmd), true, cmd);
    assert.match(check(cmd).reason, /--no-verify.*AGENTS\.md rule 3/);
  }
});

test('rule 1 is anchored to a git subcommand so quoted prose and other commands pass', () => {
  assert.equal(blocked('git commit -m "mention --no-verify in prose"'), false);
  assert.equal(blocked("git commit -m 'never use --no-verify'"), false);
  assert.equal(blocked('echo --no-verify'), false);
  assert.equal(blocked('git log --no-verify'), false);
});

test('rule 1 sees git behind global options and env assignments and chains', () => {
  assert.equal(blocked('git -C ../x commit --no-verify'), true);
  assert.equal(blocked('git -c user.name=a push --no-verify'), true);
  assert.equal(blocked('FOO=1 git commit --no-verify'), true);
  assert.equal(blocked('cargo fmt && git commit -a --no-verify -m x'), true);
  assert.equal(blocked('& git commit --no-verify'), true);
});

test('rule 2 blocks git stash except list and show', () => {
  for (const cmd of ['git stash', 'git stash push -m x', 'git stash pop', 'git stash apply abc', 'git stash drop', 'git -C ../x stash', 'cd x && git stash']) {
    assert.equal(blocked(cmd), true, cmd);
    assert.match(check(cmd).reason, /git stash.*CLAUDE\.md/);
  }
  for (const cmd of ['git stash list', 'git stash show -p', 'git -C ../x stash list --format=%H']) assert.equal(blocked(cmd), false, cmd);
});

test('rule 3 blocks CARGO_PROFILE_ environment assignments', () => {
  for (const cmd of ['CARGO_PROFILE_DEV_DEBUG=0 cargo build', 'export CARGO_PROFILE_RELEASE_LTO=true', 'env CARGO_PROFILE_DEV_OPT_LEVEL=3 cargo test', '$env:CARGO_PROFILE_DEV_DEBUG = "0"; cargo build', '$env:CARGO_PROFILE_DEV_DEBUG="0"']) {
    assert.equal(blocked(cmd), true, cmd);
    assert.match(check(cmd).reason, /CARGO_PROFILE_.*AGENTS\.md/);
  }
  assert.equal(blocked('cargo build'), false);
  assert.equal(blocked('echo $CARGO_PROFILE_DEV_DEBUG'), false);
  assert.equal(blocked('git commit -m "CARGO_PROFILE_DEV_DEBUG=0 is banned"'), false);
});

test('rule 4 blocks forced git push', () => {
  for (const cmd of ['git push --force', 'git push -f origin x', 'git push origin x --force-with-lease', 'git push --force-with-lease=x:y', 'git push -uf origin x', 'git push origin +main']) {
    assert.equal(blocked(cmd), true, cmd);
    assert.match(check(cmd).reason, /force.*AGENTS\.md/i);
  }
  for (const cmd of ['git push', 'git push -u origin claude/x', 'git fetch -f origin', 'git branch -f x']) assert.equal(blocked(cmd), false, cmd);
});

test('rule 5 blocks gates.sh piped into tail or head', () => {
  for (const cmd of ['bash scripts/ci/gates.sh lane prepush | tail -n 20', 'bash scripts/ci/gates.sh lane prepush 2>&1 | head', 'bash scripts/ci/gates.sh lane prepush 2>&1 | grep x | tail -5']) {
    assert.equal(blocked(cmd), true, cmd);
    assert.match(check(cmd).reason, /gates\.sh.*exit code.*AGENTS\.md rule 3/);
  }
});

test('rule 5 allows gates.sh runs that do not mask or that capture the status', () => {
  assert.equal(blocked('bash scripts/ci/gates.sh lane prepush'), false);
  assert.equal(blocked('bash scripts/ci/gates.sh lane prepush 2>&1 | tee gates.log'), false);
  assert.equal(blocked('bash scripts/ci/gates.sh --list'), false);
  assert.equal(blocked('git log | tail -3'), false);
  assert.equal(blocked('bash scripts/ci/gates.sh lane prepush 2>&1 | tail -20; echo "rc=${PIPESTATUS[0]}"'), false);
  assert.equal(blocked('set -o pipefail; bash scripts/ci/gates.sh lane prepush | tail -20'), false);
});

test('harmless commands pass with no reason', () => {
  for (const cmd of ['', 'ls -la', 'cargo build', 'npm run typecheck', 'git status', 'git commit -m "feat: x"', 'git push -u origin claude/x', 'git merge origin/main', 'cargo test 2>&1 >/dev/null']) {
    assert.deepEqual(check(cmd), { blocked: false, reason: null }, cmd);
  }
});

test('commands nested in bash -c and heredoc bodies are handled', () => {
  assert.equal(blocked('bash -c "git stash"'), true);
  assert.equal(blocked("sh -c 'git push --force'"), true);
  assert.equal(blocked('pwsh -Command "git commit --no-verify"'), true);
  assert.equal(blocked('git commit -m "$(cat <<\'EOF\'\nfix: x\n\nsay "git stash" and --no-verify\nEOF\n)"'), false);
});

test('rule 6 blocks disabling hooks through core.hooksPath', () => {
  for (const cmd of ['git -c core.hooksPath=/dev/null commit -m x', 'git -c core.hookspath=x push', 'git -C ../x -c core.hooksPath= merge topic', 'git --config-env=core.hooksPath=HP commit', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit', 'export GIT_CONFIG_KEY_0=core.hooksPath', "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" git push", 'env GIT_CONFIG_KEY_1=core.hookspath git commit']) {
    assert.equal(blocked(cmd), true, cmd);
    assert.match(check(cmd).reason, /core\.hooksPath.*AGENTS\.md rule 3/);
  }
  for (const cmd of ['git -c user.name=a commit -m x', 'git config core.hooksPath', 'git commit -m "core.hooksPath=x in prose"', 'GIT_CONFIG_KEY_0=user.name git commit']) assert.equal(blocked(cmd), false, cmd);
});

test('shells with unquoted commands plus eval and cmd /c are checked', () => {
  for (const cmd of ['pwsh -Command git stash', 'powershell -Command git push --force', 'pwsh -c git commit --no-verify -m x', 'eval "git stash"', 'cmd /c "git stash"', 'cmd.exe /C git push -f']) assert.equal(blocked(cmd), true, cmd);
  for (const cmd of ['pwsh -Command git status', 'eval "git status"', 'cmd /c "git stash list"', 'pwsh -Command git commit -m "no --no-verify here"']) assert.equal(blocked(cmd), false, cmd);
});

test('cli blocks with exit 2 and a one-line reason on stderr', () => {
  const r = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git stash' } }));
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /git stash/);
});

test('cli lets a harmless command through silently', () => {
  const r = run(JSON.stringify({ tool_input: { command: 'cargo build' } }));
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
});

test('cli never breaks the agent on malformed or empty or foreign input', () => {
  for (const input of ['', '   ', '{not json', 'null', '[]', '{}', '{"tool_input":null}', '{"tool_input":{"command":42}}', '{"tool_input":{"file_path":"x"}}']) {
    const r = run(input);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], JSON.stringify(input));
  }
});

test('settings.json registers the PreToolUse guard and keeps the other hooks', () => {
  const { hooks } = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.deepEqual(hooks.PreToolUse, [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node scripts/lib/rules-guard.mjs' }] }]);
  assert.equal(hooks.SessionStart[0].hooks[0].command, 'bash scripts/install-hooks.sh');
  assert.equal(hooks.PostToolUse[0].hooks[0].command, 'bash .claude/hooks/red-first.sh');
});
