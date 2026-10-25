import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeActiveProjectId } from "../../../lib/activeProject";
import LeitstandRoute from "../LeitstandRoute";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
const row = { id: "q1", projectId: "p1", workerId: "w1", scope: "worker", question: "Choose a path?", optionsJson: "[]", status: "open", answer: null, createdAt: 1 };
const worker = { id: "w1", projectId: "p1", branch: "correct/branch", task: "Correct task", profileId: "test", status: "running", createdAt: 1 };
const pane = () => within(screen.getByRole("complementary", { name: "Braucht dich" }));
const input = () => pane().getByRole("textbox", { name: "Antwort" });
const scope = (name: string) => fireEvent.click(pane().getByRole("button", { name }));
const switchProject = (id: string | null) => act(async () => { writeActiveProjectId(id); });
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
let read: (id?: string) => unknown;
let answer: () => unknown;
beforeEach(() => {
  localStorage.clear();
  writeActiveProjectId("p1");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  read = () => [row];
  answer = () => null;
  mocks.invoke.mockReset().mockImplementation(async (cmd: string, args: { projectId?: string }) => {
    if (cmd === "list_questions") return read(args.projectId);
    if (cmd === "answer_question") return answer();
    if (cmd === "list_agent_profiles") return [];
    if (cmd === "get_board_state") return { cards: [{ worker, column: "working" }], coordinators: [] };
    throw new Error(`Unexpected command: ${cmd}`);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("reads real scopes and labels fleet projects and workers without borrowing active context", async () => {
  const foreign = { ...row, id: "q2", projectId: "p2", question: "Darf ich löschen?" };
  const preflight = { ...row, id: "q3", projectId: "", workerId: null, scope: "preflight", question: "Before starting?" };
  read = (id) => id ? [row] : [row, foreign, preflight];
  render(<LeitstandRoute />);
  await pane().findByText("1 offen");
  expect(mocks.invoke).toHaveBeenCalledWith("list_questions", { projectId: "p1", status: undefined });
  expect(pane().getByText("correct/branch")).toBeInTheDocument();
  scope("Alle Projekte");
  await pane().findByText("3 offen");
  expect(mocks.invoke).toHaveBeenCalledWith("list_questions", { projectId: undefined, status: undefined });
  expect(pane().getByRole("button", { name: "Alle Projekte" })).toHaveAttribute("aria-pressed", "true");
  const lane = within(pane().getByRole("region", { name: "Löschen" }));
  expect(lane.getByText("Projekt: p2")).toBeInTheDocument();
  expect(lane.getByText("Agent: w1")).toBeInTheDocument();
  expect(lane.queryByText(/correct\/branch|Correct task|Kein Agent/)).toBeNull();
  expect(pane().getByText("Projekt: p1")).toBeInTheDocument();
  expect(pane().getByText("Projekt: Unbekannt")).toBeInTheDocument();
  expect(pane().getByText("Vorabfrage, noch kein Agent")).toBeInTheDocument();
  fireEvent.change(pane().getAllByRole("textbox")[0], { target: { value: "Fleet draft" } });
  scope("Nur dieses Projekt");
  await pane().findByText("1 offen");
  expect(input()).toHaveValue("");
  expect(pane().queryByText(foreign.question)).toBeNull();
});

it("keeps fleet reachable without a project and never calls unread or offline lists empty", async () => {
  await switchProject(null);
  const pending = deferred();
  read = () => pending.promise;
  render(<LeitstandRoute />);
  expect(screen.getByRole("button", { name: "Projekt anlegen" })).toBeInTheDocument();
  expect(pane().queryByText("Nichts offen")).toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalledWith("list_questions", expect.anything());
  scope("Alle Projekte");
  expect(pane().getByText("Fragen werden gelesen …")).toBeInTheDocument();
  expect(pane().queryByText(/\d+ offen|Nichts offen/)).toBeNull();
  await act(async () => pending.resolve([row]));
  expect(pane().getByText(row.question)).toBeInTheDocument();
  expect(pane().getByText("1 offen")).toBeInTheDocument();
  scope("Nur dieses Projekt");
  expect(pane().queryByText(row.question)).toBeNull();
  read = () => { throw new Error("offline"); };
  scope("Alle Projekte");
  await pane().findByText("Nicht verbunden");
  expect(pane().queryByText(/\d+ offen|Nichts offen/)).toBeNull();
});

it("isolates late reads and answers across project and scope round trips", async () => {
  for (const change of ["project", "scope"]) for (const result of ["stored", "null", "refused"]) {
    const lateRead = deferred(), lateAnswer = deferred();
    read = () => [row, { ...row, id: "history", question: "Old history question?", status: "answered", answer: "Old history" }];
    answer = () => lateAnswer.promise;
    const view = render(<LeitstandRoute />);
    await pane().findByText(row.question);
    fireEvent.change(input(), { target: { value: "Old draft" } });
    fireEvent.click(pane().getByRole("button", { name: "Antworten" }));
    expect(input()).toBeDisabled();
    read = () => lateRead.promise;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(input()).toHaveValue("Old draft");
    read = () => [{ ...row, id: "q2", projectId: "p2", question: "Other project?" }];
    if (change === "project") await switchProject("p2"); else scope("Alle Projekte");
    await pane().findByText("Other project?");
    expect(pane().queryByText(row.question)).toBeNull();
    expect(pane().queryByText("Beantwortet: Old history")).toBeNull();
    expect(input()).toHaveValue("");
    read = () => [row];
    if (change === "project") await switchProject("p1"); else scope("Nur dieses Projekt");
    await pane().findByText(row.question);
    const calls = mocks.invoke.mock.calls.filter(([cmd]) => cmd === "list_questions").length;
    await act(async () => {
      lateRead.resolve([{ ...row, question: "Stale read" }]);
      lateAnswer.resolve(result === "stored" ? { ...row, status: "answered", answer: "Stale answer" }
        : result === "null" ? null : Promise.reject(new Error("Stale refusal")));
    });
    expect(pane().getByText(row.question)).toBeInTheDocument();
    expect(input()).toHaveValue("");
    expect(input()).toBeEnabled();
    expect(pane().queryByText(/Stale read|Stale answer|Stale refusal|Old history/)).toBeNull();
    expect(pane().getByRole("status")).toBeEmptyDOMElement();
    expect(mocks.invoke.mock.calls.filter(([cmd]) => cmd === "list_questions")).toHaveLength(calls);
    view.unmount();
  }
});

it("keeps current drafts through polls and resets refused drafts on scope and project switches", async () => {
  answer = () => { throw new Error("Current refusal"); };
  render(<LeitstandRoute />);
  await pane().findByText(row.question);
  fireEvent.change(input(), { target: { value: "Keep this draft" } });
  fireEvent.click(pane().getByRole("button", { name: "Antworten" }));
  await pane().findByRole("alert");
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(input()).toHaveValue("Keep this draft");
  expect(pane().getByRole("alert")).toHaveTextContent("Current refusal");
  expect(input()).toBeEnabled();
  scope("Alle Projekte");
  await pane().findByText(row.question);
  expect(input()).toHaveValue("");
  expect(pane().queryByRole("alert")).toBeNull();
  fireEvent.change(input(), { target: { value: "Fleet draft" } });
  const pending = deferred();
  read = () => pending.promise;
  await switchProject("p2");
  expect(pane().queryByRole("textbox")).toBeNull();
  expect(pane().queryByText(/\d+ offen|Nichts offen/)).toBeNull();
  await act(async () => pending.resolve([row]));
  expect(input()).toHaveValue("");
  const current = deferred();
  answer = () => current.promise;
  fireEvent.change(input(), { target: { value: "Submitted" } });
  fireEvent.click(pane().getByRole("button", { name: "Antworten" }));
  read = () => [row];
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(input()).toHaveValue("Submitted");
  expect(input()).toBeDisabled();
  await act(async () => current.resolve({ ...row, status: "answered", answer: "Stored current answer" }));
  expect(pane().getByRole("status")).toHaveTextContent("Antwort gespeichert: Stored current answer");
});
