import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
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
const output = async () => join(await mkdtemp(join(tmpdir(), 'dr16-backup-')), 'snap');
const sha = buf => createHash('sha256').update(buf).digest('hex');
function run(args, env = {}, entry = SWITCH) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [entry, ...args], { env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}
async function ledger(kind = 'v2') {
  const state = join(await mkdtemp(join(tmpdir(), 'dr16-ledger-')), 'ledger.json');
  const body = kind === 'v1' ? await writeV1(state) : await writeV2(state);
  return { state, body };
}
async function writeV1(state) {
  const body = { schemaVersion: 1, revision: 3, questions: [], answers: [], note: FIXTURE_TEXT };
  await writeFile(state, JSON.stringify(body, null, 2)); return body;
}
async function writeV2(state, rev = 5) {
  const v2 = migrateState({ schemaVersion: 1, revision: rev, questions: [], answers: [], note: FIXTURE_TEXT });
  v2.revision = rev; await writeFile(state, JSON.stringify(v2, null, 2));
  await writeFile(`${state}.previous`, JSON.stringify({ schemaVersion: 1, revision: rev - 1, questions: [], answers: [] }));
  await writeFile(`${state}.v1-backup`, JSON.stringify({ schemaVersion: 1, revision: rev - 1, questions: [], answers: [] }));
  return v2;
}
async function serve(statePath) {
  const server = createDeskServer({ statePath, rootAgentId: ROOT, rootReceiptToken: SECRET });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { port, base: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) };
}
async function bakOk(state) {
  const outDir = await output();
  assert.equal((await run(['backup', '--state', state, '--out', outDir])).status, 0);
  return outDir;
}
test('DR16: backup refuses while the desk server is listening', async () => {
  const { state } = await ledger(), { port, close } = await serve(state), outDir = await output();
  try {
    const r = await run(['backup', '--state', state, '--out', outDir, '--port', String(port)]);
    assert.equal(r.status, 3); assert.match(r.stdout, /Schreiber läuft noch/);
    await assert.rejects(readdir(outDir), e => e.code === 'ENOENT');
  } finally { await close(); }
});
test('DR16: quiescent backup verifies hashes schema and revision', async () => {
  for (const kind of ['v1', 'v2']) {
    const { state, body } = await ledger(kind);
    if (kind === 'v1') {
      await writeFile(`${state}.previous`, JSON.stringify({ schemaVersion: 1, revision: 2, questions: [], answers: [] }));
      await writeFile(`${state}.v1-backup`, JSON.stringify({ schemaVersion: 1, revision: 1, questions: [], answers: [] }));
    }
    await writeFile(join(dirname(state), 'noise.tmp'), 'tmp');
    const outDir = await bakOk(state), manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, body.schemaVersion);
    assert.equal(manifest.revision, body.revision); assert.ok(manifest.utc);
    for (const f of manifest.files) {
      const bytes = await readFile(join(outDir, f.name));
      assert.equal(bytes.length, f.bytes); assert.equal(sha(bytes), f.sha256);
    }
    assert.equal((await run(['verify', '--backup', outDir])).status, 0);
    assert.notEqual((await run(['backup', '--state', state, '--out', outDir])).status, 0);
    const target = join(outDir, manifest.files[0].name);
    await writeFile(target, Buffer.concat([await readFile(target), Buffer.from('x')]));
    assert.equal((await run(['verify', '--backup', outDir])).status, 4);
  }
});
test('DR16: switch drill retains post-switch metadata writes after pause', async () => {
  const { state } = await ledger(), outDir = await bakOk(state);
  const backupBytes = await Promise.all((await readdir(outDir)).sort().map(async n => [n, await readFile(join(outDir, n))]));
  const { base, close } = await serve(state);
  try {
    const res = await fetch(`${base}/api/ideas`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-decision-desk': 'agent' },
      body: JSON.stringify({ requestId: 'dr16-meta-1', expectedRevision: null, title: 'Drill idea',
        text: 'post-switch metadata retain', category: 'Werkzeug', userPriority: 'high',
      }), });
    assert.equal(res.status, 200);
  } finally { await close(); }
  const { base: base2, close: close2 } = await serve(state);
  try {
    const rev = (await (await fetch(`${base2}/api/state`)).json()).ideas[0].revisions.at(-1);
    assert.equal(rev.category, 'Werkzeug'); assert.equal(rev.userPriority, 'high');
  } finally { await close2(); }
  assert.equal((await run(['compare', '--backup', outDir, '--state', state])).status, 0);
  for (const [n, bytes] of backupBytes) assert.deepEqual(await readFile(join(outDir, n)), bytes);
});
test('DR16: rollback never restores an older ledger', async () => {
  const { state } = await ledger(), before = await readFile(state), outDir = await bakOk(state);
  const r = await run(['restore', '--backup', outDir, '--state', state]);
  assert.equal(r.status, 2); assert.match(r.stdout, /Rückweg = vollständige Pause/);
  assert.deepEqual(await readFile(state), before);
  await new DeskStore(state, { rootAgentId: ROOT }).putIdea({ requestId: 'dr16-newer', expectedRevision: null, title: 'Bump', text: 'raise revision' });
  const newer = await bakOk(state);
  await writeFile(state, before);
  const cmp = await run(['compare', '--backup', newer, '--state', state]);
  assert.equal(cmp.status, 5); assert.match(cmp.stdout, /Datenverlust-Verdacht/);
});
test('DR16: drill log contains no ledger text or secrets', async () => {
  const { state } = await ledger();
  await writeFile(`${state}.previous`, JSON.stringify({ schemaVersion: 1, revision: 1, questions: [], answers: [], note: FIXTURE_TEXT }));
  const outDir = await output(), chunks = [];
  for (const args of [
    ['backup', '--state', state, '--out', outDir],
    ['verify', '--backup', outDir],
    ['compare', '--backup', outDir, '--state', state],
    ['restore', '--backup', outDir, '--state', state],
    ['unknown'],
  ]) chunks.push((await run(args, { DECISION_DESK_ROOT_RECEIPT_TOKEN: SECRET })).stdout);
  const text = chunks.join('');
  for (const line of text.split(/\r?\n/).filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
  for (const forbidden of [FIXTURE_TEXT, SECRET, 'DECISION_DESK_']) assert.ok(!text.includes(forbidden));
});
test('DR16: CLI entry via symlink still runs backup', async () => {
  const { state } = await ledger(), outDir = await output();
  const link = join(await mkdtemp(join(tmpdir(), 'dr16-link-')), 'sw.mjs');
  await symlink(SWITCH, link);
  const r = await run(['backup', '--state', state, '--out', outDir], {}, link);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /"cmd":"backup"/);
  assert.equal(JSON.parse(r.stdout).proof, 'port-only');
  assert.equal((await readdir(outDir)).includes('manifest.json'), true);
});
test('DR16: compare rejects malformed manifest', async () => {
  const { state } = await ledger(), outDir = await bakOk(state), path = join(outDir, 'manifest.json'), valid = JSON.parse(await readFile(path, 'utf8'));
  for (const invalid of [{}, ...['revision', 'schemaVersion'].flatMap(k =>
    [undefined, '2', 1.5, Number.MAX_SAFE_INTEGER + 1].map(v => ({ ...valid, [k]: v })))]) {
    await writeFile(path, JSON.stringify(invalid));
    assert.equal((await run(['compare', '--backup', outDir, '--state', state])).status, 4);
  }
  await writeFile(path, JSON.stringify(valid));
  await writeFile(join(outDir, valid.files[0].name), '{}');
  assert.equal((await run(['compare', '--backup', outDir, '--state', state])).status, 4);
});
test('DR16: compare is lexicographic by schema then revision', async () => {
  const { state } = await ledger('v1'), outDir = await bakOk(state);
  await writeV2(state, 1);
  assert.equal((await run(['compare', '--backup', outDir, '--state', state])).status, 0);
  await writeV2(state, 2);
  const same = await bakOk(state);
  await writeV2(state, 1);
  assert.equal((await run(['compare', '--backup', same, '--state', state])).status, 5);
  await writeV1(state);
  assert.equal((await run(['compare', '--backup', same, '--state', state])).status, 5);
});
test('DR16: hanging health listener refuses backup', async () => {
  const { state } = await ledger();
  for (const mode of ['hang', 'reset', 'http']) {
    const sockets = new Set();
    const listener = createServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.resume();
      if (mode === 'reset') socket.destroy();
      if (mode === 'http') socket.end('HTTP/1.1 503 Busy\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    });
    await new Promise(r => listener.listen(0, '127.0.0.1', r));
    const outDir = await output();
    try {
      const r = await run(['backup', '--state', state, '--out', outDir, '--port', String(listener.address().port)]);
      assert.equal(r.status, 3, mode);
      await assert.rejects(readdir(outDir), e => e.code === 'ENOENT');
    } finally { for (const socket of sockets) socket.destroy(); await new Promise(r => listener.close(r)); }
  }
});
test('DR16: verify binds manifest to primary revision', async () => {
  const { state } = await ledger(), outDir = await bakOk(state), manPath = join(outDir, 'manifest.json');
  const man = JSON.parse(await readFile(manPath, 'utf8'));
  for (const key of ['revision', 'schemaVersion']) {
    await writeFile(manPath, JSON.stringify({ ...man, [key]: 0 }));
    assert.equal((await run(['verify', '--backup', outDir])).status, 4, key);
  }
});
test('DR16: verify rejects traversal duplicate and ambiguous primary names', async () => {
  const { state } = await ledger(), outDir = await bakOk(state), path = join(outDir, 'manifest.json');
  const man = JSON.parse(await readFile(path, 'utf8')), primary = man.files[0];
  await writeFile(join(dirname(outDir), 'outside.json'), await readFile(state));
  await writeFile(join(outDir, 'extra.json'), await readFile(state));
  for (const files of [[{ ...primary, name: '../outside.json' }], [primary, primary],
    [primary, { ...primary, name: 'extra.json' }], man.files.slice(1)]) {
    await writeFile(path, JSON.stringify({ ...man, files }));
    assert.equal((await run(['verify', '--backup', outDir])).status, 4);
  }
});
