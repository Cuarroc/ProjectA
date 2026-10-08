import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const { codexHooksConfig, findBareBashHooks, inspectCodexHooks, writeCodexHooks, windowsCommand } =
  existsSync(new URL('./codex-hooks.mjs', import.meta.url)) ? await import('./codex-hooks.mjs') : {};

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const windows = process.platform === 'win32';

// The shape every checkout carried until HOOK-WIN (docs/setup/codex.md).
const legacy = {
  hooks: {
    PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: "bash 'C:\\checkout\\.codex\\hooks\\red-first.sh'" }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'bash scripts/install-hooks.sh' }] }],
  },
};

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'codex hooks '));
  test.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('flags a legacy config whose hooks call bare bash', () => {
  const config = codexHooksConfig ? codexHooksConfig(repo) : legacy;
  for (const group of Object.values(config.hooks).flat()) {
    for (const hook of group.hooks) assert.doesNotMatch(hook.commandWindows ?? hook.command, /^\s*bash(?:\.exe)?(?:\s|$)/, 'Windows hooks must avoid bare bash on PATH');
  }
  assert.deepEqual(findBareBashHooks(legacy).map(h => h.event), ['PostToolUse', 'SessionStart']);
  assert.deepEqual(findBareBashHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x', commandWindows: 'bash x.sh' }] }] } }).map(h => h.event), ['Stop']);
  assert.deepEqual(findBareBashHooks(codexHooksConfig('C:\\some checkout')), []);
  // A Windows override that is not bare bash wins over a bash `command`.
  for (const commandWindows of ['echo hi', '', '"C:\\Program Files\\Git\\bin\\bash.exe" x.sh', 'bashful.exe']) {
    assert.deepEqual(findBareBashHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash x.sh', commandWindows }] }] } }), [], commandWindows);
  }
});

const decode = command => Buffer.from(command.match(/^powershell\.exe -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/)[1], 'base64').toString('utf16le');

test('generated hooks bind tracked scripts into a self-contained Git Bash command', () => {
  const entries = Object.values(codexHooksConfig(repo).hooks).flat().flatMap(group => group.hooks);
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    const source = decode(entry.commandWindows);
    const script = source.match(/^\$Script = '([^']+)'/)[1];
    assert.ok(existsSync(script), `hook script exists: ${script}`);
    assert.match(source, /Git Bash not found/);
    assert.doesNotMatch(source, /(^|\s)bash(\s|$)/m, 'never the bare bash on PATH');
  }
  assert.match(decode(windowsCommand("C:/it's here/x.sh")), /^\$Script = 'C:\/it''s here\/x\.sh'\n/);
});

