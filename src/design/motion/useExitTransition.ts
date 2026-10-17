// DS-X-07 stub (red-first): no exit yet, the node is mounted exactly while `open`.
export const EXIT_MS = 120;

export function useExitTransition(open: boolean, _ms = EXIT_MS): { mounted: boolean; closing: boolean } {
  return { mounted: open, closing: false };
}
