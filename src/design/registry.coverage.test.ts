import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COMPONENT_REGISTRY } from "./registry";

// DS-X-14: like the tauriBrowserMock coverage test, this reads source text so a
// new `export function` component without a registry entry (or an entry whose
// component was renamed or removed) turns the test red.
const designDir = dirname(fileURLToPath(import.meta.url));

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** Exported function name -> file, for every component file under src/design. */
function exportedComponents(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of componentFiles(designDir)) {
    for (const match of readFileSync(file, "utf8").matchAll(/^export function (\w+)/gm)) found.set(match[1], file);
  }
  return found;
}

describe("design component registry", () => {
  const exported = exportedComponents();
  const names = COMPONENT_REGISTRY.map((entry) => entry.name);

  it("scans the component files under src/design", () => {
    expect(exported.size).toBeGreaterThan(20);
    expect(exported.has("Button")).toBe(true);
  });

  it("every exported design component has a registry entry", () => {
    expect([...exported.keys()].filter((name) => !names.includes(name))).toEqual([]);
  });

  it("every registry entry names an existing export", () => {
    expect(names.filter((name) => !exported.has(name))).toEqual([]);
  });

  it("lists each component once", () => {
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
  });

  it("names the directory as family and fills every field", () => {
    for (const entry of COMPONENT_REGISTRY) {
      const file = exported.get(entry.name);
      expect(file && basename(dirname(relative(designDir, resolve(file)))) === entry.family, entry.name).toBe(true);
      expect(entry.a11y.trim(), `${entry.name} a11y`).not.toBe("");
      expect(entry.text.trim(), `${entry.name} text`).not.toBe("");
    }
  });
});
