import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";

/** Leitstand and Einstellungen as the browser shows them: the browser mock answers the IPC. */
const SCREENS = ["/leitstand", "/betrieb", "/leitstand/klassisch", "/einstellungen", "/einstellungen/mcp", "/einstellungen/klassisch"];

const go = (path: string) => act(async () => { window.location.hash = path; window.dispatchEvent(new HashChangeEvent("hashchange")); });

/** Chrome flags a form field without id and name ("A form field element should have an id or name attribute"). */
const unnamed = (root: ParentNode) =>
  [...root.querySelectorAll("input, select, textarea")]
    .filter((el) => !el.id && !el.getAttribute("name"))
    .map((el) => el.outerHTML.slice(0, 260));

beforeAll(async () => {
  window.__PROJECTA_E2E_RICH__ = true;
  await import("../test/tauriBrowserMock");
  await import("../shell/mount/ShellMount");
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
  window.location.hash = "";
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Per screen, the fields without id and name; the classic settings keep most fields on tabs that are not open at first. */
async function audit(path: string) {
  const { container } = render(<App />);
  await go(path);
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  const found = unnamed(container);
  const tabs = path === "/einstellungen/klassisch" ? screen.queryAllByRole("tab") : [];
  if (path === "/einstellungen/klassisch") expect(tabs.length).toBeGreaterThan(1);
  for (const tab of tabs) {
    await act(async () => { fireEvent.click(tab); await new Promise((r) => setTimeout(r, 100)); });
    found.push(...unnamed(container));
  }
  cleanup();
  return [...new Set(found)];
}

describe("form field names", () => {
  it("every field of the Leitstand and Einstellungen screens has an id or name", async () => {
    const report: Record<string, string[]> = {};
    for (const path of SCREENS) report[path] = await audit(path);
    expect(Object.fromEntries(Object.entries(report).filter(([, found]) => found.length > 0))).toEqual({});
  }, 60_000);
});

describe("favicon", () => {
  it("index.html links an icon that public serves", () => {
    const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
    const href = /<link\s+rel="icon"[^>]*href="\/([^"]+)"/.exec(html)?.[1];
    expect(href).toBeDefined();
    expect(existsSync(resolve(__dirname, "../../public", href!))).toBe(true);
  });
});
