import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { QueueEntry } from "../types";
import QueuePanel from "./QueuePanel";

let queue: QueueEntry[] = [];
let listQueueError: Error | null = null;

vi.mock("../lib/ipc", () => ({
  listQueue: () => (listQueueError ? Promise.reject(listQueueError) : Promise.resolve(queue)),
  enqueueTask: vi.fn(),
  cancelQueuedTask: vi.fn(),
  describeError: (cause: unknown) => String(cause),
}));

vi.mock("../lib/settings", () => ({
  loadMasterPrompt: () => "",
  isMasterPromptEnabled: () => false,
  composeWithMasterPrompt: (text: string) => text,
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

function entry(overrides: Partial<QueueEntry>): QueueEntry {
  return {
    id: "entry-1",
    projectId: "project-a",
    rawText: "Fix the thing",
    sharpenedText: null,
    profileId: null,
    status: "queued",
    priority: 3,
    workerId: null,
    createdAt: 1,
    ...overrides,
  };
}

const props = {
  projectId: "project-a",
  profiles: [],
  profilesLoading: false,
  onFocusWorker: vi.fn(),
  onOpenQuestions: vi.fn(),
};

describe("QueuePanel", () => {
  it("shows the failure reason the core wrote, instead of a mute badge", async () => {
    queue = [
      entry({
        status: "failed",
        error: "preflight: unknown profile 'glm' — repair: create it in Settings",
      }),
    ];
    render(<QueuePanel {...props} />);
    expect(
      await screen.findByText("preflight: unknown profile 'glm' — repair: create it in Settings"),
    ).toBeInTheDocument();
  });

  it("renders no ghost hint when the reason is null or blank", async () => {
    queue = [entry({ status: "failed", error: null }), entry({ id: "entry-2", status: "failed", error: "" })];
    const { container } = render(<QueuePanel {...props} />);
    await screen.findAllByText("failed");
    expect(container.querySelectorAll(".info-line")).toHaveLength(0);
  });

  it("offers the sharpened prompt the dispatcher will actually hand over", async () => {
    queue = [entry({ sharpenedText: "1. Do this\n2. Then that" })];
    render(<QueuePanel {...props} />);
    expect(await screen.findByText("Geschärfter Prompt")).toBeInTheDocument();
    expect(screen.getByText(/Do this/)).toBeInTheDocument();
  });

  it("omits the sharpened-prompt fold when there is none", async () => {
    queue = [entry({ sharpenedText: null })];
    render(<QueuePanel {...props} />);
    await screen.findByText("Fix the thing");
    expect(screen.queryByText("Geschärfter Prompt")).not.toBeInTheDocument();
  });
});

describe("QueuePanel accessibility (ui-ux-pro-max audit)", () => {
  it("APP-4 / APP-6: the collapse control and the task field carry real names", async () => {
    queue = [];
    render(<QueuePanel {...props} />);
    expect(screen.getByRole("button", { name: "Warteschlange einklappen" })).toBeInTheDocument();
    expect(screen.getByLabelText("Task einreihen")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Einreihen" })).toBeInTheDocument();
  });
});

describe("QueuePanel heading outline (APP-15)", () => {
  it("names its section with a real heading", () => {
    queue = [];
    render(<QueuePanel {...props} />);
    expect(screen.getByRole("heading", { level: 2, name: "Warteschlange" })).toBeInTheDocument();
  });
});

describe("QueuePanel error announcement (review A-1)", () => {
  it("announces a queue load error and not only a sharpening error", async () => {
    queue = [entry({ status: "queued" })];
    listQueueError = new Error("queue down");
    render(<QueuePanel {...props} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("queue down");
    listQueueError = null;
  });
});
