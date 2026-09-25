import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Project } from "../types";
import GitHubLinkDialog from "./GitHubLinkDialog";

const createGithubRepo = vi.fn();

vi.mock("../lib/ipc", () => ({
  createGithubRepo: (...args: unknown[]) => createGithubRepo(...args),
  linkGithubRemote: vi.fn(),
  describeError: (cause: unknown) => String(cause),
}));

const project: Project = {
  id: "project-a",
  name: "Project A",
  repoPath: "/tmp/project-a",
  createdAt: 1,
  githubRemote: false,
  maxWorkers: null,
  testCommand: null,
};

describe("GitHubLinkDialog", () => {
  it("F-3 keeps the dialog open while repository creation is in flight", () => {
    createGithubRepo.mockReturnValue(new Promise(() => undefined));
    const onClose = vi.fn();
    render(<GitHubLinkDialog project={project} onLinked={vi.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Erstellen" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(document.querySelector(".modal-backdrop")!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("F-11 preserves the success auto-close timer across parent renders", async () => {
    vi.useFakeTimers();
    createGithubRepo.mockResolvedValue("https://github.com/example/project-a");
    const onClose = vi.fn();
    const { rerender } = render(
      <GitHubLinkDialog project={project} onLinked={vi.fn()} onClose={() => onClose()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Erstellen" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Wird geschlossen…")).toBeInTheDocument();
    rerender(<GitHubLinkDialog project={project} onLinked={vi.fn()} onClose={() => onClose()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    vi.useRealTimers();

    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("GitHubLinkDialog mode tabs (APP-5)", () => {
  it("arrow keys switch the mode and the form is the labelled tab panel", () => {
    render(<GitHubLinkDialog project={project} onLinked={vi.fn()} onClose={vi.fn()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    fireEvent.keyDown(screen.getByRole("tablist", { name: "GitHub-Modus" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Bestehendes verknüpfen" })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs[1]);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "gh-tab-link");
    expect(screen.getByLabelText("Repository-URL")).toBeInTheDocument();
  });
});

describe("GitHubLinkDialog focus (APP-7)", () => {
  it("starts inside the dialog and keeps Tab inside and returns focus to the opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Öffner";
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { unmount } = render(<GitHubLinkDialog project={project} onLinked={vi.fn()} onClose={onClose} />);
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const buttons = screen.getAllByRole("button");
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getAllByRole("tab")[0]);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
