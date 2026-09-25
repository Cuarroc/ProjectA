// Acceptance compares measured runs only. Missing telemetry never becomes zero.
export const CASES = Object.freeze([
  'config-validation', 'profile-roundtrip', 'profile-path', 'provider-unavailable',
  'routine-ui-edit', 'ui-accessibility', 'ui-project-race', 'rust-regression',
  'dependency-order', 'claim-race', 'stale-fence', 'crash-before-spawn',
  'crash-after-spawn', 'budget-exhaustion', 'model-escalation', 'review-invalidation',
  'lesson-reuse', 'offline-hq', 'update-candidate', 'update-recovery',
]);

function measure(rows, name) {
  if (!Array.isArray(rows) || rows.length !== CASES.length) throw new Error(`${name}: exactly 20 measured cases required`);
  const ids = new Set(); const runs = new Set();
  for (const row of rows) {
    if (!CASES.includes(row.caseId) || ids.has(row.caseId)) throw new Error(`${name}: invalid or duplicate case`);
    ids.add(row.caseId);
    if (row.source !== 'measured' || typeof row.runId !== 'string' || !row.runId || runs.has(row.runId) || typeof row.evidence !== 'string' || !row.evidence.trim()) throw new Error(`${name}: unique runs and measured evidence required`);
    runs.add(row.runId);
    for (const field of ['tokens', 'elapsedMs', 'reviewRejections', 'rework', 'escapedRegressions']) {
      if (!Number.isSafeInteger(row[field]) || row[field] < 0) throw new Error(`${name}: ${field} is missing or invalid`);
    }
    if (!row.elapsedMs || typeof row.accepted !== 'boolean') throw new Error(`${name}: elapsed time and acceptance are required`);
  }
  const accepted = rows.filter(row => row.accepted).length;
  if (!accepted) throw new Error(`${name}: no accepted tasks`);
  const total = field => rows.reduce((sum, row) => sum + row[field], 0);
  const elapsed = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
  return { accepted, tokensPerAcceptedTask: total('tokens') / accepted,
    medianElapsedMs: (elapsed[9] + elapsed[10]) / 2,
    reviewRejections: total('reviewRejections'), rework: total('rework'), escapedRegressions: total('escapedRegressions') };
}

export function compareDevelopmentRuns(baselineRows, candidateRows) {
  const baseline = measure(baselineRows, 'baseline');
  const candidate = measure(candidateRows, 'candidate');
  const baselineRuns = new Set(baselineRows.map(row => row.runId));
  if (candidateRows.some(row => baselineRuns.has(row.runId))) throw new Error('Baseline and candidate must be separate observed runs');
  if (!baseline.tokensPerAcceptedTask) throw new Error('Zero-token baseline cannot establish token reduction');
  const tokenReduction = 1 - candidate.tokensPerAcceptedTask / baseline.tokensPerAcceptedTask;
  const elapsedReduction = 1 - candidate.medianElapsedMs / baseline.medianElapsedMs;
  const acceptancePreserved = baselineRows.every(row => !row.accepted || candidateRows.find(c => c.caseId === row.caseId).accepted);
  const qualityPreserved = acceptancePreserved && candidate.escapedRegressions <= baseline.escapedRegressions;
  return { schemaVersion: 1, baseline, candidate, tokenReduction, elapsedReduction, qualityPreserved,
    evidenceVerified: false,
    targetAssessment: qualityPreserved && tokenReduction >= 0.20 - Number.EPSILON && elapsedReduction >= 0.15 - Number.EPSILON ? 'targets-met-unverified' : 'targets-not-met',
    recommendation: 'retain-previous-policy' };
}
