import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./components/TerminalView", () => ({ default: () => null }));

import { listen } from "@tauri-apps/api/event";
import App from "./App";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");
const ready = (command: string) => {
  if (command === "list_projects" || command === "list_agent_profiles") return Promise.resolve([]);
  if (command === "list_workers" || command === "list_questions") return Promise.resolve([]);
  if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
  return Promise.resolve(undefined);
};

describe("V161-UI-R rail contract", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(ready);
    vi.mocked(listen).mockResolvedValue(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the closed rail mounted with inert", async () => {
    localStorage.setItem("projecta.railOpen", "false");
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".rail")).toBeTruthy());
    expect(container.querySelector(".rail")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".app-railed")).toBeNull();
  });

  it("auto-collapses below 1100px without rewriting the stored preference", async () => {
    localStorage.setItem("projecta.railOpen", "true");
    type L = (e: MediaQueryListEvent) => void;
    let matches = false;
    const listeners = new Set<L>();
    const mq = {
      get matches() { return matches; },
      media: "(max-width: 1099px)",
      addEventListener: (_: string, l: L) => listeners.add(l),
      removeEventListener: (_: string, l: L) => listeners.delete(l),
      addListener: (l: L) => listeners.add(l),
      removeListener: (l: L) => listeners.delete(l),
      dispatchEvent: () => false, onchange: null,
    } as MediaQueryList;
    const idle = { matches: false, media: "", addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null } as MediaQueryList;
    vi.stubGlobal("matchMedia", vi.fn((q: string) => (q.includes("1099") || q.includes("1100") ? mq : idle)));
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app-railed")).toBeTruthy());
    matches = true;
    for (const l of listeners) l({ matches: true } as MediaQueryListEvent);
    await waitFor(() => expect(container.querySelector(".app-railed")).toBeNull());
    expect(localStorage.getItem("projecta.railOpen")).toBe("true");
    expect(container.querySelector(".rail")?.hasAttribute("inert")).toBe(true);
  });

  it("contracts three-track grid chrome surface and equal state marks", () => {
    const app = [...css.matchAll(/\.app\s*\{([^}]*)\}/g)].find((m) => m[1].includes("grid-template-columns"));
    expect(app?.[1]).toMatch(/grid-template-columns:\s*var\(--shell-sidebar-w\)\s+var\(--shell-rail-w\)\s+1fr/);
    expect(css).toMatch(/\.app\.app-rail-motion\s*\{[^}]*transition:\s*grid-template-columns\s+var\(--dur-slow\)\s+var\(--ease-move\)/);
    expect(css).toMatch(/\.app:not\(\.app-railed\)\s*\{[^}]*--shell-rail-w:\s*0(?:px)?/);
    expect([...css.matchAll(/\.rail\s*\{([^}]*)\}/g)][0]?.[1]).toMatch(/background:\s*var\(--surface-content,\s*var\(--bg\)\)/);
    expect(css).toMatch(/:root\s*\{[^}]*--size-state-mark:\s*12px/);
    expect(css).toMatch(/\.state-mark::before[\s\S]{0,200}?box-sizing:\s*border-box/);
    expect(css).toMatch(/\.state-needs-you[\s\S]{0,200}?::before[\s\S]{0,120}?(?:width|height):\s*8\.5px/);
    expect(css).toMatch(/\.state-in-review[\s\S]{0,200}?::before[\s\S]{0,120}?(?:width|height):\s*8\.5px/);
    expect(css).not.toMatch(/\.state-chip\.state-needs-you::before[\s\S]{0,80}?scale\(/);
    expect(css).not.toMatch(/\.state-chip\.state-in-review::before[\s\S]{0,80}?scale\(/);
  });

  it("keeps the rail on the content surface not chrome", () => {
    const rail = [...css.matchAll(/\.rail\s*\{([^}]*)\}/g)][0]?.[1] ?? "";
    expect(rail).toMatch(/background:\s*var\(--surface-content,\s*var\(--bg\)\)/);
    expect(rail).not.toMatch(/--surface-chrome/);
    expect(rail).not.toMatch(/backdrop-filter/);
  });

  it("drops the closed-rail right border seam", () => {
    expect(css).toMatch(/\.app:not\(\.app-railed\)\s+\.rail\s*\{[^}]*border-right-width:\s*0/);
  });

  it("defines --size-state-mark once on :root", () => {
    const root = css.match(/:root\s*\{([\s\S]*?)\n\}/);
    expect(root?.[1]).toMatch(/--size-state-mark:\s*12px/);
    expect(css).not.toMatch(/\.state-mark,\s*\n\.rail-label,\s*\n\.state-chip\s*\{\s*\n\s*--size-state-mark:/);
  });

  function stubMatchMedia(opts: { narrow?: boolean; reducedMotion?: boolean }) {
    const narrow = opts.narrow ?? false;
    const reduced = opts.reducedMotion ?? false;
    const idle = {
      matches: false,
      media: "",
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    } as MediaQueryList;
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => {
        if (q.includes("prefers-reduced-motion")) {
          return { ...idle, matches: reduced, media: q };
        }
        if (q.includes("1099") || q.includes("1100")) {
          return { ...idle, matches: narrow, media: q };
        }
        return { ...idle, media: q };
      }),
    );
  }

  it("does not leave app-rail-motion stuck under reduced motion", async () => {
    localStorage.setItem("projecta.railOpen", "true");
    stubMatchMedia({ reducedMotion: true });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app-railed")).toBeTruthy());
    fireEvent.click(container.querySelector(".viewbar-rail-toggle")!);
    await waitFor(() => expect(container.querySelector(".app-railed")).toBeNull());
    expect(container.querySelector(".app-rail-motion")).toBeNull();
  });

  it("clears app-rail-motion on transitioncancel", async () => {
    localStorage.setItem("projecta.railOpen", "true");
    stubMatchMedia({});
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app-railed")).toBeTruthy());
    fireEvent.click(container.querySelector(".viewbar-rail-toggle")!);
    await waitFor(() => expect(container.querySelector(".app-rail-motion")).toBeTruthy());
    fireEvent.transitionCancel(container.querySelector(".app")!, {
      propertyName: "grid-template-columns",
    });
    await waitFor(() => expect(container.querySelector(".app-rail-motion")).toBeNull());
  });

  it("moves focus to the ViewBar rail toggle before inert on collapse", async () => {
    localStorage.setItem("projecta.railOpen", "true");
    stubMatchMedia({});
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".rail-collapse")).toBeTruthy());
    const collapse = container.querySelector(".rail-collapse") as HTMLButtonElement;
    collapse.focus();
    expect(document.activeElement).toBe(collapse);
    fireEvent.click(collapse);
    await waitFor(() => {
      expect(container.querySelector(".rail")?.hasAttribute("inert")).toBe(true);
      expect(document.activeElement).toBe(container.querySelector(".viewbar-rail-toggle"));
    });
  });
});
