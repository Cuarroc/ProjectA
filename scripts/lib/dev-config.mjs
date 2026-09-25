import { readFileSync } from 'node:fs';

const limits = { maxWorkers: 2, maxIntegration: 1, goalMinutes: 90, maxTasksPerGoal: 8, maxAttemptsPerTask: 3, maxEscalations: 1, discoveryRunsPerDay: 2, maxAutonomousGoals: 1 };
function object(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown ${name}.${key}`);
  for (const key of keys) if (!(key in value)) throw new Error(`Missing ${name}.${key}`);
}
export function validateDevConfig(value) {
  object(value, ['schemaVersion', 'continuous', 'routing', 'providers', 'teams', ...('tokens' in value ? ['tokens'] : [])], 'config');
  if (value.tokens != null) {
    object(value.tokens, ['maxPerGoal', 'verificationReserve'], 'tokens');
    if (!Number.isInteger(value.tokens.maxPerGoal) || value.tokens.maxPerGoal < 1 || value.tokens.maxPerGoal > 200000 || !Number.isInteger(value.tokens.verificationReserve) || value.tokens.verificationReserve < 1 || value.tokens.verificationReserve > value.tokens.maxPerGoal) throw new Error('Invalid token allowance or verification reserve');
  }
  if (value.schemaVersion !== 1) throw new Error('Unsupported development configuration version');
  object(value.continuous, ['enabled', ...Object.keys(limits)], 'continuous');
  if (typeof value.continuous.enabled !== 'boolean') throw new Error('continuous.enabled must be boolean');
  if (value.continuous.enabled) throw new Error('continuous.enabled must remain false until runtime acceptance gates pass');
  for (const [key, max] of Object.entries(limits)) {
    const n = value.continuous[key];
    const min = ['maxEscalations', 'discoveryRunsPerDay', 'maxAutonomousGoals'].includes(key) ? 0 : 1;
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`continuous.${key} must be an integer from ${min} to ${max}`);
  }
  object(value.routing, ['additionalPaidApi', 'quotaReservePercent', 'billing'], 'routing');
  if (value.routing.additionalPaidApi !== false) throw new Error('Additional paid API spending is not authorized');
  if (!Number.isInteger(value.routing.quotaReservePercent) || value.routing.quotaReservePercent < 20 || value.routing.quotaReservePercent > 100) throw new Error('Quota reserve must be 20–100 percent');
  if (!Array.isArray(value.routing.billing) || !value.routing.billing.length || value.routing.billing.some(x => !['subscription', 'free', 'local'].includes(x))) throw new Error('Unknown billing policy');
  if (new Set(value.routing.billing).size !== value.routing.billing.length) throw new Error('Duplicate billing policy');
  if (!Array.isArray(value.providers) || !value.providers.length || value.providers.some(x => !['claude', 'codex', 'kimi', 'opencode', 'ollama'].includes(x)) || new Set(value.providers).size !== value.providers.length) throw new Error('Invalid provider list');
  if (!Array.isArray(value.teams) || !value.teams.length) throw new Error('At least one team is required');
  const ids = new Set();
  for (const team of value.teams) {
    object(team, ['id', 'roles'], 'team');
    if (typeof team.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(team.id) || ids.has(team.id)) throw new Error('Invalid or duplicate team id');
    ids.add(team.id);
    if (!Array.isArray(team.roles) || !team.roles.length || team.roles.some(x => !['coordinator', 'implementer', 'reviewer', 'integrator'].includes(x))) throw new Error('Invalid team roles');
    if (new Set(team.roles).size !== team.roles.length) throw new Error('Duplicate team roles');
  }
  return value;
}
export function readDevConfig(path) { return validateDevConfig(JSON.parse(readFileSync(path, 'utf8'))); }
