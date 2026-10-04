import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { judgeRestart, runAfter, runBefore, snapshotState } from './crash-drill.mjs';
const run = (id, status, extra = {}) => ({ id, task_id: 't1', status, claim_fence: 1, process_id: null, terminal_detail: null, ...extra });
const state = (runs, deliveries = []) => ({ runs, launches: [], deliveries, checkpoints: [] });
test('an open run that becomes reconciling passes', () => {
  assert.deepEqual(judgeRestart(state([run('r1', 'launched')]), state([run('r1', 'reconciling')])), []);
});
test('an open run left open or completed silently fails', () => {
  assert.equal(judgeRestart(state([run('r1', 'intent')]), state([run('r1', 'launched')])).length, 1);
  assert.equal(judgeRestart(state([run('r1', 'launched')]), state([run('r1', 'completed')])).length, 1);
});
test('a new run for a task with a reconciling run is a redispatch', () => {
  const p = judgeRestart(state([run('r1', 'launched')]), state([run('r1', 'reconciling'), run('r2', 'intent')]));
  assert.match(p.join(), /redispatch: new run r2/);
});
test('a delivery must not advance without a process and a drill needs an open run', () => {
  const b = state([run('r1', 'launched')], [{ run_id: 'r1', state: 'started' }]);
  assert.match(judgeRestart(b, state([run('r1', 'reconciling')], [{ run_id: 'r1', state: 'enqueued' }])).join(), /started -> enqueued/);
  assert.match(judgeRestart(state([run('r1', 'completed')]), state([run('r1', 'completed')])).join(), /no open run/);
});
test('before and after bundles read a copy and pass for a reconciled run', () => {
  const appDir = mkdtempSync(join(tmpdir(), 'crash-app-'));
  const db = join(appDir, 'projecta.db');
  const con = new DatabaseSync(db);
  con.exec("CREATE TABLE development_runs (id TEXT, task_id TEXT, status TEXT, claim_fence INTEGER, process_id INTEGER, terminal_detail TEXT); INSERT INTO development_runs VALUES ('r1','t1','launched',1,42,NULL)");
  assert.deepEqual(snapshotState(db).deliveries, []);
  const dir = mkdtempSync(join(tmpdir(), 'crash-out-'));
  const beforeDir = join(dir, 'b');
  const m1 = runBefore({ appDir, outDir: beforeDir, transition: 'intent', processList: `token=${'q'.repeat(20)}` });
  assert.equal(m1.result, 'pass');
  assert.ok(!readFileSync(join(beforeDir, 'processes-before.txt'), 'utf8').includes('qqqqq'));
  assert.equal(runAfter({ appDir, beforeDir, outDir: join(dir, 'a') }).result, 'fail');
  con.exec("UPDATE development_runs SET status='reconciling'"); con.close();
  const m2 = runAfter({ appDir, beforeDir, outDir: join(dir, 'a2') });
  assert.equal(m2.result, 'pass', JSON.stringify(m2.steps));
  assert.equal(runBefore({ appDir, outDir: join(dir, 'x'), transition: 'bogus' }).result, 'fail');
});
