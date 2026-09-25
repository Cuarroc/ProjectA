import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Recommendation } from "../types";
import RecommendationsPanel from "./RecommendationsPanel";

const acceptRecommendation = vi.fn();
const listRecommendations = vi.fn();
const createScout = vi.fn();
const triageRepos = vi.fn();

vi.mock("../lib/ipc", () => ({
  acceptRecommendation: (...args: unknown[]) => acceptRecommendation(...args),
  createScout: (...args: unknown[]) => createScout(...args),
  describeError: (cause: unknown) => String(cause),
  listRecommendations: (...args: unknown[]) => listRecommendations(...args),
  openExternal: vi.fn(),
  setRecommendationStatus: vi.fn(),
  triageRepos: (...args: unknown[]) => triageRepos(...args),
}));

const recommendation: Recommendation = {
  id: "recommendation-a",
  projectId: "project-a",
  title: "Only for project A",
  url: null,
  rationale: "Belongs to A",
  effort: null,
  status: "new",
  createdAt: 1,
};

describe("RecommendationsPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    acceptRecommendation.mockResolvedValue(undefined);
    listRecommendations.mockImplementation((projectId: string) =>
      projectId === "project-a"
        ? Promise.resolve([recommendation])
        : Promise.reject(new Error("project B unavailable")),
    );
  });

  it("F-6 removes the previous project's actionable recommendations when the project changes", async () => {
    const { rerender } = render(
      <RecommendationsPanel projectId="project-a" onOpenWorker={vi.fn()} />,
    );
    await screen.findByText("Only for project A");

    rerender(<RecommendationsPanel projectId="project-b" onOpenWorker={vi.fn()} />);
    await screen.findByText("Error: project B unavailable");

    expect(screen.queryByText("Only for project A")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Übernehmen" })).not.toBeInTheDocument();

    const staleAccept = screen.queryByRole("button", { name: "Übernehmen" });
    if (staleAccept) fireEvent.click(staleAccept);
    await waitFor(() => expect(acceptRecommendation).not.toHaveBeenCalled());
  });

  it("refuses scout start and triage when the scout category is off", async () => {
    localStorage.setItem(
      "projecta.settings.agentCategories",
      JSON.stringify({ scout: { active: false, defaultProfileId: null } }),
    );
    render(<RecommendationsPanel projectId="project-a" onOpenWorker={vi.fn()} />);
    await screen.findByText("Only for project A");

    const start = screen.getByRole("button", { name: "Scout starten" });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Repos prüfen/), {
      target: { value: "https://github.com/o/r" },
    });
    expect(screen.getByRole("button", { name: "Bewerten" })).toBeDisabled();
    fireEvent.click(start);
    expect(createScout).not.toHaveBeenCalled();
    expect(triageRepos).not.toHaveBeenCalled();
  });
});

describe("RecommendationsPanel accessibility (ui-ux-pro-max audit)", () => {
  // Own setup: this block must pass when run alone (`vitest -t`, red-first).
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    listRecommendations.mockResolvedValue([recommendation]);
  });

  it("APP-4 / APP-6: the collapse control and the triage field carry real names", async () => {
    render(<RecommendationsPanel projectId="project-a" onOpenWorker={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Empfehlungen einklappen" })).toBeInTheDocument();
    expect(screen.getByLabelText("Repos prüfen")).toBeInTheDocument();
    await screen.findByText("Only for project A");
  });
});
