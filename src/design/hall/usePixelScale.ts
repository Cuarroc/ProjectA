import { useSyncExternalStore } from "react";

// DS-H-01 (ASSETS.md §1): one art pixel is a whole number of device pixels at 100, 125 and 150 % scaling,
// so pixelated sprites never blur or get uneven pixel widths.

/** device = device pixels per art pixel (whole), css = the same length in CSS pixels, nearest to `target`. */
export function pixelScale(dpr: number, target = 2) {
  const device = Math.max(1, Math.round(target * dpr));
  return { device, css: device / dpr };
}

// A ratio change (scale setting, other monitor) fires only on a query for the current ratio, so re-arm on each change.
function subscribe(notify: () => void) {
  let list: MediaQueryList | null = null;
  const onChange = () => { arm(); notify(); };
  const arm = () => {
    list?.removeEventListener("change", onChange);
    list = typeof window.matchMedia === "function" ? window.matchMedia(`(resolution:${window.devicePixelRatio}dppx)`) : null;
    list?.addEventListener("change", onChange);
  };
  arm();
  return () => list?.removeEventListener("change", onChange);
}

export const usePixelScale = (target = 2) => pixelScale(useSyncExternalStore(subscribe, () => window.devicePixelRatio), target);
