import { useEffect, useRef } from "react";
import {
  backdropCandidates,
  createBackdropRuntime,
} from "../design/themes/backdrop/runtime";
import type { UiThemeStyle } from "../lib/settings";

/**
 * Decorative layer behind the app shell. Classic style keeps the current look
 * (renders nothing). Other styles mount the backdrop runtime, which draws
 * whatever renderers the theme registered (none yet: the CSS layer shows).
 */
export default function ThemeBackdrop({ style }: { style: UiThemeStyle }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (style === "klassisch" || !host.current) return;
    const runtime = createBackdropRuntime({
      host: host.current,
      candidates: backdropCandidates(style),
      webgl: import.meta.env.VITE_PA_BACKDROP_WEBGL === "true",
      exposeStats: import.meta.env.DEV,
    });
    if (runtime.stats.kind === "css") return runtime.dispose; // nothing draws, nothing to guard
    // A modal dialog blurs what is behind it: stop drawing while one is open.
    const watch = () => runtime.setOverlay(document.querySelector('[aria-modal="true"]') !== null);
    const overlays = new MutationObserver(watch);
    overlays.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-modal"] });
    watch();
    return () => {
      overlays.disconnect();
      runtime.dispose();
    };
  }, [style]);
  if (style === "klassisch") return null;
  return <div ref={host} className="theme-backdrop" data-style={style} aria-hidden="true" />;
}
