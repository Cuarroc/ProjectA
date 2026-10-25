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
