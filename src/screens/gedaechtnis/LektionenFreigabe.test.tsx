import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { approveLearning, listLearnings, rejectLearning } from "../../lib/ipc";
import type { Learning } from "../../types";
import { LektionenFreigabe } from "./LektionenFreigabe";
import { T } from "./texts";

vi.mock("../../lib/ipc", () => ({
  listLearnings: vi.fn(),
  approveLearning: vi.fn(),
  rejectLearning: vi.fn(),
}));

const learning = (id: string, over: Partial<Learning> = {}): Learning => ({
  id,
  projectId: "p1",
  workerId: "w1",
  profileId: "pr1",
  patternLabel: null,
  content: `content of ${id}`,
  status: "pending",
  createdAt: 1,
  ...over,
});

const deferred = <V,>() => {
  let resolve!: (v: V) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<V>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const row = (id: string) => screen.getByText(`content of ${id}`).closest("li") as HTMLElement;

beforeEach(() => {
  vi.mocked(listLearnings).mockReset();
  vi.mocked(approveLearning).mockReset();
  vi.mocked(rejectLearning).mockReset();
});
afterEach(cleanup);

describe("LektionenFreigabe", () => {
  it("lists only the pending lessons with their pattern", async () => {
    vi.mocked(listLearnings).mockResolvedValue([
      learning("a", { patternLabel: "retry-loop" }),
      learning("b", { status: "approved" }),
      learning("c", { status: "rejected" }),
      learning("d"),
    ]);
    render(<LektionenFreigabe projectId="p1" />);
    expect(await screen.findByText("content of a")).toBeTruthy();
    expect(screen.getByText("retry-loop")).toBeTruthy();
    expect(screen.getByText("content of d")).toBeTruthy();
    expect(screen.queryByText("content of b")).toBeNull();
    expect(screen.queryByText("content of c")).toBeNull();
    expect(listLearnings).toHaveBeenCalledWith("p1");
  });

  it("says so when nothing is pending", async () => {
    vi.mocked(listLearnings).mockResolvedValue([learning("b", { status: "approved" })]);
    render(<LektionenFreigabe projectId="p1" />);
    expect(await screen.findByText(T.empty)).toBeTruthy();
  });

  it("asks nothing without a project", () => {
    render(<LektionenFreigabe projectId={null} />);
    expect(screen.getByText(T.noProject)).toBeTruthy();
    expect(listLearnings).not.toHaveBeenCalled();
  });

  it("shows a German sentence when loading fails and retries on request", async () => {
    vi.mocked(listLearnings).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([learning("a")]);
    render(<LektionenFreigabe projectId="p1" />);
    expect(await screen.findByText(T.loadFailed)).toBeTruthy();
    expect(screen.queryByText("boom")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: T.retry }));
    expect(await screen.findByText("content of a")).toBeTruthy();
    expect(screen.queryByText(T.loadFailed)).toBeNull();
  });

  it("approves with the text of the lesson and busies only that row", async () => {
    const pending = deferred<void>();
    vi.mocked(listLearnings).mockResolvedValueOnce([learning("a"), learning("b")]).mockResolvedValueOnce([learning("b")]);
    vi.mocked(approveLearning).mockReturnValue(pending.promise);
    render(<LektionenFreigabe projectId="p1" />);
    await screen.findByText("content of a");

    fireEvent.click(within(row("a")).getByRole("button", { name: T.approve }));
    expect(approveLearning).toHaveBeenCalledWith("a", "content of a");
    await waitFor(() => expect((within(row("a")).getByRole("button", { name: T.approve }) as HTMLButtonElement).disabled).toBe(true));
    expect((within(row("a")).getByRole("button", { name: T.reject }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(row("b")).getByRole("button", { name: T.approve }) as HTMLButtonElement).disabled).toBe(false);
    expect(listLearnings).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve(); await pending.promise; });
    await waitFor(() => expect(screen.queryByText("content of a")).toBeNull());
    expect(listLearnings).toHaveBeenCalledTimes(2);
    expect(screen.getByText(T.approved)).toBeTruthy();
    expect(screen.getByText("content of b")).toBeTruthy();
  });

  it("rejects by id and refreshes", async () => {
    vi.mocked(listLearnings).mockResolvedValueOnce([learning("a")]).mockResolvedValueOnce([]);
    vi.mocked(rejectLearning).mockResolvedValue(undefined);
    render(<LektionenFreigabe projectId="p1" />);
    await screen.findByText("content of a");
    fireEvent.click(screen.getByRole("button", { name: T.reject }));
    expect(rejectLearning).toHaveBeenCalledWith("a");
    expect(await screen.findByText(T.empty)).toBeTruthy();
    expect(screen.getByText(T.rejected)).toBeTruthy();
  });

  it("keeps the row and shows a German sentence when an action fails", async () => {
    vi.mocked(listLearnings).mockResolvedValue([learning("a")]);
    vi.mocked(approveLearning).mockRejectedValue(new Error("denied by core"));
    render(<LektionenFreigabe projectId="p1" />);
    await screen.findByText("content of a");
    fireEvent.click(screen.getByRole("button", { name: T.approve }));
    expect(await screen.findByText(T.approveFailed)).toBeTruthy();
    expect(screen.queryByText("denied by core")).toBeNull();
    expect((screen.getByRole("button", { name: T.approve }) as HTMLButtonElement).disabled).toBe(false);
    expect(listLearnings).toHaveBeenCalledTimes(1);
  });

  it("does not poll on its own", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(listLearnings).mockResolvedValue([learning("a")]);
      render(<LektionenFreigabe projectId="p1" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(listLearnings).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
