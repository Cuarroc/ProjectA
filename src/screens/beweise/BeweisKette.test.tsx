import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BeweisKette } from "./BeweisKette";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const blocker = (code: string, message = `msg ${code}`, nextStep = `next ${code}`) => ({ code, message, nextStep });
const code = { workerHeadSha: "abcdef0123456789", baseTipSha: "9876543210fedcba", mergeTreeOid: "tree" };
const readiness = (extra: Record<string, unknown> = {}) => ({
  lifecycle: "exited", readiness: "blocked", blockers: [], checkedAt: 100, ahead: 3, behind: 2, code, ...extra,
});
const serve = (value: unknown) => mocks.invoke.mockImplementation(async () => value);
const step = (name: string) => screen.getByRole("listitem", { name });
const marks = (root: HTMLElement) => root.querySelectorAll(".g-st").length;

describe("BeweisKette", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("a blocker lands in its step with message and next step", async () => {
    serve(readiness({ blockers: [blocker("tests_stale", "Tests sind veraltet", "Tests neu starten")] }));
    render(<BeweisKette workerId="w1" />);
    const tests = within(await screen.findByRole("listitem", { name: "Tests" }));
    expect(tests.getByText("Tests sind veraltet")).toBeInTheDocument();
    expect(tests.getByText("Tests neu starten")).toBeInTheDocument();
    expect(tests.queryByText("erfüllt")).toBeNull();
    expect(within(step("Prüfung")).getByText("erfüllt")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("get_worker_readiness", { workerId: "w1" });
  });

  it("unknown readiness never shows a fulfilled step", async () => {
    serve(readiness({ readiness: "unknown", checkedAt: 0, code: null }));
    const { container } = render(<BeweisKette workerId="w1" />);
    expect(await screen.findByText("Noch nicht geprüft")).toBeInTheDocument();
    expect(screen.queryByText(/erfüllt/)).toBeNull();
    expect(marks(container)).toBe(0);
  });

  it("an unmapped blocker code is listed verbatim under Weitere Gründe", async () => {
    serve(readiness({ blockers: [blocker("quota_gone", "Kontingent leer", "Später")] }));
    render(<BeweisKette workerId="w1" />);
    const more = within(await screen.findByRole("region", { name: "Weitere Gründe" }));
    expect(more.getByText("quota_gone")).toBeInTheDocument();
    expect(more.getByText("Kontingent leer")).toBeInTheDocument();
  });

  it("ready shows five fulfilled steps and the short head sha", async () => {
    serve(readiness({ readiness: "ready" }));
    render(<BeweisKette workerId="w1" />);
    expect(await screen.findAllByText("erfüllt")).toHaveLength(5);
    expect(screen.queryByRole("region", { name: "Weitere Gründe" })).toBeNull();
    const stand = within(screen.getByRole("region", { name: "Code-Stand" }));
    expect(stand.getByText("abcdef0")).toBeInTheDocument();
    expect(stand.getByText("9876543")).toBeInTheDocument();
    expect(stand.queryByText(code.workerHeadSha)).toBeNull();
  });

  it("missing code tuple is an honest state without a number", async () => {
    serve(readiness({ code: null }));
    render(<BeweisKette workerId="w1" />);
    const stand = within(await screen.findByRole("region", { name: "Code-Stand" }));
    expect(stand.getByText("Code-Stand nicht gemessen")).toBeInTheDocument();
    expect(stand.queryByText("3")).toBeNull();
  });

  it("a failed read shows Beweise nicht lesbar and no step marks", async () => {
    mocks.invoke.mockRejectedValue("kein Kern");
    const { container } = render(<BeweisKette workerId="w1" />);
    expect(await screen.findByText("Beweise nicht lesbar")).toBeInTheDocument();
    expect(marks(container)).toBe(0);
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("gates review uncovered and queue position are not connected and name their package", async () => {
    serve(readiness());
    render(<BeweisKette workerId="w1" />);
    for (const [title, source] of [
      ["Gates je Lane noch nicht verbunden", /V2-B9b.*readiness\/proof\.rs/],
      ["Fremd-Review noch nicht verbunden", /V2-RUN-3/],
      ["NICHT ABGEDECKT noch nicht verbunden", /V2-B9b/],
      ["Queue-Position noch nicht verbunden", /V2-MQ1/],
    ] as const) {
      const region = within(await screen.findByRole("region", { name: title.replace(" noch nicht verbunden", "") }));
      expect(region.getByText(title)).toBeInTheDocument();
      expect(region.getByText(source)).toBeInTheDocument();
    }
  });

  it("Neu prüfen reads again and only get_worker_readiness is ever invoked", async () => {
    serve(readiness({ blockers: [blocker("dirty", "Offene Änderungen")] }));
    render(<BeweisKette workerId="w1" />);
    await screen.findByText("Offene Änderungen");
    serve(readiness({ blockers: [blocker("dirty", "Wieder sauber?")] }));
    fireEvent.click(screen.getByRole("button", { name: "Neu prüfen" }));
    expect(await screen.findByText("Wieder sauber?")).toBeInTheDocument();
    expect(mocks.invoke.mock.calls.map((c) => c[0])).toEqual(["get_worker_readiness", "get_worker_readiness"]);
  });

  it("a late reply for the previous worker id is dropped", async () => {
    const pending: Record<string, (v: unknown) => void> = {};
    let n = 0;
    mocks.invoke.mockImplementation((_cmd: string, args: { workerId: string }) =>
      new Promise((resolve) => { pending[`${args.workerId}#${n++}`] = resolve; }));
    const { rerender } = render(<BeweisKette workerId="w1" />);
    rerender(<BeweisKette workerId="w2" />);
    pending["w2#1"](readiness({ blockers: [blocker("dirty", "von zwei")] }));
    expect(await screen.findByText("von zwei")).toBeInTheDocument();
    await act(async () => pending["w1#0"](readiness({ blockers: [blocker("dirty", "von eins alt")] })));
    expect(screen.queryByText("von eins alt")).toBeNull();
    expect(screen.getByText("von zwei")).toBeInTheDocument();

    // Round trip w1 -> w2 -> w1: the first w1 call is older than the second and must stay dropped.
    rerender(<BeweisKette workerId="w1" />);
    pending["w1#2"](readiness({ blockers: [blocker("dirty", "von eins neu")] }));
    expect(await screen.findByText("von eins neu")).toBeInTheDocument();
    await act(async () => pending["w1#0"](readiness({ blockers: [blocker("dirty", "von eins alt")] })));
    expect(screen.queryByText("von eins alt")).toBeNull();
    expect(screen.getByText("von eins neu")).toBeInTheDocument();
  });
});
