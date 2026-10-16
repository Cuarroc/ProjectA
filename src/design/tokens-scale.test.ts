import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { BREAKPOINTS } from "./breakpoints";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = strip(readFileSync(resolve(__dirname, "tokens.css"), "utf8"));
const darkAt = tokens.indexOf("@media (prefers-color-scheme: dark)");
// Scales do not change with the theme, so they belong to the light root block only.
const light = Object.fromEntries(
  [...tokens.slice(0, darkAt).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);

const sans = "var(--g-font-sans)";
const scales: Record<string, string> = {
  "--g-t-display": `600 28px/1.1 ${sans}`,
  "--g-t-title": `600 20px/1.3 ${sans}`,
  "--g-t-heading": `600 15px/1.3 ${sans}`,
  "--g-t-subheading": `600 13px/1.3 ${sans}`,
  "--g-t-body": `400 13px/1.5 ${sans}`,
  "--g-t-label": `500 12px/1.3 ${sans}`,
  "--g-t-note": `400 12px/1.45 ${sans}`,
  "--g-t-micro": `500 11px/1.3 ${sans}`,
  "--g-t-code": "400 12px/1.5 var(--g-font-mono)",
  "--g-track-display": "-0.01em",
  "--g-track-eyebrow": "0.06em",
  // Same numbering as the classic --space-N, so a migration is a rename.
  ...Object.fromEntries([2, 4, 6, 8, 10, 12, 16, 24, 32, 40].map((px, i) => [`--g-space-${i + 1}`, `${px}px`])),
  "--g-r-xs": "4px", "--g-r-sm": "6px", "--g-r-md": "8px", "--g-r-ctl": "10px", "--g-r-lg": "12px",
  "--g-r-card": "14px", "--g-r-panel": "20px", "--g-r-sheet": "24px", "--g-r-pill": "999px",
  "--g-h-chip": "24px", "--g-h-sm": "32px", "--g-h-md": "36px", "--g-h-field": "40px", "--g-h-lg": "44px",
  "--g-z-sticky": "2", "--g-z-popover": "10", "--g-z-scrim": "50", "--g-z-toast": "60", "--g-z-tooltip": "70",
  "--g-focus": "2px solid var(--g-accent)", "--g-focus-offset": "2px",
  "--g-elev-1": "var(--g-spec), var(--g-shadow)", "--g-elev-2": "var(--g-spec), var(--g-shadow-pop)",
};

it("defines the foundation scales in the light root block", () => {
  expect(darkAt).toBeGreaterThan(-1);
  const found = Object.fromEntries(Object.keys(scales).map((name) => [name, light[name]]));
  expect(found).toEqual(scales);
  // The token must be the ring the baseline already draws, so adopting it changes nothing.
  const base = strip(readFileSync(resolve(__dirname, "base.css"), "utf8"));
  expect(base).toContain(`outline: ${light["--g-focus"]};`);
  expect(base).toContain(`outline-offset: ${light["--g-focus-offset"]};`);
});

// Every min-/max-width in every @media header, not only the last one per header.
const mediaWidths = (css: string) =>
  [...css.matchAll(/@media([^{]*)\{/g)].flatMap((header) =>
    [...header[1].matchAll(/\(\s*(?:min|max)-width:\s*(\d+)px\s*\)/g)].map((m) => Number(m[1])),
  );

it("documents the breakpoint scale and allows no other media width in CSS", () => {
  expect(BREAKPOINTS).toEqual({ sm: 640, md: 900, lg: 1280 });
  // Debt: widths used before the scale (beweise.css, mount.css and shell.css, quotaBar.css). Remove entries, never add.
  const legacy = [600, 760, 1100];
  const src = resolve(__dirname, "..");
  const used = new Set<number>();
  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".css")) continue;
    const css = strip(readFileSync(resolve(src, file), "utf8"));
    for (const width of mediaWidths(css)) used.add(width);
  }
  expect(used.size).toBeGreaterThan(0);
  const allowed = new Set<number>([...Object.values(BREAKPOINTS), ...legacy]);
  expect([...used].filter((width) => !allowed.has(width))).toEqual([]);
});

it("reads every width condition in a media query header", () => {
  expect(mediaWidths("@media (min-width: 777px) and (max-width: 1280px) { a { b: c } }")).toEqual([777, 1280]);
  expect(mediaWidths("@media (max-width: 777px), (max-width: 1280px) { a { b: c } }")).toEqual([777, 1280]);
});
