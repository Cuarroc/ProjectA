import { useEffect, useState } from "react";

import { useMotion } from "./motionMode";

/** Mirrors `--g-dur-exit` in motion.css: the CSS exit animation and the unmount timer must agree. */
export const EXIT_MS = 120;

// DS-X-07: a closing node stays mounted for `ms` so the exit animation (keyed on `data-state="closing"`) can play.
// Reduced motion (OS or Aus) unmounts at once, in the same render.
export function useExitTransition(open: boolean, ms = EXIT_MS): { mounted: boolean; closing: boolean } {
  const { reduced } = useMotion();
  const [kept, setKept] = useState(open);
  if (open && !kept) setKept(true);
  useEffect(() => {
    if (open) return;
    if (reduced) { setKept(false); return; }
    const timer = setTimeout(() => setKept(false), ms);
    return () => clearTimeout(timer);
  }, [open, reduced, ms]);
  const mounted = open || (kept && !reduced);
  return { mounted, closing: mounted && !open };
}
