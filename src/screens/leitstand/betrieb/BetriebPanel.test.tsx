import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentProfile } from "../../../types";
import { BetriebPanel } from "./BetriebPanel";
import { T as F } from "./einreihen/texts";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const GB = 1024 ** 3;
const profiles = [{ id: "claude", name: "Claude Code" }] as AgentProfile[];
const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id, projectId: "p1", rawText: `Task ${id}`, sharpenedText: null, profileId: null,
  status: "queued", priority: 5, workerId: null, error: null, createdAt: 1, ...extra,
});
const snapshot = (extra: Record<string, unknown> = {}) => ({
  observedAt: 1, cpuPermille: null, ramProcessBytes: 2 * GB, ramTotalBytes: 16 * GB,
  diskAppBytes: null, diskFreeBytes: null, tokensIn: 0, tokensOut: 0, ...extra,
});

function backend(queue: unknown[], resources: unknown = snapshot(), watchdog: unknown = []) {
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "list_queue") return queue;
    if (cmd === "get_resource_snapshot") return resources;
    if (cmd === "watchdog_report") {
      if (watchdog instanceof Error) throw watchdog.message;
      return watchdog;
    }
    throw new Error(`unexpected ${cmd}`);
  });
}
const section = (name: string) => screen.getByRole("region", { name });

const deferred = <V,>() => {
  const d = {} as { promise: Promise<V>; resolve: (v: V) => void };
  d.promise = new Promise<V>((resolve) => { d.resolve = resolve; });
  return d;
};
const callsOf = (cmd: string) => mocks.invoke.mock.calls.filter(([name]) => name === cmd);

