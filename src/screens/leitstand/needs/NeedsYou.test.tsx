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

  it("sends an offered option as the answer without touching the draft", async () => {
    backend([row], ({ id, answer }) => ({ ...row, id, status: "answered", answer }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Only this case" }));
    await screen.findByText(/Beantwortet: Only this case/);
    expect(mocks.invoke).toHaveBeenCalledWith("answer_question", { id: "q-1", answer: "Only this case" });
    expect(mocks.invoke.mock.calls.filter(([cmd]) => cmd === "answer_question")).toHaveLength(1);
  });

  it("disables the option buttons while an option answer is pending", async () => {
    let finish: (v: unknown) => void = () => {};
    backend([row], () => new Promise((resolve) => (finish = resolve)));
    render(<Harness />);
    const option = await screen.findByRole("button", { name: "Only this case" });
    fireEvent.click(option);
    await waitFor(() => expect(option).toBeDisabled());
    fireEvent.click(option);
    expect(mocks.invoke.mock.calls.filter(([cmd]) => cmd === "answer_question")).toHaveLength(1);
    finish({ ...row, status: "answered", answer: "Only this case" });
    await screen.findByText(/Beantwortet: Only this case/);
  });

  it("unlocks the inputs when an answer succeeds but the question stays open", async () => {
    // The core returns a row nobody can read; the card stays until the next poll.
    backend([row], () => ({}));
    render(<Harness />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Antwort" }), { target: { value: "first" } });
    fireEvent.click(send());
    await screen.findByText(/Beantwortet: first/);
    await waitFor(() => expect(field()).toBeEnabled());
    fireEvent.change(field(), { target: { value: "second" } });
    expect(send()).toBeEnabled();
    fireEvent.click(send());
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("answer_question", { id: "q-1", answer: "second" }));
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(2));
  });

  it("keeps only the 20 newest answered lines", async () => {
    const rows = Array.from({ length: 25 }, (_, n) => ({ ...row, id: `q-${n}`, optionsJson: `["a${n}"]` }));
    backend(rows, ({ id, answer }) => {
      const at = rows.findIndex((r) => r.id === id);
      rows.splice(at, 1);
      return { ...row, id, status: "answered", answer };
    });
    render(<Harness />);
    for (let n = 0; n < 25; n++) {
      fireEvent.click(await screen.findByRole("button", { name: `a${n}` }));
      await screen.findByText(`Beantwortet: a${n}`);
    }
    const lines = screen.getAllByRole("status");
    expect(lines).toHaveLength(20);
    expect(lines[0]).toHaveTextContent("Beantwortet: a24");
    expect(lines[19]).toHaveTextContent("Beantwortet: a5");
  });

  it("renders every option button when the asker offers the same option twice", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    backend([{ ...row, optionsJson: '["Yes","Yes"]' }], () => null);
    render(<Harness />);
    expect(await screen.findAllByRole("button", { name: "Yes" })).toHaveLength(2);
    expect(spy.mock.calls.filter(([msg]) => String(msg).includes("same key"))).toHaveLength(0);
    spy.mockRestore();
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
