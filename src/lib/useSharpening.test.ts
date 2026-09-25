import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSharpening } from "./useSharpening";
import type { Question } from "../types";
import * as ipc from "./ipc";

vi.mock("./ipc", () => ({
  answerQuestion: vi.fn(),
  askQuestion: vi.fn(),
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  enhancePrompt: vi.fn(),
  listQuestions: vi.fn(),
}));

const openQuestion: Question = {
  id: "question-1",
  projectId: "project-a",
  workerId: null,
  scope: "preflight",
  question: "Welche Datenquelle?",
  optionsJson: null,
  status: "open",
  answer: null,
  createdAt: 1,
  answeredAt: null,
  answeredBy: null,
  expiresAt: 2,
};

describe("useSharpening audit regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipc.enhancePrompt).mockResolvedValue({
      enhanced: null,
      questions: [{ question: openQuestion.question, options: null }],
    });
    vi.mocked(ipc.askQuestion).mockResolvedValue(openQuestion as Question | null);
    vi.mocked(ipc.answerQuestion).mockResolvedValue(openQuestion);
  });

  it("closes preflight questions when the conversation view unmounts", async () => {
    const { result, unmount } = renderHook(() => useSharpening("project-a", vi.fn()));

    act(() => result.current.start("Unklarer Auftrag"));
    await waitFor(() => expect(result.current.phase).toBe("waiting"));
    unmount();

    expect(ipc.answerQuestion).toHaveBeenCalledWith(
      "question-1",
      "abgebrochen — die Prompt-Schärfung wurde beendet",
    );
  });
});
