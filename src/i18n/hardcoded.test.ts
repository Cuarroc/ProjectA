import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderHook } from "@testing-library/react";
import ts from "typescript";
import { expect, it } from "vitest";
import { catalogs, de, type MessageKey } from "./de";
import { t, useT } from "./useT";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["src/design", "src/shell", "src/i18n"];
const DICT_FILE = "de.ts";
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

/** Collect string-like UI candidates via the TypeScript AST (JSX text, literals, template parts). */
function collectCandidateStrings(source: string, fileName = "fixture.tsx"): string[] {
  const kind = fileName.endsWith(".ts") && !fileName.endsWith(".tsx")
    ? ts.ScriptKind.TS
    : ts.ScriptKind.TSX;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];

  const pushLiteral = (text: string) => {
    if (text.length > 0) found.push(text);
  };
  const pushJsxText = (text: string) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length > 0) found.push(normalized);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      pushJsxText(node.getText(sf));
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      pushLiteral(node.text);
    } else if (ts.isTemplateExpression(node)) {
      pushLiteral(node.head.text);
      for (const span of node.templateSpans) {
        pushLiteral(span.literal.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function isHardcodedUi(text: string, dictValues: Set<string>): boolean {
  if (text.length < 2) return false;
  if (/^[./\\]|https?:|\.(ts|tsx|css|json)$/.test(text)) return false;
  // Lowercase identifier / path-ish tokens only (no `i` flag): "Abbrechen" stays UI.
  if (/^[a-z0-9_./:-]+$/.test(text) && !dictValues.has(text)) return false;
  return dictValues.has(text) || UI_RE.test(text);
}

function findHardcodedUi(source: string, dictValues: Set<string>, fileName = "fixture.tsx"): string[] {
  return collectCandidateStrings(source, fileName).filter((text) =>
    isHardcodedUi(text, dictValues),
  );
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
      const source = readFileSync(file, "utf8");
      for (const text of findHardcodedUi(source, dictValues, relative(ROOT, file))) {
        offenders.push(`${relative(ROOT, file)}: ${JSON.stringify(text)}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

it("scanner flags known-bad fixture strings for JSX text single-word and template", () => {
  const dictValues = new Set(Object.values(de));
  const fixture = `
    export function Bad({ name }: { name: string }) {
      const label = "Abbrechen";
      const greet = \`Hallo \${name} Welt\`;
      return <button aria-label="Speichern">Speichern und weiter</button>;
    }
  `;
  const found = findHardcodedUi(fixture, dictValues);
  expect(found).toEqual(
    expect.arrayContaining([
      "Speichern und weiter",
      "Speichern",
      "Abbrechen",
      "Hallo ",
      " Welt",
    ]),
  );
});
