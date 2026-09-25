import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LearningsPanel from "./LearningsPanel";
import * as ipc from "../lib/ipc";
import type { RoleVariant } from "../types";

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

const variant: RoleVariant = {
  id: "variant-1",
  projectId: "project-a",
  name: "Test-Fixer",
  baseProfileId: "claude",
  patternLabel: "tests-fixen",
  systemPromptAddition: "Lauf die Gates seriell. Nie CARGO_PROFILE_ setzen.",
  version: 1,
  status: "pending",
  createdAt: 0,
};

/**
 * KI-1: the prompt addition a role variant would carry into every future
 * spawn was folded away by default, so an "Annehmen" click could be a verdict
 * on text the reviewer never read.
 */
describe("LearningsPanel und der Prompt-Zusatz (KI-1)", () => {
  it("zeigt den Prompt-Zusatz eines Rollen-Vorschlags ohne Klick auf den Tab", async () => {
    vi.mocked(ipc.listLearnings).mockResolvedValue([]);
    vi.mocked(ipc.listRoleVariants).mockResolvedValue([variant]);

    render(<LearningsPanel projectId="project-a" />);

    // The tab starts on "Learnings"; the reviewer only has to switch to see
    // the role card at all — the addition itself must not need a second click.
    const tab = await screen.findByRole("tab", { name: /Rollen/ });
    // fireEvent wraps the click in act(), so the tab switch has settled
    // before the assertion reads the DOM (Review W1-09 Runde 3, deepseek P4).
    fireEvent.click(tab);

    expect(
      await screen.findByText("Lauf die Gates seriell. Nie CARGO_PROFILE_ setzen."),
    ).toBeInTheDocument();
  });
});
