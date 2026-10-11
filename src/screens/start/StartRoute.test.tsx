import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import StartRoute from "./StartRoute";

const project = { id: "p1", name: "Demo", repoPath: "/work/demo", createdAt: 1, githubRemote: false, maxWorkers: null, testCommand: null };
const scan = { mainBranch: "main", hasGatesSh: true, hasMergify: false, hasAgentsMd: true, seamFiles: [], freeRamBytes: null };
const step = (n: number) => within(screen.getByRole("list", { name: "Schritte der Einrichtung" })).getAllByRole("listitem")[n - 1];

function answer(scanReply: () => Promise<unknown>, projects: unknown[] = [project]) {
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "list_projects") return Promise.resolve(projects);
    if (command === "scan_setup_repo") return scanReply();
    if (command === "get_provider_overview") return Promise.resolve([]);
    return new Promise(() => {});
  });
}

beforeEach(() => { localStorage.clear(); mocks.invoke.mockReset(); });
afterEach(cleanup);

it("marks the project rules step done with the found and missing items of the scan", async () => {
  answer(() => Promise.resolve(scan));
  render(<StartRoute />);
  await waitFor(() => expect(within(step(4)).getByText("Erledigt")).toBeInTheDocument());
  expect(mocks.invoke).toHaveBeenCalledWith("scan_setup_repo", { path: "/work/demo" });
  const found = (label: string) => within(step(4)).getByText(label).closest("li")!;
  expect(within(found("Hauptzweig: main")).getByText("Gefunden")).toBeInTheDocument();
  expect(within(found("gates.sh")).getByText("Gefunden")).toBeInTheDocument();
  expect(within(found("Mergify-Konfiguration")).getByText("Fehlt")).toBeInTheDocument();
  expect(within(found("AGENTS.md")).getByText("Gefunden")).toBeInTheDocument();
  expect(within(step(4)).queryByText("Noch nicht verbunden")).toBeNull();
});

it("shows the error form when the scan fails", async () => {
  answer(() => Promise.reject("not a folder"));
  render(<StartRoute />);
  const title = await within(step(4)).findByText("Projektregeln konnten nicht gelesen werden");
  expect(title.closest(".g-hs")).not.toBeNull();
  expect(within(step(4)).getByText("Fehler")).toHaveClass("g-st--bad");
  expect(within(step(4)).getByText("not a folder")).toBeInTheDocument();
});

it("scans the project the old app selected and does not scan without a project", async () => {
  localStorage.setItem("projecta.activeProjectId", "p2");
  answer(() => Promise.resolve(scan), [project, { ...project, id: "p2", repoPath: "/work/other" }]);
  render(<StartRoute />);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("scan_setup_repo", { path: "/work/other" }));
  cleanup();
  mocks.invoke.mockClear();
  answer(() => Promise.resolve(scan), []);
  render(<StartRoute />);
  expect(await within(step(4)).findByText("Kein Projekt gewählt")).toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalledWith("scan_setup_repo", expect.anything());
});

it("shows an honest error with a retry when the project list cannot be read", async () => {
  let fail = true;
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "list_projects") return fail ? Promise.reject("db locked") : Promise.resolve([project]);
    if (command === "scan_setup_repo") return Promise.resolve(scan);
    if (command === "get_provider_overview") return Promise.resolve([]);
    return new Promise(() => {});
  });
  render(<StartRoute />);
  expect(await within(step(4)).findByText("Projekte konnten nicht gelesen werden")).toBeInTheDocument();
  expect(within(step(4)).getByText("db locked")).toBeInTheDocument();
  expect(within(step(4)).queryByText("Noch kein Projekt angelegt.")).toBeNull();
  const calls = () => mocks.invoke.mock.calls.filter(([c]) => c === "list_projects").length;
  fail = false;
  fireEvent.click(within(step(4)).getByRole("button", { name: "Erneut versuchen" }));
  await waitFor(() => expect(within(step(4)).getByText("Erledigt")).toBeInTheDocument());
  expect(calls()).toBe(2);
});
