export type SizeChip =
  | { kind: "none"; text: string }
  | { kind: "within" | "over"; lines: number; text: string };

export function sizeChip(_files: readonly { additions: number; deletions: number }[] | null): SizeChip {
  return { kind: "none", text: "" };
}
