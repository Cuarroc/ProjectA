import { useCallback, useLayoutEffect, useRef } from "react";

export interface PolledRequest {
  current: () => boolean;
  finish: () => void;
}

/** Request-token and overlap guard shared by keyed polling consumers. */
export function usePolledResource(key: string | null): (replace?: boolean) => PolledRequest | null {
  const generation = useRef(0);
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    generation.current += 1;
    pending.current = null;
    return () => {
      generation.current += 1;
      pending.current = null;
    };
  }, [key]);

  return useCallback((replace = false) => {
    if (pending.current !== null && !replace) return null;
    const mine = ++generation.current;
    pending.current = mine;
    return {
      current: () => generation.current === mine,
      finish: () => {
        if (pending.current === mine) pending.current = null;
      },
    };
  }, []);
}
