import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { manifestBytes, resourceMapping, digest, assertUnchanged, prepareNativePackage } from './native-package.mjs';

test('native package identity rejects ambiguous inputs and matches the signed schema', () => {
  const identity = { version: '1.3.0', commit: 'a'.repeat(40), protocol: 1, hostSha256: 'b'.repeat(64) };
  assert.deepEqual(JSON.parse(manifestBytes(identity)), { schemaVersion: 1,
    purpose: 'projecta-native-host-v1', appVersion: '1.3.0', buildCommit: identity.commit,
    target: 'x86_64-pc-windows-msvc', protocolVersion: 1, hostName: 'pa-capture-host.exe', hostSha256: identity.hostSha256 });
  for (const delta of [{ version: '1.3' }, { commit: 'a'.repeat(39) }, { commit: 'A'.repeat(40) },
    { hostSha256: '../host' }, { hostSha256: 'B'.repeat(64) }, { protocol: 0 }, { protocol: 1.5 }]) {
    assert.throws(() => manifestBytes({ ...identity, ...delta }));
  }
  assert.throws(() => prepareNativePackage('.', 'release', identity.commit, {}), /key unavailable/);
});

test('native resource map preserves nested paths and refuses destination collisions', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pa-package-map-'));
  try {
    mkdirSync(path.join(root, 'resources', 'nested'), { recursive: true });
    writeFileSync(path.join(root, 'resources', 'nested', 'role.md'), 'role');
    writeFileSync(path.join(root, 'resources', 'agents.json'), '{}');
    const mapping = resourceMapping(root, ['resources/**/*'], [['manifest', 'pa-native-host.json'], ['sig', 'pa-native-host.json.sig']]);
    assert.equal(mapping[path.join(root, 'resources', 'nested', 'role.md')], 'resources/nested/role.md');
    assert.equal(mapping[path.join(root, 'resources', 'agents.json')], 'resources/agents.json');
    assert.equal(Object.keys(mapping).length, 4);
    assert.throws(() => resourceMapping(root, ['missing/*'], []), /no matches/);
    assert.throws(() => resourceMapping(root, ['../escape'], []), /Unsupported/);
    assert.throws(() => resourceMapping(root, {}, []), /format/);
    for (const target of ['pa.exe', 'PA-CAPTURE-HOST.EXE', '../escape', '/absolute']) {
      assert.throws(() => resourceMapping(root, [], [['source', target]]), /Conflicting/);
    }
    assert.throws(() => resourceMapping(root, [], [['a', 'same'], ['b', 'SAME']]), /Conflicting/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native bundle comparison detects host or document substitution independently', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pa-package-hash-'));
  try {
    const files = Object.fromEntries(['host', 'manifest', 'signature'].map(name => [name, path.join(root, name)]));
    for (const file of Object.values(files)) writeFileSync(file, 'original');
    const hashes = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, digest(file)]));
    assertUnchanged({ ...files, hashes });
    for (const [name, file] of Object.entries(files)) {
      writeFileSync(file, 'substituted');
      assert.throws(() => assertUnchanged({ ...files, hashes }), new RegExp(name));
      writeFileSync(file, 'original');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('release workflow keeps signed builder and five-file MSI gate coupled', () => {
  const workflow = readFileSync(path.resolve('.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /node scripts\/build-signed-windows\.mjs/);
  assert.match(workflow, /verify-windows-package\.ps1[\s\S]*-RequireNativeResources/);
  assert.doesNotMatch(workflow, /run:\s*npx tauri build/);
});
