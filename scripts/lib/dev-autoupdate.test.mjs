import { test } from 'node:test';
import assert from 'node:assert/strict';
import { update, scrub, group } from '../dev/dev-autoupdate.mjs';

test('skips install while the dev app has child processes', () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args]);
    return { code: 0, stdout: JSON.stringify(cmd === 'gh'
      ? [{ databaseId: 7, headSha: 'a'.repeat(40) }]
      : [{ ProcessId: 10, ParentProcessId: 1, Name: 'projecta.exe', ExecutablePath: String.raw`X:\Apps\ProjectA Dev\projecta.exe` },
        { ProcessId: 11, ParentProcessId: 10, Name: 'worker.exe' }]) };
  };
  assert.equal(update({}, { run }), 'busy, retry next run');
  assert.equal(calls.length, 2);
  assert.equal(calls.some(([, args]) => args.includes('download')), false);
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
