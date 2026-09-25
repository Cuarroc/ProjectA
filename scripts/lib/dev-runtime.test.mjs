import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectRuntime, sha256File } from '../dev-setup.mjs';

test('runtime doctor binds explicit descriptor, refuses redirects, and never returns its credential', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hq-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const descriptor = join(root, 'api.json');
  writeFileSync(descriptor, JSON.stringify({ port: 34123, token: 'private-test-token' }));
  const result = await inspectRuntime({ PROJECTA_API_DESCRIPTOR: descriptor }, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:34123/api/hq/v1/runtime');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ apiVersion: 1, capabilities: { execution: false } }) };
  });
  assert.equal(result.state, 'ok');
  assert.equal(JSON.stringify(result).includes('private-test-token'), false);
  assert.equal((await inspectRuntime({ PROJECTA_API_DESCRIPTOR: join(root, 'missing') }, () => { throw new Error('must not fetch'); })).state, 'warn');
  assert.equal((await inspectRuntime({ PROJECTA_API_DESCRIPTOR: descriptor }, async () => ({ ok: false, status: 404 }))).state, 'warn');
});

test('runtime doctor reports the shipped agent manifest identity and rejects a mismatched running build', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hq-runtime-manifest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const descriptor = join(root, 'api.json');
  writeFileSync(descriptor, JSON.stringify({ port: 34124, token: 'private-test-token' }));
  const localManifest = join(process.cwd(), 'src-tauri', 'resources', 'agent-defaults.json');
  const matching = await inspectRuntime({ PROJECTA_API_DESCRIPTOR: descriptor }, async () => ({ ok: true, json: async () => ({ apiVersion: 1, provenance: { builtinManifestSha256: sha256File(localManifest) } }) }), process.cwd());
  assert.equal(matching.state, 'ok');
  assert.equal(matching.manifest.state, 'matched');
  const mismatch = await inspectRuntime({ PROJECTA_API_DESCRIPTOR: descriptor }, async () => ({ ok: true, json: async () => ({ apiVersion: 1, provenance: { builtinManifestSha256: '0'.repeat(64) } }) }), process.cwd());
  assert.equal(mismatch.state, 'warn');
  assert.equal(mismatch.manifest.state, 'mismatch');
});
