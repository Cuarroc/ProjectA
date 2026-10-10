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

function isKeyOrCodeAccess(expr: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expr) &&
    (expr.name.text === "key" || expr.name.text === "code")
  );
}

/** KeyboardEvent name literals (`e.key === "Home"`, `case "Escape"` on `.key`). */
function isKeyboardEventNameLiteral(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    if (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken
    ) {
      const other = parent.left === node ? parent.right : parent.left;
      if (isKeyOrCodeAccess(other)) return true;
    }
  }
  if (ts.isCaseClause(parent) && parent.expression === node) {
    const switchStmt = parent.parent.parent;
    if (ts.isSwitchStatement(switchStmt) && isKeyOrCodeAccess(switchStmt.expression)) {
      return true;
    }
  }
  return false;
}

function isTypePositionLiteral(node: ts.Node): boolean {
  return ts.isLiteralTypeNode(node.parent);
}

/** Explicit presentation/geometry JSX attrs — not "any attribute". */
const SVG_PRESENTATION_ATTRS = new Set([
  "viewBox", "d", "fill", "stroke", "points", "xmlns",
  "strokeLinecap", "strokeLinejoin", "strokeWidth",
]);
const DOM_SELECTOR_METHODS = new Set(["querySelector", "querySelectorAll", "matches", "closest"]);

function jsxAttributeName(node: ts.Node): string | undefined {
  for (let cur: ts.Node | undefined = node; cur && !ts.isSourceFile(cur); cur = cur.parent) {
    if (ts.isJsxAttribute(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
  }
  return undefined;
}

function isClassNameAttributeValue(node: ts.Node): boolean {
  return jsxAttributeName(node) === "className";
}

function isSvgPresentationAttributeValue(node: ts.Node): boolean {
  const name = jsxAttributeName(node);
  return name !== undefined && SVG_PRESENTATION_ATTRS.has(name);
}

function callMethodName(expr: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expr) || ts.isPropertyAccessChain(expr)) return expr.name.text;
  return ts.isIdentifier(expr) ? expr.text : undefined;
}

