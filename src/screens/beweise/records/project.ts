import { T } from "./texts";

export type Association = "current" | "stale" | "unassigned";
export interface Observation {
  commit: string | null;
  source: typeof T.sources[keyof typeof T.sources];
  observedAt: number | null;
}
export interface EvidenceProjection extends Observation {
  association: Association;
  measurement: number | null;
}
export interface ReviewProjection extends Observation {
  association: Association;
  attestation: "unverified" | "unavailable";
  approval: "unavailable";
}
export interface RunProjection {
  state: typeof T.states[keyof typeof T.states] | typeof T.unavailable;
  candidate: Observation | null;
  evidence: EvidenceProjection[];
  reviews: ReviewProjection[];
}
export interface Projection {
  projectHasRecords: boolean;
  runs: RunProjection[];
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const objects = (value: unknown) => Array.isArray(value) ? value.map(object) : [];
const identifier = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const fullCommit = (value: unknown): value is string => typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
const invalidated = (row: Record<string, unknown>) =>
  row.invalidatedAt != null || row.invalidatedByCommit != null || row.status === "invalidated";

function observation(row: Record<string, unknown>): Observation {
  const time = row.observedAt;
  return {
    commit: fullCommit(row.candidateCommit) ? row.candidateCommit.slice(0, 12) : null,
    source: row.source === "git" ? T.sources.git : row.source === "test-gate" ? T.sources["test-gate"] : T.sources.unverified,
    observedAt: typeof time === "number" && Number.isSafeInteger(time) && time >= 0 && time <= 8640000000000 ? time : null,
  };
}

function association(row: Record<string, unknown>, runId: unknown, candidate: string | null): Association {
  if (invalidated(row)) return "stale";
  if (!identifier(runId) || row.runId !== runId || !fullCommit(row.candidateCommit) || candidate === null) return "unassigned";
  return row.candidateCommit === candidate ? "current" : "stale";
}

/** Strict worker identity only: no trimming, prefixes, task IDs or fallback association. */
export function isWorkerRecord(value: unknown, workerId: string): boolean {
  return object(object(value).run).workerId === workerId;
}

/** Consume getDevelopmentRecords().runs; null display fields mean unavailable.
 * Times are Unix seconds within Date's range, commits are 12-character displays.
 * projectHasRecords distinguishes an empty project from an empty worker selection.
 * Association describes stored linkage only; reviews never grant approval.
 */
export function projectRecords(runs: readonly unknown[], workerId: string): Projection {
  return { projectHasRecords: runs.length > 0, runs: runs.filter((row) => isWorkerRecord(row, workerId)).map((value) => {
    const record = object(value), run = object(record.run), candidate = object(record.candidate);
    const commit = identifier(run.id) && candidate.runId === run.id && fullCommit(candidate.candidateCommit)
      ? candidate.candidateCommit : null;
    const evidence = objects(record.evidence);
    return {
      state: typeof run.status === "string" && Object.hasOwn(T.states, run.status)
        ? T.states[run.status as keyof typeof T.states] : T.unavailable,
      candidate: commit === null ? null : observation(candidate),
      evidence: evidence.map((row) => {
        const measurement = object(row.measurement);
        return { ...observation(row), association: association(row, run.id, commit),
          measurement: measurement.state === "measured" && typeof measurement.value === "number" && Number.isFinite(measurement.value)
            ? measurement.value : null };
      }),
      reviews: objects(record.reviews).map((row): ReviewProjection => {
        const matches = evidence.filter((item) => identifier(row.evidenceId) && item.id === row.evidenceId &&
          item.runId === run.id && item.candidateCommit === row.candidateCommit);
        let link: Association = "unassigned";
        if (invalidated(row)) link = "stale";
        else if (row.status === "valid" && row.runId === run.id && fullCommit(row.candidateCommit) && matches.length === 1) {
          link = association(matches[0], run.id, commit);
        }
        return { ...observation(row), association: link,
          attestation: row.reviewerAttestation === "unavailable" ? "unavailable" : "unverified", approval: "unavailable" };
      }),
    };
  }) };
}
