import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRoutingStatus } from "../lib/ipc";
import { saveAgentCategories } from "../lib/settings";
import type { AgentCategoryConfig, AgentProfile } from "../types";
import NewWorkerDialog from "./NewWorkerDialog";

vi.mock("../lib/ipc", () => ({
  listRoleVariants: vi.fn(async () => []),
  getRoutingStatus: vi.fn(async () => ({
    mode: "review",
    reviewIndependent: false,
    reviewDetail: "auto/review is not a known combo",
  })),
  describeError: (cause: unknown) => String(cause),
  getQuotaState: vi.fn(async () => []),
  listQuestions: vi.fn(async () => []),
  askQuestion: vi.fn(),
  answerQuestion: vi.fn(),
  enhancePrompt: vi.fn(),
  getProjectSkillPacks: vi.fn(async () => []),
  listSkillPacks: vi.fn(async () => []),
  setProjectSkillPacks: vi.fn(),
}));

vi.mock("../lib/settings", async () => {
  const actual = await vi.importActual<typeof import("../lib/settings")>("../lib/settings");
  return {
    ...actual,
    loadMasterPrompt: () => "",
    isMasterPromptEnabled: () => false,
    composeWithMasterPrompt: (task: string) => task,
  };
});

function profile(id: string, name = id): AgentProfile {
  return {
    id,
    name,
    command: id,
    args: [],
    env: {},
    fallback: null,
    enabled: true,
  };
}

const claude = profile("claude", "Claude");
const codex = profile("codex", "Codex");

const ALL_ON: AgentCategoryConfig[] = [
  { id: "worker", active: true, defaultProfileId: null },
  { id: "queen", active: true, defaultProfileId: null },
  { id: "employee", active: true, defaultProfileId: null },
  { id: "scout", active: true, defaultProfileId: null },
  { id: "orchestrator", active: true, defaultProfileId: null },
];

function renderDialog(profiles: AgentProfile[] = [claude, codex]) {
  return render(
    <NewWorkerDialog
      projectId="pj-1"
      projectName="ProjectA"
      profiles={profiles}
      profilesLoading={false}
      error={null}
      busy={false}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("NewWorkerDialog review block", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getRoutingStatus).mockResolvedValue({
      mode: "review",
      reviewIndependent: false,
      reviewDetail: "auto/review is not a known combo",
    });
  });

  it("names the live review-block for assistive tech", async () => {
    renderDialog([claude]);

    const block = await screen.findByRole("status", { name: "Review-Blockade" });
    expect(block).toHaveAttribute("aria-live", "polite");
    expect(block).toHaveTextContent(/auto\/review is not a known combo/);
    expect(block).toHaveTextContent(/fällt nicht auf das Autoren-Modell/);
  });
});

describe("NewWorkerDialog F0-5 spawn overlays", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getRoutingStatus).mockResolvedValue({
      mode: "cheap",
      reviewIndependent: true,
      reviewDetail: "",
    });
  });

  it("selects the stored worker defaultProfileId", async () => {
    saveAgentCategories(
      ALL_ON.map((category) =>
        category.id === "worker" ? { ...category, defaultProfileId: "codex" } : category,
      ),
    );
    renderDialog();
    await waitFor(() => {
      expect(screen.getByLabelText("Agent profile")).toHaveValue("codex");
    });
  });

  it("refuses spawn when the worker category is off", async () => {
    saveAgentCategories(
      ALL_ON.map((category) =>
        category.id === "worker" ? { ...category, active: false } : category,
      ),
    );
    renderDialog();
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "do the thing" } });
    expect(await screen.findByText(/Worker-Kategorie ist aus/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create worker" })).toBeDisabled();
  });
});
