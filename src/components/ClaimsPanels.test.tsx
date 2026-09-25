import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import QueuePanel from "./QueuePanel";
import RecommendationsPanel from "./RecommendationsPanel";
import LearningsPanel from "./LearningsPanel";
import * as ipc from "../lib/ipc";

vi.mock("../lib/ipc", () => ({
  acceptRecommendation: vi.fn(),
  approveLearning: vi.fn(),
  approveRoleVariant: vi.fn(),
  cancelQueuedTask: vi.fn(),
  createScout: vi.fn(),
  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  enqueueTask: vi.fn(),
  getVerdictToken: vi.fn(),
  listLearnings: vi.fn(),
  listQueue: vi.fn(),
  listRecommendations: vi.fn(),
  listRoleVariants: vi.fn(),
  openExternal: vi.fn(),
  rejectLearning: vi.fn(),
  rejectRoleVariant: vi.fn(),
  setRecommendationStatus: vi.fn(),
  triageRepos: vi.fn(),
}));

vi.mock("../lib/useSharpening", () => ({
  useSharpening: () => ({
    phase: "idle",
    active: false,
    running: false,
    open: [],
    error: null,
    clearError: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    answer: vi.fn(),
  }),
}));

describe("sidebar empty-state claims audit", () => {
  it("C-6 does not claim the queue is empty before listQueue answers", () => {
    vi.mocked(ipc.listQueue).mockReturnValue(new Promise(() => undefined));

    render(
      <QueuePanel
        projectId="project-a"
        profiles={[]}
        profilesLoading={false}
        onFocusWorker={vi.fn()}
        onOpenQuestions={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Warteschlange leer/)).not.toBeInTheDocument();
  });

  it("C-6 does not claim there are no recommendations before the read answers", () => {
    vi.mocked(ipc.listRecommendations).mockReturnValue(new Promise(() => undefined));

    render(<RecommendationsPanel projectId="project-a" onOpenWorker={vi.fn()} />);

    expect(screen.queryByText(/Noch keine Empfehlungen/)).not.toBeInTheDocument();
  });

  it("C-6 does not claim there are no learnings before both reads answer", () => {
    vi.mocked(ipc.listLearnings).mockReturnValue(new Promise(() => undefined));
    vi.mocked(ipc.listRoleVariants).mockReturnValue(new Promise(() => undefined));

    render(<LearningsPanel projectId="project-a" />);

    expect(screen.queryByText("Keine offenen Learnings.")).not.toBeInTheDocument();
  });

});
