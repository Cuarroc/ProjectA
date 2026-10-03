import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LearningsPanel from "./LearningsPanel";
import * as ipc from "../lib/ipc";
import type { Learning } from "../types";

vi.mock("../lib/ipc", () => ({
  approveLearning: vi.fn(),
  approveRoleVariant: vi.fn(),
  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  getVerdictToken: vi.fn(),
  listLearnings: vi.fn(),
  listRoleVariants: vi.fn(),
  rejectLearning: vi.fn(),
  rejectRoleVariant: vi.fn(),
}));

const learningA = {
  id: "learning-a",
  projectId: "project-a",
  status: "pending",
  content: "Learning of project A",
} as Learning;

describe("LearningsPanel project switch", () => {
  it("drops the previous project's learnings when the read for the new one fails", async () => {
    vi.mocked(ipc.listRoleVariants).mockResolvedValue([]);
    vi.mocked(ipc.listLearnings).mockResolvedValueOnce([learningA]);
    const { rerender } = render(<LearningsPanel projectId="project-a" />);
    expect(await screen.findByDisplayValue("Learning of project A")).toBeTruthy();

    vi.mocked(ipc.listLearnings).mockRejectedValue(new Error("boom"));
    rerender(<LearningsPanel projectId="project-b" />);

    await waitFor(() => expect(ipc.listLearnings).toHaveBeenCalledWith("project-b"));
    expect(screen.queryByDisplayValue("Learning of project A")).toBeNull();
  });

  it("ignores a read of the previous project that resolves after the switch", async () => {
    vi.mocked(ipc.listRoleVariants).mockResolvedValue([]);
    let resolveA: (rows: Learning[]) => void = () => undefined;
    vi.mocked(ipc.listLearnings).mockImplementation((id?: string) =>
      id === "project-a"
        ? new Promise<Learning[]>((resolve) => {
            resolveA = resolve;
          })
        : new Promise<Learning[]>(() => undefined),
    );
    const { rerender } = render(<LearningsPanel projectId="project-a" />);
    rerender(<LearningsPanel projectId="project-b" />);
    resolveA([learningA]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByDisplayValue("Learning of project A")).toBeNull();
  });

  it("does not show an old project's approval receipt after the switch", async () => {
    let resolveApproval: () => void = () => undefined;
    vi.mocked(ipc.approveLearning).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveApproval = resolve;
      }),
    );
    vi.mocked(ipc.listRoleVariants).mockResolvedValue([]);
    vi.mocked(ipc.listLearnings).mockResolvedValueOnce([learningA]).mockResolvedValue([]);
    const { rerender } = render(<LearningsPanel projectId="project-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Annehmen" }));

    rerender(<LearningsPanel projectId="project-b" />);
    await act(async () => resolveApproval());

    expect(screen.queryByText("Ins Playbook übernommen.")).toBeNull();
  });
});
