import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { OrchestratorChat } from "../lib/orchestratorChat";
import CommandChat from "./CommandChat";

it("keeps sending named and announces errors without changing the submitted draft", async () => {
  let respond: (accepted: boolean) => void = () => {};
  const send = vi.fn(() => new Promise<boolean>((resolve) => { respond = resolve; }));
  const clearError = vi.fn();
  const reload = vi.fn();
  const openConversation = vi.fn();
  const chat: OrchestratorChat = {
    orchestratorId: null,
    messages: [],
    loading: false,
    sending: false,
    error: null,
    disabled: false,
    send,
    clearError,
    reload,
  };
  const { rerender } = render(
    <CommandChat chat={chat} projectId="project-a" onOpenConversation={openConversation} />,
  );
  const input = screen.getByRole("textbox", { name: "Aufgabe an den Orchestrator" });
  const submit = screen.getByRole("button", { name: "Senden" });
  expect(input).toHaveAttribute("name", "command-chat-input");
  expect(input).toHaveAttribute("rows", "2");
  expect(submit).toBeDisabled();
  expect(send).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "  \n " } });
  expect(submit).toBeDisabled();
  fireEvent.click(submit);
  expect(send).not.toHaveBeenCalled();

  const draft = "  Prüfe die Aufgabe\nmit Kontext  ";
  fireEvent.change(input, { target: { value: draft } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(send).not.toHaveBeenCalled();
  expect(input).toHaveValue(draft);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(send).toHaveBeenCalledExactlyOnceWith(draft);
  rerender(
    <CommandChat chat={{ ...chat, sending: true }} projectId="project-a" onOpenConversation={openConversation} />,
  );
  expect.soft(screen.queryByRole("button", { name: "Senden" })).toBe(submit);
  expect(submit).toBeDisabled();
  expect(input).toBeDisabled();
  expect(input).toHaveValue(draft);
  fireEvent.click(submit);
  expect(send).toHaveBeenCalledTimes(1);
  rerender(
    <CommandChat chat={{ ...chat, error: "Aufgabe wurde nicht angenommen." }} projectId="project-a" onOpenConversation={openConversation} />,
  );
  await act(async () => { respond(false); });
  expect.soft(screen.queryByRole("alert")).toHaveTextContent("Aufgabe wurde nicht angenommen.");
  expect(input).toHaveValue(draft);
  expect(input).toHaveFocus();
  const history = screen.getByRole("button", { name: /Verlauf/ });
  expect(history).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(history);
  expect(history).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Noch keine Nachrichten. Schick dem Orchestrator eine Aufgabe.")).toBeVisible();
  expect.soft(screen.queryByRole("alert")).toHaveTextContent("Aufgabe wurde nicht angenommen.");
  expect(clearError).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Im Dialog öffnen" }));
  expect(openConversation).toHaveBeenCalledTimes(1);

  fireEvent.click(submit);
  expect(send).toHaveBeenNthCalledWith(2, draft);
  await act(async () => { respond(true); });
  expect(input).toHaveValue("");
  expect(input).toHaveFocus();
  rerender(<CommandChat chat={chat} projectId="project-a" onOpenConversation={openConversation} />);
  fireEvent.change(input, { target: { value: "Gleicher Entwurf" } });
  fireEvent.click(submit);
  expect(send).toHaveBeenNthCalledWith(3, "Gleicher Entwurf");
  rerender(<CommandChat chat={chat} projectId="project-b" onOpenConversation={openConversation} />);
  expect(input).toHaveValue("");
  expect(send).toHaveBeenCalledTimes(3);
  fireEvent.change(input, { target: { value: "Gleicher Entwurf" } });
  await act(async () => { respond(true); });
  expect(input).toHaveValue("Gleicher Entwurf");

  rerender(
    <CommandChat chat={{ ...chat, disabled: true }} projectId={null} onOpenConversation={openConversation} />,
  );
  expect(input).toHaveValue("");
  expect(input).toBeDisabled();
  expect(submit).toBeDisabled();
  expect(history).toBeDisabled();
  fireEvent.click(submit);
  expect(send).toHaveBeenCalledTimes(3);
});