describe("BetriebPanel", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("enqueues from Betrieb and rereads the confirmed project queue", async () => {
    const initial = deferred<unknown[]>();
    const saved = deferred<unknown>();
    backend([]);
    const read = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((cmd, args) => {
      if (cmd === "list_queue") return callsOf(cmd).length === 1 ? initial.promise : Promise.resolve([entry("confirmed")]);
      if (cmd === "get_emergency_stop") return Promise.resolve(false);
      if (cmd === "enqueue_task") return saved.promise;
      return read(cmd, args);
    });
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    expect(screen.queryByRole("textbox", { name: F.task })).toBeNull();
    await act(async () => initial.resolve([]));
    expect(screen.queryByRole("textbox", { name: F.task })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: F.task }), { target: { value: "  Fix the build  " } });
    fireEvent.change(screen.getByRole("combobox", { name: F.profile }), { target: { value: "claude" } });
    expect(screen.getByRole("switch", { name: F.sharpen })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("switch", { name: F.sharpen }));
    fireEvent.click(screen.getByRole("button", { name: F.submit }));
    expect(callsOf("enqueue_task")).toEqual([["enqueue_task", {
      projectId: "p1", rawText: "Fix the build", profileId: "claude", sharpen: true, priority: undefined,
    }]]);
    expect(callsOf("list_queue")).toHaveLength(1);
    await act(async () => saved.resolve(entry("write-reply")));
    expect(callsOf("list_queue")).toEqual([["list_queue", { projectId: "p1" }], ["list_queue", { projectId: "p1" }]]);
    expect(within(section("Warteschlange")).getByText("Task confirmed")).toBeVisible();
    expect(screen.queryByText("Task write-reply")).toBeNull();
    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd)).toEqual([
      "list_queue", "get_resource_snapshot", "watchdog_report", "get_emergency_stop", "enqueue_task", "list_queue",
    ]);
  });

  it("does not restore cancelled rows from an older queue read", async () => {
    vi.useFakeTimers();
    try {
      const older = deferred<unknown[]>();
      const refresh = deferred<unknown[]>();
      const newer = deferred<unknown[]>();
      backend([entry("a"), entry("b", { status: "ready" }), entry("c", { status: "dispatching" })]);
      const read = mocks.invoke.getMockImplementation()!;
      let fail = true;
      mocks.invoke.mockImplementation((cmd, args) => {
        if (cmd === "list_queue") return [null, older, refresh, newer][callsOf(cmd).length - 1]?.promise ?? read(cmd, args);
        if (cmd === "get_emergency_stop") return Promise.resolve(false);
        if (cmd === "cancel_queued_task") return fail ? Promise.reject(new Error("claimed")) : Promise.resolve();
        return read(cmd, args);
      });
      render(<BetriebPanel projectId="p1" profiles={profiles} />);
      await act(async () => {});
      expect(screen.queryAllByRole("button", { name: /Aufgabe aus der Warteschlange entfernen/ })).toHaveLength(2);
      const cancel = () => fireEvent.click(screen.getByRole("button", { name: F.cancelOne("Task a") }));
      await act(async () => cancel());
      expect(screen.getByRole("alert")).toHaveTextContent("claimed");
      expect(within(section("Warteschlange")).getByText("Task a")).toBeVisible();
      expect(callsOf("list_queue")).toHaveLength(1);
      fail = false;
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      await act(async () => cancel());
      expect(callsOf("cancel_queued_task").at(-1)).toEqual(["cancel_queued_task", { id: "a" }]);
      expect(callsOf("list_queue")).toHaveLength(3);
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      await act(async () => newer.resolve([]));
      await act(async () => { refresh.resolve([entry("a")]); older.resolve([entry("a")]); });
      expect(within(section("Warteschlange")).getByText("Warteschlange leer")).toBeVisible();
      expect(screen.queryByText("Task a")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("shows original and sharpened queue text without changing dispatch", async () => {
    const raw = "Original line\n" + "long-text".repeat(300) + "\n<img src=x onerror=alert(1)>";
    backend([
      entry("different", { rawText: raw, sharpenedText: "Precise task", status: "ready" }),
      entry("same", { rawText: "Same task", sharpenedText: "Same task" }),
    ]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    await screen.findByText("Same task");
    const rows = within(section("Warteschlange")).getAllByRole("listitem");
    for (const row of rows) {
      const disclosure = within(row).getByText("Auftrag ansehen");
      expect(disclosure.tagName).toBe("SUMMARY");
      expect(disclosure.parentElement).not.toHaveAttribute("open");
      fireEvent.click(disclosure);
    }
    const first = rows[0].querySelector("details")!;
    expect(await within(first).findByText("Precise task")).toBeVisible();
    expect(within(first).getByText("Original")).toBeVisible();
    expect(within(first).getByText("Geschärft")).toBeVisible();
    expect(within(first).getByText((_, el) => el?.tagName === "P" && el.textContent === raw)).toBeVisible();
    expect(first.querySelector("img")).toBeNull();
    const same = rows[1].querySelector("details")!;
    expect(await within(same).findByText("Original und geschärfter Text sind gleich.")).toBeVisible();
    expect(within(same).getAllByText("Same task")).toHaveLength(1);
    fireEvent.click(within(first).getByText("Auftrag ansehen"));
    expect(first).not.toHaveAttribute("open");
    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd)).toEqual([
      "list_queue", "get_resource_snapshot", "watchdog_report",
    ]);
  });

  it("does not describe an unstarted raw queue entry as already started", async () => {
    const states = ["queued", "sharpening", "ready", "dispatching", "dispatched", "done", "failed"];
    backend(states.map((status) => entry(status, {
      status, error: status === "failed" ? "preflight: no slot" : null,
    })));
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    await screen.findByText("Task queued");
    const rows = within(section("Warteschlange")).getAllByRole("listitem");
    for (const [index, row] of rows.entries()) {
      fireEvent.click(within(row).getByText("Auftrag ansehen"));
      const details = within(row.querySelector("details")!);
      expect(await details.findByText("Original")).toBeVisible();
      expect(details.getByText(`Task ${states[index]}`)).toBeVisible();
      const hint = states[index] === "sharpening"
        ? "Der Auftrag wird gerade vorbereitet."
        : "Kein geschärfter Text vorhanden. Hier steht der Originaltext.";
      expect(details.getByText(hint)).toBeVisible();
      expect(row.querySelector("details")!.textContent).not.toMatch(/gestartet|empfangen|geprüft/i);
    }
    expect(within(rows[6]).getByText("preflight: no slot")).toBeVisible();
  });

  it("shows the preflight reason of a held task with its state chip and profile", async () => {
    backend([entry("t1", { status: "failed", profileId: "claude", error: "preflight: kein freier Worker-Slot" })]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const queue = within(section("Warteschlange"));
    expect(await queue.findByText("preflight: kein freier Worker-Slot")).toBeInTheDocument();
    expect(queue.getByText("Fehler")).toBeInTheDocument();
    expect(queue.getByText("Claude Code")).toBeInTheDocument();
    expect(queue.getByText("Task t1")).toBeInTheDocument();
  });

  it("names a queued task with the automatic profile and no reason line", async () => {
    backend([entry("t2")]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const queue = within(section("Warteschlange"));
    expect(await queue.findByText("Task t2")).toBeInTheDocument();
    expect(queue.getByText("Wartet")).toBeInTheDocument();
    expect(queue.getByText("Auto")).toBeInTheDocument();
    expect(queue.queryByText(/preflight/)).toBeNull();
  });

  it("prints a visible state word for every stage and not only the waiting ones", async () => {
    backend([
      entry("a", { status: "sharpening" }), entry("b", { status: "ready" }), entry("c", { status: "dispatching" }),
      entry("d", { status: "dispatched" }), entry("e", { status: "done" }),
    ]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const queue = within(section("Warteschlange"));
    await queue.findByText("Task a");
    for (const word of ["Schärft", "Bereit", "Startet", "Läuft", "Erledigt"]) {
      expect(queue.getByText(word)).toBeVisible();
    }
  });

  it("polls every 10 seconds and stops after unmount", async () => {
    vi.useFakeTimers();
    try {
      backend([entry("t5")]);
      const { unmount } = render(<BetriebPanel projectId="p1" profiles={profiles} />);
      const reads = () => mocks.invoke.mock.calls.length;
      await vi.advanceTimersByTimeAsync(0);
      const first = reads();
      expect(first).toBe(3);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(reads()).toBe(first);
      await vi.advanceTimersByTimeAsync(1);
      expect(reads()).toBe(first + 3);
      unmount();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reads()).toBe(first + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the empty state only after a successful read of an empty queue", async () => {
    backend([]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    expect(await within(section("Warteschlange")).findByText("Warteschlange leer")).toBeInTheDocument();
  });

  it("says nothing is empty when the queue cannot be read", async () => {
    mocks.invoke.mockRejectedValue(new Error("down"));
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    expect(await within(section("Warteschlange")).findByText("Warteschlange nicht lesbar")).toBeInTheDocument();
    expect(screen.queryByText("Warteschlange leer")).toBeNull();
  });

  it("shows a missing RAM fact as an honest state without any number", async () => {
    backend([], snapshot({ ramTotalBytes: null }));
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const check = section("Startprüfung");
    expect(await within(check).findByText("Arbeitsspeicher noch nicht verbunden")).toBeInTheDocument();
    expect(within(check).getByText("Freie Worker-Slots noch nicht verbunden")).toBeInTheDocument();
    expect(check.textContent).not.toMatch(/\d/);
  });

  it("shows the RAM the frontend does get", async () => {
    backend([]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    expect(await within(section("Startprüfung")).findByText("2 GB von 16 GB")).toBeInTheDocument();
  });

  it("shows a stalled run of the watchdog with its label and sentence", async () => {
    backend([], snapshot(), [{ runId: "w1", label: "Fix the login", kind: "steht", sentence: "Steht seit 15 Minuten: keine Ausgabe, keine Änderung im Arbeitsbaum.", since: 1 }]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const dog = within(section("Wachhund"));
    expect(await dog.findByText("Fix the login")).toBeInTheDocument();
    expect(dog.getByText(/Steht seit 15 Minuten/)).toBeInTheDocument();
    expect(dog.queryByText("Keine Auffälligkeiten")).toBeNull();
  });

  it("says there is nothing to see only after the watchdog read an empty list", async () => {
    backend([]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const dog = within(section("Wachhund"));
    expect(dog.getByText("Wird gelesen …")).toBeInTheDocument();
    expect(await dog.findByText("Keine Auffälligkeiten")).toBeInTheDocument();
  });

  it("shows the core's error sentence and never the empty sentence when the watchdog fails", async () => {
    backend([], snapshot(), new Error("Der Wachhund konnte die Läufe nicht lesen."));
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const dog = within(section("Wachhund"));
    expect(await dog.findByText("Der Wachhund konnte die Läufe nicht lesen.")).toBeInTheDocument();
    expect(dog.queryByText("Keine Auffälligkeiten")).toBeNull();
  });

  it("has no button and invokes only read commands and never enqueue or dispatch", async () => {
    backend([entry("t3"), entry("t4", { status: "ready" })]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    await screen.findByText("Task t3");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const commands = mocks.invoke.mock.calls.map(([cmd]) => cmd);
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) expect(["list_queue", "get_resource_snapshot", "watchdog_report"]).toContain(cmd);
  });
});
