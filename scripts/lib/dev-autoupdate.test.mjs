import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeRunner } from './dev-tools.mjs';
import { update, scrub, group, collect, main } from '../dev/dev-autoupdate.mjs';

test('skips install while the dev app has child processes', () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args]);
    return { code: 0, stdout: JSON.stringify(cmd === 'gh'
      ? [{ databaseId: 7, headSha: 'a'.repeat(40) }]
      : [{ ProcessId: 10, ParentProcessId: 1, Name: 'projecta.exe', ExecutablePath: ['X:', 'Apps', 'ProjectA Dev', 'projecta.exe'].join('\\') },
        { ProcessId: 11, ParentProcessId: 10, Name: 'worker.exe' }]) };
  };
  assert.equal(update({}, { run }), 'busy, retry next run');
  assert.equal(calls.length, 2);
  assert.equal(calls.some(([, args]) => args.includes('download')), false);
  assert.equal(update({ sha: 'a'.repeat(40) }, { run }), 'up to date');
  assert.throws(() => update({}, { run: () => ({ code: 2 }) }), /failed/);
});

test('scrubs home paths and secrets from crash context', () => {
  const home = ['C:', 'Users', 'fixture-user'].join('\\');
  const secret = 'ghp_' + 'B'.repeat(36);
  const text = `ERROR ${home}\\private.txt fixture-user\nERROR token=${secret}`;
  const safe = scrub(text, { USERPROFILE: home, USERNAME: 'fixture-user' }, [{ StartLine: 2, EndLine: 2 }]);
  assert.equal(safe.includes('fixture-user'), false);
  assert.equal(safe.includes('private.txt'), false);
  assert.equal(safe.includes(secret), false);
  assert.match(safe, /redacted/);
  assert.throws(() => scrub(text, {}, [{ StartLine: 0, EndLine: 2 }]), /range/);
});

test('groups repeated panics under one signature', () => {
  const records = group(['2026-10-11T12:00:00Z [panic] PANIC: worker 12 failed at src/pty.rs:99',
    '2026-10-11T12:00:01Z [panic] PANIC: worker 44 failed at src/store.rs:20'], 'a'.repeat(40), 'now');
  assert.equal(records.length, 1);
  assert.equal(records[0].count, 2);
  assert.equal(records[0].devSha, 'a'.repeat(40));
  assert.equal(records[0].firstSeen, '2026-10-11T12:00:00Z');
  assert.equal(records[0].lastSeen, '2026-10-11T12:00:01Z');
});

test('collects only new errors locally and uses the real repository secret scanner', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'dev-autoupdate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logs = join(dir, 'logs'), inbox = join(dir, 'inbox'), state = { sha: 'a'.repeat(40) };
  fs.mkdirSync(logs);
  const line = '2026-10-11T12:00:00Z [panic] PANIC: worker 12 failed';
  fs.writeFileSync(join(logs, 'projecta.log'), `${line}\n`);
  fs.writeFileSync(join(dir, '.panic-last'), 'PANIC: worker 12 failed');
  const deps = { run: makeRunner(), appData: dir, inbox, env: {} };
  collect(state, deps); collect(state, deps);
  assert.equal(fs.readdirSync(inbox).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(join(inbox, fs.readdirSync(inbox)[0]))).count, 1);
  fs.renameSync(join(logs, 'projecta.log'), join(logs, 'projecta_old.log'));
  const secret = 'ghp_' + 'Z9a8B7c6D5e4F3g2H1i0'.repeat(2);
  fs.writeFileSync(join(logs, 'projecta.log'), `ERROR credential ${secret}\n`);
  collect(state, deps);
  const output = fs.readdirSync(inbox).map(n => fs.readFileSync(join(inbox, n), 'utf8')).join('\n');
  assert.equal(output.includes(secret), false);
  assert.match(output, /redacted secret line/);
  fs.appendFileSync(join(logs, 'projecta.log'), 'ERROR new failure\n');
  assert.throws(() => collect(state, { ...deps, run: () => ({ code: 127 }) }), /scanner/);
});

test('turns a feedback entry into a feedback inbox file', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'dev-autoupdate-feedback-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logs = join(dir, 'logs'), inbox = join(dir, 'inbox'), state = { sha: 'a'.repeat(40) };
  fs.mkdirSync(logs);
  const home = ['C:', 'Users', 'fixture-user'].join('\\');
  const line = `2026-10-12T12:00:00Z [frontend] FEEDBACK message="Button tat nichts in ${home}\\app" expected="Menü" route="/leitstand" context="sha=\\"abc123\\""`;
  fs.writeFileSync(join(logs, 'projecta.log'), `${line}\nERROR ordinary failure\n`);
  const deps = { run: makeRunner(), appData: dir, inbox, env: { USERPROFILE: home, USERNAME: 'fixture-user' } };
  collect(state, deps);
  const feedbackDir = join(inbox, 'feedback');
  assert.equal(fs.readdirSync(feedbackDir).length, 1);
  const name = fs.readdirSync(feedbackDir)[0];
  const record = JSON.parse(fs.readFileSync(join(feedbackDir, name), 'utf8'));
  assert.match(record.context.join('\n'), /FEEDBACK/);
  assert.equal(record.context.join('\n').includes('fixture-user'), false);
  assert.equal(fs.readdirSync(inbox).filter(n => n.endsWith('.json')).length, 1);
  collect(state, deps);
  assert.equal(fs.readdirSync(feedbackDir).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(join(feedbackDir, name), 'utf8')).count, 1);
});

