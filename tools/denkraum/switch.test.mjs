import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { chmod, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDeskServer } from './server.mjs';
import { DeskStore } from './store.mjs';
import { migrateState } from './store/model.mjs';
import { isInside } from './switch.mjs';
const ROOT = 'test-root-agent';
const SWITCH = fileURLToPath(new URL('./switch.mjs', import.meta.url));
const FIXTURE_TEXT = 'DR16-LEDGER-FIXTURE-TEXT-UNIQUE';
const SECRET = 'synth-secret-token-dr16-0123456789abcdef';
const output = async () => join(await mkdtemp(join(tmpdir(), 'dr16-backup-')), 'snap');
const sha = buf => createHash('sha256').update(buf).digest('hex');
async function freePort() {
  const listener = createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  return port;
}
function run(args, env = {}, entry = SWITCH) {
  return new Promise(resolve => {
    const childEnv = { ...process.env, ...env }; delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [entry, ...args], { env: childEnv });
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
  const outDir = await output(), port = await freePort();
  assert.equal((await run(['backup', '--state', state, '--out', outDir, '--port', String(port)])).status, 0);
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
    assert.notEqual((await run(['backup', '--state', state, '--out', outDir, '--port', String(await freePort())])).status, 0);
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
  const outDir = await output(), chunks = [], port = await freePort();
  for (const args of [
    ['backup', '--state', state, '--out', outDir, '--port', String(port)],
    ['verify', '--backup', outDir],
    ['compare', '--backup', outDir, '--state', state],
    ['restore', '--backup', outDir, '--state', state],
    ['unknown'],
  ]) chunks.push((await run(args, { DECISION_DESK_ROOT_RECEIPT_TOKEN: SECRET })).stdout);
  const text = chunks.join('');
  for (const line of text.split(/\r?\n/).filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
  for (const forbidden of [FIXTURE_TEXT, SECRET, 'DECISION_DESK_']) assert.ok(!text.includes(forbidden));
});
test('DR16: CLI entry via symlink still runs backup', async t => {
  const { state } = await ledger(), outDir = await output();
  const link = join(await mkdtemp(join(tmpdir(), 'dr16-link-')), 'sw.mjs');
  try { await symlink(SWITCH, link); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlink privilege unavailable (EPERM)'); throw error; }
  const r = await run(['backup', '--state', state, '--out', outDir, '--port', String(await freePort())], {}, link);
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

test('R871-A7: backup refuses --out equal to ledger sidecar path', async () => {
  const { state } = await ledger('v1');
  const out = `${state}.previous`;
  const before = await readdir(dirname(state));
  const r = await run(['backup', '--state', state, '--out', out, '--port', String(await freePort())]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(r.stdout).ok, false);
  await assert.rejects(stat(out), e => e.code === 'ENOENT');
  assert.deepEqual(await readdir(dirname(state)), before);
});
test('R871-A7: backup refuses --out nested inside the ledger directory', async () => {
  const { state } = await ledger();
  const nested = join(dirname(state), 'sub');
  const out = join(nested, 'bk');
  const before = await readdir(dirname(state));
  const r = await run(['backup', '--state', state, '--out', out, '--port', String(await freePort())]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(r.stdout).ok, false);
  await assert.rejects(stat(nested), e => e.code === 'ENOENT');
  await assert.rejects(stat(out), e => e.code === 'ENOENT');
  assert.deepEqual(await readdir(dirname(state)), before);
});
test('R871-A7: backup allows --out in a sibling directory', async () => {
  const { state } = await ledger('v1');
  const sibling = await mkdtemp(join(dirname(dirname(state)), 'dr16-sib-'));
  const out = join(sibling, 'snap');
  const r = await run(['backup', '--state', state, '--out', out, '--port', String(await freePort())]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout.trim().split('\n').at(-1)).ok, true);
  assert.equal((await readdir(out)).includes('manifest.json'), true);
});
test('R890-K1: backup refuses --out next to a symlinked state path', async t => {
  const { state } = await ledger('v1');
  const linkDir = await mkdtemp(join(tmpdir(), 'dr16-state-link-'));
  const linkState = join(linkDir, 'ledger.json');
  try { await symlink(state, linkState); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlink privilege unavailable (EPERM)'); throw error; }
  const out = join(linkDir, 'ledger.json.previous');
  const before = await readdir(linkDir);
  const r = await run(['backup', '--state', linkState, '--out', out, '--port', String(await freePort())]);
  assert.equal(r.status, 2, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).ok, false);
  assert.match(r.stdout, /Ledger-Verzeichnis/);
  await assert.rejects(stat(out), e => e.code === 'ENOENT');
  assert.deepEqual(await readdir(linkDir), before);
});
test('R890-K2: backup refuses --out routed through a symlink into the ledger dir', async t => {
  const { state } = await ledger('v1');
  const aliasParent = await mkdtemp(join(tmpdir(), 'dr16-out-alias-'));
  const alias = join(aliasParent, 'alias');
  try { await symlink(dirname(state), alias); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlink privilege unavailable (EPERM)'); throw error; }
  const out = join(alias, 'snap');
  const before = await readdir(dirname(state));
  const r = await run(['backup', '--state', state, '--out', out, '--port', String(await freePort())]);
  assert.equal(r.status, 2, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).ok, false);
  assert.match(r.stdout, /Ledger-Verzeichnis/);
  await assert.rejects(stat(out), e => e.code === 'ENOENT');
  assert.deepEqual(await readdir(dirname(state)), before);
});
test('R890-K3: guard ENOTDIR on --out uses invalid-path wording', async t => {
  const { state } = await ledger('v1');
  const fileComponent = join(await mkdtemp(join(tmpdir(), 'dr16-enotdir-')), 'not-a-dir');
  await writeFile(fileComponent, 'x');
  const out = join(fileComponent, 'nested', 'snap');
  const before = await readdir(dirname(state));
  const r = await run(['backup', '--state', state, '--out', out, '--port', String(await freePort())]);
  assert.notEqual(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).ok, false);
  const err = JSON.parse(r.stdout).error;
  if (process.platform === 'win32') {
    t.diagnostic('win32: path-under-file is ENOENT; mkdir refusal wording');
    assert.match(err, /Ausgabeverzeichnis kann nicht erstellt werden|Ungültiger Pfad/);
  } else {
    t.diagnostic('posix: ENOTDIR uses invalid-path wording');
    assert.match(err, /Pfad/);
    assert.ok(!/nicht ruhend/.test(r.stdout));
  }
  // SAFETY: nested out unreachable; ledger dir unchanged.
  await assert.rejects(stat(join(fileComponent, 'nested')), e => e.code === 'ENOENT' || e.code === 'ENOTDIR');
  assert.deepEqual(await readdir(dirname(state)), before);
});
test('R890-FU: state-side ENOTDIR yields Ungültiger Pfad and creates no out dir', async t => {
  const fileParent = join(await mkdtemp(join(tmpdir(), 'dr16-state-enotdir-')), 'not-a-dir');
  await writeFile(fileParent, 'x');
  const state = join(fileParent, 'ledger.json');
  const outDir = await output();
  const r = await run(['backup', '--state', state, '--out', outDir, '--port', String(await freePort())]);
  assert.notEqual(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).ok, false);
  if (process.platform === 'win32') {
    t.diagnostic('win32: state-under-file is ENOENT→nicht ruhend');
    assert.match(JSON.parse(r.stdout).error, /nicht ruhend|Ungültiger Pfad/);
  } else {
    t.diagnostic('posix: state-side ENOTDIR→Ungültiger Pfad');
    assert.equal(JSON.parse(r.stdout).error, 'Ungültiger Pfad');
    assert.match(r.stderr, /ENOTDIR/);
  }
  await assert.rejects(stat(outDir), e => e.code === 'ENOENT');
});
test('R890-FU: missing state file keeps exit 4 nicht ruhend (ENOENT skips guard)', async () => {
  const state = join(await mkdtemp(join(tmpdir(), 'dr16-miss-state-')), 'ledger.json');
  const outDir = await output();
  const r = await run(['backup', '--state', state, '--out', outDir, '--port', String(await freePort())]);
  assert.equal(r.status, 4, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).error, 'nicht ruhend');
  assert.match(r.stderr, /ENOENT/);
  assert.ok(!/Ungültiger Pfad/.test(r.stdout));
  await assert.rejects(stat(outDir), e => e.code === 'ENOENT');
});
test('R890-FU: ELOOP on --out parent yields Ungültiger Pfad', async t => {
  if (process.platform === 'win32') return t.skip('symlink loops are POSIX-oriented');
  const { state } = await ledger('v1');
  const loopDir = await mkdtemp(join(tmpdir(), 'dr16-eloop-'));
  const a = join(loopDir, 'a');
  const b = join(loopDir, 'b');
  try {
    await symlink(a, b);
    await symlink(b, a);
  } catch (error) {
    if (error.code === 'EPERM') return t.skip('Symlink privilege unavailable (EPERM)');
    throw error;
  }
  const out = join(a, 'snap');
  const before = await readdir(dirname(state));
  const r = await run(['backup', '--state', state, '--out', out, '--port', String(await freePort())]);
  assert.equal(r.status, 4, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).error, 'Ungültiger Pfad');
  assert.match(r.stderr, /ELOOP/);
  assert.deepEqual(await readdir(dirname(state)), before);
});
test('R890-FU: EACCES on --out parent yields Ungültiger Pfad', async t => {
  if (process.platform === 'win32') return t.skip('POSIX mode bits unavailable on win32');
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return t.skip('running as root; EACCES not observable');
  }
  const { state } = await ledger('v1');
  const denied = await mkdtemp(join(tmpdir(), 'dr16-eacces-'));
  const out = join(denied, 'snap');
  await chmod(denied, 0o000);
  try {
    const before = await readdir(dirname(state));
    const r = await run(['backup', '--state', state, '--out', out, '--port', String(await freePort())]);
    assert.equal(r.status, 4, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stdout).error, 'Ungültiger Pfad');
    assert.match(r.stderr, /EACCES/);
    assert.deepEqual(await readdir(dirname(state)), before);
  } finally {
    await chmod(denied, 0o700);
  }
});
test('R890-G1: isInside folds case on win32 and stays case-sensitive elsewhere', t => {
  const root = join('/Ledger', 'Dir');
  const mixed = join('/ledger', 'dir', 'out');
  assert.equal(isInside(root, mixed, 'win32'), true);
  if (process.platform === 'win32') {
    t.diagnostic('win32 host: path.relative case-folds; mixed inside in both modes');
    assert.equal(isInside(root, mixed, 'linux'), true);
  } else {
    t.diagnostic('non-win32 host: linux mode stays case-sensitive');
    assert.equal(isInside(root, mixed, 'linux'), false);
  }
  assert.equal(isInside(root, join(root, 'out'), 'linux'), true);
  assert.equal(isInside(root, join('/other', 'out'), 'win32'), false);
});
test('DR16H: backup reports explicit and default probe ports', async t => {
  const { state } = await ledger();
  const listener = createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  const explicit = await run(['backup', '--state', state, '--out', await output(), '--port', String(port)]);
  assert.equal(explicit.status, 0, explicit.stderr);
  const explicitResult = JSON.parse(explicit.stdout);
  assert.equal(explicitResult.port, port);
  assert.equal(explicitResult.defaultPort, false);
  const probe = createServer();
  let defaultBusy = false;
  try {
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(4791, '127.0.0.1', resolve); });
    await new Promise(r => probe.close(r));
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    defaultBusy = true;
  }
  const r = await run(['backup', '--state', state, '--out', await output()]);
  if (defaultBusy) {
    t.diagnostic('4791 busy: asserted refusal path');
    assert.equal(r.status, 3, r.stderr + r.stdout);
    const result = JSON.parse(r.stdout);
    assert.equal(result.ok, false);
    assert.match(result.error, /Schreiber läuft noch/);
    if ('port' in result) assert.equal(result.port, 4791);
    if ('defaultPort' in result) assert.equal(result.defaultPort, true);
  } else {
    assert.equal(r.status, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assert.equal(result.port, 4791);
    assert.equal(result.defaultPort, true);
  }
});
test('DR16H: invalid paths emit exactly one JSON error', async () => {
  for (const args of [['backup'], ['compare'], ['verify'], ['backup', '--state', 'relative', '--out', 'relative']]) {
    const r = await run(args);
    assert.equal(r.status, 2); assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.equal(JSON.parse(r.stdout).ok, false); assert.match(r.stderr, /Pfad/);
  }
});
test('DR16H: filesystem and validation failures retain safe diagnostics', async () => {
  const { state } = await ledger(), out = await bakOk(state);
  for (const target of [out, join(out, 'missing', 'snap')]) {
    const r = await run(['backup', '--state', state, '--out', target, '--port', String(await freePort())]);
    assert.equal(r.status, 4); assert.match(JSON.parse(r.stdout).error, /Ausgabeverzeichnis/);
    assert.match(r.stderr, target === out ? /EEXIST/ : /ENOENT/);
  }
  for (const cmd of ['backup', 'verify', 'compare']) {
    const r = await run([cmd, '--state', join(out, 'missing'), '--out', await output(), '--backup', join(out, 'missing'),
      '--port', String(await freePort())]);
    assert.equal(r.status, 4); assert.match(r.stderr, /ENOENT/); JSON.parse(r.stdout);
  }
  await writeFile(state, '{}');
  const r = await run(['compare', '--backup', out, '--state', state]);
  assert.equal(r.status, 4); assert.match(r.stderr, /Datendatei beschädigt/);
});
test('DR16H: parser diagnostics never expose ledger text or secrets', async () => {
  const { state } = await ledger(), out = await bakOk(state);
  for (const [file, args] of [[state, ['backup', '--state', state, '--out', await output(), '--port', String(await freePort())]],
    [join(out, 'manifest.json'), ['verify', '--backup', out]]]) {
    await writeFile(file, `{"${FIXTURE_TEXT}":"${SECRET}" BROKEN}`);
    const r = await run(args, { DECISION_DESK_ROOT_RECEIPT_TOKEN: SECRET });
    assert.equal(r.status, 4); assert.match(r.stderr, /JSON/); JSON.parse(r.stdout);
    for (const value of [FIXTURE_TEXT, SECRET]) assert.ok(!(r.stdout + r.stderr).includes(value));
  }
});
test('DR16H: entry guard uses native realpaths and tolerates failures', async () => {
  const script = `import { realpathSync } from 'node:fs';
    process.argv = [process.execPath, ${JSON.stringify(SWITCH)}, 'unknown'];
    realpathSync.native = () => { throw new Error('native realpath probe'); };
    await import(${JSON.stringify(new URL('./switch.mjs', import.meta.url).href)});`;
  const r = await run([script], {}, '-e');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /native realpath probe/);
  assert.equal(JSON.parse(r.stdout).ok, false);
});
test('DR16H: entry guard fails closed when realpath misses', async () => {
  const missing = join(await output(), 'missing.mjs');
  const script = `import { realpathSync } from 'node:fs';
    process.argv = [process.execPath, ${JSON.stringify(missing)}, 'unknown'];
    realpathSync.native = () => { throw new Error('native realpath probe'); };
    await import(${JSON.stringify(new URL('./switch.mjs', import.meta.url).href)});`;
  const r = await run([script], {}, '-e');
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /native realpath probe/);
  assert.equal(JSON.parse(r.stdout).ok, false);
});test('DR16H: compare accepts equal schema and revision', async () => {
  const { state } = await ledger(), out = await bakOk(state);
  const r = await run(['compare', '--backup', out, '--state', state]);
  assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).revision, 5);
});
test('DR16H: invalid port arguments are rejected before backup', async () => {
  const { state } = await ledger();
  for (const value of ['0', '-1', '65536', '1.5', 'NaN', '', undefined]) {
    const out = await output(), args = value === undefined ? [] : [value];
    const r = await run(['backup', '--state', state, '--out', out, '--port', ...args]);
    assert.equal(r.status, 2, String(value)); assert.match(r.stdout, /Port/);
    await assert.rejects(readdir(out), e => e.code === 'ENOENT');
  }
});
test('DR16H: non-digit port forms are rejected', async () => {
  const { state } = await ledger();
  for (const value of ['+1', '1e3', '655350']) {
    const out = await output();
    const r = await run(['backup', '--state', state, '--out', out, '--port', value]);
    assert.equal(r.status, 2, String(value)); assert.match(r.stdout, /Ungültiger Port/);
    await assert.rejects(readdir(out), e => e.code === 'ENOENT');
  }
});
test('DR16H: valid boundary ports are accepted', async () => {
  const { state } = await ledger('v1');
  for (const port of ['1', '65535']) {
    const r = await run(['backup', '--state', state, '--out', await output(), '--port', port]);
    // Hosts may have listeners on 1/65535; acceptance means not a port-validation failure.
    assert.notEqual(r.status, 2, r.stdout + r.stderr);
    assert.ok(!/Ungültiger Port/.test(r.stdout));
    const line = r.stdout.trim().split('\n').map(l => JSON.parse(l)).at(-1);
    if (r.status === 0) {
      assert.equal(line.port, Number(port));
      assert.equal(line.defaultPort, false);
    } else {
      assert.equal(line.ok, false);
    }
  }
});
test('DR16H: tmp warnings belong only to this ledger including previous temps', async () => {
  const { state } = await ledger(), id = '12345678-1234-1234-1234-123456789abc';
  const expected = [`ledger.json.${id}.tmp`, `ledger.json.${id}.tmp.previous`];
  for (const name of [...expected, 'noise.tmp', `other.json.${id}.tmp.previous`, `ledger.json.other.${id}.tmp`]) {
    await writeFile(join(dirname(state), name), 'temporary fixture');
  }
  const r = await run(['backup', '--state', state, '--out', await output(), '--port', String(await freePort())]);
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines.filter(l => l.warn === 'tmp').map(l => l.name).sort(), expected.sort());
  assert.equal(lines.at(-1).ok, true);
});
test('DR16H: backup directory is private on POSIX', { skip: process.platform === 'win32' }, async () => {
  const { state } = await ledger(), out = await output(), port = await freePort();
  const r = await run([`process.umask(0); process.argv = [process.execPath, ${JSON.stringify(SWITCH)},
    'backup', '--state', ${JSON.stringify(state)}, '--out', ${JSON.stringify(out)}, '--port', ${JSON.stringify(String(port))}];
    await import(${JSON.stringify(new URL('./switch.mjs', import.meta.url).href)});`], {}, '-e');
  assert.equal(r.status, 0, r.stderr); assert.equal((await stat(out)).mode & 0o777, 0o700);
});
test('DR16H: symlink drill skips when the capability probe returns EPERM', async () => {
  const preload = `import { promises } from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    promises.symlink = async () => { throw Object.assign(new Error('privilege unavailable'), { code: 'EPERM' }); };
    syncBuiltinESMExports();`;
  const r = await run([`data:text/javascript,${encodeURIComponent(preload)}`, '--test',
    '--test-name-pattern=^DR16: CLI entry via symlink', fileURLToPath(import.meta.url)], {}, '--import');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Symlink privilege unavailable \(EPERM\)/);
});
test('DR16H: top-level handler reports the original output failure', async () => {
  const r = await run([`process.argv = [process.execPath, ${JSON.stringify(SWITCH)}, 'unknown'];
    const write = process.stdout.write.bind(process.stdout); let calls = 0;
    process.stdout.write = chunk => { if (++calls <= 2) throw new Error('output write probe'); return write(chunk); };
    await import(${JSON.stringify(new URL('./switch.mjs', import.meta.url).href)});`], {}, '-e');
  assert.equal(r.status, 4); assert.match(r.stderr, /output write probe/);
  assert.equal(JSON.parse(r.stdout).ok, false);
});
test('DR16H: happy-path backup with no sidecars has empty stderr', async () => {
  const { state } = await ledger('v1');
  const listener = createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  const r = await run(['backup', '--state', state, '--out', await output(), '--port', String(port)]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stderr, '');
  assert.equal(JSON.parse(r.stdout).ok, true);
});
test('DR16H: missing primary ledger prints exactly one diagnostic line', async () => {
  const state = join(await mkdtemp(join(tmpdir(), 'dr16-missing-')), 'ledger.json');
  const listener = createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  const r = await run(['backup', '--state', state, '--out', await output(), '--port', String(port)]);
  assert.equal(r.status, 4);
  assert.equal(r.stderr.trim().split(/\r?\n/).filter(Boolean).length, 1);
  assert.match(r.stderr, /ENOENT|ledger\.json/);
  assert.equal(JSON.parse(r.stdout).ok, false);
});
test('DR16H: diagnose handles thrown strings', async () => {
  const { state } = await ledger('v1');
  const listener = createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  const preload = `import { promises } from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    promises.readFile = async () => { throw 'string-throw-probe-dr16'; };
    syncBuiltinESMExports();`;
  const r = await run([`data:text/javascript,${encodeURIComponent(preload)}`, SWITCH,
    'backup', '--state', state, '--out', await output(), '--port', String(port)], {}, '--import');
  assert.equal(r.status, 4);
  assert.match(r.stderr, /string-throw-probe-dr16/);
  assert.equal(JSON.parse(r.stdout).ok, false);
});
test('DR16H: env redaction applies to non-SyntaxError diagnostics', async () => {
  const { state } = await ledger('v1');
  const listener = createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  const shortToken = 'short7c';
  const preload = `import { promises } from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    promises.readFile = async () => {
      throw new Error('leak ' + process.env.DECISION_DESK_ROOT_RECEIPT_TOKEN + ' and ' + process.env.DR16_SHORT_TOKEN);
    };
    syncBuiltinESMExports();`;
  const r = await run([`data:text/javascript,${encodeURIComponent(preload)}`, SWITCH,
    'backup', '--state', state, '--out', await output(), '--port', String(port)], {
    DECISION_DESK_ROOT_RECEIPT_TOKEN: SECRET,
    DR16_SHORT_TOKEN: shortToken,
  }, '--import');
  assert.equal(r.status, 4);
  assert.match(r.stderr, /\[redacted\]/);
  assert.ok(!r.stderr.includes(SECRET), 'long secret must be redacted');
  assert.match(r.stderr, new RegExp(shortToken), 'values shorter than 8 stay visible');
  assert.equal(JSON.parse(r.stdout).ok, false);
});
