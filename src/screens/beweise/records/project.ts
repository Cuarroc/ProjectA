export type Association = "current" | "stale" | "unassigned";
export interface Observation {
  commit: string | null;
  source: string;
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
  state: string;
  candidate: Observation | null;
  evidence: EvidenceProjection[];
  reviews: ReviewProjection[];
}
export interface Projection {
  projectHasRecords: boolean;
  runs: RunProjection[];
}

export function isWorkerRecord(_value: unknown, _workerId: string): boolean {
  return false;
}

/** Input is the reader's opaque runs array; output contains display fields only. */
export function projectRecords(runs: readonly unknown[], _workerId: string): Projection {
  return { projectHasRecords: runs.length > 0, runs: [] };
}
