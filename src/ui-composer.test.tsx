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

function slice(start: string, end: string): string {
  const a = css.indexOf(start);
  return css.slice(a, css.indexOf(end, a + 1));
}

function vars(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]),
  );
}

function theme(): Record<string, string>[] {
  const lightAt = css.indexOf("@media (prefers-color-scheme: light)");
  const dark = vars(css.slice(0, lightAt));
  const root = css.indexOf(":root", lightAt);
  return [dark, { ...dark, ...vars(css.slice(lightAt, css.indexOf("\n}", root))) }];
}

function resolveVar(t: Record<string, string>, value: string): string {
  const m = value.match(/^var\(--([\w-]+)\)$/);
  return m ? resolveVar(t, t[m[1]]) : value.trim();
}

function solid(t: Record<string, string>, token: string, against: string): string {
  const raw = resolveVar(t, t[token]);
  if (raw.startsWith("#")) return raw.toLowerCase();
  const rgba = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?/)!;
  const n = parseInt(against.slice(1), 16);
  const base = { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
  const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
  const mix = (c: number, i: number) => Math.round(c * a + i * (1 - a));
  return `#${[mix(+rgba[1], base.r), mix(+rgba[2], base.g), mix(+rgba[3], base.b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")}`;
}

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v: number) => {
      const s = ((n >> v) & 255) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function body(src: string, sel: string): string {
  const m = src.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  expect(m, sel).not.toBeNull();
  return m![1];
}

function chat(over: Partial<OrchestratorChat> = {}): OrchestratorChat {
  return {
    orchestratorId: "o",
    messages: [],
    loading: false,
    sending: false,
    error: null,
    disabled: false,
    send: vi.fn(async () => true),
    clearError: vi.fn(),
    ...over,
  };
}

const convo = () => slice("/* ---- conversation (Variant B main surface)", "/* ---- board ");
const cmd = () => slice("/* ---- command chat (Phase 10)", "/* ---- merge (Phase 13)");

describe("V161-UI-K composer contract", () => {
  it("both composers resolve the same control height", () => {
    const c = convo();
    const k = cmd();
    for (const [src, sel] of [
      [c, ".convo-input"],
      [c, ".convo-send"],
      [c, ".convo-sharpen"],
      [k, ".command-chat-input"],
      [k, ".command-chat-send"],
      [k, ".command-chat-toggle"],
      [k, ".command-chat-expand"],
    ] as const) {
      expect(body(src, sel)).toMatch(/min-height:\s*var\(--ui-control-min\)/);
    }
    expect(body(c, ".convo-head")).toMatch(/height:\s*var\(--shell-bar-h\)/);
  });

  it("disabled composer inputs keep a solid surface ground", () => {
    const c = convo();
    const k = cmd();
    for (const [src, sel] of [
      [c, ".convo-input:disabled"],
      [k, ".command-chat-input:disabled"],
    ] as const) {
      expect(body(src, sel)).toMatch(/background:\s*var\(--surface-content\)/);
      expect(body(src, sel)).not.toMatch(/--color-disabled-bg/);
    }
    for (const t of theme()) {
      const ground = resolveVar(t, t["surface-content"] ?? t["color-content"]);
      expect(ground.startsWith("#"), ground).toBe(true);
    }
  });

  it("timestamp pairs meet 4.5 to 1 without opacity fading", () => {
    const c = convo();
    const k = cmd();
    expect(body(c, ".convo-msg-time")).not.toMatch(/opacity\s*:/);
    expect(body(k, ".command-chat-time")).not.toMatch(/opacity\s*:/);
    expect(body(k, ".command-chat-entry-system")).not.toMatch(/opacity\s*:/);
    expect(body(c, ".convo-msg-time")).toMatch(/color:\s*var\(--color-text-tertiary\)/);
    expect(body(k, ".command-chat-time")).toMatch(/color:\s*var\(--color-text-tertiary\)/);
    for (const t of theme()) {
      const elevated = resolveVar(t, t["color-elevated"]).toLowerCase();
      const content = resolveVar(t, t["color-content"]).toLowerCase();
      expect(contrast(solid(t, "color-text-tertiary", content), content)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(solid(t, "color-text-tertiary", elevated), elevated)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("shows no empty copy while command-chat history is loading", () => {
    render(<CommandChat chat={chat({ loading: true })} projectId="p" onOpenConversation={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Verlauf/ }));
    });
    expect(screen.queryByText(/Noch keine Nachrichten/)).toBeNull();
    expect(screen.getByText(/wird geladen/)).toBeTruthy();
    render(
      <ConversationView
        chat={chat({ loading: true })}
        projectId="p"
        projectName="D"
        onOpenOrchestrator={vi.fn()}
        onOpenQuestions={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Noch keine Nachrichten/)).toBeNull();
    expect(document.querySelector(".convo-empty")?.textContent).toMatch(/wird geladen/);
  });

  it("renders the disabled conversation empty state with a headline", () => {
    render(
      <ConversationView
        chat={chat({ disabled: true })}
        projectId={null}
        projectName={null}
        onOpenOrchestrator={vi.fn()}
        onOpenQuestions={vi.fn()}
      />,
    );
    expect(document.querySelector(".convo-empty-title")?.textContent).toBe("Kein Projekt");
    expect(screen.getByText(/Wähle links ein Projekt/)).toBeTruthy();
  });
});
