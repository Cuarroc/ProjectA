import { useEffect } from "react";

/** Initial read plus a heal when this webview becomes active again. */
export function useRefreshOnResume(refresh: () => void): void {
  useEffect(() => {
    const run = () => refresh();
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
  }, [refresh]);
}
