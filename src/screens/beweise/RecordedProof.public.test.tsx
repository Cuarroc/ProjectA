import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: boundary.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
import BeweiseRoute from "./BeweiseRoute";
import { writeActiveProjectId } from "../../lib/activeProject";

const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const candidate = { runId: "r1", candidateCommit: sha, source: "git", observedAt: 0 };
const evidence = { id: "e1", runId: "r1", candidateCommit: sha, source: "test-gate", observedAt: 2,
  measurement: { state: "measured", value: 0 }, payload: { gate: "CANARY_GATE", path: "CANARY_PATH", exitCode: 0 } };
const review = { runId: "r1", evidenceId: "e1", candidateCommit: sha, source: "CANARY_SOURCE", observedAt: 3,
  status: "valid", disposition: "approved", reviewerAttestation: "verified: CANARY_IDENTITY", approvalEligible: true, detail: "CANARY_DETAIL" };
const record = (patch: object = {}) => ({ run: { id: "r1", workerId: "w1", status: "completed", policyJson: "CANARY_POLICY" },
  candidate, evidence: [evidence], reviews: [review], unknown: "CANARY_UNKNOWN", ...patch });
const envelope = (runs: unknown[]) => ({ apiVersion: 1, executionEnabled: false, sourceTimestamp: 4, runs,
  approvalAuthority: { state: "unavailable", reviewerPrincipal: "launch-route-receipt", detail: "CANARY_AUTHORITY" } });
const reads: { projectId: string; resolve: (value: unknown) => void; reject: (reason: unknown) => void }[] = [];
const region = () => screen.getByRole("region", { name: "Aufgezeichnete Beobachtungen" });
const choose = (id = "w1") => act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "Worker auswählen" }), { target: { value: id } }); });
const select = async (id = "w1") => { await screen.findByRole("option", { name: "Worker one" }); await choose(id); };
const reload = () => fireEvent.click(within(region()).getByRole("button", { name: "Beobachtungen neu laden" }));
const finish = async (runs: unknown[], index = reads.length - 1) => act(async () => reads[index].resolve(envelope(runs)));
const items = (name: string) => within(within(region()).getByRole("region", { name })).getAllByRole("listitem");
const loading = () => {
  expect(within(region()).getByText("Beobachtungen werden geladen …")).toBeVisible();
  expect(within(region()).queryByText("aaaaaaaaaaaa")).toBeNull();
  expect(within(region()).queryByText("Beendet")).toBeNull();
};
beforeEach(() => {
  localStorage.clear(); writeActiveProjectId("p1"); reads.length = 0;
  boundary.invoke.mockReset();
  boundary.invoke.mockImplementation((command: string, args: { projectId: string }) => {
    if (command === "get_development_records") return new Promise((resolve, reject) => reads.push({ projectId: args.projectId, resolve, reject }))
      .then((value) => JSON.parse(JSON.stringify(value)));
    if (command === "get_board_state") return Promise.resolve({ coordinators: [], cards: ["w1", "w2"].map((id) => ({
      worker: { id, projectId: args.projectId, task: id === "w1" ? "Worker one" : "Worker two", status: "exited" },
      column: "ready", prUrl: "https://github.com/example/sample/pull/7",
    })) });
    if (command === "get_worker_readiness") return Promise.resolve({ lifecycle: "exited", readiness: "ready", blockers: [],
      checkedAt: 100, ahead: 0, behind: 0, code: { workerHeadSha: "123456789abcdef", baseTipSha: "987654321abcdef", mergeTreeOid: "tree" } });
    throw new Error(`Unexpected boundary command: ${command}`);
  });
});
afterEach(cleanup);

