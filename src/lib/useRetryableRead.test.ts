import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRetryableRead } from "./useRetryableRead";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useRetryableRead", () => {
  it("starts loading and settles ok with the value", async () => {
    const read = vi.fn().mockResolvedValue("plan");
    const { result } = renderHook(() => useRetryableRead(read));
    expect(result.current).toMatchObject({ status: "loading", pending: true, data: undefined });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current).toMatchObject({ data: "plan", pending: false });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("stays idle without a read and starts once one is given", async () => {
    const read = vi.fn().mockResolvedValue(1);
    const { result, rerender } = renderHook(({ fn }: { fn: (() => Promise<number>) | null }) => useRetryableRead(fn), {
      initialProps: { fn: null as (() => Promise<number>) | null },
    });
    expect(result.current.status).toBe("idle");
    act(() => result.current.retry());
    expect(read).not.toHaveBeenCalled();
    rerender({ fn: read });
    await waitFor(() => expect(result.current.status).toBe("ok"));
  });

  it("settles error with the cause and retry reads again", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("back");
    const { result } = renderHook(() => useRetryableRead(read));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toEqual(new Error("offline"));
    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current).toMatchObject({ data: "back", error: undefined });
  });

  it("turns a synchronous throw into an error state", async () => {
    const read = vi.fn(() => {
      throw new Error("sync");
    });
    const { result } = renderHook(() => useRetryableRead<string>(read));
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("ignores retry while a read is in flight", async () => {
    const first = deferred<string>();
    const read = vi.fn().mockReturnValue(first.promise);
    const { result } = renderHook(() => useRetryableRead(read));
    act(() => result.current.retry());
    act(() => result.current.retry());
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve("done"));
    expect(result.current.status).toBe("ok");
    act(() => result.current.retry());
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous value while a retry is loading and the retry handle stays stable", async () => {
    const second = deferred<string>();
    const read = vi.fn().mockResolvedValueOnce("one").mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useRetryableRead(read));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const retry = result.current.retry;
    act(() => retry());
    expect(result.current).toMatchObject({ status: "loading", pending: true, data: "one" });
    expect(result.current.retry).toBe(retry);
    await act(async () => second.resolve("two"));
    expect(result.current).toMatchObject({ status: "ok", data: "two" });
  });

  it("drops the value at once when the read changes and ignores the old reply", async () => {
    const stale = deferred<string>();
    const a = vi.fn().mockReturnValue(stale.promise);
    const b = vi.fn().mockResolvedValue("b");
    const { result, rerender } = renderHook(({ fn }) => useRetryableRead(fn), { initialProps: { fn: a } });
    rerender({ fn: b });
    expect(result.current).toMatchObject({ status: "loading", data: undefined });
    await waitFor(() => expect(result.current.data).toBe("b"));
    await act(async () => stale.resolve("a"));
    expect(result.current).toMatchObject({ status: "ok", data: "b" });
  });

  it("ignores a late reply after a round trip back to an earlier read", async () => {
    const late = deferred<string>();
    const p1 = vi.fn().mockReturnValue(late.promise);
    const p2 = vi.fn().mockResolvedValue("p2");
    const p1Again = vi.fn().mockResolvedValue("fresh");
    const { result, rerender } = renderHook(({ fn }) => useRetryableRead(fn), { initialProps: { fn: p1 } });
    rerender({ fn: p2 });
    await waitFor(() => expect(result.current.data).toBe("p2"));
    rerender({ fn: p1Again });
    await waitFor(() => expect(result.current.data).toBe("fresh"));
    await act(async () => late.resolve("stale"));
    expect(result.current.data).toBe("fresh");
  });

  it("does not update after unmount", async () => {
    const late = deferred<string>();
    const read = vi.fn().mockReturnValue(late.promise);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = renderHook(() => useRetryableRead(read));
    unmount();
    await act(async () => late.resolve("x"));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
