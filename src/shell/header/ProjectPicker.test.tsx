import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeActiveProject } from "../../lib/activeProject";
import { listProjects } from "../../lib/ipc/projects";
import type { Project } from "../../types";
import { ProjectPicker } from "./ProjectPicker";

vi.mock("../../lib/ipc/projects", () => ({ listProjects: vi.fn() }));

const list = vi.mocked(listProjects);
const project = (id: string, name: string): Project =>
  ({ id, name, repoPath: `repo-${id}`, createdAt: 0, githubRemote: false, maxWorkers: null, testCommand: null }) as Project;
const THREE = [project("a", "Alpha"), project("b", "Beta"), project("c", "Gamma")];
const trigger = () => screen.getByRole("button", { name: /Projekt/ });

beforeEach(() => { localStorage.clear(); list.mockReset().mockResolvedValue(THREE); });
afterEach(cleanup);

describe("project picker", () => {
  it("shows the active project name and lists the projects on click", async () => {
    localStorage.setItem("projecta.activeProjectId", "b");
    render(<ProjectPicker />);
    await waitFor(() => expect(trigger()).toHaveTextContent("Beta"));
    fireEvent.click(trigger());
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(screen.getByRole("option", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
  });

  it("choosing a project writes the key and fires the event", async () => {
    const seen: Array<string | null> = [];
    const off = subscribeActiveProject((id) => seen.push(id));
    render(<ProjectPicker />);
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole("option", { name: "Gamma" }));
    off();
    expect(localStorage.getItem("projecta.activeProjectId")).toBe("c");
    expect(seen).toEqual(["c"]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("drops the answer of an earlier load once a newer one has been asked for", async () => {
    let first!: (list: Project[]) => void;
    let second!: (list: Project[]) => void;
    list.mockReset()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(new Promise((r) => { first = r; }))
      .mockReturnValueOnce(new Promise((r) => { second = r; }));
    render(<ProjectPicker />);
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    await act(async () => { second(THREE); });
    await act(async () => { first([]); });
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("moves with the arrow keys and picks with Enter and Escape returns focus", async () => {
    render(<ProjectPicker />);
    fireEvent.click(trigger());
    const box = await screen.findByRole("listbox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Beta" }).id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(localStorage.getItem("projecta.activeProjectId")).toBe("b");
    expect(trigger()).toHaveFocus();
    fireEvent.click(trigger());
    fireEvent.keyDown(await screen.findByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it.each([
    ["no project yet", () => list.mockResolvedValue([]), "Noch kein Projekt – lege eins in den Einstellungen an"],
    ["a list that cannot be read", () => list.mockRejectedValue(new Error("boom")), "Projekte konnten nicht geladen werden."],
    ["a list still loading", () => list.mockReturnValue(new Promise(() => {})), "Projekte werden geladen …"],
  ])("says so in a sentence for %s", async (_name, arrange, sentence) => {
    arrange();
    render(<ProjectPicker />);
    fireEvent.click(trigger());
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.queryByRole("option")).toBeNull();
  });
});
