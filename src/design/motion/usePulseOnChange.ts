import { useEffect, useRef } from "react";

/** Ref for an element that carries `data-ping` for `ms` after `value` changes (never on mount): a one-shot ping, not a loop.
 *  The attribute is set on the node, not in state, so a ping costs no extra render. */
export function usePulseOnChange<T extends HTMLElement>(value: unknown, ms = 480) {
  const node = useRef<T>(null);
  const last = useRef(value);
  useEffect(() => {
    const el = node.current;
    if (!el || Object.is(last.current, value)) return;
    last.current = value;
    el.setAttribute("data-ping", "");
    const timer = setTimeout(() => el.removeAttribute("data-ping"), ms);
    return () => { clearTimeout(timer); el.removeAttribute("data-ping"); };
  }, [value, ms]);
  return node;
}
