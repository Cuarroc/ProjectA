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
