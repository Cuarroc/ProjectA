import { useEffect, useRef } from "react";

/** Initial read plus a heal when this webview becomes active again. */
export function useRefreshOnResume(refresh: () => void): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const run = () => refreshRef.current();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") run();
    };

    run();
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
}
