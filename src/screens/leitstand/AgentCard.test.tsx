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

it("drops the archive confirmation when the card changes to an exited worker", () => {
  const { rerender } = render(<AgentCard card={card("running")} name="Claude Code" now={NOW} onOpen={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Claude Code archivieren" }));
  expect(screen.getByText(/Der Arbeitsbaum bleibt/)).toBeInTheDocument();
  rerender(<AgentCard card={card("exited")} name="Claude Code" now={NOW} onOpen={() => {}} />);
  expect(screen.queryByText(/Der Arbeitsbaum bleibt/)).toBeNull();
  expect(screen.getByRole("button", { name: "Claude Code neu starten" })).toBeInTheDocument();
});

it("drops the archive confirmation when another worker's card replaces it", () => {
  const other = card("running");
  other.worker.id = "w2";
  const { rerender } = render(<AgentCard card={card("running")} name="Claude Code" now={NOW} onOpen={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Claude Code archivieren" }));
  expect(screen.getByText(/Der Arbeitsbaum bleibt/)).toBeInTheDocument();
  rerender(<AgentCard card={other} name="Claude Code" now={NOW} onOpen={() => {}} />);
  expect(screen.queryByText(/Der Arbeitsbaum bleibt/)).toBeNull();
});

it("drops the failed message when the card changes state", async () => {
  vi.mocked(archiveWorker).mockRejectedValue(new Error("boom"));
  const { rerender } = render(<AgentCard card={card("running")} name="Claude Code" now={NOW} onOpen={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Claude Code archivieren" }));
  fireEvent.click(screen.getByRole("button", { name: "Ja, endgültig archivieren" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  rerender(<AgentCard card={card("exited")} name="Claude Code" now={NOW} onOpen={() => {}} />);
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


it("shows the attention reason with its age when the card needs attention", () => {
  const attention = { ...card("running"), column: "needs_you" as const,
    attentionReason: "Approval required", attentionObservedAt: NOW - 300 };
  render(<AgentCard card={attention} name="Fixture" now={NOW} onOpen={() => {}} />);
  expect(screen.getByText("Approval required").parentElement).toHaveTextContent("seit 5 min");
});

it("expands the full task text on request", () => {
  const task = "Inspect the component and verify its behavior. ".repeat(8) + "Final acceptance detail.";
  const item = card("running");
  item.worker.task = task;
  render(<AgentCard card={item} name="Fixture" now={NOW} onOpen={() => {}} />);
  const expand = screen.getByRole("button", { name: "Ganzen Auftrag zeigen" });
  expect(expand).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText(task)).toBeNull();
  fireEvent.click(expand);
  expect(screen.getByText(task)).toBeInTheDocument();
  const collapse = screen.getByRole("button", { name: "Weniger" });
  expect(collapse).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(collapse);
  expect(screen.queryByText(task)).toBeNull();
  expect(screen.getByRole("button", { name: "Ganzen Auftrag zeigen" })).toHaveAttribute("aria-expanded", "false");
});

it("keeps the end of a long branch name visible", () => {
  const item = card("running");
  item.worker.branch = "fixture/a-long-shared-prefix-for-tasks/fix-distinctive-ending";
  render(<AgentCard card={item} name="Fixture" now={NOW} onOpen={() => {}} />);
  const suffix = screen.getByText(/….*fix-distinctive-ending$/);
  expect(suffix).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByTitle(item.worker.branch)).toContainElement(suffix);
  expect(screen.getByText(item.worker.branch)).not.toHaveAttribute("aria-hidden", "true");
});

it("omits the attention line when no reason exists", () => {
  const item = { ...card("running"), attentionReason: null, attentionObservedAt: NOW - 300 };
  const { container } = render(<AgentCard card={item} name="Fixture" now={NOW} onOpen={() => {}} />);
  expect(container.querySelector(".ls-attention")).toBeNull();
  expect(screen.queryByText("seit 5 min")).toBeNull();
});

it("offers expansion only beyond the fixed task length threshold", () => {
  for (const length of [160, 161]) {
    const item = card("running");
    item.worker.task = "x".repeat(length);
    render(<AgentCard card={item} name="Fixture" now={NOW} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: "Ganzen Auftrag zeigen" }) !== null).toBe(length > 160);
    cleanup();
  }
});

it("does not invent an attention age when the observation time is missing", () => {
  render(<AgentCard card={{ ...card("running"), attentionReason: "Approval required" }} name="Fixture" now={NOW} onOpen={() => {}} />);
  expect(screen.getByText("Approval required").parentElement).not.toHaveTextContent(/seit/);
});
