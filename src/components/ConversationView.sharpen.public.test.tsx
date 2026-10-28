import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { OrchestratorChat } from "../lib/orchestratorChat";
import ConversationView from "./ConversationView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));

const chat: OrchestratorChat = {
  orchestratorId: null, messages: [], loading: false, sending: false,
  error: null, disabled: false, send: vi.fn(async () => true),
  clearError: vi.fn(), reload: vi.fn(),
};
const props = {
  chat, projectId: "project-a", projectName: "Project A",
  onOpenOrchestrator: vi.fn(), onOpenQuestions: vi.fn(),
};
const input = () => screen.getByRole("textbox", { name: "Nachricht an den Orchestrator" });
const sharpen = () => screen.getByRole("button", { name: "Schärfen" });
const write = () => fireEvent.change(input(), { target: { value: "original draft" } });

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

it("keeps sharpening named while waiting and never sends the rewritten draft automatically", async () => {
  let resolve!: (value: { enhanced: string; questions: [] }) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise((done) => { resolve = done; }));
  vi.mocked(chat.send).mockResolvedValue(true);
  render(<ConversationView {...props} />);
  write();
  fireEvent.click(sharpen());

  expect(invoke).toHaveBeenCalledExactlyOnceWith("enhance_prompt", {
    draft: "original draft", targetProfile: undefined, answers: undefined,
  });
  expect(sharpen()).toBeDisabled();
  expect(sharpen()).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Schärft …");
  expect(input()).toHaveValue("original draft");
  expect(chat.send).not.toHaveBeenCalled();

  await act(async () => resolve({ enhanced: "literal rewritten draft", questions: [] }));
  expect(input()).toHaveValue("literal rewritten draft");
  expect(input()).toBeEnabled();
  expect(sharpen()).toBeEnabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(chat.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Senden" }));
  await waitFor(() => expect(chat.send).toHaveBeenCalledExactlyOnceWith("literal rewritten draft"));
  expect(input()).toHaveValue("");
});

const question = {
  id: "q-1", projectId: "project-a", workerId: null, scope: "preflight",
  question: "Which source?", status: "open", answer: null, answeredBy: null,
};

it("keeps the waiting count and navigation and single cancellation of real questions", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "enhance_prompt") return { enhanced: null, questions: [{ question: "Which source?" }] };
    if (command === "ask_question") return question;
    if (command === "answer_question") return { ...question, status: "answered" };
    throw new Error(`Unexpected command: ${command}`);
  });
  render(<ConversationView {...props} />);
  write();
  fireEvent.click(sharpen());
  await screen.findByText("Eine Rückfrage wartet.", { exact: false });
  expect(sharpen()).toBeDisabled();
  expect(sharpen()).not.toHaveAttribute("aria-busy");
  expect(screen.getByRole("status")).toHaveTextContent("Wartet auf dich …");
  fireEvent.click(screen.getByRole("button", { name: "→ Rückfragen öffnen" }));
  expect(props.onOpenQuestions).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Schärfung abbrechen" }));
  expect(invoke).toHaveBeenCalledWith("answer_question", {
    id: "q-1", answer: "abgebrochen — die Prompt-Schärfung wurde beendet",
  });
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "answer_question")).toHaveLength(1);
  expect(input()).toHaveValue("original draft");
  expect(sharpen()).toBeEnabled();
  expect(chat.send).not.toHaveBeenCalled();
});

it("announces the final call after the actual open questions are answered", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let finish!: (value: unknown) => void;
  let calls = 0;
  let rows = 0;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "enhance_prompt") {
      if (++calls === 2) return new Promise((resolve) => { finish = resolve; });
      return { enhanced: null, questions: [{ question: "Which source?" }, { question: "Which format?" }] };
    }
    if (command === "ask_question") return { ...question, id: `q-${++rows}` };
    if (command === "list_questions") return [1, 2].map((id) => ({
      ...question, id: `q-${id}`, status: "answered", answer: "literal answer", answeredBy: "human",
    }));
    throw new Error(`Unexpected command: ${command}`);
  });
  render(<ConversationView {...props} />);
  write();
  fireEvent.click(sharpen());
  await screen.findByText("2 Rückfragen warten.", { exact: false });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(invoke).toHaveBeenCalledWith("list_questions", { projectId: "project-a", status: undefined });
  expect(sharpen()).toBeDisabled();
  expect(sharpen()).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Baut Prompt …");
  await act(async () => finish({ enhanced: "literal final draft", questions: [] }));
  expect(input()).toHaveValue("literal final draft");
  expect(chat.send).not.toHaveBeenCalled();
});

it("retains the editable draft and error after the first call refuses", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("literal refusal"));
  render(<ConversationView {...props} />);
  write();
  fireEvent.click(sharpen());
  expect(await screen.findByRole("alert")).toHaveTextContent("literal refusal");
  expect(input()).toHaveValue("original draft");
  expect(input()).toBeEnabled();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(chat.send).not.toHaveBeenCalled();
});

it.each([
  ["", "project-a", false, false], ["   ", "project-a", false, false],
  ["draft", null, false, false], ["draft", "project-a", true, false],
  ["draft", "project-a", false, true],
])("does not invoke enhancement for draft=%s project=%s disabled=%s sending=%s", (draft, projectId, disabled, sending) => {
  render(<ConversationView {...props} projectId={projectId} chat={{ ...chat, disabled, sending }} />);
  fireEvent.change(input(), { target: { value: draft } });
  fireEvent.click(sharpen());
  expect(invoke).not.toHaveBeenCalled();
  expect(chat.send).not.toHaveBeenCalled();
});
