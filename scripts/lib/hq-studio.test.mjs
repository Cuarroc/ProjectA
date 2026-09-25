import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRouting, saveRouting, validateRouting, studioCatalog } from './hq-studio.mjs';
import { upsertProfile } from './hq-live-lib.mjs';
await import('../../docs/dev-hq/concepts/studio-model.js');
const { advise, signature, taskPrompt } = globalThis.StudioModel;
const root = mkdtempSync(join(tmpdir(), 'hq-studio-test-'));
const now = Date.now();
const profile = { id: 'codex', name: 'Codex', command: 'codex', args: [], enabled: true };
const sample = () => ({ id: 'run-1', profileId: 'codex', profileSignature: signature(profile), task: 'code', kind: 'experience', model: 'measured-model', effort: 'high', source: '.pa/run-1.md', samples: 4, passed: 3, seconds: 20, observedAt: new Date(now - 1000).toISOString() });
test('routing persists, detects concurrent edits, and does not overwrite invalid data', () => {
  const config = readRouting(root); config.evidence.push(sample());
  const saved = saveRouting(root, config); assert.equal(saved.revision, 1); assert.deepEqual(readRouting(root), saved);
  assert.throws(() => saveRouting(root, config), /inzwischen/);
  assert.throws(() => saveRouting(root, { ...saved, rules: { ...saved.rules, maxAgeDays: -1 } }), /Regeln/);
  assert.equal(readRouting(root).revision, 1);
});
test('invalid measurements, duplicate IDs and future evidence are refused', () => {
  for (const patch of [{ samples: 0 }, { passed: 50 }, { seconds: 0 }, { source: '' }, { observedAt: 'invalid' }, { observedAt: new Date(now + 86400000).toISOString() }]) {
    assert.throws(() => validateRouting({ ...readRouting(root), evidence: [{ ...sample(), ...patch }] }));
  }
  assert.throws(() => validateRouting({ ...readRouting(root), evidence: [sample(), sample()] }), /Doppelte/);
});
test('advisor requires fresh quota, task evidence and exact profile configuration', () => {
  const cfg = readRouting(root), quota = [{ profileId: 'codex', state: 'ok', updatedAt: now / 1000 }];
  assert.equal(advise(cfg, [profile], quota, 'code', now)[0].reasons.length, 0);
  assert.equal(advise(cfg, [profile], [], 'code', now)[0].reasons.length, 1);
  assert.ok(advise(cfg, [profile], quota, 'review', now)[0].reasons.length);
  assert.ok(advise(cfg, [{ ...profile, args: ['--new-model'] }], quota, 'code', now)[0].reasons.length);
  assert.ok(advise(cfg, [profile], quota, 'code', now + 7200000)[0].reasons.length);
});
test('advisor keeps model/effort samples separate and never fills missing measurements with zero', () => {
  const cfg = readRouting(root); cfg.evidence = [{ ...sample(), samples: 2, passed: 2 }, { ...sample(), id: 'run-2', effort: 'low', samples: 2, passed: 1 }];
  const candidate = advise(cfg, [profile], [{ profileId: 'codex', state: 'ok', updatedAt: now / 1000 }], 'code', now)[0];
  assert.equal(candidate.measured, null); assert.equal(candidate.score, null); assert.ok(candidate.reasons.length);
});
test('catalog exposes only paths and plugin states, never settings secrets', () => {
  mkdirSync(join(root, '.agents', 'skills', 'review'), { recursive: true }); writeFileSync(join(root, '.agents', 'skills', 'review', 'SKILL.md'), 'secret skill content');
  mkdirSync(join(root, '.claude'), { recursive: true }); writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { example: true }, env: { SECRET: 'never-return' } }));
  const catalog = studioCatalog(root); assert.equal(catalog.skills[0].name, 'review'); assert.deepEqual(catalog.plugins[0], { name: 'example', enabled: true, source: '.claude/settings.json' });
  assert.doesNotMatch(JSON.stringify(catalog), /never-return|secret skill content/);
});
test('plan and interview prompts retain requested context and no-implementation instruction', () => {
  assert.match(taskPrompt({ mode: 'plan', text: 'Scope', skills: ['.agents/skills/review/SKILL.md'] }), /Keine Dateien ändern/);
  assert.match(taskPrompt({ mode: 'interview', text: 'Scope', goal: 'Goal', constraints: 'Budget' }), /keine Implementierung/);
});
test('all new assets are referenced by the runtime entrypoint', () => {
  const html = readFileSync(new URL('../../docs/dev-hq/concepts/hq2-studio.html', import.meta.url), 'utf8');
  assert.match(html, /studio-workspace.js/); assert.doesNotMatch(html, /live.html|studio-analysis.js/);
});
test('advisor applies the selected weight inside model/effort groups too', () => {
  const cfg = readRouting(root); cfg.rules.qualityWeight = 0;
  cfg.evidence = [{ ...sample(), model: 'slow', samples: 100, passed: 100, seconds: 100 }, { ...sample(), id: 'fast', model: 'fast', samples: 100, passed: 99, seconds: 1 }];
  assert.equal(advise(cfg, [profile], [{ profileId: 'codex', state: 'ok', updatedAt: now / 1000 }], 'code', now)[0].measured.model, 'fast');
});
test('a new harness profile retains the explicitly copied capabilities', () => {
  const caps = { systemPrompt: { mode: 'arg', flag: '--system' }, skills: { mode: 'convention' } };
  const saved = upsertProfile({ profiles: [] }, { ...profile, id: 'independent-harness', caps });
  assert.deepEqual(saved.profiles[0].caps, caps);
});
