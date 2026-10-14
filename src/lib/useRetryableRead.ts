import { useCallback, useEffect, useRef, useState } from "react";

export type RetryableReadStatus = "idle" | "loading" | "ok" | "error";

export interface RetryableRead<T> {
  status: RetryableReadStatus;
  /** The last value that was read for the current `read`; kept while a retry loads, dropped when `read` changes. */
  data: T | undefined;
  error: unknown;
  pending: boolean;
  /** Reads again; ignored while a read is in flight or when there is no read. Stable identity. */
  retry: () => void;
}

interface Slot<T> {
  read: (() => Promise<T>) | null;
  status: RetryableReadStatus;
  data: T | undefined;
  error: unknown;
}

/**
 * One failed-read-then-retry cycle shared by the screens: reads on mount and whenever `read`
 * changes (memoise it on its inputs), and `retry()` rereads on demand. A reply only lands while
 * its own read is still the newest, so a late answer of an earlier project, plan or unmounted
 * screen is dropped. `null` keeps the hook idle.
 */
export function useRetryableRead<T>(read: (() => Promise<T>) | null): RetryableRead<T> {
  const [slot, setSlot] = useState<Slot<T>>({ read, status: read ? "loading" : "idle", data: undefined, error: undefined });
  const token = useRef(0);
  const inFlight = useRef(false);
  const latest = useRef(read);

  const run = useCallback((fn: () => Promise<T>) => {
    const mine = ++token.current;
    inFlight.current = true;
    setSlot((prev) => (prev.read === fn && prev.status === "loading" ? prev : { read: fn, status: "loading", data: prev.read === fn ? prev.data : undefined, error: undefined }));
    let reply: Promise<T>;
    try {
      reply = fn();
    } catch (cause) {
      reply = Promise.reject(cause);
    }
    reply.then(
      (data) => {
        if (token.current !== mine) return;
        inFlight.current = false;
        setSlot({ read: fn, status: "ok", data, error: undefined });
      },
      (error: unknown) => {
        if (token.current !== mine) return;
        inFlight.current = false;
        setSlot((prev) => ({ read: fn, status: "error", data: prev.read === fn ? prev.data : undefined, error }));
      },
    );
  }, []);

  useEffect(() => {
    latest.current = read;
    if (read === null) {
      setSlot({ read: null, status: "idle", data: undefined, error: undefined });
      return;
    }
    run(read);
    return () => {
      token.current += 1;
      inFlight.current = false;
    };
  }, [read, run]);

  const retry = useCallback(() => {
    if (inFlight.current || latest.current === null) return;
    run(latest.current);
  }, [run]);

  // Until the effect has started the new read, show it as loading rather than the old read's result.
  const view: Slot<T> = read === null
    ? { read, status: "idle", data: undefined, error: undefined }
    : slot.read === read ? slot : { read, status: "loading", data: undefined, error: undefined };
  return { status: view.status, data: view.data, error: view.error, pending: view.status === "loading", retry };
}
