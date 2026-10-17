import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COMPONENT_REGISTRY } from "./registry";

// DS-X-14: like the tauriBrowserMock coverage test, this reads source text so a
// new component export (function, const or default) without a registry entry (or
// an entry whose component was renamed or removed) turns the test red; an export
// style the scan cannot classify fails loudly instead of slipping through.
const designDir = dirname(fileURLToPath(import.meta.url));

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

interface Scan { components: string[]; unsupported: string[] }

const PASCAL = /^[A-Z]\w*[a-z]\w*$/;

/** Components a `.tsx` source exports, plus every export line the scan cannot classify. */
export function scanExports(source: string): Scan {
  const found: Scan = { components: [], unsupported: [] };
  for (const line of source.split(/\r?\n/)) {
    if (!line.startsWith("export")) continue;
    const named = line.match(/^export (?:default )?(?:async )?(?:function|const) (\w+)/);
    if (named) {
      if (PASCAL.test(named[1])) found.components.push(named[1]);
    } else if (!/^export (?:type|interface) /.test(line)) found.unsupported.push(line);
  }
  return found;
}

const toPosix = (path: string) => path.replaceAll("\\", "/");

/** Top-level folder below src/design (nested folders keep it), whatever the separator. */
export function familyOf(path: string): string {
  return toPosix(path).split("/")[0];
}

/** Exported component name -> file (relative to src/design, posix), plus unclassified export lines. */
function scanDesign(): { exported: Map<string, string>; unsupported: string[] } {
  const exported = new Map<string, string>();
  const unsupported: string[] = [];
  for (const file of componentFiles(designDir)) {
    const path = toPosix(relative(designDir, file));
    const scan = scanExports(readFileSync(file, "utf8"));
    for (const name of scan.components) exported.set(name, path);
    unsupported.push(...scan.unsupported.map((line) => `${path}: ${line}`));
  }
  return { exported, unsupported };
}

describe("design component registry", () => {
  const { exported, unsupported } = scanDesign();
  const names = COMPONENT_REGISTRY.map((entry) => entry.name);

  it("scans every family the registry names", () => {
    const scanned = new Set([...exported.values()].map(familyOf));
    expect([...scanned].sort()).toEqual([...new Set(COMPONENT_REGISTRY.map((entry) => entry.family))].sort());
  });

  it("finds no export style the scan cannot classify", () => {
    expect(unsupported).toEqual([]);
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
      expect(file && familyOf(file) === entry.family, entry.name).toBe(true);
      expect(entry.a11y.trim(), `${entry.name} a11y`).not.toBe("");
      expect(entry.text.trim(), `${entry.name} text`).not.toBe("");
    }
  });

  it("an export const component without an entry is caught", () => {
    const { components } = scanExports([
      "export const Ghost = memo(() => null);",
      "export const Phantom = forwardRef<HTMLDivElement, object>(() => null);",
      "export default function Wraith() { return null; }",
      "export const LIMIT = 3;",
      "export function useThing() {}",
      "export type Kind = \"a\";",
    ].join("\n"));
    expect(components).toEqual(["Ghost", "Phantom", "Wraith"]);
    expect(components.filter((name) => !names.includes(name))).toEqual(components);
  });

  it("an unsupported export style fails the scan", () => {
    for (const line of ["export { Ghost };", "export * from \"./Ghost\";", "export default memo(Ghost);", "export default function () {}", "export class Ghost {}"]) {
      expect(scanExports(`${line}\n`).unsupported, line).toEqual([line]);
    }
  });

  it("takes the family from the top-level folder with either separator", () => {
    expect(familyOf("controls/deep/Nested.tsx")).toBe("controls");
    expect(familyOf("controls\\deep\\Nested.tsx")).toBe("controls");
  });
});
