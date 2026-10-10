import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8");
const vars = (s: string): Record<string, string> =>
  Object.fromEntries(
    [
      ...s.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([\w-]+):\s*([^;]+);/g),
    ].map((m) => [m[1], m[2].trim()]),
  );
const block = (selector: string) =>
  css.slice(css.indexOf(selector)).split("}")[0];
const dark = vars(block(":root"));
const light = {
  ...dark,
  ...vars(block("@media (prefers-color-scheme: light)")),
};
function value(
  tokens: Record<string, string>,
  key: string,
  seen: string[] = [],
): string {
  expect(seen, `cycle at ${key}`).not.toContain(key);
  expect(tokens[key], `missing ${key}`).toBeDefined();
  return tokens[key].replace(/var\(--([\w-]+)\)/g, (_, k: string) =>
    value(tokens, k, [...seen, key]),
  );
}

it("resolves the classic theme contract in both modes", () => {
  const aliases = {
    "surface-window": "color-window",
    "surface-chrome": "color-chrome-solid",
    "surface-content": "color-content",
    "surface-card": "color-elevated",
    "surface-overlay": "color-elevated",
    "surface-edge": "color-separator",
    "shadow-card": "elev-1",
    "shadow-popover": "elev-2",
  };
  for (const tokens of [dark, light]) {
    for (const [alias, target] of Object.entries(aliases))
      expect(value(tokens, alias)).toBe(value(tokens, target));
    for (const role of [
      "surface-spec",
      "color-disabled-fg",
      "color-disabled-bg",
      "state-danger-line",
      "elev-0",
      "elev-3",
    ]) {
      expect(value(tokens, role)).toBeTruthy();
    }
    for (const [key, expected] of Object.entries({
      "material-chrome-filter": "none",
      "material-overlay-filter": "none",
      "weight-regular": "400",
      "weight-medium": "500",
      "line-tight": "1.25",
      "tracking-eyebrow": "0.06em",
      "radius-xs": "4px",
      "space-9": "32px",
      "space-10": "40px",
      "z-base": "0",
      "z-sticky": "10",
      "z-popover": "50",
      "z-modal": "100",
      "z-toast": "200",
    })) {
      expect(value(tokens, key)).toBe(expected);
    }
  }
  expect(value(light, "color-scrim").replace(/\s/g, "")).toBe(
    "rgba(0,0,0,0.32)",
  );
});

it("separates bar and form heights in both densities", () => {
  const density = css.slice(css.indexOf("/* Native desktop density"));
  const comfortable = vars(density.split("}")[0]);
  const compact = vars(block('.app[data-density="compact"]'));
  for (const [tokens, heights] of [
    [comfortable, [44, 28, 40, 24]],
    [compact, [38, 24, 32, 16]],
  ] as const) {
    ["shell-bar-h", "ui-bar-control", "ui-control-min", "ui-panel-pad"].forEach(
      (key, i) => {
        expect(value({ ...dark, ...tokens }, key)).toBe(`${heights[i]}px`);
      },
    );
  }
  expect(density).toMatch(
    /\.app \.convo-action,\s*\.app \.segment\s*\{\s*min-height: var\(--ui-bar-control\)/,
  );
  expect(density).toContain("accent-color: var(--color-accent)");
  expect(css).toMatch(
    /button:disabled\s*\{[^}]*color: var\(--color-disabled-fg\);[^}]*background: var\(--color-disabled-bg\);[^}]*opacity: 1;/,
  );
});

it("scales title tokens and rebinds legacy elevation at the app boundary", () => {
  for (const [size, xl, hero] of [
    ["small", 16, 21],
    ["normal", 18, 24],
    ["large", 21, 28],
  ] as const) {
    const tokens = {
      ...dark,
      ...(size === "normal"
        ? {}
        : vars(block(`.app[data-ui-font-size="${size}"]`))),
    };
    expect(value(tokens, "text-xl")).toBe(`${xl}px`);
    expect(value(tokens, "text-2xl")).toBe(`${hero}px`);
  }
  const density = css
    .slice(css.indexOf("/* Native desktop density"))
    .split("}")[0];
  expect(vars(density)["shadow-card"]).toBe("var(--elev-1)");
  expect(vars(density)["shadow-popover"]).toBe("var(--elev-2)");
});

it("rejects unreadable control disabled and scrim pairs", () => {
  const scriptPath = resolve(__dirname, "../scripts/contrast-check.mjs");
  const script = readFileSync(scriptPath, "utf8").replace(
    "fileURLToPath(import.meta.url)",
    JSON.stringify(scriptPath),
  );
  for (const [token, replacement] of [
    ["color-control-border", "#1e1e20"],
    ["color-disabled-fg", "#333336"],
    ["color-scrim", "rgba(0, 0, 0, 0)"],
  ]) {
    const mutated = css.replace(
      new RegExp(`--${token}: [^;]+;`),
      `--${token}: ${replacement};`,
    );
    const run = spawnSync(process.execPath, ["--input-type=module"], {
      input: script.replace(
        'readFileSync(join(here, "..", "src", "styles.css"), "utf8")',
        JSON.stringify(mutated),
      ),
      encoding: "utf8",
    });
    expect(run.status, token).toBe(1);
    expect(run.stdout, token).toContain("NICHT BESTANDEN");
  }
});
