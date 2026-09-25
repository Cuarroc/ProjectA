/** Longest tab label we are willing to render before clipping. */
const TAB_LABEL_MAX = 26;

/**
 * A worker task is free-form multi-line text; tabs and dense lists want one
 * short line of it.
 */
export function shortTask(task: string, max = TAB_LABEL_MAX): string {
  const firstLine = task.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const label = firstLine || "untitled task";
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/**
 * Token counts in the compact form the label needs: `842`, `137k`, `1M`,
 * `1.5M`. Fractions are only kept in the millions, where they carry meaning.
 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0";
  if (count < 1_000) return String(Math.round(count));
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  const millions = count / 1_000_000;
  const rounded = millions < 10 ? Math.round(millions * 10) / 10 : Math.round(millions);
  return `${rounded}M`;
}
