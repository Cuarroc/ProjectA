import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CommandChat from "./components/CommandChat";
import ConversationView from "./components/ConversationView";
import type { OrchestratorChat } from "./lib/orchestratorChat";

vi.mock("./lib/useSharpening", () => ({
  useSharpening: () => ({
    active: false,
    phase: "idle",
    error: null,
    open: [],
    start: vi.fn(),
    cancel: vi.fn(),
    clearError: vi.fn(),
  }),
}));

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

function section(startMarker: string, endMarker: string): string {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker, start + 1);
  expect(start, startMarker).toBeGreaterThanOrEqual(0);
  expect(end, endMarker).toBeGreaterThan(start);
  return css.slice(start, end);
}

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

function themeVars(): { dark: Record<string, string>; light: Record<string, string> } {
  const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
  const dark = parseVars(css.slice(0, lightStart));
  const lightRoot = css.indexOf(":root", lightStart);
  const light = {
    ...dark,
    ...parseVars(css.slice(lightStart, css.indexOf("\n}", lightRoot))),
  };
  return { dark, light };
}

function resolveVar(vars: Record<string, string>, value: string, depth = 0): string {
  expect(value, "missing token").toBeDefined();
  expect(depth, `var cycle at ${value}`).toBeLessThanOrEqual(10);
  const match = value.match(/^var\(--([\w-]+)\)$/);
  return match ? resolveVar(vars, vars[match[1]], depth + 1) : value.trim();
}

function parseHex(raw: string): { r: number; g: number; b: number } {
  const m = raw.match(/^#([0-9a-f]{6})$/i);
  expect(m, `expected solid hex got ${raw}`).not.toBeNull();
  const n = parseInt(m![1], 16);
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
}

function compositeRgba(fg: string, bgHex: string): string {
  const rgba = fg.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i,
  );
  if (!rgba) return bgHex;
  const base = parseHex(bgHex);
  const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
  const mix = (c: number, i: number) => Math.round(c * a + i * (1 - a));
  return `#${[mix(+rgba[1], base.r), mix(+rgba[2], base.g), mix(+rgba[3], base.b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

function solidColor(vars: Record<string, string>, token: string, against: string): string {
  const raw = resolveVar(vars, vars[token]);
  if (raw.startsWith("#")) return raw.toLowerCase();
  return compositeRgba(raw, against).toLowerCase();
}

function lum(c: { r: number; g: number; b: number }): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

function contrast(a: string, b: string): number {
  const [x, y] = [lum(parseHex(a)), lum(parseHex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function ruleBody(slice: string, selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const m = slice.match(re);
  expect(m, `missing ${selector}`).not.toBeNull();
  return m![1];
}

function makeChat(overrides: Partial<OrchestratorChat> = {}): OrchestratorChat {
  return {
    orchestratorId: "orch-a",
    messages: [],
    loading: false,
    sending: false,
    error: null,
    disabled: false,
    send: vi.fn(async () => true),
    clearError: vi.fn(),
    ...overrides,
  };
}

const convo = () =>
  section(
    "/* ---- conversation (Variant B main surface)",
    "/* ---- board ",
  );
const cmd = () =>
  section("/* ---- command chat (Phase 10)", "/* ---- merge (Phase 13)");

describe("V161-UI-K composer contract", () => {
  it("both composers resolve the same control height", () => {
    const c = convo();
    const k = cmd();
    expect(ruleBody(c, ".convo-input")).toMatch(/min-height:\s*var\(--ui-control-min\)/);
    expect(ruleBody(k, ".command-chat-input")).toMatch(
      /min-height:\s*var\(--ui-control-min\)/,
    );
    expect(ruleBody(c, ".convo-send")).toMatch(/min-height:\s*var\(--ui-control-min\)/);
    expect(ruleBody(c, ".convo-sharpen")).toMatch(/min-height:\s*var\(--ui-control-min\)/);
    expect(ruleBody(k, ".command-chat-send")).toMatch(
      /min-height:\s*var\(--ui-control-min\)/,
    );
    expect(ruleBody(c, ".convo-head")).toMatch(/height:\s*var\(--shell-bar-h\)/);
  });

  it("timestamp pairs meet 4.5 to 1 without opacity fading", () => {
    const c = convo();
    const k = cmd();
    expect(ruleBody(c, ".convo-msg-time")).not.toMatch(/opacity\s*:/);
    expect(ruleBody(k, ".command-chat-time")).not.toMatch(/opacity\s*:/);
    expect(ruleBody(k, ".command-chat-entry-system")).not.toMatch(/opacity\s*:/);
    expect(ruleBody(c, ".convo-msg-time")).toMatch(
      /color:\s*var\(--(?:color-text-tertiary|fg-muted)\)/,
    );
    expect(ruleBody(k, ".command-chat-time")).toMatch(
      /color:\s*var\(--(?:color-text-tertiary|fg-muted)\)/,
    );

    for (const [mode, vars] of Object.entries(themeVars()) as [
      string,
      Record<string, string>,
    ][]) {
      const elevated = resolveVar(vars, vars["color-elevated"]).toLowerCase();
      const content = resolveVar(vars, vars["color-content"]).toLowerCase();
      const convoTime = solidColor(vars, "color-text-tertiary", content);
      const cmdTime = solidColor(vars, "color-text-tertiary", elevated);
      expect(contrast(convoTime, content), `${mode} convo time`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(cmdTime, elevated), `${mode} command time`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("shows no empty copy while the conversation history is loading", () => {
    const chat = makeChat({ loading: true, messages: [] });
    render(
      <ConversationView
        chat={chat}
        projectId="project-a"
        projectName="Demo"
        onOpenOrchestrator={vi.fn()}
        onOpenQuestions={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Noch keine Nachrichten/)).toBeNull();
    expect(screen.getByText(/wird geladen/)).toBeTruthy();
  });

  it("shows no empty copy while command-chat history is loading", () => {
    const chat = makeChat({ loading: true, messages: [] });
    render(
      <CommandChat chat={chat} projectId="project-a" onOpenConversation={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Verlauf/ }));
    });
    expect(screen.queryByText(/Noch keine Nachrichten/)).toBeNull();
    expect(screen.getByText(/wird geladen/)).toBeTruthy();
  });
});
