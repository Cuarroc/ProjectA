import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAgentsFile, upsertProfile, writeAgentsFile } from './hq-live-lib.mjs';

test('editing a profile preserves wrapper metadata and capabilities', () => {
  const doc = { schemaVersion: 1, notes: 'keep', profiles: [{ id: 'claude', caps: { trusted: false } }] };
  const next = upsertProfile(doc, { id: 'claude', name: 'Claude', command: 'claude' });
  assert.equal(next.notes, 'keep');
  assert.equal(next.schemaVersion, 1);
  assert.deepEqual(next.profiles[0].caps, { trusted: false });
});

test('strict reads refuse corrupt data before a profile edit can overwrite it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-profile-contract-'));
  try {
    const path = join(dir, 'agents.json');
    writeFileSync(path, '{broken');
    assert.throws(() => readAgentsFile(path, { strict: true }), /profile/i);
    assert.equal(readFileSync(path, 'utf8'), '{broken');
    writeFileSync(path, '{"notProfiles":[]}');
    assert.throws(() => readAgentsFile(path, { strict: true }), /profile/i);
    for (const profile of [{ id: 'broken' }, { id: 'a', name: 'A', command: 'a', args: [1] }, { id: 'a', name: 'A', command: 'a', caps: { lifecycle: { mode: 'invalid' } } }]) {
      const invalid = JSON.stringify({ profiles: [profile] });
      writeFileSync(path, invalid);
      assert.throws(() => readAgentsFile(path, { strict: true }), /runtime schema/);
      assert.equal(readFileSync(path, 'utf8'), invalid);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('profile writes retain wrapper metadata and support legacy array reads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-profile-contract-'));
  try {
    const path = join(dir, 'agents.json');
    writeFileSync(path, '[{"id":"kimi","name":"Kimi","command":"kimi"}]');
    assert.equal(readAgentsFile(path, { strict: true }).profiles[0].id, 'kimi');
    writeAgentsFile(path, { schemaVersion: 1, profiles: [] });
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).schemaVersion, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
