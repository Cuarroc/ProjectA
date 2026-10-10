import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * PKG-U (UM-6): safety-critical settings controls must not ship as bare
 * <button> elements. A missing className drops hover, focus chrome and the
 * danger surface — Not-Aus then looks like plain text.
 */
const COMPONENTS = join(__dirname, "components");
const STYLES = join(__dirname, "styles.css");

/** Known remaining unfinished controls owned by later packages. */
const ALLOWED_UNSTYLED = new Set([
  "TabBar.tsx",
  "DiagnosticsPanel.tsx",
]);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(full);
      continue;
    }
    if (!entry.endsWith(".tsx")) continue;
    if (entry.includes(".test.") || entry.includes(".spec.")) continue;
    yield full;
  }
}

function unstyledButtonsIn(file: string): number[] {
  const text = readFileSync(file, "utf8");
  const lines: number[] = [];
  const re = /<button\b([^>]*?)>/gs;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (!/\bclassName\s*=/.test(match[1])) {
      lines.push(text.slice(0, match.index).split("\n").length);
    }
  }
  return lines;
}

describe("unstyled buttons", () => {
  it("EmergencyStop and MaintenancePanel buttons carry a style class", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(COMPONENTS)) {
      const base = relative(COMPONENTS, file).replace(/\\/g, "/");
      if (base !== "EmergencyStop.tsx" && base !== "settings/MaintenancePanel.tsx") continue;
      for (const line of unstyledButtonsIn(file)) {
        offenders.push(`${base}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("styles.css defines a button-danger variant", () => {
    const css = readFileSync(STYLES, "utf8");
    expect(css).toMatch(/\.button-danger\s*\{/);
    expect(css).toMatch(/\.button-danger:focus-visible\s*\{/);
    expect(css).toMatch(/--state-danger-fg/);
  });

  it("button-danger uses contrast-safe solid danger fill tokens", () => {
    const css = readFileSync(STYLES, "utf8");
    expect(css).toMatch(/--color-danger-solid:\s*#[0-9a-fA-F]{6}/);
    expect(css).toMatch(/--color-on-danger:\s*#[0-9a-fA-F]{6}/);
    const block = css.match(/\.button-danger\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/background:\s*var\(--color-danger-solid\)/);
    expect(block).toMatch(/color:\s*var\(--color-on-danger\)/);
    expect(block).not.toMatch(/background:\s*var\(--state-danger-fg\)/);
    const hover = css.match(/\.button-danger:hover:not\(:disabled\)\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(hover).not.toMatch(/--state-danger-bg/);
    expect(hover).toMatch(/color-mix|var\(--color-danger-solid\)/);
    const gate = readFileSync(join(__dirname, "..", "scripts", "contrast-check.mjs"), "utf8");
    expect(gate).toMatch(/on-danger \/ danger-solid/);
  });

  it("button-danger disabled uses neutral disabled treatment at full opacity", () => {
    const css = readFileSync(STYLES, "utf8");
    const block = css.match(/\.button-danger:disabled\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/opacity:\s*1/);
    expect(block).toMatch(/background:\s*var\(--color-elevated\)/);
    expect(block).toMatch(/color:\s*var\(--color-text-tertiary\)/);
  });

  it("button-danger focus ring uses the shared focus token", () => {
    const css = readFileSync(STYLES, "utf8");
    const block = css.match(/\.button-danger:focus-visible\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/outline:\s*2px\s+solid\s+var\(--color-focus-ring\)/);
    expect(block).not.toMatch(/--state-danger-fg/);
  });

  it("button-danger geometry and press use shared control tokens", () => {
    const css = readFileSync(STYLES, "utf8");
    const block = css.match(/\.button-danger\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/padding:\s*var\(--space-3\)\s+var\(--space-6\)/);
    expect(block).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(block).toMatch(/min-height:\s*var\(--ui-control-min\)/);
    expect(block).not.toMatch(/padding:\s*6px\s+14px/);
    const active = css.match(/\.button-danger:active:not\(:disabled\)\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(active).toMatch(/scale\(var\(--press-scale\)\)/);
    expect(active).not.toMatch(/scale\(0\.97\)/);
  });

  it("settings port ghost buttons use a bordered secondary treatment", () => {
    const css = readFileSync(STYLES, "utf8");
    const block = css.match(/\.settings-port-row\s+\.button-ghost\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/border:\s*1px\s+solid\s+var\(--border\)/);
    expect(block).toMatch(/min-height:\s*var\(--ui-control-min\)/);
  });

  it("no new unstyled buttons appear outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(COMPONENTS)) {
      const base = relative(COMPONENTS, file).replace(/\\/g, "/");
      const name = base.split("/").pop()!;
      if (ALLOWED_UNSTYLED.has(name)) continue;
      for (const line of unstyledButtonsIn(file)) {
        offenders.push(`${base}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
