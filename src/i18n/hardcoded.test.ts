import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { catalogs, de, type MessageKey } from "./de";
import { t, useT } from "./useT";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["src/design", "src/shell", "src/i18n"];
const DICT_FILE = "de.ts";
const LITERAL_RE = /(?<![\w$])(["'`])((?:\\.|(?!\1).)*)\1/g;
const UI_RE = /[ÄÖÜäöüß]|\s|[A-ZÄÖÜ][a-zäöüß]{2,}/;

function walkTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walkTs(path));
      continue;
    }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    if (name === DICT_FILE) continue;
    out.push(path);
  }
  return out;
}

function literals(source: string): string[] {
  const bare = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const found: string[] = [];
  for (const match of bare.matchAll(LITERAL_RE)) {
    const raw = match[2];
    if (match[1] === "`" && raw.includes("${")) continue;
    const text = raw.replace(/\\([\\'"nrt])/g, (_, c: string) =>
      ({ "\\": "\\", "'": "'", '"': '"', n: "\n", r: "\r", t: "\t" })[c] ?? c);
    found.push(text);
  }
  return found;
}

function isHardcodedUi(text: string, dictValues: Set<string>): boolean {
  if (text.length < 2) return false;
  if (/^[./\\]|https?:|\.(ts|tsx|css|json)$/.test(text)) return false;
  if (/^[a-z0-9_./:-]+$/i.test(text) && !dictValues.has(text)) return false;
  return dictValues.has(text) || UI_RE.test(text);
}

it("hook returns German dictionary strings", () => {
  expect(t("nav.leitstand")).toBe("Leitstand");
  expect(t("shell.estop")).toBe("Not-Aus");
  expect(t("state.run")).toBe("Läuft");
  const { result } = renderHook(() => useT());
  expect(result.current("nav.beweise")).toBe("Beweise");
});

it("catalog structure reserves a second locale slot", () => {
  expect(catalogs.de).toBe(de);
  expect(catalogs.en).toBeUndefined();
  const keys = Object.keys(de) as MessageKey[];
  expect(keys).toContain("nav.leitstand");
  expect(keys).toContain("shell.estop");
});

it("new v2 code has no hardcoded UI strings outside the dictionary", () => {
  const dictValues = new Set(Object.values(de));
  const offenders: string[] = [];
  for (const rel of SCAN_DIRS) {
    for (const file of walkTs(join(ROOT, rel))) {
      for (const text of literals(readFileSync(file, "utf8"))) {
        if (!isHardcodedUi(text, dictValues)) continue;
        offenders.push(`${relative(ROOT, file)}: ${JSON.stringify(text)}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
