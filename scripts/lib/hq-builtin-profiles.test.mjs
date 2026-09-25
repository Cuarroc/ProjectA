import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBuiltinProfiles, mergeProfileViews } from './hq-live-lib.mjs';

test('HQ builtins contain only the seven shipped profiles, with runtime capabilities', () => {
  const profiles = parseBuiltinProfiles(readFileSync('src-tauri/resources/agent-defaults.json', 'utf8'));
  assert.deepEqual(profiles.map(profile => profile.id), ['claude', 'kimi', 'codex', 'opencode', 'opencode-glm-53-flash', 'ollama', 'ollama-coder']);
  assert.equal(profiles[0].caps.lifecycle.mode, 'settingsHooks');
  assert.equal(profiles[3].caps.readinessMarker, 'Ask anything');
});

test('HQ applies Rust replacement defaults and longest-prefix capability inheritance', () => {
  const builtins = parseBuiltinProfiles(readFileSync('src-tauri/resources/agent-defaults.json', 'utf8'));
  const profiles = mergeProfileViews(builtins, { profiles: [
    { id: 'opencode-glm-53-flash', name: 'Reset args', command: 'opencode' },
    { id: 'claude-omni', name: 'Variant', command: 'claude' },
    { id: 'claude-omni-fast', name: 'Explicit caps', command: 'claude', caps: { skills: { mode: 'unsupported' } } },
    { id: 'claude-omni-fast-child', name: 'Nearest base', command: 'claude', caps: null },
    { id: 'claudeomni', name: 'Unrelated', command: 'x' },
  ] });
  assert.deepEqual(profiles.find(p => p.id === 'opencode-glm-53-flash').args, []);
  assert.equal(profiles.find(p => p.id === 'claude-omni').caps.lifecycle.mode, 'settingsHooks');
  for (const id of ['claude-omni-fast', 'claude-omni-fast-child', 'claudeomni']) {
    const profile = profiles.find(p => p.id === id);
    assert.equal(profile.caps.systemPrompt.mode, 'unsupported');
    assert.equal(profile.caps.lifecycle.mode, 'heuristic');
    assert.deepEqual(profile.env, {});
    assert.equal(profile.fallback, null);
  }
});

test('builtin parser rejects source code, invalid versions and duplicate identities visibly', () => {
  assert.throws(() => parseBuiltinProfiles('AgentProfile::new("fake", "Fake", "x", &[])'));
  assert.throws(() => parseBuiltinProfiles('{"schemaVersion":2,"profiles":[]}'));
  const profile = { id: 'a', name: 'A', command: 'a' };
  assert.throws(() => parseBuiltinProfiles(JSON.stringify({ schemaVersion: 1, profiles: [profile, profile] })), /duplicate/);
  assert.throws(() => parseBuiltinProfiles(JSON.stringify({ schemaVersion: 1, profiles: [{ ...profile, caps: null }] })), /Invalid/);
});
