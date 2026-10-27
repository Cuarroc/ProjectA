import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const created = { id: "project-glass-new", name: "Glass Garden", repoPath: "/repos/glass-garden", createdAt: 1 };
let projects: typeof created[];
const calls = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "create_project");
const picker = () => screen.getByRole("button", { name: /^Projekt wechseln:/ });
const form = () => screen.getByRole("dialog", { name: "Projekt anlegen" });
async function mount() {
  const view = render(<App />);
  await act(async () => { await vi.dynamicImportSettled(); });
  await screen.findByRole("button", { name: "Projekt hinzufügen" });
  return view;
}
async function open() {
  fireEvent.click(picker());
  fireEvent.click(await screen.findByRole("button", { name: "Neues Projekt anlegen" }));
  return within(form());
}
function fill() {
  fireEvent.change(screen.getByLabelText("Projektname"), { target: { value: "  Glass Garden  " } });
  fireEvent.change(screen.getByLabelText("Repository-Pfad"), { target: { value: "  /repos/glass-garden  " } });
}
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
  window.history.replaceState(null, "", "#/leitstand/werkzeuge");
  projects = [];
  vi.mocked(invoke).mockReset().mockImplementation(async (command) => {
    if (command === "list_projects") return projects;
    if (command === "get_board_state") return { cards: [], coordinators: [] };
    if (command === "get_panic_notice") return { current: null, previous: null };
    return [];
  });
});
afterEach(cleanup);

it("creates a project from the Glass picker and shares the new selection", async () => {
  let finish!: (value: typeof created) => void;
  const view = await mount();
  const ipc = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args, options) => command === "create_project"
    ? new Promise((resolve) => { finish = resolve as typeof finish; }) : ipc(command, args, options));
  const dialog = await open();
  expect(dialog.getByLabelText("Projektname")).toHaveFocus();
  expect(dialog.getByRole("button", { name: "Anlegen" })).toBeDisabled();
  fill();
  fireEvent.click(dialog.getByRole("button", { name: "Anlegen" }));
  fireEvent.click(dialog.getByRole("button", { name: "Anlegen" }));
  fireEvent.submit(dialog.getByRole("button", { name: "Anlegen" }).closest("form")!);
  expect(calls()).toEqual([["create_project", { name: "Glass Garden", repoPath: "/repos/glass-garden" }]]);
  expect(localStorage.getItem("projecta.activeProjectId")).toBeNull();
  projects = [created];
  await act(async () => { finish(created); });
  await waitFor(() => expect(picker()).toHaveTextContent("Glass Garden"));
  expect(picker()).toHaveFocus();
  expect(localStorage.getItem("projecta.activeProjectId")).toBe("project-glass-new");
  const sidebar = within(screen.getByRole("complementary", { name: "Projekte und Panels" }));
  expect(await sidebar.findByRole("button", { name: /^Glass Garden\s*\/repos\/glass-garden$/ })).toBeVisible();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_workers", { projectId: "project-glass-new" }));
  view.unmount();
  await mount();
  expect(picker()).toHaveTextContent("Glass Garden");
  fireEvent.click(picker());
  expect(await screen.findByRole("option", { name: "Glass Garden" })).toHaveAttribute("aria-selected", "true");
  expect(calls()).toHaveLength(1);
  expect(vi.mocked(invoke).mock.calls.some(([c]) => /^(create_worker|create_orchestrator|spawn_pty)$/.test(c))).toBe(false);
});

async function dismissesCreation(existing: boolean) {
  if (existing) projects = [{ ...created, id: "existing", name: "Existing" }];
  await mount();
  for (const dismissal of ["cancel", "escape", "scrim"]) {
    const dialog = await open();
    fill();
    expect(calls()).toHaveLength(0);
    if (dismissal === "cancel") fireEvent.click(dialog.getByRole("button", { name: "Abbrechen" }));
    else if (dismissal === "escape") fireEvent.keyDown(form(), { key: "Escape" });
    else fireEvent.mouseDown(form().parentElement!);
    expect(screen.queryByRole("dialog", { name: "Projekt anlegen" })).toBeNull();
    expect(picker()).toHaveFocus();
    expect(calls()).toHaveLength(0);
  }
  if (existing) {
    fireEvent.click(picker());
    fireEvent.keyDown(await screen.findByRole("listbox"), { key: "Enter" });
    expect(localStorage.getItem("projecta.activeProjectId")).toBe("existing");
  }
}
it("dismisses creation for an empty picker without writing and returns focus", () => dismissesCreation(false));
it("dismisses creation for an existing picker without writing and returns focus", () => dismissesCreation(true));

it("keeps rejected input and selection until an explicit new attempt", async () => {
  projects = [{ ...created, id: "existing", name: "Existing" }];
  await mount();
  const ipc = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args, options) => command === "create_project"
    ? Promise.reject(new Error("Repository unavailable")) : ipc(command, args, options));
  const dialog = await open();
  fill();
  fireEvent.click(dialog.getByRole("button", { name: "Anlegen" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("Repository unavailable");
  expect(dialog.getByLabelText("Projektname")).toHaveValue("  Glass Garden  ");
  expect(dialog.getByLabelText("Repository-Pfad")).toHaveValue("  /repos/glass-garden  ");
  expect(localStorage.getItem("projecta.activeProjectId")).toBe("existing");
  expect(picker()).toHaveTextContent("Existing");
  expect(calls()).toHaveLength(1);
  expect(dialog.getByRole("button", { name: "Anlegen" })).not.toHaveAttribute("aria-busy");
  fireEvent.click(dialog.getByRole("button", { name: "Anlegen" }));
  await waitFor(() => expect(calls()).toHaveLength(2));
  expect(await dialog.findByRole("alert")).toHaveTextContent("Repository unavailable");
  expect(vi.mocked(invoke).mock.calls.some(([c]) => /^(create_worker|create_orchestrator|spawn_pty)$/.test(c))).toBe(false);
});
