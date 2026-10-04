// W3-03g: provider identity + usage/billing drill (matrix rows 11 and 12).
// Pure over two `pa hq runs` captures (before/after the one real run); never
// estimates tokens: a missing collector must show up as `not_reported`.
import { createBundle } from './drill-kit.mjs';
export const ADAPTERS = ['claude', 'codex', 'opencode'];
const runList = (json) => (Array.isArray(json) ? json : json?.runs ?? json?.records ?? []);
const runId = (r) => r?.run?.id ?? r?.runId ?? null;
const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };

export function newRuns(before, after) {
  const seen = new Set(runList(before).map(runId));
  return runList(after).filter((r) => runId(r) && !seen.has(runId(r)));
}
export function summarizeRun(record) {
  const route = parse(record?.launch?.routeJson) ?? {};
  const identity = record?.executionIdentity ?? { state: 'unavailable' };
  const observed = identity.identity?.observed ?? null;
  const usage = record?.usage ?? { state: 'missing' };
  const prov = usage.provenance ?? {};
  return {
    runId: runId(record),
    configured: {
      provider: route.selection?.resolved?.provider ?? 'unknown',
      model: route.invocationModel ?? null,
      transport: route.preparedInvocation?.transport ?? 'unknown',
    },
    routeExecutionObservation: route.executionObservation?.state ?? 'unknown',
    identity: { state: identity.state, assessment: identity.assessment ?? null, observed },
    reservation: { ledgerState: usage.ledgerState ?? null, reservedTokens: usage.reservedTokens ?? null },
    usage: {
      state: usage.state, reason: usage.reason ?? null, tokens: usage.state === 'measured' ? usage.tokens ?? null : null,
      collector: prov.collector ?? null, source: prov.source ?? null, observedAt: prov.observedAt ?? null,
    },
  };
}
// Rows 11/12 problems: anything unknown, stale or invented blocks the drill.
export function judge(adapter, s) {
  const p = [];
  if (s.configured.provider !== adapter) p.push(`route provider is ${s.configured.provider}, not ${adapter}`);
  if (s.configured.transport === 'unknown') p.push('route has no transport');
  if (s.identity.state !== 'recorded') p.push(`execution identity is ${s.identity.state} (no observed identity)`);
  if (s.usage.state === 'measured') {
    if (!s.usage.source || s.usage.observedAt == null) p.push('measured usage lacks source or observedAt');
  } else if (s.usage.state === 'not_reported') {
    if (s.usage.tokens != null) p.push('not_reported receipt carries tokens');
    if (!s.usage.reason) p.push('not_reported receipt lacks a reason');
  } else p.push(`usage receipt state is ${s.usage.state}`);
  return p;
}
export function runProviderDrill({ adapter, outDir, before, after, snapshot = '', snapshotSource = '', snapshotObservedAt = '', appVersion, commit, processList = '' }) {
  const bundle = createBundle({ outDir, drill: `provider-${adapter}`, appVersion, commit });
  const done = () => bundle.finish(NOT_COVERED);
  if (!ADAPTERS.includes(adapter)) { bundle.step('check adapter', { exitCode: 1, detail: `unknown adapter ${adapter}` }); return done(); }
  if (processList) bundle.addFile('processes.txt', processList);
  const fresh = newRuns(before, after);
  bundle.step('find the one new run', { exitCode: fresh.length === 1 ? 0 : 1, detail: `${fresh.length} new run(s)` });
  if (fresh.length !== 1) return done();
  const summary = summarizeRun(fresh[0]);
  bundle.addFile('run-summary.json', JSON.stringify(summary, null, 2));
  bundle.addFile('run-record.json', JSON.stringify(fresh[0], null, 2));
  const problems = judge(adapter, summary);
  bundle.step('route, observed identity, reservation and collector result', {
    command: 'pa hq runs --project <id> (before/after)', exitCode: problems.length ? 1 : 0,
    detail: problems.join('; ') || `${summary.configured.provider}/${summary.configured.transport}, usage ${summary.usage.state}`,
  });
  const hasSnapshot = snapshot.trim() !== '' && snapshotSource.trim() !== '' && snapshotObservedAt.trim() !== '';
  bundle.addFile('provider-snapshot.txt', `source: ${snapshotSource}\nobservedAt: ${snapshotObservedAt}\n\n${snapshot}\n`);
  bundle.step('provider-side snapshot (copied by the user)', { exitCode: hasSnapshot ? 0 : 1, detail: hasSnapshot ? `source: ${snapshotSource}` : 'text, source or observation time missing' });
  return done();
}
export const NOT_COVERED = [
  'The provider-side snapshot is typed in by the user; the script cannot verify it against the provider.',
  'Windows-only behaviour (installed app, real subscription login) is exercised only on the user PC; Linux CI runs the parser tests.',
  'Adapters without a trusted collector are expected to end as not_reported; usage is never estimated.',
];
