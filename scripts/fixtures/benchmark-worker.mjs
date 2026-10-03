const answers = {
  'config-validation': { accepted: false, reason: 'user-approval-required' },
  'dependency-order': ['plan', 'implement', 'review'],
  'budget-exhaustion': { decision: 'block' },
  'review-invalidation': { valid: false },
  'provider-unavailable': { terminal: 'blocked', retryable: true },
};

export async function runTask({ id }) {
  if (!(id in answers)) throw new Error(`Unknown fixture task: ${id}`);
  return structuredClone(answers[id]);
}
