import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

import { expand, PALETTE, PIXELS, type Frames } from "./sprites/format";

const atlasDir = join(__dirname, "sprites");
const sources = import.meta.glob<{ frames: Frames }>("./*/*.px.ts", { eager: true });

it("generated atlas equals the committed atlas", () => {
  const out = mkdtempSync(join(tmpdir(), "hall-sprites-"));
  execFileSync(process.execPath, [resolve(__dirname, "../../../scripts/dev/build-sprites.mjs"), "--out", out]);
  const built = readdirSync(out).sort();
  expect(built.length).toBeGreaterThan(0);
  expect(readdirSync(atlasDir).filter((f) => f.startsWith("hall-")).sort()).toEqual(built);
  for (const f of built) expect(Buffer.compare(readFileSync(join(out, f)), readFileSync(join(atlasDir, f))), f).toBe(0);
});

it("every frame is 32 by 32 and uses only palette entries", () => {
  const figures = Object.entries(sources).filter(([path]) => path.startsWith("./figures/"));
  expect(figures.length).toBeGreaterThan(0);
  expect(PIXELS).toHaveLength(PALETTE.length);
  for (const [path, { frames }] of figures) {
    for (const [id, rows] of Object.entries(expand(frames))) {
      expect(rows, `${path} ${id}`).toHaveLength(32);
      for (const row of rows) expect(row, `${path} ${id}`).toMatch(new RegExp(`^[${PIXELS}]{32}$`));
    }
  }
});

it("a delta frame replaces only its rows of the base frame", () => {
  const frames: Frames = { "fig-a-0": ["11", "22"], "fig-a-1": { from: "fig-a-0", rows: { 1: "33" } } };
  expect(expand(frames)).toEqual({ "fig-a-0": ["11", "22"], "fig-a-1": ["11", "33"] });
});

it("provenance lists every raster source once under MIT", () => {
  const entries: { file: string; license: string }[] = JSON.parse(readFileSync(join(atlasDir, "provenance.json"), "utf8"));
  // Equality with the glob also proves every listed file exists.
  expect(entries.map((e) => e.file).sort()).toEqual(Object.keys(sources).map((p) => `src/design/hall/${p.slice(2)}`).sort());
  for (const e of entries) expect(e.license, e.file).toBe("MIT");
});
