import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

import HistoryView from "./HistoryView";

describe("HistoryView public history read", () => {
  beforeEach(() => { invoke.mockReset(); });
  afterEach(cleanup);

  it("announces the initial worker history read before an empty result", async () => {
    let reply!: (rows: unknown[]) => void;
    invoke.mockReturnValueOnce(new Promise((resolve) => { reply = resolve; }));
    const view = render(<HistoryView workerId="worker-1" />);

    expect(invoke).toHaveBeenCalledExactlyOnceWith("list_worker_messages", {
      workerId: "worker-1", limit: 200,
    });
    expect(screen.getByRole("status", { name: "Verlauf wird geladen …" })).toBeVisible();
    expect(screen.queryByText(/Hier erscheinen Nachrichten des Agenten/)).toBeNull();

    await act(async () => reply([]));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Noch keine Nachrichten")).toBeVisible();
    expect(screen.getByText(
      "Hier erscheinen Nachrichten des Agenten: Aufgaben, Updates und Lebenszyklus-Ereignisse.",
    )).toBeVisible();
    expect(view.container.querySelector(".g-hs--empty")).toBeTruthy();
  });

  it("shows the existing automatic retry hint as offline after an initial rejection", async () => {
    invoke.mockRejectedValueOnce(new Error("history unavailable"));
    const view = render(<HistoryView workerId="worker-1" />);
    await act(async () => {});

    expect(screen.getByRole("status")).toHaveTextContent("Verlauf konnte nicht geladen werden.");
    expect(screen.getByText("Er wird automatisch erneut versucht.")).toBeVisible();
    expect(view.container.querySelector(".g-hs--offline")).toBeTruthy();
    expect(screen.queryByText("Noch keine Nachrichten")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps literal message order and roles through normalization and an ordinary worker switch", async () => {
    invoke.mockResolvedValueOnce([
      { id: "m1", worker_id: "worker-1", role: "user", content: "First instruction", created_at: 1700000000 },
      { id: "m2", worker_id: "worker-1", role: "agent", content: "Agent response", created_at: 1700000060 },
      { id: "m3", worker_id: "worker-1", role: "system", content: "Worker stopped", created_at: 1700000120 },
    ]);
    const view = render(<HistoryView workerId="worker-1" />);
    await act(async () => {});

    expect(screen.getAllByText(/^(First instruction|Agent response|Worker stopped)$/)
      .map((node) => node.textContent)).toEqual(["First instruction", "Agent response", "Worker stopped"]);
    for (const role of ["Nutzer", "Agent", "System"]) expect(screen.getByText(role)).toBeVisible();
    expect(screen.getAllByText(/\d{2}:\d{2}/)).toHaveLength(3);

    let reply!: (rows: unknown[]) => void;
    invoke.mockReturnValueOnce(new Promise((resolve) => { reply = resolve; }));
    view.rerender(<HistoryView workerId="worker-2" />);
    expect(screen.getByRole("status", { name: "Verlauf wird geladen …" })).toBeVisible();
    expect(screen.queryByText("First instruction")).toBeNull();
    expect(invoke).toHaveBeenLastCalledWith("list_worker_messages", { workerId: "worker-2", limit: 200 });

    await act(async () => reply([
      { id: "m4", worker_id: "worker-2", role: "agent", content: "Second worker response", created_at: 1700000180 },
    ]));
    expect(screen.getByText("Second worker response")).toBeVisible();
    expect(screen.queryByText("Worker stopped")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
