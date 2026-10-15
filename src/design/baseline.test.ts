import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("provides the global baseline without classic styles", () => {
  const path = resolve(__dirname, "base.css");
  expect(existsSync(path)).toBe(true);
  const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string) => {
    const block = css.split("}").find((part) => part.slice(0, part.lastIndexOf("{")).trim() === selector);
    expect(block, selector).toBeDefined();
    return block!.slice(block!.lastIndexOf("{") + 1);
  };
  expect(css).toContain('@import "./tokens.css";');
  expect(css).not.toMatch(/styles\.css|var\(--(?!g-)/);
  expect(rule("*, *::before, *::after")).toContain("box-sizing: border-box;");
  expect(rule("html, body, #root")).toContain("height: 100%;");
  expect(rule("html, body, #root")).toContain("margin: 0;");
  for (const value of ["var(--g-font-sans)", "var(--g-ground)", "var(--g-ink)", "overflow: hidden;"]) {
    expect(rule("body")).toContain(value);
  }
  for (const value of ["font: inherit;", "color: inherit;", "background: none;", "border: none;"]) {
    expect(rule("button")).toContain(value);
  }
  expect(rule(":focus-visible")).toContain("outline: 2px solid var(--g-accent);");
  expect(rule(":focus-visible")).toContain("outline-offset: 2px;");
  for (const value of ["position: absolute;", "width: 1px;", "height: 1px;", "overflow: hidden;", "clip-path: inset(50%);", "white-space: nowrap;"]) {
    expect(rule(".sr-only")).toContain(value);
  }
  expect(rule(".sr-only")).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => match[1]);
  expect(faces).toHaveLength(4);
  for (const [weight, file] of [[400, "Regular"], [500, "Medium"], [600, "SemiBold"], [700, "Bold"]]) {
    const face = faces.find((block) => block.includes(`font-weight: ${weight};`));
    expect(face).toContain('font-family: "Inter";');
    expect(face).toContain(`url("/fonts/Inter-${file}.otf")`);
    expect(face).toContain("font-display: swap;");
    expect(existsSync(resolve(__dirname, `../../public/fonts/Inter-${file}.otf`))).toBe(true);
  }
  expect(css).not.toMatch(/https?:/);
});

it("imports the design baseline before classic styles", () => {
  const main = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
  const imports = [...main.matchAll(/import "([^"]+\.css)"/g)].map((match) => match[1]);
  expect(imports).toContain("./design/base.css");
  expect(imports).toContain("./styles.css");
  expect(imports.indexOf("./design/base.css")).toBeLessThan(imports.indexOf("./styles.css"));
});

it("shortens design duration tokens without globally disabling reduced motion effects", () => {
  const css = readFileSync(resolve(__dirname, "base.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(css).not.toMatch(/(?:animation|transition):\s*none\s*!important/);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  const root = reduced.match(/html:root\s*\{([^}]+)\}/)?.[1];
  expect(root).toBeDefined();
  for (const token of ["--g-dur", "--g-dur-1", "--g-dur-2", "--g-dur-3"]) {
    expect(root).toContain(`${token}: 80ms;`);
  }
  expect(reduced).toMatch(/scroll-behavior:\s*auto/);
});
