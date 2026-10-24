import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("shows the stored answer rather than the submitted text", async () => {
    const rows = [row];
    backend(rows, ({ id }) => {
      rows.length = 0;
      return { ...row, id, status: "answered", answer: "Stored answer", answeredBy: "human" };
    });
    render(<Harness />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Antwort" }), { target: { value: "Yes, only that" } });
    fireEvent.click(send());
    await screen.findByText("Beantwortet: Stored answer");
    expect(screen.queryByText(/Beantwortet: Yes, only that/)).toBeNull();
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
    expect(screen.queryByRole("list", { name: "Verlauf" })).toBeNull();
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

  it("unlocks for a second answer without fabricating unreadable history", async () => {
    // The core returns a row nobody can read; the card stays until the next poll.
    backend([row], () => ({}));
    render(<Harness />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Antwort" }), { target: { value: "first" } });
    fireEvent.click(send());
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("answer_question", { id: "q-1", answer: "first" }));
    await waitFor(() => expect(field()).toBeEnabled());
    fireEvent.change(field(), { target: { value: "second" } });
    expect(send()).toBeEnabled();
    fireEvent.click(send());
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("answer_question", { id: "q-1", answer: "second" }));
    await waitFor(() => expect(field()).toBeEnabled());
    expect(screen.queryByText(/Beantwortet:/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Verlauf" })).toBeNull();
    expect(mocks.invoke.mock.calls.filter(([cmd]) => cmd === "answer_question")).toHaveLength(2);
  });

  it("loads the latest 50 persisted questions on fetch and remount", async () => {
    const rows = Array.from({ length: 52 }, (_, n) => ({
      ...row, id: `q-${n}`, question: `Stored question ${n}?`, status: "answered", answer: `Stored answer ${n}`,
    }));
    backend(rows, () => { throw new Error("must not answer to read history"); });
    const first = render(<Harness />);
    const history = within(await screen.findByRole("list", { name: "Verlauf" }));
    const items = history.getAllByRole("listitem");
    expect(items).toHaveLength(50);
    expect(items[0]).toHaveTextContent("Stored question 51?");
    expect(items[0]).toHaveTextContent("Beantwortet: Stored answer 51");
    expect(items[49]).toHaveTextContent("Stored question 2?");
    expect(items[49]).toHaveTextContent("Beantwortet: Stored answer 2");
    expect(history.queryByText("Stored question 1?")).toBeNull();
    expect(history.queryByText("Stored question 0?")).toBeNull();
    first.unmount();
    render(<Harness />);
    const restored = within(await screen.findByRole("list", { name: "Verlauf" }));
    expect(restored.getAllByRole("listitem")).toHaveLength(50);
    expect(restored.getAllByRole("listitem")[0]).toHaveTextContent("Stored question 51?");
    expect(restored.getAllByRole("listitem")[49]).toHaveTextContent("Stored question 2?");
    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd)).toEqual(["list_questions", "list_questions"]);
  });

  it("preserves closed status attribution timestamps and stored context", async () => {
    backend([
      { ...row, id: "human", question: "Human question?", status: "answered", answer: "Approved", answeredBy: "human", answeredAt: 60 },
      { ...row, id: "api", question: "API question?", status: "answered", answer: "API answer", answeredBy: "unverified", answeredAt: 0 },
      { ...row, id: "expired", question: "Expired question?", status: "expired", answer: "Timeout answer", answeredBy: null, answeredAt: 120, projectId: "removed-project", workerId: "archived-worker" },
      { ...row, id: "refused", question: "Refused question?", status: "refused", answer: null, answeredBy: null, scope: "preflight", workerId: null, projectId: "" },
      { ...row, id: "missing", question: "Missing attribution?", status: "answered", answer: "", workerId: null },
    ], () => null);
    render(<Harness />);
    const history = within(await screen.findByRole("list", { name: "Verlauf" }));
    const items = history.getAllByRole("listitem");
    const human = items[4];
    expect(human).toHaveTextContent("Human question?");
    expect(human).toHaveTextContent("Beantwortet: Approved");
    expect(human).toHaveTextContent("von einem Menschen beantwortet");
    expect(human).toHaveTextContent("Projekt: p-1");
    expect(human).toHaveTextContent("Agent: w-1");
    expect(human).toHaveTextContent("Geschlossen:");
    expect(human.querySelector("time")).toHaveAttribute("dateTime", "1970-01-01T00:01:00.000Z");
    expect(items[3]).toHaveTextContent("Beantwortet: API answer");
    expect(items[3]).toHaveTextContent("beantwortet, Herkunft ungeprüft");
    expect(items[3].querySelector("time")).toHaveAttribute("dateTime", "1970-01-01T00:00:00.000Z");
    expect(items[2]).toHaveTextContent("Abgelaufen: Timeout answer");
    expect(items[2]).toHaveTextContent("niemand hat entschieden");
    expect(items[2]).toHaveTextContent("Projekt: removed-project");
    expect(items[2]).toHaveTextContent("Agent: archived-worker");
    expect(items[1]).toHaveTextContent("Abgewiesen: Keine Antwort gespeichert");
    expect(items[1]).toHaveTextContent("niemand hat entschieden");
    expect(items[1]).toHaveTextContent("Vorabfrage, noch kein Agent");
    expect(items[1]).toHaveTextContent("Projekt: Unbekannt");
    expect(items[1]).toHaveTextContent("Erstellt:");
    expect(items[1].querySelector("time")).toHaveAttribute("dateTime", "1970-01-01T00:00:01.000Z");
    expect(items[0]).toHaveTextContent("Beantwortet: Keine Antwort gespeichert");
    expect(items[0]).toHaveTextContent("niemand hat entschieden");
    expect(items[0]).toHaveTextContent("Agent: Unbekannt");
    expect(history.queryByText("tester/red-first")).toBeNull();
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

  it("says nothing is open exactly once", async () => {
    backend([], () => null);
    render(<Harness />);
    await screen.findByText("Nichts offen");
    expect(screen.getAllByText(/nichts offen/i)).toHaveLength(1);
    expect(screen.queryByText("Keine offene Entscheidung.")).toBeNull();
  });

  it("shows the money one-liner while no money question is open", async () => {
    backend([], () => null);
    const { container } = render(<Harness />);
    expect(await screen.findByText("Nichts offen")).toBeInTheDocument();
    expect(screen.getByText("Geld ausgeben braucht deine Freigabe.")).toBeInTheDocument();
    expect(screen.getByText("Installieren braucht deine Freigabe.")).toBeInTheDocument();
    expect(screen.getByText("Löschen braucht deine Freigabe.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("answers a delete question from its own row", async () => {
    const del = { ...row, id: "q-del", question: "Darf ich die Datei löschen?", optionsJson: "[]" };
    backend([del], ({ id, answer }) => ({ ...del, id, status: "answered", answer }));
    render(<Harness />);
    const lane = within(await screen.findByRole("region", { name: "Löschen" }));
    expect(lane.getByText("Darf ich die Datei löschen?")).toBeInTheDocument();
    expect(screen.getAllByText("Darf ich die Datei löschen?")).toHaveLength(1);
    fireEvent.change(lane.getByRole("textbox", { name: "Antwort" }), { target: { value: "Ja" } });
    fireEvent.click(lane.getByRole("button", { name: "Antworten" }));
    await screen.findByText("Beantwortet: Ja");
    expect(mocks.invoke).toHaveBeenCalledWith("answer_question", { id: "q-del", answer: "Ja" });
  });

  it("keeps a question that matches no row in the list", async () => {
    backend([row], () => null);
    render(<Harness />);
    expect(await screen.findByRole("list", { name: "Braucht dich" })).toContainElement(screen.getByText("Cover only this case?"));
    expect(screen.getAllByText("Keine offene Entscheidung.")).toHaveLength(3);
  });

  it("says it is not connected when the list cannot be read", async () => {
    mocks.invoke.mockRejectedValue(new Error("core unreachable"));
    render(<Harness />);
    expect(await screen.findByText("Nicht verbunden")).toBeInTheDocument();
  });

  it("shows no decision lane claiming nothing is open while the list cannot be read", async () => {
    mocks.invoke.mockRejectedValue(new Error("core unreachable"));
    render(<Harness />);
    expect(await screen.findByText("Nicht verbunden")).toBeInTheDocument();
    expect(screen.queryAllByText("Keine offene Entscheidung.")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Löschen" })).toBeNull();
  });

  it("claims nothing open only after the list was read", async () => {
    mocks.invoke.mockRejectedValue(new Error("core unreachable"));
    const failed = render(<Harness />);
    expect(await screen.findByText("Nicht verbunden")).toBeInTheDocument();
    expect(screen.queryByText("Nichts offen")).toBeNull();
    failed.unmount();

    let read: (rows: unknown[]) => void = () => {};
    mocks.invoke.mockImplementation(() => new Promise((resolve) => (read = resolve)));
    render(<Harness />);
    expect(screen.getByText("Fragen werden gelesen …")).toBeInTheDocument();
    expect(screen.queryByText("Nichts offen")).toBeNull();
    await act(async () => read([]));
    expect(screen.getByText("Nichts offen")).toBeInTheDocument();
  });

  it("shows no decision lane claiming nothing is open while the list is loading", () => {
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    render(<Harness />);
    expect(screen.getByText("Fragen werden gelesen …")).toBeInTheDocument();
    expect(screen.queryAllByText("Keine offene Entscheidung.")).toHaveLength(0);
  });
});
