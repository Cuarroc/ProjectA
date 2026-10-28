import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { readActiveProjectId, subscribeActiveProject, writeActiveProjectId } from "../../lib/activeProject";
import { ProjectPicker } from "../../shell/header/ProjectPicker";
import LeitstandRoute from "./LeitstandRoute";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const created = { id: "garden", name: "Garden", repoPath: "/repos/garden", createdAt: 1 };
let projects: typeof created[];
const calls = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "create_project");
const dialog = () => screen.getByRole("dialog", { name: "Projekt anlegen" });
async function open() {
  const trigger = await screen.findByRole("button", { name: "Projekt anlegen" });
  trigger.focus();
  fireEvent.click(trigger);
  return within(await screen.findByRole("dialog", { name: "Projekt anlegen" }));
}
function fill() {
  fireEvent.change(screen.getByLabelText("Projektname"), { target: { value: "  Garden  " } });
  fireEvent.change(screen.getByLabelText("Repository-Pfad"), { target: { value: "  /repos/garden  " } });
}
function deferCreation() {
  let finish!: (value: typeof created) => void;
  const wire = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args, options) => command === "create_project"
    ? new Promise((resolve) => { finish = resolve as typeof finish; }) : wire(command, args, options));
  return async () => { await act(async () => { finish(created); }); };
}
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "#/leitstand");
  projects = [];
  vi.mocked(invoke).mockReset().mockImplementation(async (command) => {
    if (command === "list_projects") return projects;
    if (command === "list_agent_profiles") return [];
    if (command === "get_board_state") return { cards: [], coordinators: [] };
    if (command === "list_questions") return [];
    throw new Error(`Unexpected IPC: ${command}`);
  });
});
afterEach(() => {
  cleanup();
  const reads = ["list_projects", "list_agent_profiles", "get_board_state", "list_questions", "create_project"];
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command).filter((command) => !reads.includes(command))).toEqual([]);
});

