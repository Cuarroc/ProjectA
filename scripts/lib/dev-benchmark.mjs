import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

export const TASKS = Object.freeze([
  {
    id: 'config-validation',
    prompt: 'Decide whether unattended mode may start.',
    input: { mode: 'continuous', userApproved: false },
    expected: { accepted: false, reason: 'user-approval-required' },
  },
  {
    id: 'dependency-order',
    prompt: 'Return a valid execution order for these dependent tasks.',
    input: { tasks: [{ id: 'review', after: ['implement'] }, { id: 'plan', after: [] }, { id: 'implement', after: ['plan'] }] },
    expected: ['plan', 'implement', 'review'],
  },
  {
    id: 'budget-exhaustion',
    prompt: 'Decide whether the task fits the remaining token budget.',
    input: { remainingTokens: 120, estimatedTokens: 180 },
    expected: { decision: 'block' },
  },
  {
    id: 'review-invalidation',
    prompt: 'Decide whether this review still applies to the candidate.',
    input: { reviewedCommit: 'abc123', candidateCommit: 'def456' },
    expected: { valid: false },
  },
  {
    id: 'provider-unavailable',
    prompt: 'Classify a temporary provider outage.',
    input: { providerState: 'unavailable', attempts: 1, maxAttempts: 2 },
    expected: { terminal: 'blocked', retryable: true },
  },
]);

export const CASES = Object.freeze(TASKS.map(({ id }) => id));

export async function runDevelopmentBenchmark(runTask, adapter = 'worker-adapter') {
  if (typeof runTask !== 'function') throw new TypeError('Worker adapter must export a function');
  const results = [];
  const benchmarkStarted = performance.now();
  for (const task of TASKS) {
    const started = performance.now();
    let actual = null;
    let error = null;
    try {
      actual = await runTask(structuredClone({ id: task.id, prompt: task.prompt, input: task.input }));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    results.push({
      id: task.id,
      passed: error === null && isDeepStrictEqual(actual, task.expected),
      durationMs: Number((performance.now() - started).toFixed(3)),
      expected: task.expected,
      actual,
      ...(error === null ? {} : { error }),
    });
  }
  return {
    schemaVersion: 1,
    adapter,
    tasks: results,
    summary: {
      passed: results.filter(({ passed }) => passed).length,
      total: TASKS.length,
      durationMs: Number((performance.now() - benchmarkStarted).toFixed(3)),
    },
  };
}