test('installs only a Dev setup and restarts a gracefully closed app after success or failure', t => {
  const folder = fs.mkdtempSync(join(tmpdir(), 'dev-update-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const fail of [false, true]) {
    let closed = false, restarted = false, saved = false;
    const state = {}, exe = ['X:', 'Apps', 'ProjectA Dev', 'projecta.exe'].join('\\');
    const run = (cmd, args) => {
      if (args.includes('list')) return { code: 0, stdout: JSON.stringify([{ databaseId: 7, headSha: 'a'.repeat(40) }]) };
      if (args.includes('download')) fs.writeFileSync(join(args.at(-1), 'ProjectA Dev_1.2.3_x64-setup.exe'), 'fixture');
      if (cmd === 'powershell.exe') {
        if (args.at(-1).includes('ConvertTo-Json')) return { code: 0, stdout: JSON.stringify(closed ? [] : [{ ProcessId: 10, ParentProcessId: 1, Name: 'projecta.exe', ExecutablePath: exe }]) };
        if (args.at(-1).includes('CloseMainWindow')) closed = true;
        if (args.at(-1).includes('Start-Process')) restarted = true;
      } else if (args.includes('/S')) { assert.equal(closed, true); if (fail) return { code: 2 }; }
      return { code: 0, stdout: '' };
    };
    const execute = () => update(state, { run, folder, save: () => { saved = true; } });
    if (fail) assert.throws(execute, /failed/); else assert.equal(execute(), 'installed');
    assert.equal(restarted, true);
    assert.equal(saved, !fail);
    assert.equal(state.sha, fail ? undefined : 'a'.repeat(40));
  }
});

function updateRunner({ installFails = false, restartFails = false, onList = () => {} } = {}) {
  let closed = false;
  return (cmd, args) => {
    if (args.includes('list')) {
      onList();
      return { code: 0, stdout: JSON.stringify([{ databaseId: 7, headSha: 'a'.repeat(40) }]) };
    }
    if (args.includes('download')) fs.writeFileSync(join(args.at(-1), 'ProjectA Dev_1.2.3_x64-setup.exe'), 'fixture');
    if (cmd === 'powershell.exe') {
      const script = args.at(-1);
      if (script.includes('ConvertTo-Json')) return { code: 0, stdout: JSON.stringify(closed ? [] : [{ ProcessId: 10, ParentProcessId: 1, Name: 'projecta.exe', ExecutablePath: ['X:', 'Apps', 'ProjectA Dev', 'projecta.exe'].join('\\') }]) };
      if (script.includes('CloseMainWindow')) closed = true;
      if (script.includes('Start-Process') && restartFails) return { code: 23 };
    }
    if (args.includes('/S') && installFails) return { code: 17 };
    return { code: 0, stdout: '' };
  };
}

test('removes the download folder after every run', t => {
  const folder = fs.mkdtempSync(join(tmpdir(), 'dev-cleanup-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(join(folder, 'keep'), 'state');
  for (const outcome of ['success', 'download', 'install', 'restart', 'busy', 'inventory', 'save']) {
    const base = updateRunner({ installFails: outcome === 'install', restartFails: outcome === 'restart' });
    let inventories = 0, download;
    const run = (cmd, args) => {
      if (args.includes('download')) {
        download = args.at(-1);
        assert.equal(fs.existsSync(download), true);
        if (outcome === 'download') return { code: 19 };
      }
      if (args.at(-1).includes('ConvertTo-Json') && ++inventories === 2) {
        if (outcome === 'inventory') return { code: 0, stdout: '{}' };
        if (outcome === 'busy') return { code: 0, stdout: JSON.stringify([
          { ProcessId: 20, ParentProcessId: 1, Name: 'projecta.exe', ExecutablePath: 'stable.exe' },
        ]) };
      }
      return base(cmd, args);
    };
    const execute = () => update({}, { folder, run, save: () => { if (outcome === 'save') throw new Error('save failed'); } });
    if (outcome === 'success') assert.equal(execute(), 'installed');
    else if (outcome === 'busy') assert.equal(execute(), 'busy, retry next run');
    else assert.throws(execute, /failed|inventory/);
    assert.ok(download);
    assert.equal(fs.existsSync(download), false, outcome);
    assert.deepEqual(fs.readdirSync(folder), ['keep']);
    assert.equal(fs.readFileSync(join(folder, 'keep'), 'utf8'), 'state');
  }
});

test('refuses an artifact without exactly one installer', t => {
  const folder = fs.mkdtempSync(join(tmpdir(), 'dev-artifact-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const names of [[], ['ProjectA_1.2.3_x64-setup.exe'],
    ['ProjectA Dev_1.2.3_x64-setup.exe', 'ProjectA Dev_1.2.3_arm64-setup.exe']]) {
    const base = updateRunner();
    const run = (cmd, args) => {
      assert.equal(args.includes('/S') || args.at(-1).includes('CloseMainWindow'), false);
      if (!args.includes('download')) return base(cmd, args);
      for (const name of names) fs.writeFileSync(join(args.at(-1), name), 'fixture');
      return { code: 0, stdout: '' };
    };
    assert.throws(() => update({}, { folder, run }), /expected exactly one Dev NSIS installer/);
    assert.deepEqual(fs.readdirSync(folder), []);
  }
});

test('refuses invalid inventories and unreadable app process paths', () => {
  for (const inventory of [{}, [{ ProcessId: '10', ParentProcessId: 1 }],
    [{ ProcessId: 10, ParentProcessId: null }], [{ ProcessId: 10, ParentProcessId: 1, Name: 'projecta.exe' }]]) {
    const base = updateRunner();
    const run = (cmd, args) => cmd === 'powershell.exe'
      ? { code: 0, stdout: JSON.stringify(inventory) } : base(cmd, args);
    assert.throws(() => update({}, { run }), /invalid process inventory|unreadable app process path/);
  }
});

test('keeps a successful exit when the run log cannot be appended', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'dev-run-log-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { LOCALAPPDATA: root, APPDATA: root, USERPROFILE: root };
  const folder = join(root, 'projecta-dev-autoupdate');
  fs.mkdirSync(join(folder, 'runs.log'), { recursive: true });
  let stderr = '';
  t.mock.method(process.stderr, 'write', chunk => { stderr += chunk; return true; });
  assert.equal(main({ env, platform: 'win32', run: updateRunner() }), 0);
  assert.match(stderr, /runs\.log/);
  assert.equal(JSON.parse(fs.readFileSync(join(folder, 'state.json'))).sha, 'a'.repeat(40));
  assert.equal(fs.existsSync(join(folder, 'running.lock')), false);
});

test('reports a failed restart without masking the install result', t => {
  const folder = fs.mkdtempSync(join(tmpdir(), 'dev-restart-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const installFails of [true, false]) {
    const state = {};
    let saved = false;
    assert.throws(() => update(state, { folder, run: updateRunner({ installFails, restartFails: true }), save: () => { saved = true; } }),
      { message: installFails ? 'process step failed (17)' : 'installed, restart failed' });
    assert.equal(saved, !installFails);
    assert.equal(state.sha, installFails ? undefined : 'a'.repeat(40));
  }
});

test('main removes its lock file and maps failures to exit 2', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'dev-main-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { LOCALAPPDATA: join(root, 'local'), APPDATA: join(root, 'roaming'), USERPROFILE: root };
  const folder = join(env.LOCALAPPDATA, 'projecta-dev-autoupdate'), lock = join(folder, 'running.lock');
  const noWork = () => assert.fail('unexpected external work');
  assert.equal(main({ env, platform: 'linux', run: noWork }), 2);
  assert.equal(fs.existsSync(env.LOCALAPPDATA), false);
  for (const [installFails, restartFails] of [[true, true], [true, false], [false, true], [false, false]]) {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(join(folder, 'state.json'), '{}');
    const run = updateRunner({ installFails, restartFails, onList: () => {
      assert.equal(fs.existsSync(lock), true);
      assert.equal(main({ env, platform: 'win32', run: noWork }), 2);
      assert.equal(fs.existsSync(lock), true);
    } });
    const code = installFails || restartFails ? 2 : 0;
    assert.equal(main({ env, platform: 'win32', run }), code);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(JSON.parse(fs.readFileSync(join(folder, 'state.json'))).sha, installFails ? undefined : 'a'.repeat(40));
    const lines = fs.readFileSync(join(folder, 'runs.log'), 'utf8').trim().split('\n');
    assert.match(lines.at(-2), /exit=2 setup failed \(EEXIST\)/);
    assert.match(lines.at(-1), new RegExp(`exit=${code} `));
    assert.ok(lines.at(-1).endsWith(installFails ? 'process step failed (17)' : restartFails ? 'installed, restart failed' : 'installed'));
  }
});