it("creates and selects a project from empty Leitstand without leaving for classic tools", async () => {
  const finish = deferCreation();
  render(<LeitstandRoute />);
  const form = await open();
  expect(form.getByLabelText("Projektname")).toHaveFocus();
  expect(form.getByRole("button", { name: "Anlegen" })).toBeDisabled();
  expect(calls()).toHaveLength(0);
  fill();
  const submit = form.getByRole("button", { name: "Anlegen" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  fireEvent.submit(submit.closest("form")!);
  expect(calls()).toEqual([["create_project", { name: "Garden", repoPath: "/repos/garden" }]]);
  expect(form.getByLabelText("Projektname")).toBeDisabled();
  expect(form.getByLabelText("Repository-Pfad")).toBeDisabled();
  expect(form.getByRole("button", { name: "Abbrechen" })).toBeDisabled();
  fireEvent.click(form.getByRole("button", { name: "Abbrechen" }));
  fireEvent.keyDown(dialog(), { key: "Escape" });
  fireEvent.mouseDown(dialog().parentElement!);
  expect(dialog()).toBeInTheDocument();
  expect(readActiveProjectId()).toBeNull();
  const selections: Array<string | null> = [];
  const unsubscribe = subscribeActiveProject((id) => selections.push(id));
  try {
    await finish();
    expect(selections).toEqual(["garden"]);
  } finally { unsubscribe(); }
  expect(readActiveProjectId()).toBe("garden");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(await screen.findByRole("button", { name: "Auftrag einreihen" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#/leitstand");
  expect(calls()).toHaveLength(1);
});

it("cancels empty Leitstand creation without writing or navigating", async () => {
  render(<LeitstandRoute />);
  for (const dismissal of ["cancel", "escape", "scrim"]) {
    const form = await open();
    fill();
    if (dismissal === "cancel") fireEvent.click(form.getByRole("button", { name: "Abbrechen" }));
    else if (dismissal === "escape") fireEvent.keyDown(dialog(), { key: "Escape" });
    else fireEvent.mouseDown(dialog().parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Projekt anlegen" })).toHaveFocus();
    expect(readActiveProjectId()).toBeNull();
    expect(calls()).toHaveLength(0);
    expect(window.location.hash).toBe("#/leitstand");
  }
});

it("keeps refused creation visible without publishing a fake project", async () => {
  const wire = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args, options) => command === "create_project"
    ? Promise.reject(new Error("Repository unavailable")) : wire(command, args, options));
  render(<LeitstandRoute />);
  const form = await open();
  fill();
  fireEvent.click(form.getByRole("button", { name: "Anlegen" }));
  expect(await form.findByRole("alert")).toHaveTextContent("Repository unavailable");
  expect(form.getByLabelText("Projektname")).toHaveValue("  Garden  ");
  expect(form.getByLabelText("Repository-Pfad")).toHaveValue("  /repos/garden  ");
  expect(form.getByRole("button", { name: "Abbrechen" })).toBeEnabled();
  expect(readActiveProjectId()).toBeNull();
  expect(calls()).toHaveLength(1);
  expect(window.location.hash).toBe("#/leitstand");
});

it("does not steal a newer explicit selection even after it returns to empty", async () => {
  const finish = deferCreation();
  render(<><button>New selection</button><LeitstandRoute /></>);
  const form = await open();
  fill();
  fireEvent.click(form.getByRole("button", { name: "Anlegen" }));
  act(() => { writeActiveProjectId("other"); writeActiveProjectId(null); });
  screen.getByRole("button", { name: "New selection" }).focus();
  await finish();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "New selection" }));
  expect(readActiveProjectId()).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Projekt anlegen" })).toBeInTheDocument();
  expect(calls()).toHaveLength(1);
});

it("does not publish a creation result after the route unmounts", async () => {
  const finish = deferCreation();
  const view = render(<LeitstandRoute />);
  const form = await open();
  fill();
  fireEvent.click(form.getByRole("button", { name: "Anlegen" }));
  view.unmount();
  await finish();
  expect(readActiveProjectId()).toBeNull();
  expect(calls()).toHaveLength(1);
});

it("shares selection with the existing picker after its next list refresh", async () => {
  const finish = deferCreation();
  render(<><ProjectPicker /><LeitstandRoute /></>);
  await act(async () => {});
  const form = await open();
  fill();
  fireEvent.click(form.getByRole("button", { name: "Anlegen" }));
  projects = [created];
  await finish();
  fireEvent.click(screen.getByRole("button", { name: /^Projekt wechseln:/ }));
  expect(await screen.findByRole("option", { name: "Garden" })).toHaveAttribute("aria-selected", "true");
  await waitFor(() => expect(screen.getByRole("button", { name: /^Projekt wechseln:/ })).toHaveTextContent("Garden"));
  expect(window.location.hash).toBe("#/leitstand");
});

it("keeps the returned project name when the initial project list arrives late", async () => {
  let finishRead!: (value: typeof projects) => void;
  const wire = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args, options) => {
    if (command === "list_projects") return new Promise((resolve) => { finishRead = resolve as typeof finishRead; });
    if (command === "list_questions") return Promise.resolve([{ id: "q1", projectId: "garden", workerId: null, scope: "preflight", question: "Which example?", optionsJson: "[]", status: "open", answer: null, createdAt: 1, expiresAt: null }]);
    return wire(command, args, options);
  });
  const finish = deferCreation();
  render(<LeitstandRoute />);
  const form = await open();
  fill();
  fireEvent.click(form.getByRole("button", { name: "Anlegen" }));
  await finish();
  await act(async () => { finishRead([]); });
  fireEvent.click(screen.getByRole("button", { name: "Alle Projekte" }));
  expect(await screen.findByText("Projekt: Garden")).toBeInTheDocument();
});

async function expectUnreadNames(state: "failed" | "pending") {
  let finishRead!: (value: typeof projects) => void;
  const wire = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args, options) => {
    if (command === "list_projects") return state === "failed" ? Promise.reject(new Error("List unavailable"))
      : new Promise((resolve) => { finishRead = resolve as typeof finishRead; });
    if (command === "list_questions") return Promise.resolve([{ id: "q2", projectId: "other", workerId: null, scope: "preflight", question: "Which project?", optionsJson: "[]", status: "open", answer: null, createdAt: 1, expiresAt: null }]);
    return wire(command, args, options);
  });
  const finish = deferCreation();
  render(<LeitstandRoute />);
  const form = await open();
  fill();
  fireEvent.click(form.getByRole("button", { name: "Anlegen" }));
  await finish();
  fireEvent.click(screen.getByRole("button", { name: "Alle Projekte" }));
  expect(await screen.findByText(state === "failed"
    ? "Projekt: other (Projektname nicht lesbar)" : "Projekt: other (Projektname wird gelesen …)")).toBeInTheDocument();
  expect(screen.queryByText("Projekt: other (Projekt nicht registriert)")).toBeNull();
  if (state === "pending") {
    await act(async () => { finishRead([{ ...created, id: "other", name: "Other project" }]); });
    expect(await screen.findByText("Projekt: Other project")).toBeInTheDocument();
  }
}
it("keeps other project names honest after creation with a failed list", () => expectUnreadNames("failed"));
it("keeps other project names honest after creation with a pending list", () => expectUnreadNames("pending"));

it("focuses the stable Leitstand heading after current creation closes the sheet", async () => {
  const finish = deferCreation();
  render(<LeitstandRoute />);
  const form = await open();
  fill();
  fireEvent.click(form.getByRole("button", { name: "Anlegen" }));
  await finish();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Fabrik" }));
});
