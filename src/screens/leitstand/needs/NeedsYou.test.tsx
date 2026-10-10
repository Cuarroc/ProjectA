import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestions } from "../../../lib/useQuestions";
import type { Worker } from "../../../types";
import { NeedsYou } from "./NeedsYou";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const workers = [{ id: "w-1", branch: "tester/red-first", task: "Fix the start block" }] as Worker[];
const row = { id: "q-1", projectId: "p-1", workerId: "w-1", scope: "worker", question: "Cover only this case?", optionsJson: '["Only this case"]', status: "open", answer: null, createdAt: 1, expiresAt: null };

function Harness() {
  return <NeedsYou questions={useQuestions("p-1", true)} workers={workers} />;
}

/** list_questions answers from `rows`; answer_question is `onAnswer`. */
function backend(rows: unknown[], onAnswer: (args: { id: string; answer: string }) => unknown) {
  mocks.invoke.mockImplementation(async (cmd: string, args: { id: string; answer: string }) => {
    if (cmd === "list_questions") return rows;
    if (cmd === "answer_question") return onAnswer(args);
    throw new Error(`unexpected ${cmd}`);
  });
}

const send = () => screen.getByRole("button", { name: "Antworten" });
const field = () => screen.getByRole("textbox", { name: "Antwort" });

describe("NeedsYou", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("answers through answer_question with the question id and text and lists it as answered", async () => {
    const rows = [row];
    backend(rows, ({ id, answer }) => {
      rows.length = 0;
      return { ...row, id, status: "answered", answer, answeredBy: "human" };
    });
    render(<Harness />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Antwort" }), { target: { value: "Yes, only that" } });
    fireEvent.click(send());
    await screen.findByText(/Beantwortet: Yes, only that/);
    expect(mocks.invoke).toHaveBeenCalledWith("answer_question", { id: "q-1", answer: "Yes, only that" });
    expect(screen.queryByRole("textbox", { name: "Antwort" })).toBeNull();
    expect(screen.getByText("Nichts offen")).toBeInTheDocument();
  });

  it("shows the error in words and keeps the item when answering fails", async () => {
    backend([row], () => {
      throw new Error("terminal refused the write");
    });
    render(<Harness />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Antwort" }), { target: { value: "ok" } });
    fireEvent.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("terminal refused the write");
    expect(field()).toHaveValue("ok");
    expect(send()).toBeEnabled();
  });

  it("disables send while the answer is pending", async () => {
    let finish: (v: unknown) => void = () => {};
    backend([row], () => new Promise((resolve) => (finish = resolve)));
    render(<Harness />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Antwort" }), { target: { value: "ok" } });
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByRole("button", { name: "Sendet …" })).toBeDisabled());
    finish({ ...row, status: "answered", answer: "ok" });
    await screen.findByText(/Beantwortet: ok/);
  });

  it("sends on Enter in the single-line field and clears it on Escape", async () => {
    backend([row], ({ id, answer }) => ({ ...row, id, status: "answered", answer }));
    render(<Harness />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Antwort" }), { target: { value: "draft" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field()).toHaveValue("");
    fireEvent.change(field(), { target: { value: "final" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await screen.findByText(/Beantwortet: final/);
    expect(mocks.invoke).toHaveBeenCalledWith("answer_question", { id: "q-1", answer: "final" });
  });

  it("shows an honest empty state without digits when nothing is open", async () => {
    backend([], () => null);
    const { container } = render(<Harness />);
    expect(await screen.findByText("Nichts offen")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("says it is not connected when the list cannot be read", async () => {
    mocks.invoke.mockRejectedValue(new Error("core unreachable"));
    render(<Harness />);
    expect(await screen.findByText("Nicht verbunden")).toBeInTheDocument();
  });
});
