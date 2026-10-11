import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeRunner } from './dev-tools.mjs';
import { update, scrub, group, collect } from '../dev/dev-autoupdate.mjs';

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