/** Direct selector args, or same-file const string initializers passed to those methods. */
function collectDomSelectorLiteralNodes(sf: ts.SourceFile): Set<ts.Node> {
  const skipped = new Set<ts.Node>();
  const constInit = new Map<string, ts.Node>();
  const noteConsts = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      constInit.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, noteConsts);
  };
  noteConsts(sf);
  const visit = (node: ts.Node) => {
    if ((ts.isCallExpression(node) || ts.isCallChain(node)) && node.arguments.length > 0) {
      const method = callMethodName(node.expression);
      if (method && DOM_SELECTOR_METHODS.has(method)) {
        const arg = node.arguments[0];
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) skipped.add(arg);
        else if (ts.isIdentifier(arg)) {
          const init = constInit.get(arg.text);
          if (init) skipped.add(init);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return skipped;
}

/** Collect string-like UI candidates via the TypeScript AST (JSX text, literals, template parts). */
function collectCandidateStrings(source: string, fileName = "fixture.tsx"): string[] {
  const kind = fileName.endsWith(".ts") && !fileName.endsWith(".tsx")
    ? ts.ScriptKind.TS
    : ts.ScriptKind.TSX;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const selectorLiterals = collectDomSelectorLiteralNodes(sf);
  const found: string[] = [];
  const pushLiteral = (text: string) => { if (text.length > 0) found.push(text); };
  const pushJsxText = (text: string) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length > 0) found.push(normalized);
  };
  const skipAttr = (node: ts.Node) =>
    isClassNameAttributeValue(node) || isSvgPresentationAttributeValue(node);

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      pushJsxText(node.getText(sf));
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (
        !isKeyboardEventNameLiteral(node) &&
        !isTypePositionLiteral(node) &&
        !skipAttr(node) &&
        !selectorLiterals.has(node)
      ) {
        pushLiteral(node.text);
      }
    } else if (ts.isTemplateExpression(node) && !skipAttr(node)) {
      pushLiteral(node.head.text);
      for (const span of node.templateSpans) pushLiteral(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** SVG path grammar: only path commands, numbers and separators, with at least one digit. */
function isSvgPathData(text: string): boolean {
  return /^[MmLlHhVvCcSsQqTtAaZz0-9.,\-\s]+$/.test(text) && /\d/.test(text);
}

/** Dotted identifier without whitespace (storage key, i18n key): `projecta.settings.glassTheme`. */
function isDottedIdentifier(text: string): boolean {
  return /^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(text);
}

function isHardcodedUi(text: string, dictValues: Set<string>): boolean {
  if (text.length < 2) return false;
  if (isSvgPathData(text) || isDottedIdentifier(text)) return false;
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

it("scanner ignores KeyboardEvent key and code literals while still flagging UI copy", () => {
  const dictValues = new Set(Object.values(de));
  const fixture = `
    export function onKey(e: KeyboardEvent) {
      if (e.key === "Home") return;
      if ("End" === e.key) return;
      switch (e.key) {
        case "Escape":
          break;
      }
      if (e.code === "Tab") return;
      const label = "Abbrechen";
      return label;
    }
  `;
  const found = findHardcodedUi(fixture, dictValues);
  expect(found).not.toContain("Home");
  expect(found).not.toContain("End");
  expect(found).not.toContain("Escape");
  expect(found).not.toContain("Tab");
  expect(found).toContain("Abbrechen");
});

it("scanner ignores SVG presentation attribute values while still flagging UI copy", () => {
  const dictValues = new Set(Object.values(de));
  const fixture = `
    export function Icon() {
      return <svg viewBox="0 0 20 20"><path d="m5 8 5 5 5-5" stroke="currentColor" points="0,0 10,10" /></svg>;
    }
    export function Bad() { return <button aria-label="Speichern">Abbrechen</button>; }
  `;
  const found = findHardcodedUi(fixture, dictValues);
  for (const s of ["0 0 20 20", "m5 8 5 5 5-5", "currentColor", "0,0 10,10"]) expect(found).not.toContain(s);
  expect(found).toEqual(expect.arrayContaining(["Speichern", "Abbrechen"]));
});

it("scanner ignores querySelector family selector strings while still flagging UI copy", () => {
  const dictValues = new Set(Object.values(de));
  const fixture = `
    export function focusTrap(root: Element, el: Element) {
      const FOCUSABLE = 'a[href], button:not(:disabled)';
      root.querySelectorAll(FOCUSABLE);
      root.querySelector("input:not(:disabled)");
      el.matches('[tabindex]:not([tabindex="-1"])');
      el.closest("button:not(:disabled)");
      return "Abbrechen";
    }
  `;
  const found = findHardcodedUi(fixture, dictValues);
  for (const s of [
    "a[href], button:not(:disabled)",
    "input:not(:disabled)",
    '[tabindex]:not([tabindex="-1"])',
    "button:not(:disabled)",
  ]) expect(found).not.toContain(s);
  expect(found).toContain("Abbrechen");
});

it("scanner skips SVG path data strings while still flagging UI words", () => {
  const dictValues = new Set(Object.values(de));
  const fixture = `
    export const icon = "M3.5 13.5a6.5 6.5 0 1 1 13 0";
    export const arc = "M3 10a7 7 0 1 1 14 0 7 7 0 0 1-14 0ZM10 10V6M10 10l3 2";
    export const word = "Leitstand";
    export const lookalike = "Hall";
  `;
  const found = findHardcodedUi(fixture, dictValues);
  expect(found).not.toContain("M3.5 13.5a6.5 6.5 0 1 1 13 0");
  expect(found).not.toContain("M3 10a7 7 0 1 1 14 0 7 7 0 0 1-14 0ZM10 10V6M10 10l3 2");
  expect(found).toContain("Leitstand");
  expect(found).toContain("Hall");
});

it("scanner skips dotted storage keys while still flagging dictionary-style words", () => {
  const dictValues = new Set(Object.values(de));
  const fixture = `
    export const KEY = "projecta.settings.glassTheme";
    export const word = "Gedächtnis";
  `;
  const found = findHardcodedUi(fixture, dictValues);
  expect(found).not.toContain("projecta.settings.glassTheme");
  expect(found).toContain("Gedächtnis");
});

it("scanner still flags aria-label UI copy", () => {
  const dictValues = new Set(Object.values(de));
  const fixture = `export function Close() {
    return <button aria-label="Schließen" title="Hinweis" placeholder="Name" alt="Bild">x</button>;
  }`;
  const found = findHardcodedUi(fixture, dictValues);
  expect(found).toEqual(expect.arrayContaining(["Schließen", "Hinweis", "Name", "Bild"]));
});
