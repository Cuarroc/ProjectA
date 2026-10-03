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

describe("useSharpening project switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipc.enhancePrompt).mockResolvedValue({
      enhanced: null,
      questions: [{ question: openQuestion.question, options: null }],
    });
    vi.mocked(ipc.askQuestion).mockResolvedValue(openQuestion as Question | null);
    vi.mocked(ipc.answerQuestion).mockResolvedValue(openQuestion);
  });

  it("closes a row that was still being filed when the round was cancelled", async () => {
    let fileRow: (row: Question) => void = () => undefined;
    vi.mocked(ipc.askQuestion).mockReturnValue(
      new Promise<Question | null>((resolve) => {
        fileRow = resolve;
      }),
    );
    const { result } = renderHook(() => useSharpening("project-a", vi.fn()));

    act(() => result.current.start("Unklarer Auftrag"));
    await waitFor(() => expect(ipc.askQuestion).toHaveBeenCalled());
    act(() => result.current.cancel());
    await act(async () => fileRow(openQuestion));

    expect(ipc.answerQuestion).toHaveBeenCalledWith(
      "question-1",
      "abgebrochen — die Prompt-Schärfung wurde beendet",
    );
  });
});
