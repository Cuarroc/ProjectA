import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { QuestionsState } from "../lib/useQuestions";
import type { Project, Question, Worker } from "../types";
import QuestionsView from "./QuestionsView";

const projects: Project[] = [
  {
    id: "project-a",
    name: "Alpha",
    repoPath: "/projects/alpha",
    createdAt: 1,
    githubRemote: true,
    maxWorkers: null,
    testCommand: null,
  },
  {
    id: "project-b",
    name: "Beta",
    repoPath: "/projects/beta",
    createdAt: 1,
    githubRemote: true,
    maxWorkers: null,
    testCommand: null,
  },
];

const worker: Worker = {
  id: "worker-a",
  projectId: "project-a",
  task: "Prepare release",
  profileId: "codex",
  branch: "codex/release",
  worktreePath: "/worktrees/release",
  sessionId: "session-a",
  status: "running",
  kind: "worker",
  spawnedBy: null,
  pausedReason: null,
  createdAt: 1,
};

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "question-a",
    projectId: "project-a",
    workerId: worker.id,
    scope: "worker",
    question: "Which release channel?",
    optionsJson: '["Beta","Stable",""]',
    status: "open",
    answer: null,
    createdAt: 1_000,
    answeredAt: null,
    answeredBy: null,
    expiresAt: 20_000,
    ...overrides,
  };
}

function state(overrides: Partial<QuestionsState> = {}): QuestionsState {
  return {
    open: [],
    history: [],
    loading: false,
    error: null,
    scope: "project",
    setScope: vi.fn(),
    refresh: vi.fn(),
    answer: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("QuestionsView", () => {
  it("answers an offered choice and opens the waiting worker", async () => {
    const answer = vi.fn(async () => undefined);
    const onOpenWorker = vi.fn();
    render(
      <QuestionsView
        questions={state({ open: [question()], answer })}
        projects={projects}
        activeProjectId="project-a"
        workers={[worker]}
        onOpenWorker={onOpenWorker}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "codex/release" }));
    expect(onOpenWorker).toHaveBeenCalledWith(worker);
    fireEvent.click(screen.getByRole("button", { name: "Stable" }));
    await waitFor(() => expect(answer).toHaveBeenCalledWith("question-a", "Stable"));
  });

  it("submits typed answers with Enter but preserves Shift+Enter", async () => {
    const answer = vi.fn(async () => undefined);
    render(
      <QuestionsView
        questions={state({ open: [question({ optionsJson: null })], answer })}
        projects={projects}
        activeProjectId="project-a"
        workers={[worker]}
        onOpenWorker={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Antwort" });
    fireEvent.change(input, { target: { value: "Use beta" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(answer).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(answer).toHaveBeenCalledWith("question-a", "Use beta"));
  });

  it("keeps fleet questions actionable while explaining an unloaded worker", () => {
    const setScope = vi.fn();
    render(
      <QuestionsView
        questions={state({
          scope: "all",
          setScope,
          open: [question({ projectId: "project-b", workerId: "worker-b" })],
        })}
        projects={projects}
        activeProjectId="project-a"
        workers={[worker]}
        onOpenWorker={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Beta")).toHaveTextContent("Beta");
    expect(screen.getByText("Worker in Beta")).toHaveAttribute(
      "title",
      expect.stringContaining("aktiven Projekts"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Nur dieses Projekt" }));
    expect(setScope).toHaveBeenCalledWith("project");
  });

  it("reveals who closed a question when history is expanded", () => {
    render(
      <QuestionsView
        questions={state({
          history: [
            question({
              status: "answered",
              answer: "Beta",
              answeredAt: 2_000,
              answeredBy: "human",
            }),
          ],
        })}
        projects={projects}
        activeProjectId="project-a"
        workers={[worker]}
        onOpenWorker={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Entschieden/ }));
    expect(screen.getByText("von einem Menschen beantwortet")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });
});
