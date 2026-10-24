import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import App from "../../App";
import { writeActiveProjectId } from "../../lib/activeProject";
import ShellMount from "./ShellMount";

const worker = (id: string, projectId = "p1", live = false) => ({
  id, projectId, kind: "orchestrator", status: live ? "running" : "done",
  sessionId: live ? `session-${id}` : null, createdAt: 1,
});
const mount = () => render(<ShellMount>{() => <div>Legacy fixture</div>}</ShellMount>);
const history = () => within(screen.getByRole("log", { name: "Nachrichten mit dem Orchestrator" }));

beforeAll(async () => { await import("./ShellMount"); });
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
  window.location.hash = "#/leitstand/verlauf";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string, args?: { workerId?: string }) => {
    if (["list_projects", "list_agent_profiles", "list_workers", "list_questions", "get_provider_overview", "get_reason_catalog"].includes(command)) return [];
    if (command === "get_board_state") return { cards: [], coordinators: [] };
    if (command === "get_panic_notice") return { current: null, previous: null };
    if (command === "list_worker_messages") return [{ id: "message", workerId: args?.workerId, role: "agent", content: `History ${args?.workerId}`, createdAt: 1 }];
    return new Promise(() => {});
  });
});
afterEach(cleanup);

it("mounts the VerlaufChat composer instead of the legacy panel with D1 on", async () => {
  const { container } = render(<App />);
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(await screen.findByRole("textbox", { name: "Nachricht an den Orchestrator" })).toBeDisabled();
  expect(history().getByText("Kein Projekt aktiv")).toBeInTheDocument();
  expect(container.querySelector(".g-shell-content .vc")).not.toBeNull();
  expect(container.querySelector(".g-mount")).toHaveAttribute("data-legacy", "off");
  expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
});

it("loads the live project orchestrator and sends through the existing chat API", async () => {
  writeActiveProjectId("p1");
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "list_workers") return Promise.resolve([worker("live", "p1", true), worker("latest"), worker("foreign", "p2", true)]);
    if (command === "send_to_orchestrator") return Promise.resolve(worker("live", "p1", true));
    return fallback(command, args);
  });
  mount();
  expect(await screen.findByText("History live")).toBeInTheDocument();
  const input = screen.getByRole("textbox", { name: "Nachricht an den Orchestrator" });
  fireEvent.change(input, { target: { value: " Inspect this project " } });
  fireEvent.click(screen.getByRole("button", { name: "Senden" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("send_to_orchestrator", { projectId: "p1", text: "Inspect this project" }));
  await waitFor(() => expect(input).toHaveValue(""));
});

it("uses the latest project orchestrator when none is live", async () => {
  writeActiveProjectId("p1");
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "list_workers"
    ? Promise.resolve([worker("older"), worker("latest"), worker("foreign", "p2")]) : fallback(command, args));
  mount();
  expect(await screen.findByText("History latest")).toBeInTheDocument();
});

it("binds the first send to the newly created orchestrator without leaving Verlauf", async () => {
  writeActiveProjectId("p1");
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "send_to_orchestrator") return Promise.resolve(worker("created", "p1", true));
    return fallback(command, args);
  });
  mount();
  expect(await screen.findByText("Noch keine Nachrichten")).toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalledWith("list_worker_messages", expect.anything());
  const input = screen.getByRole("textbox", { name: "Nachricht an den Orchestrator" });
  fireEvent.change(input, { target: { value: "Start this conversation" } });
  fireEvent.click(screen.getByRole("button", { name: "Senden" }));
  expect(await screen.findByText("History created")).toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledWith("list_worker_messages", { workerId: "created", limit: 200 });
  expect(input).toHaveValue("");
});

it("ignores a late orchestrator lookup after switching projects", async () => {
  writeActiveProjectId("p1");
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args?: { projectId?: string }) => {
    if (command === "list_workers") return args?.projectId === "p1" ? pending : Promise.resolve([worker("second", "p2")]);
    return fallback(command, args);
  });
  mount();
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_workers", { projectId: "p1" }));
  act(() => writeActiveProjectId("p2"));
  expect(await screen.findByText("History second")).toBeInTheDocument();
  await act(async () => finish([worker("first")]));
  expect(history().getByText("History second")).toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalledWith("list_worker_messages", { workerId: "first", limit: 200 });
  act(() => writeActiveProjectId(null));
  expect(await screen.findByRole("textbox", { name: "Nachricht an den Orchestrator" })).toBeDisabled();
  expect(history().queryByText("History second")).toBeNull();
});

it("reports a failed orchestrator lookup and retries before claiming an empty history", async () => {
  writeActiveProjectId("p1");
  let failed = true;
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "list_workers") return failed ? Promise.reject(new Error("offline")) : Promise.resolve([]);
    return fallback(command, args);
  });
  mount();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("Noch keine Nachrichten")).toBeNull();
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "Erneut lesen" }));
  expect(await screen.findByText("Noch keine Nachrichten")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Nachricht an den Orchestrator" })).toBeEnabled();
});


