import { expect, it } from "vitest";
import { isWorkerRecord, projectRecords, type Projection } from "./project";
import { T } from "./texts";

it("projects validated passive worker observations with explicit stale and unavailable associations", () => {
  const raw = {
    run: { id: "r1", workerId: "worker-1", status: "completed", policyJson: "CANARY_POLICY" },
    candidate: { runId: "r1", candidateCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", source: "git", observedAt: 4 },
    evidence: [{
      id: "e1", runId: "r1", candidateCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source: "test-gate", observedAt: 2, measurement: { state: "measured", value: 0 },
      invalidatedAt: null, invalidatedByCommit: null, trustedTestSource: true,
      payload: { gate: "CANARY_GATE", exitCode: 0, path: "CANARY_PATH" },
    }],
    reviews: [{
      id: "v1", runId: "r1", evidenceId: "e1", candidateCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source: "CANARY_SOURCE", observedAt: 3, status: "valid", disposition: "approved",
      reviewerAttestation: "verified: CANARY_IDENTITY", approvalEligible: true,
      invalidatedAt: null, invalidatedByCommit: null, detail: "CANARY_DETAIL",
    }],
    unknown: "CANARY_UNKNOWN",
  };
  const view = (patch: object = {}): Projection => projectRecords([{ ...raw, ...patch }], "worker-1");
  expect(projectRecords([], "worker-1")).toEqual({ projectHasRecords: false, runs: [] });
  expect(projectRecords([raw], "worker-2")).toEqual({ projectHasRecords: true, runs: [] });
  expect(isWorkerRecord(raw, "worker-1")).toBe(true);
  for (const worker of ["worker", "worker-10", " worker-1", "WORKER-1", ""]) {
    expect(isWorkerRecord(raw, worker)).toBe(false);
  }
  expect(projectRecords([null, [], {}, { run: { workerId: null } }], "worker-1").runs).toEqual([]);
  expect(view()).toEqual({ projectHasRecords: true, runs: [{
    state: "Beendet", candidate: { commit: "aaaaaaaaaaaa", source: "Git", observedAt: 4 },
    evidence: [{ commit: "aaaaaaaaaaaa", source: "Aufgezeichnete Testquelle", observedAt: 2, association: "current", measurement: 0 }],
    reviews: [{ commit: "aaaaaaaaaaaa", source: "Ungeprüfte Quelle", observedAt: 3,
      association: "current", attestation: "unverified", approval: "unavailable" }],
  }] });
  for (const token of ["CANARY_", "payload", "policyJson", "detail", "disposition", "approved", "approvalEligible", "trustedTestSource", "exitCode", "gate"]) {
    expect(JSON.stringify(view())).not.toContain(token);
  }
  for (const candidate of [null, {}, { ...raw.candidate, runId: "other" },
    { ...raw.candidate, candidateCommit: "CANARY_SHA" }, { ...raw.candidate, candidateCommit: "a" },
    { ...raw.candidate, candidateCommit: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }]) {
    const result = view({ candidate }).runs[0];
    expect(result.candidate).toBeNull();
    expect(result.evidence[0].association).toBe("unassigned");
    expect(result.reviews[0].association).toBe("unassigned");
  }
  const rebound = view({ candidate: { ...raw.candidate, candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } }).runs[0];
  expect(rebound.candidate?.commit).toBe("bbbbbbbbbbbb");
  expect(rebound.evidence[0]).toMatchObject({ association: "stale", measurement: 0 });
  expect(rebound.reviews[0]).toMatchObject({ association: "stale", approval: "unavailable" });
  for (const invalidation of [{ invalidatedAt: 0 }, { invalidatedByCommit: "CANARY_INVALIDATION" }]) {
    const result = view({ evidence: [{ ...raw.evidence[0], ...invalidation }] }).runs[0];
    expect(result.evidence[0].association).toBe("stale");
    expect(result.reviews[0].association).toBe("stale");
    expect(JSON.stringify(result)).not.toContain("CANARY_");
  }
  for (const patch of [{ status: "invalidated" }, { invalidatedAt: 5 }, { invalidatedByCommit: "CANARY_INVALIDATION" }]) {
    expect(view({ reviews: [{ ...raw.reviews[0], ...patch }] }).runs[0].reviews[0].association).toBe("stale");
  }
  for (const patch of [{ runId: "other" }, { candidateCommit: "CANARY_SHA" }, { candidateCommit: null }]) {
    const result = view({ evidence: [{ ...raw.evidence[0], ...patch }] }).runs[0];
    expect(result.evidence[0].association).toBe("unassigned");
    expect(result.reviews[0].association).toBe("unassigned");
  }
  for (const patch of [{ runId: "other" }, { evidenceId: "missing" }, { evidenceId: null },
    { candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, { status: "CANARY_STATUS" }]) {
    expect(view({ reviews: [{ ...raw.reviews[0], ...patch }] }).runs[0].reviews[0].association).toBe("unassigned");
  }
  for (const evidence of [[], [raw.evidence[0], raw.evidence[0]]]) {
    expect(view({ evidence }).runs[0].reviews[0].association).toBe("unassigned");
  }
  for (const value of [NaN, Infinity, -Infinity, "CANARY_VALUE", { path: "CANARY_PATH" }, null, true]) {
    expect(view({ evidence: [{ ...raw.evidence[0], measurement: { state: "measured", value } }] }).runs[0].evidence[0].measurement).toBeNull();
  }
  expect(view({ evidence: [{ ...raw.evidence[0], measurement: { state: "unavailable", value: 0, reason: "CANARY_REASON" } }] }).runs[0].evidence[0].measurement).toBeNull();
  expect(view({ evidence: [{ ...raw.evidence[0], measurement: { state: "measured", value: -2.5 } }] }).runs[0].evidence[0].measurement).toBe(-2.5);
  for (const observedAt of [-1, NaN, Infinity, 1.5, "CANARY_TIME", 8640000000001]) {
    const result = view({ candidate: { ...raw.candidate, observedAt }, evidence: [{ ...raw.evidence[0], observedAt }], reviews: [{ ...raw.reviews[0], observedAt }] }).runs[0];
    expect([result.candidate?.observedAt, result.evidence[0].observedAt, result.reviews[0].observedAt]).toEqual([null, null, null]);
  }
  expect(view({ candidate: { ...raw.candidate, candidateCommit: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" } }).runs[0].candidate).toBeNull();
  expect(view({ candidate: { ...raw.candidate, candidateCommit: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" } }).runs[0].candidate?.commit).toBe("0123456789ab");
  expect(view({ run: { ...raw.run, id: "", status: "CANARY_STATUS" } }).runs[0]).toMatchObject({ state: "Nicht verfügbar", candidate: null });
  expect(view({ candidate: { ...raw.candidate, source: "CANARY_SOURCE" }, reviews: [{ ...raw.reviews[0], reviewerAttestation: "unavailable" }] }).runs[0]).toMatchObject({
    candidate: { source: "Ungeprüfte Quelle" }, reviews: [{ attestation: "unavailable", approval: "unavailable" }],
  });
  expect(view({ evidence: [null], reviews: [null] }).runs[0]).toMatchObject({
    evidence: [{ commit: null, source: "Ungeprüfte Quelle", observedAt: null, association: "unassigned", measurement: null }],
    reviews: [{ association: "unassigned", attestation: "unverified", approval: "unavailable" }],
  });
  expect([T.region, T.loading, T.readError, T.emptyProject, T.noWorker, T.reload]).toEqual([
    "Aufgezeichnete Beobachtungen", "Beobachtungen werden geladen …", "Beobachtungen konnten nicht gelesen werden",
    "Keine aufgezeichneten Beobachtungen in diesem Projekt", "Keine aufgezeichneten Beobachtungen für diesen Worker", "Beobachtungen neu laden",
  ]);
  expect([T.unavailable, T.unverified, T.approvalUnavailable, T.associations.stale, T.associations.unassigned]).toEqual([
    "Nicht verfügbar", "Ungeprüft", "Freigabe nicht verfügbar", "Veraltet", "Nicht zugeordnet",
  ]);
});
