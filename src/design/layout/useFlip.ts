import { useLayoutEffect, useState, type RefObject } from "react";

/** Keep in step with the `calc(100% + 8px)` offsets in layout.css. */
const GAP = 8;

/** Which side of `anchor` the open `panel` fits on: below, or above when there is no room below and room above. Measured once, when it opens. */
export function useFlip(open: boolean, anchor: RefObject<HTMLElement>, panel: RefObject<HTMLElement>): "top" | "bottom" {
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const { top, bottom } = anchor.current.getBoundingClientRect();
    const need = panel.current.offsetHeight + GAP;
    setSide(bottom + need > window.innerHeight && top - need >= 0 ? "top" : "bottom");
  }, [open, anchor, panel]);
  return side;
}
