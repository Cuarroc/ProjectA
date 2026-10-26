import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getDevelopmentRecords } from "./developmentRecords";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const snapshot = () => ({
  apiVersion: 1, executionEnabled: false, sourceTimestamp: 42,
  approvalAuthority: {
    state: "unavailable", reviewerPrincipal: "launch-route-receipt", detail: "Unsigned verdicts",
  },
  runs: [{
    run: { id: "run-1", taskId: "task-1", workerId: "worker-1", policyJson: "opaque" },
    candidate: { runId: "run-1", candidateCommit: "b".repeat(40), source: "git", observedAt: 4 },
    evidence: [{
      runId: "run-1", candidateCommit: "a".repeat(40), source: "test-gate", observedAt: 2,
      measurement: { state: "measured", value: 0 }, trustedTestSource: false,
      invalidatedAt: 4, invalidatedByCommit: "b".repeat(40),
      payload: { kind: "gate-result", schemaVersion: 1, lane: "prepush", gate: "fmt", exitCode: 0 },
    }, {
      measurement: { state: "unavailable", reason: "not observed" }, payload: { malformed: true },
      trustedTestSource: false,
    }],
    reviews: [{ status: "invalidated", reviewerAttestation: "unverified", approvalEligible: false }],
  }],
});

it("preserves the versioned snapshot and opaque untrusted records without promotion", async () => {
  const raw = snapshot();
  vi.mocked(invoke).mockResolvedValue(raw);
  await expect(getDevelopmentRecords("project-1")).resolves.toBe(raw);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("get_development_records", { projectId: "project-1" });
});

it("keeps empty projects distinct from unavailable authority and read errors", async () => {
  const raw = { ...snapshot(), runs: [] };
  vi.mocked(invoke).mockResolvedValue(raw);
  await expect(getDevelopmentRecords("empty")).resolves.toEqual(raw);
  const error = new Error("read failed");
  vi.mocked(invoke).mockRejectedValue(error);
  await expect(getDevelopmentRecords("known")).rejects.toBe(error);
});

it("rejects malformed envelopes and execution or approval invariant violations", async () => {
  for (const raw of [null, undefined, [], {},
    ...["apiVersion", "executionEnabled", "sourceTimestamp", "approvalAuthority", "runs"].map((key) => {
      const value: Record<string, unknown> = snapshot();
      delete value[key];
      return value;
    }),
    { ...snapshot(), apiVersion: 2 }, { ...snapshot(), executionEnabled: true },
    { ...snapshot(), sourceTimestamp: -1 }, { ...snapshot(), sourceTimestamp: NaN },
    { ...snapshot(), sourceTimestamp: 1.5 }, { ...snapshot(), runs: {} },
    { ...snapshot(), approvalAuthority: { state: "available" } },
    { ...snapshot(), approvalAuthority: { state: "unavailable" } },
    { ...snapshot(), approvalAuthority: [] },
  ]) {
    vi.mocked(invoke).mockResolvedValue(raw);
    await expect(getDevelopmentRecords("project-1")).rejects.toThrow("Invalid development records snapshot");
  }
});

it("refuses blank project ids before invoking the native boundary", async () => {
  for (const id of ["", " \t"]) await expect(getDevelopmentRecords(id)).rejects.toThrow("projectId is required");
  expect(invoke).not.toHaveBeenCalled();
});
