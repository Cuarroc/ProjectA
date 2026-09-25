import { useEffect, type RefObject } from "react";

/**
 * Keeps keyboard focus inside a modal dialog and hands it back afterwards
 * (APP-7 / APP-18 of the ui-ux-pro-max audit).
 *
 * `aria-modal="true"` tells assistive technology that the rest of the page is
 * gone; this hook makes the keyboard agree. On mount it remembers the element
 * that opened the dialog and, unless the dialog already focused something
 * itself, moves focus to its first focusable control. Tab and Shift+Tab wrap
 * at the edges. On unmount the opener gets focus back, if it is still there.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable descendants in document order, skipping hidden ones. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => !node.hidden && node.getAttribute("aria-hidden") !== "true",
  );
}

/** Where Tab (or Shift+Tab) should land; `null` when the trap has nothing to do. */
export function trapTarget(
  focusables: HTMLElement[],
  active: Element | null,
  backwards: boolean,
): HTMLElement | null {
  if (focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const index = active instanceof HTMLElement ? focusables.indexOf(active) : -1;
  if (index === -1) return backwards ? last : first;
  if (backwards && index === 0) return last;
  if (!backwards && index === focusables.length - 1) return first;
  return null;
}

export function useFocusTrap(dialogRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Give the dialog's own autofocus a chance first (ProfilePicker focuses
    // its first entry, forms use autoFocus); only fill the gap if it stays.
    const raf = window.requestAnimationFrame(() => {
      if (!dialog.contains(document.activeElement)) {
        const first = focusableWithin(dialog)[0];
        if (first) first.focus();
        else {
          dialog.tabIndex = -1;
          dialog.focus();
        }
      }
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const target = trapTarget(focusableWithin(dialog), document.activeElement, event.shiftKey);
      if (!target) return;
      event.preventDefault();
      target.focus();
    };
    dialog.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(raf);
      dialog.removeEventListener("keydown", onKeyDown);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [dialogRef]);
}
