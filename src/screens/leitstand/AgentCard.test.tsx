import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { archiveWorker, respawnWorker } from "../../lib/ipc";
import type { BoardCard, Worker } from "../../types";
import { AgentCard } from "./AgentCard";

vi.mock("../../lib/ipc", () => ({ respawnWorker: vi.fn(), archiveWorker: vi.fn() }));

const NOW = 1_760_000_000;
const card = (status: Worker["status"]) =>
  ({
    worker: { id: "w1", projectId: "p1", task: "Task w1", profileId: "claude", branch: "claude/w1", worktreePath: "wt", sessionId: null, status, createdAt: NOW },
    column: "working",
  }) as unknown as BoardCard;
const view = (status: Worker["status"], onChanged = vi.fn()) => {
  render(<AgentCard card={card(status)} name="Claude Code" now={NOW} onOpen={() => {}} onChanged={onChanged} />);
  return onChanged;
};
/** A call that stays pending until the test settles it. */
const pending = <T,>() => {
  let settle!: { resolve: (v: T) => void; reject: (e: unknown) => void };
  const promise = new Promise<T>((resolve, reject) => (settle = { resolve, reject }));
  return { promise, ...settle };
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("restart calls respawnWorker with the card's worker id and refreshes the board", async () => {
  vi.mocked(respawnWorker).mockResolvedValue({} as Worker);
  const onChanged = view("exited");
  fireEvent.click(screen.getByRole("button", { name: "Claude Code neu starten" }));
  expect(respawnWorker).toHaveBeenCalledWith("w1");
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

it("archive asks inline first and only the confirmation calls archiveWorker", async () => {
  vi.mocked(archiveWorker).mockResolvedValue({} as Worker);
  const onChanged = view("running");
  fireEvent.click(screen.getByRole("button", { name: "Claude Code archivieren" }));
  expect(archiveWorker).not.toHaveBeenCalled();
  expect(screen.getByText(/Der Arbeitsbaum bleibt/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
  expect(screen.queryByText(/Der Arbeitsbaum bleibt/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Claude Code archivieren" }));
  fireEvent.click(screen.getByRole("button", { name: "Ja, endgültig archivieren" }));
  expect(archiveWorker).toHaveBeenCalledWith("w1");
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

it("buttons are disabled with a busy label while a call runs", async () => {
  const call = pending<Worker>();
  vi.mocked(respawnWorker).mockReturnValue(call.promise);
  view("exited");
  fireEvent.click(screen.getByRole("button", { name: "Claude Code neu starten" }));
  const busy = await screen.findByRole("button", { name: /Startet/ });
  expect(busy).toBeDisabled();
  expect(screen.getByRole("button", { name: "Claude Code öffnen" })).toBeEnabled();
  fireEvent.click(busy);
  expect(respawnWorker).toHaveBeenCalledTimes(1);
  call.resolve({} as Worker);
  await waitFor(() => expect(screen.getByRole("button", { name: "Claude Code neu starten" })).toBeEnabled());
});

it("a rejected call shows a German sentence in the card and the button works again", async () => {
  vi.mocked(archiveWorker).mockRejectedValue(new Error("boom"));
  const onChanged = view("running");
  fireEvent.click(screen.getByRole("button", { name: "Claude Code archivieren" }));
  fireEvent.click(screen.getByRole("button", { name: "Ja, endgültig archivieren" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Archivieren hat nicht geklappt. Bitte noch einmal versuchen.");
  expect(screen.getByRole("alert")).not.toHaveTextContent("boom");
  expect(onChanged).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Claude Code archivieren" })).toBeEnabled();
});

it("a restart error says restart and not archive", async () => {
  vi.mocked(respawnWorker).mockRejectedValue(new Error("boom"));
  view("exited");
  fireEvent.click(screen.getByRole("button", { name: "Claude Code neu starten" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Neu starten hat nicht geklappt. Bitte noch einmal versuchen.");
});

it("offers only the action the old worker list allows for the state", () => {
  const names = (status: Worker["status"]) => {
    cleanup();
    view(status);
    return screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
  };
  expect(names("running")).toEqual(["Claude Code öffnen", "Claude Code archivieren"]);
  expect(names("exited")).toEqual(["Claude Code öffnen", "Claude Code neu starten"]);
  expect(names("archived")).toEqual(["Claude Code öffnen"]);
});
