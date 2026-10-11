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

const withModel = (observedModel?: string | null) => {
  render(<AgentCard card={{ ...card("running"), observedModel }} name="Claude Code" now={NOW} onOpen={() => {}} />);
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
  const busy = await screen.findByRole("button", { name: "Claude Code neu starten" });
  expect(busy).toBeDisabled();
  expect(busy).toHaveTextContent(/Startet/);
  expect(screen.getByRole("button", { name: "Claude Code öffnen" })).toBeEnabled();
  fireEvent.click(busy);
  expect(respawnWorker).toHaveBeenCalledTimes(1);
  call.resolve({} as Worker);
  await waitFor(() => expect(screen.getByRole("button", { name: "Claude Code neu starten" })).toBeEnabled());
});

it("a busy button keeps its accessible name and sets aria-busy", async () => {
  const call = pending<Worker>();
  vi.mocked(archiveWorker).mockReturnValue(call.promise);
  view("running");
  const idle = screen.getByRole("button", { name: "Claude Code archivieren" });
  expect(idle).not.toHaveAttribute("aria-busy");
  fireEvent.click(idle);
  fireEvent.click(screen.getByRole("button", { name: "Ja, endgültig archivieren" }));
  const busy = await screen.findByRole("button", { name: "Claude Code archivieren" });
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy).toBeDisabled();
  call.resolve({} as Worker);
  await waitFor(() => expect(screen.getByRole("button", { name: "Claude Code archivieren" })).not.toHaveAttribute("aria-busy"));
});

it("reopening the archive confirmation clears the previous error", async () => {
  vi.mocked(archiveWorker).mockRejectedValue(new Error("boom"));
  view("running");
  fireEvent.click(screen.getByRole("button", { name: "Claude Code archivieren" }));
  fireEvent.click(screen.getByRole("button", { name: "Ja, endgültig archivieren" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Claude Code archivieren" }));
  expect(screen.getByText(/Der Arbeitsbaum bleibt/)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
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

it("starting another restart clears the previous error while the retry is pending", async () => {
  const retry = pending<Worker>();
  vi.mocked(respawnWorker).mockRejectedValueOnce(new Error("boom")).mockReturnValueOnce(retry.promise);
  const onChanged = view("exited");
  fireEvent.click(screen.getByRole("button", { name: "Claude Code neu starten" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Neu starten hat nicht geklappt. Bitte noch einmal versuchen.");
  expect(onChanged).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Claude Code neu starten" }));
  expect(respawnWorker).toHaveBeenNthCalledWith(2, "w1");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Claude Code neu starten" })).toBeDisabled();
  expect(onChanged).not.toHaveBeenCalled();

  retry.resolve({} as Worker);
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Claude Code neu starten" })).toBeEnabled();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("the proof chip exposes its full text in a native tooltip", () => {
  view("running");
  expect(screen.getByTitle("Beweis nicht verbunden")).toContainElement(screen.getByText("Beweis nicht verbunden"));
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

it("shows the self-reported model with its source label", () => {
  withModel("Opus 5");
  expect(screen.getByText("Opus 5 · gemeldet vom Agenten")).toBeInTheDocument();
});

it("shows no model line when the agent reported none", () => {
  for (const absent of [undefined, null, "  "]) {
    withModel(absent);
    expect(screen.queryByText(/gemeldet vom Agenten/)).toBeNull();
    cleanup();
  }
});
