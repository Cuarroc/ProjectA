import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrchestratorChat } from "../../../lib/orchestratorChat";
import type { WorkerMessage } from "../../../types";
import { VerlaufChat } from "./VerlaufChat";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const msg = (id: string, role: WorkerMessage["role"], content: string): WorkerMessage => ({
  id, workerId: "w-1", role, content, createdAt: 1_700_000_000,
});

function chatWith(patch: Partial<OrchestratorChat> = {}): OrchestratorChat {
  return {
    orchestratorId: "w-1", messages: [], loading: false, sending: false, error: null, disabled: false,
    send: vi.fn(async () => true), clearError: vi.fn(), ...patch,
  };
}

const box = () => screen.getByRole("textbox", { name: "Nachricht an den Orchestrator" });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

describe("VerlaufChat", () => {
  beforeEach(() => mocks.invoke.mockReset());

  it("renders the messages of the chat object with their speaker", () => {
    const chat = chatWith({ messages: [msg("1", "user", "Fix the bug"), msg("2", "agent", "On it")] });
    render(<VerlaufChat chat={chat} projectId="p-1" />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("Fix the bug")).toBeInTheDocument();
    expect(screen.getByText("Orchestrator")).toBeInTheDocument();
  });

  it("sends the typed text through chat.send and clears the box", async () => {
    const chat = chatWith();
    render(<VerlaufChat chat={chat} projectId="p-1" />);
    type("Ship it");
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(box()).toHaveValue(""));
    expect(chat.send).toHaveBeenCalledWith("Ship it");
  });

  it("keeps the draft when the send did not go out", async () => {
    const chat = chatWith({ send: vi.fn(async () => false) });
    render(<VerlaufChat chat={chat} projectId="p-1" />);
    type("Ship it");
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(chat.send).toHaveBeenCalled());
    expect(box()).toHaveValue("Ship it");
  });

  it("sends on Enter but not while Shift is held", () => {
    const chat = chatWith();
    render(<VerlaufChat chat={chat} projectId="p-1" />);
    type("Line");
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(chat.send).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chat.send).toHaveBeenCalledWith("Line");
  });

  it("disables send when the box is empty or while sending or without a project", () => {
    const { rerender } = render(<VerlaufChat chat={chatWith()} projectId="p-1" />);
    expect(screen.getByRole("button", { name: "Senden" })).toBeDisabled();
    rerender(<VerlaufChat chat={chatWith({ sending: true })} projectId="p-1" />);
    type("Text");
    expect(screen.getByRole("button", { name: "Sendet …" })).toBeDisabled();
    rerender(<VerlaufChat chat={chatWith({ disabled: true })} projectId={null} />);
    expect(box()).toBeDisabled();
    expect(screen.getByText("Kein Projekt aktiv")).toBeInTheDocument();
  });

  it("shows an honest empty state and a loading note while the history is read", () => {
    const { rerender } = render(<VerlaufChat chat={chatWith({ loading: true })} projectId="p-1" />);
    expect(screen.getByText("Verlauf wird geladen …")).toBeInTheDocument();
    expect(screen.queryByText("Noch keine Nachrichten")).toBeNull();
    rerender(<VerlaufChat chat={chatWith()} projectId="p-1" />);
    expect(screen.getByText("Noch keine Nachrichten")).toBeInTheDocument();
  });

  it("shows the error as a German honest state that can be hidden", () => {
    const chat = chatWith({ error: "Der Verlauf kam unvollständig an." });
    render(<VerlaufChat chat={chat} projectId="p-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Das hat nicht geklappt");
    expect(screen.getByText("Der Verlauf kam unvollständig an.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ausblenden" }));
    expect(chat.clearError).toHaveBeenCalled();
  });

  it("drops an unsent draft when another project is shown", () => {
    const { rerender } = render(<VerlaufChat chat={chatWith()} projectId="p-1" />);
    type("For project one");
    rerender(<VerlaufChat chat={chatWith()} projectId="p-2" />);
    expect(box()).toHaveValue("");
  });

  it("calls no IPC itself and sends only through the chat object", async () => {
    const chat = chatWith({ messages: [msg("1", "user", "Hi")] });
    render(<VerlaufChat chat={chat} projectId="p-1" />);
    type("Hello");
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(chat.send).toHaveBeenCalled());
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("shows message times as German 24-hour clock without AM/PM", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 16, 0));
    try {
      const times = [new Date(2026, 9, 2, 14, 5), new Date(2026, 0, 3, 0, 5)];
      const messages = times.map((at, i) => ({
        ...msg(String(i), "agent", "On it"), createdAt: at.getTime() / 1000,
      }));
      render(<VerlaufChat chat={chatWith({ messages })} projectId="p-1" />);
      expect(screen.getByText("14:05", { exact: true })).toBeInTheDocument();
      expect(screen.getByText("03.01. 00:05", { exact: true })).toBeInTheDocument();
      for (const article of screen.getAllByRole("article")) {
        expect(article.textContent).not.toMatch(/AM|PM/i);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends once when Enter is pressed twice before the parent reports sending", () => {
    const chat = chatWith({ send: vi.fn(() => new Promise<boolean>(() => {})) });
    render(<VerlaufChat chat={chat} projectId="p-1" />);
    type("Ship it");
    fireEvent.keyDown(box(), { key: "Enter" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chat.send).toHaveBeenCalledTimes(1);
  });

  it("lets the user send again after a send that did not go out", async () => {
    const chat = chatWith({ send: vi.fn(async () => false) });
    render(<VerlaufChat chat={chat} projectId="p-1" />);
    type("Ship it");
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(2));
  });

  it("follows a streamed append to the last message while the user is at the bottom", () => {
    const first = chatWith({ messages: [msg("1", "agent", "Working")] });
    const { rerender } = render(<VerlaufChat chat={first} projectId="p-1" />);
    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 500 });
    expect(log.scrollTop).toBe(0);
    rerender(<VerlaufChat chat={chatWith({ messages: [msg("1", "agent", "Working on it, still going")] })} projectId="p-1" />);
    expect(log.scrollTop).toBe(500);
  });
});
