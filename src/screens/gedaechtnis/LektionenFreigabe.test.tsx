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
    expect(within(row("a")).getByText(T.working)).toBeTruthy();
    expect(within(row("b")).queryByText(T.working)).toBeNull();

    await act(async () => { pending.resolve(); await pending.promise; });
    await waitFor(() => expect(screen.queryByText("content of a")).toBeNull());
    expect(screen.queryByText(T.working)).toBeNull();
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

  it("keeps the row and shows a German sentence when a rejection fails", async () => {
    vi.mocked(listLearnings).mockResolvedValue([learning("a")]);
    vi.mocked(rejectLearning).mockRejectedValue(new Error("denied by core"));
    render(<LektionenFreigabe projectId="p1" />);
    await screen.findByText("content of a");
    fireEvent.click(screen.getByRole("button", { name: T.reject }));
    expect(await screen.findByText(T.rejectFailed)).toBeTruthy();
    expect(screen.queryByText("denied by core")).toBeNull();
    expect((screen.getByRole("button", { name: T.reject }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(T.working)).toBeNull();
    expect(listLearnings).toHaveBeenCalledTimes(1);
  });

  describe("a verdict that outlives a project switch", () => {
    const setup = () => {
      const late = deferred<void>();
      const fresh = deferred<void>();
      vi.mocked(listLearnings).mockImplementation(async (id: string) => [learning("a", { projectId: id })]);
      vi.mocked(approveLearning).mockReturnValueOnce(late.promise).mockReturnValueOnce(fresh.promise);
      return { late, fresh };
    };
    const startApprove = () => fireEvent.click(screen.getByRole("button", { name: T.approve }));
    const settle = (d: { resolve: () => void; promise: Promise<void> }) => act(async () => { d.resolve(); await d.promise; });

    it("does not touch the state of the new project", async () => {
      const { late, fresh } = setup();
      const view = render(<LektionenFreigabe projectId="p1" />);
      await screen.findByText("content of a");
      startApprove();
      view.rerender(<LektionenFreigabe projectId="p2" />);
      await waitFor(() => expect(listLearnings).toHaveBeenCalledWith("p2"));
      await screen.findByText("content of a");
      startApprove();
      await waitFor(() => expect((screen.getByRole("button", { name: T.approve }) as HTMLButtonElement).disabled).toBe(true));

      await settle(late);
      expect(screen.queryByText(T.approved)).toBeNull();
      expect((screen.getByRole("button", { name: T.approve }) as HTMLButtonElement).disabled).toBe(true);
      expect(listLearnings).toHaveBeenCalledTimes(2);
      expect(screen.getByText("content of a")).toBeTruthy();

      await settle(fresh);
      await waitFor(() => expect(screen.getByText(T.approved)).toBeTruthy());
    });

    it("ignores a late reply after the round trip p1 -> p2 -> p1", async () => {
      const { late, fresh } = setup();
      const view = render(<LektionenFreigabe projectId="p1" />);
      await screen.findByText("content of a");
      startApprove();
      view.rerender(<LektionenFreigabe projectId="p2" />);
      await waitFor(() => expect(listLearnings).toHaveBeenCalledWith("p2"));
      view.rerender(<LektionenFreigabe projectId="p1" />);
      await waitFor(() => expect(listLearnings).toHaveBeenCalledTimes(3));
      await screen.findByText("content of a");
      startApprove();
      await waitFor(() => expect((screen.getByRole("button", { name: T.approve }) as HTMLButtonElement).disabled).toBe(true));

      await settle(late);
      expect(screen.queryByText(T.approved)).toBeNull();
      expect((screen.getByRole("button", { name: T.approve }) as HTMLButtonElement).disabled).toBe(true);
      expect(listLearnings).toHaveBeenCalledTimes(3);

      await settle(fresh);
      await waitFor(() => expect(screen.getByText(T.approved)).toBeTruthy());
    });
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

  it("removes a decided lesson before its follow-up read settles", async () => {
    const deferredRefresh = deferred<Learning[]>();
    const approved = deferred<void>();
    vi.mocked(listLearnings).mockResolvedValueOnce([learning("a"), learning("b")]).mockReturnValue(deferredRefresh.promise);
    vi.mocked(approveLearning).mockReturnValue(approved.promise);
    render(<LektionenFreigabe projectId="p1" />);
    await screen.findByText("content of a");

    fireEvent.click(within(row("a")).getByRole("button", { name: T.approve }));
    await waitFor(() => expect((within(row("a")).getByRole("button", { name: T.approve }) as HTMLButtonElement).disabled).toBe(true));

    await act(async () => { approved.resolve(); await approved.promise; });
    await waitFor(() => expect(screen.queryByText("content of a")).toBeNull());
    expect(screen.getByText("content of b")).toBeTruthy();
    expect(screen.getByText(T.approved)).toBeTruthy();
    expect((within(row("b")).getByRole("button", { name: T.approve }) as HTMLButtonElement).disabled).toBe(false);
    expect(listLearnings).toHaveBeenCalledTimes(2);

    await act(async () => { deferredRefresh.resolve([learning("b")]); });
    await waitFor(() => expect(screen.getByText("content of b")).toBeTruthy());
    expect(screen.queryByText("content of a")).toBeNull();
  });

  it("keeps remaining lessons when the post-decision read fails", async () => {
    vi.mocked(listLearnings).mockResolvedValueOnce([learning("a"), learning("b")]).mockRejectedValueOnce(new Error("read failed"));
    vi.mocked(approveLearning).mockResolvedValue(undefined);
    render(<LektionenFreigabe projectId="p1" />);
    await screen.findByText("content of a");

    fireEvent.click(within(row("a")).getByRole("button", { name: T.approve }));
    await waitFor(() => expect(screen.queryByText("content of a")).toBeNull());
    expect(screen.getByText("content of b")).toBeTruthy();
    expect(screen.getByText(T.approved)).toBeTruthy();
    expect(await screen.findByText(T.reloadFailed)).toBeTruthy();
    expect(screen.queryByText(T.loadFailed)).toBeNull();
    expect(screen.queryByText(T.approveFailed)).toBeNull();
    expect(screen.queryByText(T.empty)).toBeNull();
    expect(screen.getByRole("button", { name: T.retry })).toBeTruthy();
    expect((within(row("b")).getByRole("button", { name: T.reject }) as HTMLButtonElement).disabled).toBe(false);
    expect(listLearnings).toHaveBeenCalledTimes(2);
  });

  it("retries only the lesson read after a confirmed decision", async () => {
    vi.mocked(listLearnings)
      .mockResolvedValueOnce([learning("a"), learning("b")])
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce([learning("a"), learning("b")]);
    vi.mocked(approveLearning).mockResolvedValue(undefined);
    render(<LektionenFreigabe projectId="p1" />);
    await screen.findByText("content of a");

    fireEvent.click(within(row("a")).getByRole("button", { name: T.approve }));
    expect(await screen.findByText(T.reloadFailed)).toBeTruthy();
    expect(screen.queryByText("content of a")).toBeNull();
    expect(screen.getByText("content of b")).toBeTruthy();
    expect(approveLearning).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: T.retry }));
    await waitFor(() => expect(screen.queryByText(T.reloadFailed)).toBeNull());
    expect(screen.getByText("content of b")).toBeTruthy();
    expect(screen.queryByText("content of a")).toBeNull();
    expect(screen.queryByText(T.empty)).toBeNull();
    expect(approveLearning).toHaveBeenCalledTimes(1);
    expect(rejectLearning).not.toHaveBeenCalled();
    expect(listLearnings).toHaveBeenCalledTimes(3);
  });

  it("does not claim there are no open lessons when the reread fails", async () => {
    vi.mocked(listLearnings).mockResolvedValueOnce([learning("a")]).mockRejectedValueOnce(new Error("read failed"));
    vi.mocked(rejectLearning).mockResolvedValue(undefined);
    render(<LektionenFreigabe projectId="p1" />);
    await screen.findByText("content of a");

    fireEvent.click(screen.getByRole("button", { name: T.reject }));
    expect(await screen.findByText(T.reloadFailed)).toBeTruthy();
    expect(screen.getByText(T.rejected)).toBeTruthy();
    expect(screen.queryByText("content of a")).toBeNull();
    expect(screen.queryByText(T.empty)).toBeNull();
    expect(screen.queryByText(T.loadFailed)).toBeNull();
    expect(screen.getByRole("button", { name: T.retry })).toBeTruthy();
    expect(rejectLearning).toHaveBeenCalledTimes(1);
    expect(listLearnings).toHaveBeenCalledTimes(2);
  });

  it("does not bring back a lesson decided while another read is still open", async () => {
    const firstRead = deferred<Learning[]>();
    const secondRead = deferred<Learning[]>();
    vi.mocked(listLearnings)
      .mockResolvedValueOnce([learning("a"), learning("b")])
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise);
    vi.mocked(approveLearning).mockResolvedValue(undefined);
    vi.mocked(rejectLearning).mockResolvedValue(undefined);
    render(<LektionenFreigabe projectId="p1" />);
    await screen.findByText("content of a");

    fireEvent.click(within(row("a")).getByRole("button", { name: T.approve }));
    await waitFor(() => expect(screen.queryByText("content of a")).toBeNull());
    expect(screen.getByText("content of b")).toBeTruthy();
    await waitFor(() => expect(listLearnings).toHaveBeenCalledTimes(2));

    fireEvent.click(within(row("b")).getByRole("button", { name: T.reject }));
    await waitFor(() => expect(screen.queryByText("content of b")).toBeNull());
    await waitFor(() => expect(listLearnings).toHaveBeenCalledTimes(3));

    await act(async () => { firstRead.resolve([learning("a"), learning("b")]); });
    await act(async () => { secondRead.resolve([learning("a"), learning("b")]); });
    await waitFor(() => expect(screen.queryByText(T.working)).toBeNull());
    expect(screen.queryByText("content of a")).toBeNull();
    expect(screen.queryByText("content of b")).toBeNull();
    expect(screen.getByText(T.empty)).toBeTruthy();
    expect(approveLearning).toHaveBeenCalledTimes(1);
    expect(rejectLearning).toHaveBeenCalledTimes(1);
  });
});
