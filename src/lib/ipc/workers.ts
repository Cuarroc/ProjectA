import { invoke } from "@tauri-apps/api/core";

import type { Worker, WorkerKind } from "../../types";

// -- workers (Phase 2) -------------------------------------------------------

/** A worker as it comes off the wire, before `kind` is settled. */
export type RawWorker = Omit<Worker, "kind" | "spawnedBy" | "pausedReason"> & {
  kind?: string | null;
  spawnedBy?: string | null;
  pausedReason?: string | null;
};

/** Every kind the UI can render. Anything else falls back to `worker`. */
const WORKER_KINDS: ReadonlySet<string> = new Set<WorkerKind>([
  "worker",
  "orchestrator",
  "queen",
  "scout",
]);

export function toWorkerKind(value: string | null | undefined): WorkerKind {
  return typeof value === "string" && WORKER_KINDS.has(value)
    ? (value as WorkerKind)
    : "worker";
}

/**
 * A worker without a `kind` is an ordinary worker — an unrecognised one must
 * never disappear from the board by being mistaken for a coordinator, which
 * the board keeps off its columns.
 */
export function toWorker(raw: RawWorker): Worker {
  return {
    ...raw,
    kind: toWorkerKind(raw.kind),
    spawnedBy: raw.spawnedBy ?? null,
    pausedReason: raw.pausedReason ?? null,
  };
}

/**
 * `roleVariantId` is opt-in: a plain spawn must reach the core exactly as it
 * did before variants existed, so the key is only added when one was picked.
 */
export async function createWorker(args: {
  projectId: string;
  task: string;
  profileId: string;
  roleVariantId?: string;
}): Promise<Worker> {
  return toWorker(
    await invoke<RawWorker>("create_worker", {
      projectId: args.projectId,
      task: args.task,
      profileId: args.profileId,
      ...(args.roleVariantId === undefined ? {} : { roleVariantId: args.roleVariantId }),
    }),
  );
}

/** Every worker, or only those of `projectId`. */
export async function listWorkers(projectId?: string): Promise<Worker[]> {
  const raw = await invoke<RawWorker[]>("list_workers", { projectId });
  return Array.isArray(raw) ? raw.map(toWorker) : [];
}