it("retains project drafts across routes and settles only the submitted revision", async () => {
  const first = "draft-first", second = "draft-second";
  let finishSend!: (value: unknown) => void;
  let rejectSend!: (error: Error) => void;
  let finishRead!: (value: unknown) => void;
  let holdRead = false;
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args?: { projectId?: string; workerId?: string }) => {
    if (command === "list_workers") return Promise.resolve([worker(`own-${args?.projectId}`, args?.projectId), worker("foreign", "foreign")]);
    if (command === "list_worker_messages" && holdRead) return new Promise((resolve) => { finishRead = resolve; });
    if (command === "send_to_orchestrator") return new Promise((resolve, reject) => { finishSend = resolve; rejectSend = reject; });
    return fallback(command, args);
  });
  const box = () => screen.getByRole("textbox", { name: "Nachricht an den Orchestrator" });
  const type = (value: string) => fireEvent.change(box(), { target: { value } });
  const navigate = async (path: string) => {
    await act(async () => {
      window.location.hash = `#${path}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  };
  const switchProject = async (id: string) => {
    act(() => writeActiveProjectId(id));
    await screen.findByText(`History own-${id}`);
  };
  const sendCount = () => mocks.invoke.mock.calls.filter(([command]) => command === "send_to_orchestrator").length;
  writeActiveProjectId(first);
  mount();
  await screen.findByText("History own-draft-first");
  type("First unsent draft");
  await navigate("/core");
  expect(screen.queryByRole("textbox", { name: "Nachricht an den Orchestrator" })).toBeNull();
  holdRead = true;
  await navigate("/leitstand/verlauf");
  await waitFor(() => expect(box()).toHaveValue("First unsent draft"));
  expect(history().getByText("Verlauf wird geladen …")).toBeInTheDocument();
  expect(screen.queryByText("Noch keine Nachrichten")).toBeNull();
  expect(screen.queryByText("History own-draft-first")).toBeNull();
  holdRead = false;
  await act(async () => finishRead([{ id: "fresh", workerId: "own-draft-first", role: "agent", content: "Fresh backend history", createdAt: 1 }]));
  expect(history().getByText("Fresh backend history")).toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledWith("list_worker_messages", { workerId: "own-draft-first", limit: 200 });
  await switchProject(second);
  expect(box()).toHaveValue("");
  expect(screen.queryByText("Fresh backend history")).toBeNull();
  type("Second unsent draft");
  await switchProject(first);
  expect(box()).toHaveValue("First unsent draft");
  expect(sendCount()).toBe(0);
  fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
  expect(sendCount()).toBe(0);
  fireEvent.keyDown(box(), { key: "Enter" });
  expect(mocks.invoke).toHaveBeenCalledWith("send_to_orchestrator", { projectId: first, text: "First unsent draft" });
  await switchProject(second);
  expect(box()).toHaveValue("Second unsent draft");
  await switchProject(first);
  expect(screen.getByRole("button", { name: "Sendet …" })).toBeDisabled();
  type("Newer first draft");
  type("First unsent draft"); // Same text, different revision: an old acknowledgement cannot erase it.
  fireEvent.keyDown(box(), { key: "Enter" });
  expect(sendCount()).toBe(1);
  await act(async () => finishSend(worker("own-draft-first", first)));
  expect(box()).toHaveValue("First unsent draft");
  fireEvent.click(screen.getByRole("button", { name: "Senden" }));
  await navigate("/core");
  await act(async () => rejectSend(new Error("ERR_REFUSED: Versand verweigert")));
  await navigate("/leitstand/verlauf");
  await screen.findByText("History own-draft-first");
  expect(box()).toHaveValue("First unsent draft");
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Erneut lesen" }));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Senden" }));
  await switchProject(second);
  await act(async () => finishSend(worker("own-draft-first", first)));
  expect(box()).toHaveValue("Second unsent draft");
  await switchProject(first);
  expect(box()).toHaveValue("");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(sendCount()).toBe(3);
  expect(mocks.invoke.mock.calls.filter(([command]) => /^(create_worker|start_worker|spawn_worker)$/.test(command))).toHaveLength(0);
});


it("does not claim empty history before the first backend read", async () => {
  writeActiveProjectId("loading-project");
  let claimedEmpty: boolean | undefined;
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "list_workers") return Promise.resolve([worker("existing", "loading-project")]);
    if (command === "list_worker_messages") claimedEmpty = screen.queryByText("Noch keine Nachrichten") !== null;
    return fallback(command, args);
  });
  mount();
  await screen.findByText("History existing");
  expect(claimedEmpty).toBe(false);
});

it("loads the accepted first conversation after returning during its send", async () => {
  const projectId = "pending-first-project";
  writeActiveProjectId(projectId);
  let finish!: (value: unknown) => void;
  let accepted = false;
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "list_workers") return Promise.resolve(accepted ? [worker("accepted-first", projectId)] : []);
    if (command === "send_to_orchestrator") return new Promise((resolve) => { finish = resolve; });
    return fallback(command, args);
  });
  mount();
  const input = await screen.findByRole("textbox", { name: "Nachricht an den Orchestrator" });
  fireEvent.change(input, { target: { value: "First request" } });
  fireEvent.keyDown(input, { key: "Enter" });
  for (const path of ["/core", "/leitstand/verlauf"]) {
    await act(async () => {
      window.location.hash = `#${path}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  }
  expect(await screen.findByRole("button", { name: "Sendet …" })).toBeDisabled();
  accepted = true;
  await act(async () => finish(worker("accepted-first", projectId)));
  expect(await screen.findByText("History accepted-first")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Nachricht an den Orchestrator" })).toHaveValue("");
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "send_to_orchestrator")).toHaveLength(1);
});