// A real bash for the POSIX `command` arm: Git Bash on Windows (never the
// WSL launcher on PATH), the system bash elsewhere.
function posixBash() {
  if (!windows) return 'bash';
  const env = process.env;
  const bases = [env.ProgramFiles, env.ProgramW6432, env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  return (env.PROJECTA_GIT_BASH ? [env.PROJECTA_GIT_BASH] : bases.map(base => join(base, 'Git', 'bin', 'bash.exe'))).find(existsSync);
}

test('generated Unix hook commands keep an apostrophe in the checkout path literal', () => {
  const bash = posixBash();
  assert.ok(bash, 'Git Bash is needed to check the POSIX hook command');
  const root = "/Users/O'Brian/my $repo";
  const scripts = { PostToolUse: '.claude/hooks/red-first.sh', SessionStart: 'scripts/install-hooks.sh' };
  for (const [event, groups] of Object.entries(codexHooksConfig(root).hooks)) {
    const { command } = groups[0].hooks[0];
    assert.match(command, /^bash /, event);
    const syntax = spawnSync(bash, ['-n', '-c', command], { encoding: 'utf8', windowsHide: true });
    assert.equal(syntax.status, 0, `${event}: bash -n: ${syntax.stderr}`);
    // The same words with printf in place of bash show the argument the hook
    // script would receive, without running the hook.
    const words = spawnSync(bash, ['-c', command.replace(/^bash /, "printf '%s\\n' ")], { encoding: 'utf8', windowsHide: true });
    assert.equal(words.stdout, `${root}/${scripts[event]}\n`, `${event}: ${words.stderr}`);
  }
});

test('writeCodexHooks keeps a backup of a legacy file and the doctor turns ok', () => {
  const root = tempRoot();
  assert.equal(inspectCodexHooks(root).state, 'ok', 'no file is fine');
  mkdirSync(join(root, '.codex'));
  const legacyText = JSON.stringify(legacy, null, 2);
  writeFileSync(join(root, '.codex', 'hooks.json'), legacyText);
  assert.equal(inspectCodexHooks(root).state, 'fail');
  const first = writeCodexHooks(root);
  assert.equal(first.changed, true);
  assert.equal(readFileSync(first.backup, 'utf8'), legacyText);
  assert.equal(inspectCodexHooks(root).state, 'ok');
  assert.deepEqual(writeCodexHooks(root), { changed: false, backup: null });
  assert.equal(readdirSync(join(root, '.codex')).filter(name => name.endsWith('.bak')).length, 1);
});

// Builds a checkout whose generated hooks run a fixture instead of red-first:
// a path with spaces, a script that echoes stdin and exits HOOK_TEST_EXIT.
function fixtureCheckout() {
  const root = tempRoot();
  mkdirSync(join(root, '.claude', 'hooks'), { recursive: true });
  writeFileSync(join(root, '.claude', 'hooks', 'red-first.sh'), '#!/usr/bin/env bash\nin="$(cat)"\nprintf "stdin=%s\\n" "$in"\nexit "${HOOK_TEST_EXIT:-0}"\n');
  return { root, command: codexHooksConfig(root).hooks.PostToolUse[0].hooks[0].commandWindows };
}

// The shells Codex may run a hook in on Windows (its environment shell).
function shells() {
  const list = [['powershell.exe', ['-NoProfile', '-Command']]];
  if (spawnSync('pwsh.exe', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true }).status === 0) list.push(['pwsh.exe', ['-NoProfile', '-Command']]);
  return list;
}
function run(shell, args, command, env, input) {
  return spawnSync(shell, [...args, command], { input, encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true, timeout: 60000 });
}
function runCmd(command, env, input) {
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${command}"`], { input, encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true, timeout: 60000, windowsVerbatimArguments: true });
}

test('wrapper passes stdin JSON and the child exit through PowerShell 5, PowerShell 7 and CMD', { skip: !windows && 'Windows only' }, () => {
  const { command } = fixtureCheckout();
  const event = '{"hook_event_name":"PostToolUse","tool_name":"Edit"}';
  // One run per PowerShell (each start costs seconds): the failing child
  // proves stdin arrived and that its failure is not turned into success.
  for (const [shell, args] of shells()) {
    const failed = run(shell, args, command, { HOOK_TEST_EXIT: '7' }, event);
    assert.match(failed.stdout, /stdin=\{"hook_event_name":"PostToolUse","tool_name":"Edit"\}/, `${shell}: ${failed.stderr}`);
    assert.notEqual(failed.status, 0, `${shell}: a failing hook must not become success`);
  }
  const ok = runCmd(command, { HOOK_TEST_EXIT: '0' }, event);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /stdin=\{"hook_event_name"/);
  assert.doesNotMatch(ok.stderr, /CLIXML/, 'no serialized PowerShell progress records in the hook output');
  assert.equal(runCmd(command, { HOOK_TEST_EXIT: '7' }, event).status, 7, 'the exact child status survives');
});

test('missing Git Bash fails with exit 127 and a message instead of reaching WSL', { skip: !windows && 'Windows only' }, () => {
  const { command } = fixtureCheckout();
  const env = { PROJECTA_GIT_BASH: 'C:\\no git here\\bash.exe', HOOK_TEST_EXIT: '0' };
  const result = run('powershell.exe', ['-NoProfile', '-Command'], command, env, '{}');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Git Bash not found/);
  assert.doesNotMatch(result.stdout, /stdin=/);
  assert.equal(runCmd(command, env, '{}').status, 127);
});
