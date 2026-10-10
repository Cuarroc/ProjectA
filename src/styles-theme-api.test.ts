import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const block = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
const vars = (source: string): Record<string, string> => Object.fromEntries(
  [...source.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);
const dark = vars(block(":root"));
const light = { ...dark, ...vars(block("@media (prefers-color-scheme: light)")) };
function value(tokens: Record<string, string>, name: string, seen: string[] = []): string {
  expect(seen, `cycle at ${name}`).not.toContain(name);
  expect(tokens[name], `missing ${name}`).toBeDefined();
  return tokens[name].replace(/var\(--([\w-]+)\)/g, (_, ref: string) => value(tokens, ref, [...seen, name]));
}

it("contract roles resolve in both color modes with solid classic surfaces", () => {
  const roles = ["surface-edge", "surface-spec", "color-disabled-fg", "color-disabled-bg",
    "state-danger-line", "elev-0", "elev-1", "elev-2", "elev-3", "radius-xs",
    "weight-regular", "weight-medium", "line-tight", "tracking-eyebrow", "space-9", "space-10"];
  for (const tokens of [dark, light]) {
    for (const role of roles) expect(value(tokens, role)).not.toMatch(/var\(/);
    for (const [role, legacy] of Object.entries({window:"window", chrome:"chrome-solid", content:"content", card:"elevated", overlay:"elevated"})) {
      expect(value(tokens, `surface-${role}`)).toBe(value(tokens, `color-${legacy}`));
    }
    for (const kind of ["chrome", "overlay"]) expect(value(tokens, `material-${kind}-filter`)).toBe("none");
    for (const [layer, n] of Object.entries({base:0, sticky:10, popover:50, modal:100, toast:200})) {
      expect(value(tokens, `z-${layer}`)).toBe(String(n));
    }
    expect(value(tokens, "shadow-card")).toBe(value(tokens, "elev-1"));
    expect(value(tokens, "shadow-popover")).toBe(value(tokens, "elev-2"));
    expect(value(tokens, "radius-xs")).toBe("4px");
    expect(value(tokens, "line-tight")).toBe("1.25");
    expect(value(tokens, "tracking-eyebrow")).toBe("0.06em");
  }
  expect(value(dark, "color-scrim")).toBe("rgba(0, 0, 0, 0.5)");
  expect(value(light, "color-scrim")).toBe("rgba(0, 0, 0, 0.32)");
});

it("title sizes scale across small normal and large", () => {
  for (const [size, xl, hero] of [["small", "16px", "21px"], ["normal", "18px", "24px"], ["large", "21px", "28px"]]) {
    const tokens = { ...dark, ...(size === "normal" ? {} : vars(block(`.app[data-ui-font-size="${size}"]`))) };
    expect(value(tokens, "text-xl")).toBe(xl);
    expect(value(tokens, "text-2xl")).toBe(hero);
  }
});

it("disabled buttons use readable tokens without opacity and native controls inherit accent", () => {
  const disabled = block(".app button:disabled");
  expect(disabled).toContain("color: var(--color-disabled-fg)");
  expect(disabled).toContain("background: var(--color-disabled-bg)");
  expect(disabled).toContain("opacity: 1");
  expect(css).toMatch(/\.app\s*\{[^}]*accent-color: var\(--color-accent\)/);
});
