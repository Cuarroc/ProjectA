import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import ShellMount from "./ShellMount";
import { writeActiveProjectId } from "../../lib/activeProject";

const board = { cards: [
  { worker: { id: "w1", projectId: "p1", task: "Inspect sample", status: "exited" }, column: "ready", prUrl: "https://github.com/example/sample/pull/7", testStatus: "pass" },
  { worker: { id: "w2", projectId: "p1", task: "Without PR", status: "exited" }, column: "working", prUrl: null },
], coordinators: [] };
const ready = { lifecycle: "exited", readiness: "ready", blockers: [], checkedAt: 100, ahead: 0, behind: 0, code: null };
const go = (hash: string) => act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });
const mount = () => render(<ShellMount>{() => <input aria-label="Mounted session" defaultValue="draft" />}</ShellMount>);
const choose = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Worker auswählen" }), { target: { value: id } });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("projecta.settings.featureFlag.weitere_bereiche", "0");
  writeActiveProjectId("p1");
  window.location.hash = "#/beweise";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_board_state") return board;
    if (command === "get_worker_readiness") return ready;
    if (command === "get_emergency_stop") return false;
    if (command === "get_panic_notice") return { current: null, previous: null };
    return [];
  });
});
afterEach(cleanup);

it("shows Beweise by default and never invents gate or review evidence", async () => {
  const { container } = mount();
  expect(within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getByRole("link", { name: "Beweise" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Beweise" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Seiten und Befehle suchen" }));
  fireEvent.click(screen.getByRole("option", { name: "Beweise · Haupt" }));
  await screen.findByRole("option", { name: "Inspect sample" });
  choose("w1");
  expect(await screen.findByRole("link", { name: "Pull Request öffnen" })).toHaveAttribute("href", "https://github.com/example/sample/pull/7");
  await screen.findByText("Bereitschaftscheck bestanden");
  for (const name of ["Gates", "Reviews"]) {
    const evidence = screen.getByRole("region", { name });
    expect(within(evidence).getByText("Der Kern liefert gerade keinen Wert")).toBeVisible();
    expect(evidence.querySelector(".g-st--ok, .g-proof")).toBeNull();
    expect(within(evidence).queryByText(/erfüllt|bestanden/)).toBeNull();
  }
  expect(screen.queryByText(/0\s*\/\s*0|0 Gates|0 Reviews/)).toBeNull();
  expect(screen.getByText("Dieser Check ersetzt keine Gates, kein Fremd-Review und keine Prüfung der Queue.")).toBeVisible();
  expect(mocks.invoke).toHaveBeenCalledWith("get_board_state", { projectId: "p1" });
  expect(container.querySelector(".g-mount")).toHaveAttribute("data-fresh", "on");
});

it("distinguishes no project from failed loading and empty board states", async () => {
  writeActiveProjectId(null);
  mount();
  expect(await screen.findByText("Kein Projekt gewählt")).toBeVisible();
  expect(screen.getByRole("link", { name: "Zur Projekteinrichtung" })).toHaveAttribute("href", "#/start");
  expect(mocks.invoke.mock.calls.some(([command]) => command === "get_board_state")).toBe(false);
  mocks.invoke.mockRejectedValueOnce(new Error("offline"));
  await act(async () => writeActiveProjectId("p1"));
  expect(await screen.findByText("Worker konnten nicht geladen werden")).toBeVisible();
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Worker neu laden" }));
  expect(screen.getByText("Worker werden geladen …")).toBeVisible();
  await act(async () => finish({ cards: [], coordinators: [] }));
  expect(screen.getByText("Keine Worker in diesem Projekt")).toBeVisible();
});

it("clears worker selection and rejects late readiness and project round-trip responses", async () => {
  const pending: Array<(value: unknown) => void> = [];
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string) => command === "get_worker_readiness"
    ? new Promise((resolve) => pending.push(resolve)) : fallback(command));
  mount();
  await screen.findByRole("option", { name: "Inspect sample" });
  choose("w1");
  choose("w2");
  expect(screen.queryByRole("link", { name: "Pull Request öffnen" })).toBeNull();
  expect(screen.getByText("PR fehlt")).toBeVisible();
  await act(async () => pending[0]({ ...ready, blockers: [{ code: "dirty", message: "Old worker", nextStep: "Wait" }] }));
  expect(screen.queryByText("Old worker")).toBeNull();
  await act(async () => pending[1](ready));
  await screen.findByText("Bereitschaftscheck bestanden");
  choose("w1");
  const boards: Array<(value: unknown) => void> = [];
  mocks.invoke.mockImplementation((command: string) => command === "get_board_state"
    ? new Promise((resolve) => boards.push(resolve)) : fallback(command));
  await act(async () => writeActiveProjectId("p2"));
  expect(screen.queryByRole("heading", { name: "Beweiskette" })).toBeNull();
  await act(async () => writeActiveProjectId("p1"));
  await act(async () => writeActiveProjectId("p2"));
  await act(async () => {
    boards[0](board);
    boards[1](board);
    pending[2]({ ...ready, blockers: [{ code: "dirty", message: "Old project", nextStep: "Wait" }] });
  });
  expect(screen.queryByRole("option", { name: "Inspect sample" })).toBeNull();
  expect(screen.queryByText("Old project")).toBeNull();
  await act(async () => boards[2]({ cards: [{ ...board.cards[1], worker: { ...board.cards[1].worker, projectId: "p2" } }], coordinators: [] }));
  expect(screen.getByRole("combobox", { name: "Worker auswählen" })).toHaveValue("");
  choose("w2");
  await screen.findByText("Bereitschaftscheck bestanden");
  fireEvent.click(screen.getByRole("button", { name: "Neu prüfen" }));
  await screen.findByText("Bereitschaftscheck bestanden");
  expect(mocks.invoke).toHaveBeenLastCalledWith("get_worker_readiness", { workerId: "w2" });
});

it("preserves the legacy session and diff fallback and hidden-settings recovery", async () => {
  const { container } = mount();
  const session = screen.getByDisplayValue("draft");
  fireEvent.change(session, { target: { value: "kept" } });
  for (const path of ["#/beweise/diff", "#/beweise/unknown"]) {
    await go(path);
    expect(container.querySelector(".g-mount")).toHaveAttribute("data-fresh", "off");
    expect(container.querySelector(".g-mount-legacy")).not.toHaveAttribute("hidden");
    expect(screen.queryByRole("combobox", { name: "Worker auswählen" })).toBeNull();
    expect(screen.getByDisplayValue("kept")).toBe(session);
  }
  await go("#/steuerung/autonomie");
  expect(window.location.hash).toBe("#/steuerung/autonomie");
  expect(screen.getByText("Dieser Bereich ist noch nicht verbunden und ausgeblendet.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Weitere Bereiche in den Einstellungen einschalten" })).toHaveAttribute("href", "#/einstellungen");
  await go("#/beweise");
  expect(screen.getByDisplayValue("kept")).toBe(session);
  expect(mocks.invoke.mock.calls.every(([command]) => ["get_board_state", "get_worker_readiness", "list_projects", "get_emergency_stop", "get_panic_notice", "get_provider_overview", "get_quota_state"].includes(command))).toBe(true);
});
