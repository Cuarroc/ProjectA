#!/usr/bin/env node
// DS-H-01: builds the probe hall atlases from the text rasters (docs/design/hall/ASSETS.md).
//
//   node scripts/dev/build-sprites.mjs [--out <dir>]
//
// For every sheet with raster sources (src/design/hall/<sheet>/*.px.ts) it writes
// hall-<sheet>-light.png and hall-<sheet>-dark.png (indexed PNG, palette resolved from the
// tokens of each theme) and the shared frame map hall-<sheet>.json ({ id: [x, y, w, h] }).
// Default output: src/design/hall/sprites; src/design/hall/sprites.test.ts checks that the
// committed files equal a fresh build byte for byte. Node built-ins only.

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { constants, crc32, deflateSync } from "node:zlib";

import { PALETTE, PIXELS, expand } from "../../src/design/hall/sprites/format.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hall = join(root, "src", "design", "hall");
const outAt = process.argv.indexOf("--out");
const out = outAt > 0 ? process.argv[outAt + 1] : join(hall, "sprites");

// §1 and §5: frame size (figures and tiles exactly, things in whole multiples) and atlas limit.
const SHEETS = { figures: [32, true, 256, 192], tiles: [16, true, 128, 128], things: [16, false, 128, 128] };
const MAX_PNG = 24 * 1024;
const ID = /^(tile|fig|piece|station|gate|prop)-[a-z0-9]+(-[a-z]+)?-\d+$/;

// §2: palette per theme from :root (light) and :root[data-theme="dark"]; only opaque hex qualifies.
const css = readFileSync(join(root, "src", "design", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
function tokens(selector) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`tokens.css has no ${selector} block`);
  return Object.fromEntries([...css.slice(at, css.indexOf("}", at)).matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const light = tokens(":root");
const themes = { light, dark: { ...light, ...tokens(':root[data-theme="dark"]') } };
const plte = (vars) => Buffer.concat(PALETTE.map((name) => {
  if (name === null) return Buffer.alloc(3);
  if (!/^#[0-9a-f]{6}$/i.test(vars[name] ?? "")) throw new Error(`--${name} is not an opaque hex colour: ${vars[name]}`);
  return Buffer.from(vars[name].slice(1), "hex");
}));

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

// PNG type 3, 4 bits per pixel; tRNS makes index 0 the only transparent entry.
function png(width, height, pixels, palette) {
  const stride = Math.ceil(width / 2) + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * stride + 1 + (x >> 1)] |= pixels[y * width + x] << (x & 1 ? 0 : 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([4, 3], 8);
  // Z_RLE needs no match hash, so the bytes do not depend on a zlib build's hash-chain search.
  const idat = deflateSync(raw, { level: 9, strategy: constants.Z_RLE });
  return Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), chunk("IHDR", ihdr), chunk("PLTE", palette), chunk("tRNS", Buffer.from([0])), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

for (const [sheet, [size, exact, maxW, maxH]] of Object.entries(SHEETS)) {
  const dir = join(hall, sheet);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".px.ts")).sort() : [];
  if (!files.length) continue;
  const frames = [];
  for (const file of files) frames.push(...Object.entries(expand((await import(pathToFileURL(join(dir, file)).href)).frames)));

  const map = {};
  const cells = [];
  let x = 0, y = 0, rowH = 0, width = 0;
  for (const [id, rows] of frames) {
    const w = rows[0]?.length ?? 0, h = rows.length;
    const index = rows.flatMap((row) => [...row].map((c) => PIXELS.indexOf(c)));
    if (!ID.test(id) || map[id]) throw new Error(`${sheet}: frame id ${id} is malformed or not unique (§4)`);
    if (!w || rows.some((row) => row.length !== w) || (exact ? w !== size || h !== size : w % size || h % size))
      throw new Error(`${id}: frame must be ${exact ? `${size} × ${size}` : `whole multiples of ${size}`} (§1)`);
    if (index.some((i) => i < 0 || i >= PALETTE.length)) throw new Error(`${id}: character outside the palette ${PIXELS}`);
    if (sheet === "figures" && new Set(index.filter(Boolean)).size > 8) throw new Error(`${id}: more than 8 colours (§2)`);
    if (x + w > maxW) [x, y, rowH] = [0, y + rowH, 0];
    map[id] = [x, y, w, h];
    cells.push([x, y, w, index]);
    [x, rowH, width] = [x + w, Math.max(rowH, h), Math.max(width, x + w)];
  }
  const height = y + rowH;
  if (width > maxW || height > maxH) throw new Error(`${sheet}: atlas ${width} × ${height} exceeds ${maxW} × ${maxH} (§5)`);
  const pixels = new Uint8Array(width * height);
  for (const [cx, cy, w, index] of cells) index.forEach((i, n) => { pixels[(cy + Math.floor(n / w)) * width + cx + (n % w)] = i; });

  writeFileSync(join(out, `hall-${sheet}.json`), `{\n${Object.entries(map).map(([id, r]) => `  ${JSON.stringify(id)}: ${JSON.stringify(r)}`).join(",\n")}\n}\n`);
  for (const [theme, vars] of Object.entries(themes)) {
    const bytes = png(width, height, pixels, plte(vars));
    if (bytes.length > MAX_PNG) throw new Error(`hall-${sheet}-${theme}.png is ${bytes.length} bytes, over 24 KiB (§5)`);
    writeFileSync(join(out, `hall-${sheet}-${theme}.png`), bytes);
  }
  console.log(`hall-${sheet}: ${frames.length} frame(s), ${width} × ${height}`);
}
