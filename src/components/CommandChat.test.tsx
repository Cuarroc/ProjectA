import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OrchestratorChat } from "../lib/orchestratorChat";
import CommandChat from "./CommandChat";

function makeChat(overrides: Partial<OrchestratorChat> = {}): OrchestratorChat {
  return {
    orchestratorId: null,
    messages: [],
    loading: false,
    sending: false,
    error: null,
    disabled: false,
    send: vi.fn(async () => true),
    clearError: vi.fn(),
    ...overrides,
  };
}

/**
 * KI-3: a draft typed into the command bar survived a project switch and
 * would go to the new project's orchestrator on the next Enter.
 * `ConversationView` already discards its draft on a project switch (via
 * `key={activeProjectId}` in `App.tsx`); `CommandChat` did not.
 */
describe("CommandChat und der Projektwechsel (KI-3)", () => {
  it("verwirft den ungesendeten Entwurf, wenn die projectId wechselt", () => {
    const { rerender } = render(
      <CommandChat
        chat={makeChat()}
        projectId="project-a"
        onOpenConversation={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Aufgabe an den Orchestrator");
    fireEvent.change(input, { target: { value: "geheimer Entwurf für Projekt A" } });
    expect(input).toHaveValue("geheimer Entwurf für Projekt A");

    rerender(
      <CommandChat
        chat={makeChat()}
        projectId="project-b"
        onOpenConversation={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue("");
  });

  // Review W1-09 Runde 3 (deepseek-v4-flash P5): leaving every project is a
  // switch too - the draft must not wait in the box for the next one.
  it("verwirft den ungesendeten Entwurf, wenn die projectId auf null wechselt", () => {
    const { rerender } = render(
      <CommandChat chat={makeChat()} projectId="project-a" onOpenConversation={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Aufgabe an den Orchestrator"), {
      target: { value: "Entwurf für Projekt A" },
    });

    rerender(
      <CommandChat
        chat={makeChat({ disabled: true })}
        projectId={null}
        onOpenConversation={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue("");
  });

  it("behält den Entwurf, solange dieselbe projectId aktiv bleibt", () => {
    const chat = makeChat();
    const { rerender } = render(
      <CommandChat chat={chat} projectId="project-a" onOpenConversation={vi.fn()} />,
    );

    const input = screen.getByLabelText("Aufgabe an den Orchestrator");
    fireEvent.change(input, { target: { value: "noch nicht abgeschickt" } });

    // A re-render with the same projectId (e.g. a chat poll landing) must not
    // wipe what the user is mid-typing.
    rerender(<CommandChat chat={chat} projectId="project-a" onOpenConversation={vi.fn()} />);

    expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue(
      "noch nicht abgeschickt",
    );
  });

  // Review W1-09 (kimi-k3 B5): a send still in flight when the project
  // switches resolved later and cleared the box unconditionally, so it wiped
  // the draft already typed for the new project.
  it("ein spaet bestaetigtes Senden loescht keinen neuen Entwurf", async () => {
    let resolveSend: (sent: boolean) => void = () => {};
    const chat = makeChat({
      send: vi.fn(() => new Promise<boolean>((resolve) => { resolveSend = resolve; })),
    });
    const { rerender } = render(
      <CommandChat chat={chat} projectId="project-a" onOpenConversation={vi.fn()} />,
    );

    const input = screen.getByLabelText("Aufgabe an den Orchestrator");
    fireEvent.change(input, { target: { value: "Auftrag für A" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // The send really is in flight; otherwise the race is never run and the
    // assertion below holds for nothing (Review W1-09b, kimi-k3 P2).
    expect(chat.send).toHaveBeenCalledWith("Auftrag für A");

    rerender(<CommandChat chat={chat} projectId="project-b" onOpenConversation={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Aufgabe an den Orchestrator"), {
      target: { value: "Entwurf für B" },
    });

    await act(async () => {
      resolveSend(true);
    });

    expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue("Entwurf für B");
  });

  // Review W1-09 Runde 3 (kimi-k2.6 P2/P3, deepseek-v4-flash P2): the guard
  // above compared only the text, so a new draft that happens to read exactly
  // like the one still in flight was taken for it and wiped.
  it("ein spaet bestaetigtes Senden loescht auch einen gleichlautenden neuen Entwurf nicht", async () => {
    let resolveSend: (sent: boolean) => void = () => {};
    const chat = makeChat({
      send: vi.fn(() => new Promise<boolean>((resolve) => { resolveSend = resolve; })),
    });
    const { rerender } = render(
      <CommandChat chat={chat} projectId="project-a" onOpenConversation={vi.fn()} />,
    );

    const input = screen.getByLabelText("Aufgabe an den Orchestrator");
    fireEvent.change(input, { target: { value: "Tests fixen" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // The send really is in flight; otherwise the race is never run and the
    // assertion below holds for nothing (Review W1-09b, kimi-k3 P2).
    expect(chat.send).toHaveBeenCalledWith("Tests fixen");

    rerender(<CommandChat chat={chat} projectId="project-b" onOpenConversation={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Aufgabe an den Orchestrator"), {
      target: { value: "Tests fixen" },
    });

    await act(async () => {
      resolveSend(true);
    });

    expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue("Tests fixen");
  });
});
