import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Recommendation } from "../types";

const mocks = vi.hoisted(() => ({
  listRecommendations: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  acceptRecommendation: vi.fn(),
  createScout: vi.fn(),
  describeError: (cause: unknown) => String(cause),
  listRecommendations: mocks.listRecommendations,
  setRecommendationStatus: vi.fn(),
  triageRepos: vi.fn(),
}));

import RecommendationsPanel from "./RecommendationsPanel";

function recommendation(projectId: string, title: string): Recommendation {
  return {
    id: `recommendation-${projectId}`,
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
    mocks.listRecommendations.mockReset();
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
});
