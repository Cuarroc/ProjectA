import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Recommendation } from "../types";

const mocks = vi.hoisted(() => ({
  acceptRecommendation: vi.fn(),
  listRecommendations: vi.fn(),
  setRecommendationStatus: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  acceptRecommendation: mocks.acceptRecommendation,
  createScout: vi.fn(),
  describeError: (cause: unknown) => String(cause),
  listRecommendations: mocks.listRecommendations,
  setRecommendationStatus: mocks.setRecommendationStatus,
  triageRepos: vi.fn(),
}));

import RecommendationsPanel from "./RecommendationsPanel";

function recommendation(projectId: string, title: string, id = `recommendation-${projectId}`): Recommendation {
  return {
    id,
    projectId,
    title,
    url: null,
    rationale: `Belongs to ${projectId}`,
    effort: null,
    status: "new",
    createdAt: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("RecommendationsPanel project switch race", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("ignores a late recommendation response from the previous project", async () => {
    const oldProject = deferred<Recommendation[]>();
    mocks.listRecommendations.mockImplementation((projectId: string) =>
      projectId === "project-a"
        ? oldProject.promise
        : Promise.resolve([recommendation("project-b", "Only for project B")]),
    );

    const { rerender } = render(
      <RecommendationsPanel projectId="project-a" onOpenWorker={vi.fn()} />,
    );
    rerender(<RecommendationsPanel projectId="project-b" onOpenWorker={vi.fn()} />);
    expect(await screen.findByText("Only for project B")).toBeInTheDocument();

    await act(async () => {
      oldProject.resolve([recommendation("project-a", "Only for project A")]);
    });

    expect(screen.queryByText("Only for project A")).not.toBeInTheDocument();
    expect(screen.getByText("Only for project B")).toBeInTheDocument();
  });

  it("ignores a late accept response after the project changes", async () => {
    const acceptance = deferred<void>();
    mocks.acceptRecommendation.mockReturnValue(acceptance.promise);
    mocks.listRecommendations.mockImplementation((projectId: string) =>
      Promise.resolve([recommendation(projectId, `Only for ${projectId}`, "shared-id")]),
    );
    const { rerender } = render(
      <RecommendationsPanel projectId="project-a" onOpenWorker={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Übernehmen" }));
    rerender(<RecommendationsPanel projectId="project-b" onOpenWorker={vi.fn()} />);
    expect(await screen.findByText("Only for project-b")).toBeInTheDocument();
    await act(async () => acceptance.resolve());
    expect(screen.getByRole("button", { name: "Übernehmen" })).toBeEnabled();
    expect(screen.queryByText(/ist in der Warteschlange/)).not.toBeInTheDocument();
  });

  it("ignores a late dismiss response after the project changes", async () => {
    const dismissal = deferred<void>();
    mocks.setRecommendationStatus.mockReturnValue(dismissal.promise);
    mocks.listRecommendations.mockImplementation((projectId: string) =>
      Promise.resolve([recommendation(projectId, `Only for ${projectId}`, "shared-id")]),
    );
    const { rerender } = render(
      <RecommendationsPanel projectId="project-a" onOpenWorker={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Ablehnen" }));
    rerender(<RecommendationsPanel projectId="project-b" onOpenWorker={vi.fn()} />);
    expect(await screen.findByText("Only for project-b")).toBeInTheDocument();
    await act(async () => dismissal.resolve());
    expect(screen.getByText("Only for project-b")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ablehnen" })).toBeEnabled();
  });
});
