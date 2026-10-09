import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDeskServer } from './server.mjs';
import { DeskStore } from './store.mjs';
import { migrateState } from './store/model.mjs';
const ROOT = 'test-root-agent';
const SWITCH = fileURLToPath(new URL('./switch.mjs', import.meta.url));
const FIXTURE_TEXT = 'DR16-LEDGER-FIXTURE-TEXT-UNIQUE';
const SECRET = 'synth-secret-token-dr16-0123456789abcdef';
const sha = buf => createHash('sha256').update(buf).digest('hex');
function run(args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SWITCH, ...args], { env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}
async function ledger() {
  const dir = await mkdtemp(join(tmpdir(), 'dr16-ledger-'));
  return { dir, state: join(dir, 'ledger.json') };
}
async function writeV1(state) {
  const body = { schemaVersion: 1, revision: 3, questions: [], answers: [], note: FIXTURE_TEXT };
  await writeFile(state, JSON.stringify(body, null, 2));
  return body;
}
async function writeV2(state) {
  const v2 = migrateState({ schemaVersion: 1, revision: 5, questions: [], answers: [], note: FIXTURE_TEXT });
  v2.revision = 5;
  await writeFile(state, JSON.stringify(v2, null, 2));
  await writeFile(`${state}.previous`, JSON.stringify({ schemaVersion: 1, revision: 4, questions: [], answers: [] }));
  await writeFile(`${state}.v1-backup`, JSON.stringify({ schemaVersion: 1, revision: 4, questions: [], answers: [] }));
  return v2;
}
async function serve(statePath) {
  const server = createDeskServer({ statePath, rootAgentId: ROOT, rootReceiptToken: SECRET });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { port, base: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) };
}
test('DR16: backup refuses while the desk server is listening', async () => {
  const { state } = await ledger();
  await writeV2(state);
  const { port, close } = await serve(state);
  const outDir = join(await mkdtemp(join(tmpdir(), 'dr16-out-')), 'bak');
  try {
    const r = await run(['backup', '--state', state, '--out', outDir, '--port', String(port)]);
    assert.equal(r.status, 3);
    assert.match(r.stdout, /Schreiber läuft noch/);
    await assert.rejects(readdir(outDir), e => e.code === 'ENOENT');
  } finally { await close(); }
});
test('DR16: quiescent backup verifies hashes schema and revision', async () => {
  for (const kind of ['v1', 'v2']) {
    const { state } = await ledger();
    const body = kind === 'v1' ? await writeV1(state) : await writeV2(state);
    if (kind === 'v1') {
      await writeFile(`${state}.previous`, JSON.stringify({ schemaVersion: 1, revision: 2, questions: [], answers: [] }));
      await writeFile(`${state}.v1-backup`, JSON.stringify({ schemaVersion: 1, revision: 1, questions: [], answers: [] }));
    }
    await writeFile(join(dirname(state), 'noise.tmp'), 'tmp');
    const outDir = join(await mkdtemp(join(tmpdir(), 'dr16-bak-')), 'snap');
    const r = await run(['backup', '--state', state, '--out', outDir]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, body.schemaVersion);
    assert.equal(manifest.revision, body.revision);
    assert.ok(manifest.utc);
    for (const f of manifest.files) {
      const bytes = await readFile(join(outDir, f.name));
      assert.equal(bytes.length, f.bytes);
      assert.equal(sha(bytes), f.sha256);
    }
    assert.equal((await run(['verify', '--backup', outDir])).status, 0);
    assert.notEqual((await run(['backup', '--state', state, '--out', outDir])).status, 0);
    const target = join(outDir, manifest.files[0].name);
    await writeFile(target, Buffer.concat([await readFile(target), Buffer.from('x')]));
    assert.equal((await run(['verify', '--backup', outDir])).status, 4);
  }
});
test('DR16: switch drill retains post-switch metadata writes after pause', async () => {
  const { state } = await ledger();
  await writeV2(state);
  const outDir = join(await mkdtemp(join(tmpdir(), 'dr16-drill-')), 'snap');
  assert.equal((await run(['backup', '--state', state, '--out', outDir])).status, 0);
  const backupBytes = await Promise.all((await readdir(outDir)).sort().map(async n => [n, await readFile(join(outDir, n))]));
  const { base, close } = await serve(state);
  try {
    const res = await fetch(`${base}/api/ideas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-decision-desk': 'agent' },
      body: JSON.stringify({
        requestId: 'dr16-meta-1', expectedRevision: null, title: 'Drill idea',
        text: 'post-switch metadata retain', category: 'Werkzeug', userPriority: 'high',
      }),
    });
    assert.equal(res.status, 200);
  } finally { await close(); }
  const { base: base2, close: close2 } = await serve(state);
  try {
    const stateJson = await (await fetch(`${base2}/api/state`)).json();
    const rev = stateJson.ideas[0].revisions.at(-1);
    assert.equal(rev.category, 'Werkzeug');
    assert.equal(rev.userPriority, 'high');
  } finally { await close2(); }
  assert.equal((await run(['compare', '--backup', outDir, '--state', state])).status, 0);
  for (const [n, bytes] of backupBytes) assert.deepEqual(await readFile(join(outDir, n)), bytes);
});
test('DR16: rollback never restores an older ledger', async () => {
  const { state } = await ledger();
  await writeV2(state);
  const before = await readFile(state);
  const outDir = join(await mkdtemp(join(tmpdir(), 'dr16-rb-')), 'snap');
  assert.equal((await run(['backup', '--state', state, '--out', outDir])).status, 0);
  const r = await run(['restore', '--backup', outDir, '--state', state]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Rückweg = vollständige Pause/);
  assert.deepEqual(await readFile(state), before);
  await new DeskStore(state, { rootAgentId: ROOT }).putIdea({
    requestId: 'dr16-newer', expectedRevision: null, title: 'Bump', text: 'raise revision',
  });
  const newer = join(await mkdtemp(join(tmpdir(), 'dr16-newer-')), 'snap');
  assert.equal((await run(['backup', '--state', state, '--out', newer])).status, 0);
  await writeFile(state, before);
  const cmp = await run(['compare', '--backup', newer, '--state', state]);
  assert.equal(cmp.status, 5);
  assert.match(cmp.stdout, /Datenverlust-Verdacht/);
});
test('DR16: drill log contains no ledger text or secrets', async () => {
  const { state } = await ledger();
  await writeV2(state);
  await writeFile(`${state}.previous`, JSON.stringify({
    schemaVersion: 1, revision: 1, questions: [], answers: [], note: FIXTURE_TEXT,
  }));
  const outDir = join(await mkdtemp(join(tmpdir(), 'dr16-log-')), 'snap');
  const chunks = [];
  for (const args of [
    ['backup', '--state', state, '--out', outDir],
    ['verify', '--backup', outDir],
    ['compare', '--backup', outDir, '--state', state],
    ['restore', '--backup', outDir, '--state', state],
    ['unknown'],
  ]) chunks.push((await run(args, { DECISION_DESK_ROOT_RECEIPT_TOKEN: SECRET })).stdout);
  const text = chunks.join('');
  for (const line of text.split(/\r?\n/).filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
  assert.ok(!text.includes(FIXTURE_TEXT));
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes('DECISION_DESK_'));
});
