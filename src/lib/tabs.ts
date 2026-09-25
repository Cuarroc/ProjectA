import type { KeyboardEvent } from "react";

/**
 * The keyboard half of the WAI-ARIA tabs pattern, shared by every
 * `role="tablist"` in the app (APP-5 of the ui-ux-pro-max audit).
 *
 * A tablist is one tab stop: only the selected tab has `tabIndex={0}`, the
 * others `-1`, and the arrow keys move both selection and focus. Selection
 * follows focus ("automatic activation"), which is the right choice here
 * because every tab switch in this app is cheap and synchronous.
 */

/** Where an arrow, Home or End key moves the selection; `null` for other keys. */
export function tabTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  const at = current < 0 || current >= count ? -1 : current;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return at < 0 ? 0 : (at + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return at < 0 ? count - 1 : (at - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Key handler for the tablist element. `select` receives the new index; the
 * matching `[role="tab"]` child is focused so the ring follows the selection.
 */
export function handleTablistKey(
  event: KeyboardEvent<HTMLElement>,
  current: number,
  count: number,
  select: (index: number) => void,
): void {
  const next = tabTarget(event.key, current, count);
  if (next === null) return;
  event.preventDefault();
  select(next);
  const tabs = event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
  tabs[next]?.focus();
}

/** `tabIndex` for one tab: the selected one is the tab stop; with no selection, the first. */
export function tabStop(selected: boolean, index: number, anySelected: boolean): 0 | -1 {
  if (selected) return 0;
  return !anySelected && index === 0 ? 0 : -1;
}
