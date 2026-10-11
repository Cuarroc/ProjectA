import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentProfile, QueueEntry } from "../../../../types";
import { EinreihenForm } from "./EinreihenForm";
import { T } from "./texts";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const profiles = [{ id: "claude", name: "Claude Code" }] as AgentProfile[];
const entry = (id: string, status = "queued"): QueueEntry => ({
  id, projectId: "p1", rawText: `Task ${id}`, sharpenedText: null, profileId: null,
  status, priority: 5, workerId: null, error: null, createdAt: 1,
} as QueueEntry);
function backend(h: Partial<Record<"stop" | "enqueue" | "cancel", () => unknown>> = {}) {
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "get_emergency_stop") return h.stop ? h.stop() : false;
    if (cmd === "enqueue_task") return h.enqueue ? h.enqueue() : entry("new");
    if (cmd === "cancel_queued_task") return h.cancel?.();
    throw new Error(`unexpected ${cmd}`);
  });
}
const deferred = <V,>() => {
  const d = {} as { promise: Promise<V>; resolve: (v: V) => void; reject: (e: unknown) => void };
  d.promise = new Promise<V>((res, rej) => { d.resolve = res; d.reject = rej; });
  return d;
};
const callsOf = (cmd: string) => mocks.invoke.mock.calls.filter(([name]) => name === cmd);
const task = () => screen.getByRole("textbox", { name: T.task }) as HTMLTextAreaElement;
const profile = () => screen.getByRole("combobox", { name: T.profile }) as HTMLSelectElement;
const sharpen = () => screen.getByRole("switch", { name: T.sharpen }) as HTMLButtonElement;
const submit = () => screen.getByRole("button", { name: new RegExp(`^(${T.submit}|${T.submitting})$`) }) as HTMLButtonElement;
const cancelBtn = (id: string) => screen.getByRole("button", { name: T.cancelOne(`Task ${id}`) }) as HTMLButtonElement;
const type = (text: string) => fireEvent.change(task(), { target: { value: text } });
const form = (extra = {}, projectId = "p1") => <EinreihenForm projectId={projectId} profiles={profiles} entries={[]} {...extra} />;
describe("EinreihenForm", () => {
  beforeEach(() => { mocks.invoke.mockReset(); });
  it("enqueues the trimmed text with the chosen profile and sharpen flag and clears the draft", async () => {
    backend();
    const onEnqueued = vi.fn();
    render(form({ onEnqueued }));
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(T.reasonEmpty)).toBeTruthy();
    type("  Fix the build  ");
    fireEvent.change(profile(), { target: { value: "claude" } });
    fireEvent.click(sharpen());
    fireEvent.click(submit());
    await waitFor(() => expect(onEnqueued).toHaveBeenCalledWith(entry("new")));
    expect(callsOf("enqueue_task")[0][1]).toMatchObject({ projectId: "p1", rawText: "Fix the build", profileId: "claude", sharpen: true });
    expect(task().value).toBe("");
  });

  it("disables the form while the enqueue runs and says why", async () => {
    const pending = deferred<QueueEntry>();
    backend({ enqueue: () => pending.promise });
    render(form());
    type("Task");
    fireEvent.click(submit());
    await waitFor(() => expect(submit().disabled).toBe(true));
    expect(submit().textContent).toBe(T.submitting);
    expect([task().disabled, profile().disabled, sharpen().disabled]).toEqual([true, true, true]);
    expect(submit().getAttribute("aria-describedby")).toBe(screen.getByText(T.reasonBusy).id);
    await act(async () => pending.resolve(entry("new")));
    expect(submit().textContent).toBe(T.submit);
  });

  it("disables adding but not cancelling while Not-Aus is active or unreadable", async () => {
    for (const stop of [() => true, () => Promise.reject(new Error("offline"))]) {
      mocks.invoke.mockReset();
      backend({ stop });
      const { unmount } = render(form({ entries: [entry("a")] }));
      type("Task");
      expect(await screen.findByText(T.reasonStopped)).toBeTruthy();
      expect(submit().disabled).toBe(true);
      fireEvent.submit(submit().closest("form")!);
      expect(callsOf("enqueue_task")).toHaveLength(0);
      expect(cancelBtn("a").disabled).toBe(false);
      unmount();
    }
  });

  it("shows a German sentence and keeps the draft when the enqueue is rejected", async () => {
    backend({ enqueue: () => Promise.reject(new Error("db locked")) });
    const onEnqueued = vi.fn();
    render(form({ onEnqueued }));
    type("Task");
    fireEvent.click(submit());
    expect((await screen.findByRole("alert")).textContent).toBe(T.enqueueFailed("db locked"));
    expect(callsOf("enqueue_task")[0][1]).toMatchObject({ profileId: undefined, sharpen: false });
    expect(task().value).toBe("Task");
    expect(submit().disabled).toBe(false);
    expect(onEnqueued).not.toHaveBeenCalled();
  });

  it("cancels a queued entry by id and offers no cancel for one that was picked up", async () => {
    backend();
    const onCancelled = vi.fn();
    const entries = [entry("a"), entry("b", "ready"), entry("c", "dispatching"), entry("d", "failed")];
    render(form({ entries, onCancelled }));
    expect(screen.getAllByRole("button", { name: /Aufgabe aus der Warteschlange entfernen/ })).toHaveLength(2);
    fireEvent.click(cancelBtn("a"));
    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith("a"));
    expect(callsOf("cancel_queued_task")[0][1]).toEqual({ id: "a" });
  });

  it("disables only the entry being cancelled and shows a German sentence on rejection", async () => {
    const pending = deferred<void>();
    backend({ cancel: () => pending.promise });
    render(form({ entries: [entry("a"), entry("b")] }));
    fireEvent.click(cancelBtn("a"));
    await waitFor(() => expect(cancelBtn("a").disabled).toBe(true));
    expect(cancelBtn("b").disabled).toBe(false);
    await act(async () => pending.reject(new Error("already claimed")));
    expect((await screen.findByRole("alert")).textContent).toBe(T.cancelFailed("already claimed"));
    expect(cancelBtn("a").disabled).toBe(false);
  });

  // Ported from QueuePanel.switch.test.tsx: nothing of the old project carries over.
  it("drops the draft and the error when the project switches", async () => {
    backend({ enqueue: () => Promise.reject(new Error("boom")) });
    const { rerender } = render(form());
    type("half-typed draft");
    fireEvent.click(submit());
    await screen.findByRole("alert");
    rerender(form({}, "p2"));
    expect(task().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not publish an enqueue or a cancel that completes after the project switch", async () => {
    const enqueue = deferred<QueueEntry>();
    const cancel = deferred<void>();
    backend({ enqueue: () => enqueue.promise, cancel: () => cancel.promise });
    const cb = { onEnqueued: vi.fn(), onCancelled: vi.fn() };
    const { rerender } = render(form({ entries: [entry("a")], ...cb }));
    type("Task of project one");
    fireEvent.click(submit());
    fireEvent.click(cancelBtn("a"));
    await waitFor(() => expect(callsOf("cancel_queued_task")).toHaveLength(1));
    rerender(form(cb, "p2"));
    type("Draft of project two");
    await act(async () => { enqueue.resolve(entry("new")); cancel.resolve(); });
    expect(cb.onEnqueued).not.toHaveBeenCalled();
    expect(cb.onCancelled).not.toHaveBeenCalled();
    expect(task().value).toBe("Draft of project two");
    expect(submit().disabled).toBe(false);
  });

  it("does not publish a late enqueue or cancel reply after a round trip back to the same project", async () => {
    const enqueue = deferred<QueueEntry>();
    const cancel = deferred<void>();
    backend({ enqueue: () => enqueue.promise, cancel: () => cancel.promise });
    const cb = { onEnqueued: vi.fn(), onCancelled: vi.fn() };
    const { rerender } = render(form({ entries: [entry("a")], ...cb }));
    type("Task of the first visit");
    fireEvent.click(submit());
    fireEvent.click(cancelBtn("a"));
    await waitFor(() => expect(callsOf("cancel_queued_task")).toHaveLength(1));
    rerender(form(cb, "p2"));
    rerender(form({ entries: [entry("a")], ...cb }, "p1"));
    type("Draft of the second visit");
    await act(async () => { enqueue.resolve(entry("new")); cancel.resolve(); });
    expect(cb.onEnqueued).not.toHaveBeenCalled();
    expect(cb.onCancelled).not.toHaveBeenCalled();
    expect(task().value).toBe("Draft of the second visit");
    expect(submit().disabled).toBe(false);
    expect(cancelBtn("a").disabled).toBe(false);
  });

  it("polls Not-Aus every five seconds and closes the gate once it turns active", async () => {
    vi.useFakeTimers();
    try {
      let stopped = false;
      backend({ stop: () => stopped });
      render(form());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      type("Task");
      expect(submit().disabled).toBe(false);
      stopped = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
      expect(submit().disabled).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(submit().disabled).toBe(true);
      expect(screen.getByText(T.reasonStopped)).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });
});
