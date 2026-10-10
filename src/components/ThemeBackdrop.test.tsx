import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./TerminalView", () => ({ default: () => null }));

import App from "../App";
import ThemeBackdrop from "./ThemeBackdrop";

const themesCss = resolve(__dirname, "../design/themes/index.css");
const mainSrcPath = resolve(__dirname, "../main.tsx");

describe("ThemeBackdrop", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_projects" || command === "list_agent_profiles") return Promise.resolve([]);
      if (command === "list_workers" || command === "list_questions") return Promise.resolve([]);
      if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
      return Promise.resolve(undefined);
    });
  });

  it("ThemeBackdrop renders nothing for klassisch", () => {
    const { container } = render(<ThemeBackdrop style="klassisch" />);
    expect(container.firstChild).toBeNull();
  });

  it("app root carries data-theme-style", async () => {
    const { container } = render(<App />);
    await waitFor(() =>
      expect(container.querySelector(".app")).toHaveAttribute("data-theme-style", "klassisch"),
    );
  });

  it("theme backdrop CSS keeps the layer behind the shell", () => {
    const css = readFileSync(themesCss, "utf8").replace(/\r\n/g, "\n");
    expect(css).toMatch(/\.app\[data-theme-style\]\s*\{[^}]*isolation:\s*isolate/);
    expect(css).toMatch(/\.theme-backdrop\s*\{[^}]*z-index:\s*-1/);
  });

  it("theme index imports glas liquid and mesh sheets, liquid and mesh still empty", () => {
    const index = readFileSync(themesCss, "utf8").replace(/\r\n/g, "\n");
    for (const name of ["glas", "liquid", "mesh"] as const) {
      expect(index).toMatch(new RegExp(`@import\\s+["']\\./${name}\\.css["']`));
      if (name === "glas") continue; // filled by TH2
      const body = readFileSync(resolve(__dirname, `../design/themes/${name}.css`), "utf8");
      expect(body.trimStart().startsWith("/*")).toBe(true);
      expect(body.replace(/\/\*[\s\S]*?\*\//g, "").trim()).toBe("");
    }
  });

  it("main mirrors stored theme style onto documentElement before render", () => {
    const src = readFileSync(mainSrcPath, "utf8").replace(/\r\n/g, "\n");
    expect(src).toMatch(/loadUiThemeStyle|applyDocumentThemeStyle/);
    expect(src).toMatch(
      /document\.documentElement[\s\S]{0,120}data-theme-style|setAttribute\(\s*["']data-theme-style["']/,
    );
    const mirrorAt = src.search(/applyDocumentThemeStyle|document\.documentElement/);
    const renderAt = src.indexOf(".render(");
    expect(mirrorAt).toBeGreaterThanOrEqual(0);
    expect(renderAt).toBeGreaterThan(mirrorAt);
  });

  it("both app roots carry stored data-theme-style", async () => {
    localStorage.setItem("projecta.settings.themeStyle", "glas");
    let releaseProjects!: (value: unknown) => void;
    const projectsGate = new Promise((resolveProjects) => {
      releaseProjects = resolveProjects;
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_projects") return projectsGate;
      if (command === "list_agent_profiles") return Promise.resolve([]);
      if (command === "list_workers" || command === "list_questions") return Promise.resolve([]);
      if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
      return Promise.resolve(undefined);
    });

    const { container } = render(<App />);
    await waitFor(() => {
      const bootstrap = container.querySelector(".app");
      expect(bootstrap).toHaveAttribute("data-theme-style", "glas");
      expect(bootstrap?.querySelector(".theme-backdrop")).toHaveAttribute("data-style", "glas");
      expect(bootstrap?.querySelector(".theme-backdrop")).toHaveAttribute("aria-hidden", "true");
    });
    expect(container.querySelector(".sidebar")).toBeNull();

    releaseProjects([]);
    await waitFor(() => expect(container.querySelector(".sidebar")).not.toBeNull());
    const ready = container.querySelector(".app");
    expect(ready).toHaveAttribute("data-theme-style", "glas");
    expect(ready?.querySelector(".theme-backdrop")).toHaveAttribute("data-style", "glas");
  });
});
