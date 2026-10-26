import { invoke } from "@tauri-apps/api/core";

export interface DevelopmentRecordsV1 {
  apiVersion: 1;
  executionEnabled: false;
  sourceTimestamp: number;
  approvalAuthority: {
    state: "unavailable";
    detail: string;
    reviewerPrincipal: "launch-route-receipt";
  };
  // Complete native records stay opaque until a consumer validates its projection.
  runs: unknown[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDevelopmentRecordsV1(value: unknown): value is DevelopmentRecordsV1 {
  if (!isObject(value) || !isObject(value.approvalAuthority)) return false;
  return value.apiVersion === 1 && value.executionEnabled === false &&
    Number.isSafeInteger(value.sourceTimestamp) && (value.sourceTimestamp as number) >= 0 &&
    value.approvalAuthority.state === "unavailable" &&
    typeof value.approvalAuthority.detail === "string" &&
    value.approvalAuthority.reviewerPrincipal === "launch-route-receipt" &&
    Array.isArray(value.runs);
}

/** One coherent read. Native failures reject; unavailable observations remain in the snapshot. */
export async function getDevelopmentRecords(projectId: string): Promise<DevelopmentRecordsV1> {
  if (!projectId.trim()) throw new Error("projectId is required");
  const raw = await invoke<unknown>("get_development_records", { projectId });
  if (!isDevelopmentRecordsV1(raw)) throw new Error("Invalid development records snapshot");
  return raw;
}
