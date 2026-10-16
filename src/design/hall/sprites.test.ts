import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

// Negative cases run the real script on a throw-away --root holding a tokens.css and raster sources.
const script = resolve(__dirname, "../../../scripts/dev/build-sprites.mjs");
const css = readFileSync(resolve(__dirname, "../tokens.css"), "utf8");
const tile = (id: string, row = "1".repeat(16)) => `export const frames = ${JSON.stringify({ [id]: Array(16).fill(row) })};`;
function build(files: Record<string, string>, tokens = css, args?: string[]) {
  const root = mkdtempSync(join(tmpdir(), "hall-root-"));
  for (const [path, body] of Object.entries({ "tokens.css": tokens, ...files })) {
    const file = join(root, "src", "design", path === "tokens.css" ? path : join("hall", path));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  const run = spawnSync(process.execPath, [script, "--root", root, ...(args ?? ["--out", join(root, "out")])], { encoding: "utf8" });
  return { ...run, root };
}

it("the build rejects a malformed frame id", () => {
  const run = build({ "tiles/a.px.ts": tile("tile_floor_0") });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toMatch(/tile_floor_0 is malformed/);
});

it("the build rejects a duplicate frame id", () => {
  const run = build({ "tiles/a.px.ts": tile("tile-a-0"), "tiles/b.px.ts": tile("tile-a-0") });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toMatch(/tile-a-0 is malformed or not unique/);
});

it("the build rejects a frame of the wrong size", () => {
  const run = build({ "tiles/a.px.ts": tile("tile-a-0", "1".repeat(15)) });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toMatch(/tile-a-0: frame must be 16 × 16/);
});

it("the build rejects a figure frame with more than eight colours", () => {
  const rows = ["123456789".padEnd(32, "."), ...Array(31).fill(".".repeat(32))];
  const run = build({ "figures/a.px.ts": `export const frames = ${JSON.stringify({ "fig-a-0": rows })};` });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toMatch(/fig-a-0: more than 8 colours/);
});

it("the build rejects an atlas over its size limit", () => {
  const body = 'export const frames = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`tile-a-${i}`, Array(16).fill("1".repeat(16))]));';
  const run = build({ "tiles/a.px.ts": body });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toMatch(/tiles: atlas 128 × 144 exceeds 128 × 128/);
});

it("the build rejects a token that is not an opaque hex colour", () => {
  const run = build({ "tiles/a.px.ts": tile("tile-a-0") }, css.replace("--g-ink: #121826;", "--g-ink: rgb(18 24 38);"));
  expect(run.status).not.toBe(0);
  expect(run.stderr).toMatch(/--g-ink is not an opaque hex colour/);
});

it("the build reads token blocks without a space before the brace", () => {
  const tokens = css.replace(":root {", ":root{").replace(':root[data-theme="dark"] {', ':root[data-theme="dark"]\n{');
  const run = build({ "tiles/a.px.ts": tile("tile-a-0") }, tokens);
  expect(run.stderr).toBe("");
  expect(JSON.parse(readFileSync(join(run.root, "out", "hall-tiles.json"), "utf8"))).toEqual({ "tile-a-0": [0, 0, 16, 16] });
});

it("the build creates a missing output directory", () => {
  const root = mkdtempSync(join(tmpdir(), "hall-out-"));
  const run = build({ "tiles/a.px.ts": tile("tile-a-0") }, css, ["--out", join(root, "a", "b")]);
  expect(run.stderr).toBe("");
  expect(existsSync(join(root, "a", "b", "hall-tiles-light.png"))).toBe(true);
});

it("the build fails clearly when --out has no value", () => {
  const run = build({ "tiles/a.px.ts": tile("tile-a-0") }, css, ["--out"]);
  expect(run.status).not.toBe(0);
  expect(run.stderr).toMatch(/--out needs a directory/);
});
