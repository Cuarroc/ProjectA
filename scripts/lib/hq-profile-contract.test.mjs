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

// W1-18b: `conventionAt` is a documented (docs/agents-json.md) and shipped
// (PR #57) skills mode and the built-in opencode profiles use it - the HQ
// validator must not reject it as malformed.
test('the validator accepts skills conventionAt with a string dir and rejects a malformed one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-profile-contract-'));
  try {
    const path = join(dir, 'agents.json');
    const valid = JSON.stringify({ profiles: [{ id: 'opencode', name: 'OC', command: 'opencode', caps: { skills: { mode: 'conventionAt', dir: '.agents/skills' } } }] });
    writeFileSync(path, valid);
    assert.equal(readAgentsFile(path, { strict: true }).profiles[0].caps.skills.mode, 'conventionAt');
    assert.equal(readFileSync(path, 'utf8'), valid);
    for (const caps of [{ skills: { mode: 'conventionAt' } }, { skills: { mode: 'conventionAt', dir: 5 } }]) {
      const invalid = JSON.stringify({ profiles: [{ id: 'a', name: 'A', command: 'a', caps }] });
      writeFileSync(path, invalid);
      assert.throws(() => readAgentsFile(path, { strict: true }), /runtime schema/);
      assert.equal(readFileSync(path, 'utf8'), invalid);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// W1-18b, second review: the validator's mode table is a JS mirror
// of the Rust capability enums in src-tauri/src/capabilities.rs. The W1-18b
// sibling bug (validator rejected the documented conventionAt mode) happened
// because the two drifted apart - this gate fails when one side gains,
// renames or re-shapes a mode without the other.
test('the validator mode table mirrors the Rust capability enums', () => {
  const rust = readFileSync(join(import.meta.dirname, '../../src-tauri/src/capabilities.rs'), 'utf8');
  const parseEnum = (name) => {
    const start = rust.indexOf(`pub enum ${name} {`);
    assert.notEqual(start, -1, `enum ${name} not found in capabilities.rs`);
    const bodyStart = rust.indexOf('{', start);
    let depth = 0, bodyEnd = -1;
    for (let i = bodyStart; i < rust.length; i++) {
      if (rust[i] === '{') depth++;
      if (rust[i] === '}' && --depth === 0) { bodyEnd = i; break; }
    }
    const modes = {};
    for (const match of rust.slice(bodyStart + 1, bodyEnd).matchAll(/^\s*(\w+)(?:\s*\{([^}]*)\})?,/gm)) {
      const mode = match[1][0].toLowerCase() + match[1].slice(1);
      modes[mode] = match[2] ? [...match[2].matchAll(/(\w+):\s*String/g)].map(field => field[1]).sort() : [];
    }
    return modes;
  };
  const lib = readFileSync(join(import.meta.dirname, 'hq-live-lib.mjs'), 'utf8');
  const marker = 'Object.entries({';
  const open = lib.indexOf(marker);
  assert.notEqual(open, -1, 'mode table not found in hq-live-lib.mjs');
  let depth = 1, close = -1;
  for (let i = open + marker.length; i < lib.length; i++) {
    if (lib[i] === '{') depth++;
    if (lib[i] === '}' && --depth === 0) { close = i; break; }
    assert.ok(i < lib.length - 1, 'unbalanced mode table');
  }
  const table = new Function(`return ${lib.slice(open + marker.length - 1, close + 1)}`)();
  for (const modeMap of Object.values(table)) for (const fields of Object.values(modeMap)) fields.sort();
  const rustSide = { systemPrompt: parseEnum('SystemPrompt'), skills: parseEnum('SkillsDiscovery'), lifecycle: parseEnum('Lifecycle') };
  assert.deepEqual(table, rustSide);
  // self-check, so the gate cannot silently degrade: injected drift must trip it
  const drifted = structuredClone(rustSide);
  drifted.skills.conventionAt = [];
  assert.throws(() => assert.deepEqual(table, drifted));
});
