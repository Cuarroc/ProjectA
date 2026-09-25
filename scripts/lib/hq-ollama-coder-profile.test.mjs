import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBuiltinProfiles } from './hq-live-lib.mjs';

test('the shipped ollama-coder profile runs a live cloud coding model and inherits the cautious ollama defaults', () => {
  const profiles = parseBuiltinProfiles(readFileSync('src-tauri/resources/agent-defaults.json', 'utf8'));
  const coder = profiles.find(profile => profile.id === 'ollama-coder');
  assert.ok(coder, 'ollama-coder is shipped');
  assert.equal(coder.command, 'ollama');
  assert.deepEqual(coder.args, ['run', 'deepseek-v4-flash:cloud']);
  // Regression: qwen3-coder:480b-cloud was retired by Ollama on 2026-07-15,
  // so the shipped profile could not start at all (BUGS.md 2026-09-17).
  assert.ok(!JSON.stringify(coder.args).includes('qwen3-coder'), 'no retired model ships');
  assert.equal(coder.enabled, true);
  const base = profiles.find(profile => profile.id === 'ollama');
  assert.deepEqual(coder.caps, base.caps);
});