it("renders only safe recorded worker observations with literal measurements and checked associations", async () => {
  render(<BeweiseRoute />);
  await screen.findByRole("option", { name: "Worker one" });
  expect(reads).toHaveLength(0);
  expect(screen.queryByRole("region", { name: "Aufgezeichnete Beobachtungen" })).toBeNull();
  await choose(); loading();
  await finish([record(), ...["w2", "w10", " w1", "W1"].map((workerId) => record({
    run: { id: "other", workerId, status: "failed" }, candidate: { ...candidate, runId: "other", candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" },
  }))]);
  expect(reads.map((r) => r.projectId)).toEqual(["p1"]);
  expect(boundary.invoke).toHaveBeenCalledWith("get_development_records", { projectId: "p1" });
  expect(within(region()).getByText("Beendet")).toBeVisible();
  expect(within(region()).getAllByText("aaaaaaaaaaaa")).toHaveLength(3);
  expect(within(region()).getByText("1970-01-01T00:00:00.000Z")).toBeVisible();
  expect(items("Belege")[0]).toHaveTextContent("Messwert0");
  expect(items("Belege")[0]).toHaveTextContent("Dem Kandidaten zugeordnet");
  expect(items("Reviews")[0]).toHaveTextContent("Dem Kandidaten zugeordnet");
  expect(items("Reviews")[0]).toHaveTextContent("Ungeprüft");
  expect(items("Reviews")[0]).toHaveTextContent("Freigabe nicht verfügbar");
  expect(items("Reviews")[0]).toHaveTextContent("Ungeprüfte Quelle");
  expect(region().textContent).not.toMatch(/CANARY_|cccccccccccc|approved|verified|payload|policy|exitCode|bestanden|erfüllt|Fehler erfasst/);
  expect(region().querySelector(".g-st--ok, .g-proof")).toBeNull();
  expect(screen.getByRole("link", { name: "Pull Request öffnen" })).toHaveAttribute("href", "https://github.com/example/sample/pull/7");
  expect(await screen.findByText("Bereitschaftscheck bestanden")).toBeVisible();
  expect(screen.getByText("1234567")).toBeVisible();
  for (const name of ["Gates", "Reviews"]) expect(within(screen.getAllByRole("region", { name })[0]).getByText("Der Kern liefert gerade keinen Wert")).toBeVisible();
  const cases: [object, string, string, string][] = [
    [{ candidate: { ...candidate, candidateCommit: "aaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbb" } }, "Veraltet", "Veraltet", "0"],
    [{ evidence: [{ ...evidence, invalidatedAt: 0, measurement: { state: "measured", value: -2.5 } }] }, "Veraltet", "Veraltet", "-2.5"],
    [{ candidate: null }, "Nicht zugeordnet", "Nicht zugeordnet", "0"],
    [{ candidate: { ...candidate, candidateCommit: "CANARY_SHA" } }, "Nicht zugeordnet", "Nicht zugeordnet", "0"],
    [{ candidate: { ...candidate, runId: "other" } }, "Nicht zugeordnet", "Nicht zugeordnet", "0"],
    [{ evidence: [{ ...evidence, runId: "other", observedAt: -1, measurement: { state: "unavailable", value: 0 } }] }, "Nicht zugeordnet", "Nicht zugeordnet", "Nicht verfügbar"],
    [{ evidence: [{ ...evidence, measurement: { state: "measured", value: "CANARY_NUMBER" } }] }, "Dem Kandidaten zugeordnet", "Dem Kandidaten zugeordnet", "Nicht verfügbar"],
    [{ reviews: [{ ...review, evidenceId: "missing" }] }, "Dem Kandidaten zugeordnet", "Nicht zugeordnet", "0"],
    [{ evidence: [evidence, evidence] }, "Dem Kandidaten zugeordnet", "Nicht zugeordnet", "0"],
    [{ reviews: [{ ...review, invalidatedAt: 0, reviewerAttestation: "unavailable" }] }, "Dem Kandidaten zugeordnet", "Veraltet", "0"],
  ];
  for (const [patch, evidenceLink, reviewLink, measurement] of cases) {
    reload(); loading(); await finish([record(patch)]);
    expect(items("Belege")[0]).toHaveTextContent(evidenceLink);
    expect(items("Belege")[0]).toHaveTextContent(`Messwert${measurement}`);
    expect(items("Reviews")[0]).toHaveTextContent(reviewLink);
    expect(items("Reviews")[0]).toHaveTextContent("Freigabe nicht verfügbar");
    expect(region().textContent).not.toMatch(/CANARY_|approved|verified|bestanden|erfüllt/);
  }
});

it("keeps loading empty project absent worker and failed replacement reads visibly distinct", async () => {
  render(<BeweiseRoute />); await select(); loading();
  await finish([]);
  expect(within(region()).getByText("Keine aufgezeichneten Beobachtungen in diesem Projekt")).toBeVisible();
  reload(); loading(); await finish([record({ run: { id: "r2", workerId: "w2" } })]);
  expect(within(region()).getByText("Keine aufgezeichneten Beobachtungen für diesen Worker")).toBeVisible();
  reload(); loading(); await finish([record()]);
  for (const failure of [null, { ...envelope([]), executionEnabled: true }, new Error("CANARY_NATIVE_MALFORMED_SNAPSHOT")]) {
    reload(); loading();
    await act(async () => {
      if (failure instanceof Error) reads.at(-1)!.reject(failure);
      else reads.at(-1)!.resolve(failure);
    });
    expect(within(region()).getByText("Beobachtungen konnten nicht gelesen werden")).toBeVisible();
    expect(region().textContent).not.toMatch(/CANARY_|aaaaaaaaaaaa|Beendet|Messwert|Keine aufgezeichneten/);
  }
  reload(); loading(); await finish([record({ run: { id: "r1", workerId: "w1", status: "CANARY_STATUS" },
    candidate: { ...candidate, source: "CANARY_SOURCE", observedAt: "CANARY_TIME" }, evidence: [], reviews: [] })]);
  expect(within(region()).getAllByText("Nicht verfügbar").length).toBeGreaterThan(0);
  expect(within(region()).getByText("Ungeprüfte Quelle")).toBeVisible();
  expect(region().textContent).not.toMatch(/CANARY_|Dem Kandidaten zugeordnet/);
});

it("clears successful observations and ignores delayed reload worker project and reentry responses", async () => {
  const mounted = render(<BeweiseRoute />); await select(); loading(); await finish([record()]);
  reload(); loading(); const oldReload = reads.length - 1;
  reload(); loading(); const newReload = reads.length - 1;
  await finish([record()], oldReload); loading();
  await finish([], newReload);
  expect(within(region()).getByText("Keine aufgezeichneten Beobachtungen in diesem Projekt")).toBeVisible();
  reload(); await finish([record()]);
  await choose("w2"); loading(); const oldWorker = reads.length - 1;
  await choose("w1"); loading();
  await finish([record({ run: { id: "r1", workerId: "w2", status: "failed" } })], oldWorker); loading();
  await finish([record()]);
  reload(); const oldProject = reads.length - 1;
  await act(async () => writeActiveProjectId("p2"));
  expect(screen.queryByRole("region", { name: "Aufgezeichnete Beobachtungen" })).toBeNull();
  await select(); loading(); const firstP2 = reads.length - 1;
  await act(async () => writeActiveProjectId("p1"));
  await select(); loading(); const returnedP1 = reads.length - 1;
  await finish([record()], oldProject); await finish([record()], firstP2); loading();
  expect(reads[returnedP1].projectId).toBe("p1");
  await finish([record()], returnedP1);
  await act(async () => writeActiveProjectId("p2"));
  await select(); loading(); expect(reads.at(-1)!.projectId).toBe("p2");
  await act(async () => reads.at(-1)!.reject(new Error("CANARY_P2_READ")));
  expect(within(region()).getByText("Beobachtungen konnten nicht gelesen werden")).toBeVisible();
  expect(region().textContent).not.toMatch(/aaaaaaaaaaaa|CANARY_|Beendet/);
  reload(); const abandoned = reads.length - 1; mounted.unmount();
  render(<BeweiseRoute />); await select(); loading();
  await finish([record()], abandoned); loading(); await finish([]);
  expect(within(region()).getByText("Keine aufgezeichneten Beobachtungen in diesem Projekt")).toBeVisible();
  expect(boundary.invoke.mock.calls.filter(([cmd]) => cmd === "get_development_records")).toHaveLength(reads.length);
});
