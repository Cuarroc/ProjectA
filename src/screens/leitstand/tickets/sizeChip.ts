import { T } from "./texts";

/** The size limit of one package (AGENTS.md rule 1); 300 itself is still within it. */
export const SIZE_LIMIT = 300;

export type SizeChip =
  | { kind: "none"; text: string }
  | { kind: "within" | "over"; lines: number; text: string };

/** Counts added plus deleted lines; context lines are never in `DiffFile`. `null` = no diff read yet. */
export function sizeChip(files: readonly { additions: number; deletions: number }[] | null): SizeChip {
  if (files === null) return { kind: "none", text: T.noDiff };
  const lines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  return lines > SIZE_LIMIT
    ? { kind: "over", lines, text: T.over(lines, SIZE_LIMIT) }
    : { kind: "within", lines, text: T.within(lines) };
}
