// DS-H-01: the sprite format of docs/design/hall/ASSETS.md. A raster is one string per row, one
// character per pixel; the character's position in PIXELS is its palette index ("." = 0 = transparent).
// A frame is a raster or a delta whose `rows` replace whole rows of the earlier frame `from` (§5).
// Raster sources are `src/design/hall/<sheet>/*.px.ts` exporting `frames`. scripts/dev/build-sprites.mjs
// loads them and this file with Node's type stripping, so all of them use erasable TypeScript only.

export type Raster = readonly string[];
export type Frame = Raster | { readonly from: string; readonly rows: Readonly<Record<number, string>> };
export type Frames = Readonly<Record<string, Frame>>;

export const PIXELS = ".123456789abcdef";

/** Palette index → token of src/design/tokens.css (§2); index 0 is transparent and has none. */
export const PALETTE = [
  null, "g-ink", "g-ink2", "g-muted", "g-faint", "g-ground", "g-av1", "g-av2",
  "g-av4", "g-av5", "g-av3", "g-av6", "g-amb1", "g-amb2", "g-amb3", "g-px-skin",
] as const;

/** Resolves delta frames into full rasters, keeping the source order. */
export function expand(frames: Frames): Record<string, Raster> {
  const out: Record<string, Raster> = {};
  for (const [id, frame] of Object.entries(frames)) {
    // A `from` that is unknown or comes later yields an empty frame, which the size checks reject.
    out[id] = "from" in frame ? (out[frame.from] ?? []).map((row, y) => frame.rows[y] ?? row) : frame;
  }
  return out;
}
