import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./components/TerminalView", () => ({ default: () => null }));

import { listen } from "@tauri-apps/api/event";
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

  it("applies the stored UI text size to the app root", async () => {
    localStorage.setItem("projecta.settings.uiFontSize", "large");
    const { container } = render(<App />);
    expect(container.querySelector(".app")).toHaveAttribute("data-ui-font-size", "large");
    await waitFor(() => expect(container.querySelector(".app")).toHaveAttribute("data-ui-font-size", "large"));
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
  it("shows the first-run checklist with the missing agent when nothing is connected", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_projects" || command === "list_agent_profiles") return Promise.resolve([]);
      if (command === "list_workers" || command === "list_questions") return Promise.resolve([]);
      if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
      if (command === "get_provider_overview") {
        return Promise.resolve([
          { id: "claude", name: "Claude Code", kind: "subscription", connected: false, detail: null },
        ]);
      }
      return Promise.resolve(undefined);
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "Agents" }));
    const list = await screen.findByRole("list", { name: "Erste Schritte" });
    expect(list.querySelectorAll("li")).toHaveLength(3);
    const agentStep = screen.getByText("Ein Agent ist bereit").closest("li");
    await waitFor(() => expect(agentStep).toHaveTextContent("Noch nicht verbunden: Claude Code"));
    expect(agentStep).toHaveAttribute("data-done", "false");
    expect(screen.getByText("Projekt anlegen (ein Git-Ordner)").closest("li")).toHaveAttribute("data-done", "false");
    expect(screen.getByRole("button", { name: "Ad-hoc-Sitzung" })).toBeInTheDocument();
  });

  it("checklist is not shown for an established project without workers", async () => {
    const project = { id: "p1", name: "Demo", repoPath: "/repo/demo", createdAt: 1, githubRemote: false };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_projects") return Promise.resolve([project]);
      if (command === "list_agent_profiles") return Promise.resolve([]);
      if (command === "list_workers" || command === "list_questions") return Promise.resolve([]);
      if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
      if (command === "get_provider_overview") {
        return Promise.resolve([
          { id: "claude", name: "Claude Code", kind: "subscription", connected: true, detail: null },
        ]);
      }
      return Promise.resolve(undefined);
    });

    vi.mocked(listen).mockResolvedValue(() => {});
    render(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "Agents" }));
    expect(await screen.findByText("Keine Terminal-Sitzungen.")).toBeInTheDocument();
    await waitFor(() => expect(invokeCalls("get_provider_overview")).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("list", { name: "Erste Schritte" })).toBeNull();
  });
});
