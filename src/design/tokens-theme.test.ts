import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const MEDIA = "@media (prefers-color-scheme: dark)";
const mediaAt = css.indexOf(MEDIA);
// The media block holds exactly one rule; everything up to the closing "}\n}"
// belongs to it.
const mediaEnd = css.indexOf("\n}", css.indexOf("\n  }", mediaAt) + 1);
const mediaText = mediaAt < 0 ? "" : css.slice(mediaAt, mediaEnd + 2);
const afterMedia = mediaAt < 0 ? "" : css.slice(mediaEnd + 2);

function rule(text: string, selectorPattern: RegExp): { selector: string; body: string } | undefined {
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].replace(/@media[^{]*$/, "").trim();
    if (selectorPattern.test(selector)) return { selector, body: m[2] };
  }
  return undefined;
}

function props(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const mediaDark = rule(mediaText, /^:root/);
const attrDark = rule(afterMedia, /^:root\[data-theme="dark"\]$/);
const lightRoot = rule(css.slice(0, mediaAt < 0 ? css.length : mediaAt), /^:root$/);

it("media dark block is scoped to root not light attribute", () => {
  expect(mediaDark?.selector).toBe(':root:not([data-theme="light"])');
});

it("explicit dark attribute block follows the media block", () => {
  expect(mediaAt).toBeGreaterThan(-1);
  expect(attrDark).toBeDefined();
});

it("both dark blocks declare identical properties and values", () => {
  expect(mediaDark).toBeDefined();
  expect(attrDark).toBeDefined();
  const a = props(mediaDark?.body ?? "");
  const b = props(attrDark?.body ?? "");
  expect(Object.keys(a).length).toBeGreaterThan(30);
  expect(b).toEqual(a);
});

it("color-scheme is light on root and dark in both dark blocks", () => {
  expect(props(lightRoot?.body ?? "")["color-scheme"]).toBe("light");
  expect(props(mediaDark?.body ?? "")["color-scheme"]).toBe("dark");
  expect(props(attrDark?.body ?? "")["color-scheme"]).toBe("dark");
});

it("dark accent-soft alpha is 0.12 in both dark blocks", () => {
  const want = "rgba(110, 155, 255, 0.12)";
  expect(props(mediaDark?.body ?? "")["--g-accent-soft"]).toBe(want);
  expect(props(attrDark?.body ?? "")["--g-accent-soft"]).toBe(want);
});
