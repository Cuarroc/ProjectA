import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AttentionSource } from "./attentionInbox";
import { describeError, getWorkerReadiness } from "./ipc";
import type { Worker } from "../types";

const POLL_INTERVAL_MS = 15_000;

export interface AttentionBlockersState {
  blockers: AttentionSource[];
  error: string | null;
  refresh: () => void;
}

/**
 * Projects F4 readiness blockers into the shared Attention source shape.
 * Readiness remains the source of truth: this hook only adds worker/project
 * identity so the existing inbox can navigate to the affected task.
 */
export function useAttentionBlockers(
  projectId: string | null,
  workers: readonly Worker[],
): AttentionBlockersState {
  const [blockers, setBlockers] = useState<AttentionSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  const workerIds = useMemo(
    () =>
      workers
        .filter(
          (worker) =>
            worker.kind === "worker" &&
            worker.projectId === projectId &&
            worker.status !== "archived",
        )
        .map((worker) => worker.id)
        .sort(),
    [projectId, workers],
  );
  const load = useCallback(async () => {
    const mine = ++token.current;
    if (projectId === null || workerIds.length === 0) {
      setBlockers([]);
      setError(null);
      return;
    }

    const results = await Promise.allSettled(
      workerIds.map(async (workerId) => ({
        workerId,
        readiness: await getWorkerReadiness(workerId),
      })),
    );
    if (token.current !== mine) return;

    const next: AttentionSource[] = [];
    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failures.push(`${workerIds[index]}: ${describeError(result.reason)}`);
        return;
      }
      const { workerId, readiness } = result.value;
      for (const blocker of readiness.blockers) {
        next.push({
          kind: "blocker",
          workerId,
          projectId,
          code: blocker.code,
          message: blocker.message,
          nextStep: blocker.nextStep,
          observedAt: readiness.checkedAt,
        });
      }
    });
    setBlockers(next);
    setError(
      failures.length === 0
        ? null
        : `Readiness konnte nicht vollständig geladen werden: ${failures.join("; ")}`,
    );
  }, [projectId, workerIds]);

  useEffect(() => {
    void load();
    if (projectId === null || workerIds.length === 0) return;
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load, projectId, workerIds.length]);

  return { blockers, error, refresh: () => void load() };
}
