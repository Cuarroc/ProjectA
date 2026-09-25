import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./components/TerminalView", () => ({ default: () => null }));

import App from "./App";

function invokeCalls(command: string): number {
  return mocks.invoke.mock.calls.filter(([called]) => called === command).length;
}

describe("App bootstrap", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_agent_profiles") return Promise.resolve([]);
      if (command === "list_workers" || command === "list_questions") return Promise.resolve([]);
      if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
      return Promise.resolve(undefined);
    });
  });

  it("applies the stored density to the app root before Settings mounts", async () => {
    localStorage.setItem("projecta.settings.density", "compact");
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_projects" || command === "list_agent_profiles") return Promise.resolve([]);
      if (command === "list_workers" || command === "list_questions") return Promise.resolve([]);
      if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
      return Promise.resolve(undefined);
    });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app")).toHaveAttribute("data-density", "compact"));
  });

  it("updates the whole app immediately from Settings and persists the choice", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_projects" || command === "list_agent_profiles") return Promise.resolve([]);
      if (command === "list_workers" || command === "list_questions") return Promise.resolve([]);
      if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
      if (command === "get_panic_notice") return Promise.resolve({ current: null, previous: null });
      if (command === "get_reason_catalog") return Promise.resolve([]);
      return new Promise(() => {});
    });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app")).toHaveAttribute("data-density", "comfortable"));
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    expect(await screen.findByRole("radio", { name: "Komfortabel" })).toBeChecked();
    fireEvent.click(await screen.findByRole("radio", { name: "Kompakt" }));
    expect(localStorage.getItem("projecta.settings.density")).toBe("compact");
    await waitFor(() => expect(container.querySelector(".app")).toHaveAttribute("data-density", "compact"));
  });

  it("holds dependent reads behind the project bootstrap", async () => {
    let resolveProjects: (projects: []) => void = () => undefined;
    const projects = new Promise<[]>(resolve => {
      resolveProjects = resolve;
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_projects") return projects;
      if (command === "list_agent_profiles") return Promise.resolve([]);
      if (command === "list_workers" || command === "list_questions") return Promise.resolve([]);
      if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
      return Promise.resolve(undefined);
    });

    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Arbeitsbereich wird geladen");
    await waitFor(() => expect(invokeCalls("list_projects")).toBe(1));
    expect(invokeCalls("list_workers")).toBe(0);
    expect(invokeCalls("list_questions")).toBe(0);
    expect(invokeCalls("get_board_state")).toBe(0);

    resolveProjects([]);
  });

  it("keeps transport details out of the first error screen and retries", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_projects") return Promise.reject(new Error("C:\\private\\projecta.db"));
      if (command === "list_agent_profiles") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Arbeitsbereich konnte nicht geladen werden");
    expect(alert).not.toHaveTextContent("private");

    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(invokeCalls("list_projects")).toBe(2));
  });
});
