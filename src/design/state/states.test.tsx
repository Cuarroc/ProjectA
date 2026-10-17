import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { parse } from "postcss";
import { afterEach, expect, it, vi } from "vitest";
import { StateGlyph, StateMark } from "./StateMark";
import {
  COLUMN_FORM, REASON_FORM, STATE_FORMS, STATE_WORDS, formForColumn, formForReason,
  type StateForm,
} from "./states";

const rust = (file: string) => readFileSync(resolve(__dirname, "../../../src-tauri/src", file), "utf8");
const statusRs = rust("status.rs");
const css = readFileSync(resolve(__dirname, "state.css"), "utf8");

/** The wire names of ReasonCode::code(), read from the Rust source. */
function reasonCodes(): string[] {
  const body = statusRs.match(/pub fn code\(self\)[^{]*\{\s*match self \{([\s\S]*?)\n {8}\}/)?.[1] ?? "";
  const quota = rust("preflight.rs").match(/CODE_QUOTA_BLOCKED: &str = "(\w+)"/)?.[1];
  return [...body.matchAll(/ReasonCode::\w+ => (?:"(\w+)"|crate::preflight::CODE_QUOTA_BLOCKED),/g)]
    .map(([, name]) => name ?? quota ?? "");
}

it("every board column of status.rs has exactly one form", () => {
  const columns = [...statusRs.matchAll(/pub const COL_\w+: &str = "(\w+)";/g)].map((m) => m[1]);
  expect(columns).toHaveLength(5);
  expect(Object.keys(COLUMN_FORM).sort()).toEqual([...columns].sort());
  for (const column of columns) expect(STATE_FORMS).toContain(formForColumn(column as never));
});

it("every ReasonCode of status.rs has exactly one form and none is invented", () => {
  const codes = reasonCodes();
  expect(codes).toHaveLength(15);
  expect(new Set(codes).size).toBe(codes.length);
  expect(Object.keys(REASON_FORM).sort()).toEqual([...codes].sort());
  for (const code of codes) expect(STATE_FORMS).toContain(formForReason(code));
  expect(formForReason("code_from_a_newer_core")).toBeUndefined();
  expect(formForReason("toString")).toBeUndefined();
});

it("the six forms have distinct words and each has its own shape and color in the css", () => {
  expect(STATE_FORMS).toHaveLength(6);
  expect(new Set(Object.values(STATE_WORDS)).size).toBe(6);
  const shapes = new Set<string>();
  for (const form of STATE_FORMS) {
    expect(css).toContain(`.g-st--${form} { --c: var(--g-${form}); --b: var(--g-${form}-bg); }`);
    const shape = css.match(new RegExp(`\\.g-st--${form}::before,\\s*\\.g-glyph--${form} \\{([^}]*)\\}`))?.[1];
    expect(shape, form).toBeDefined();
    shapes.add(shape!.replace(/\s+/g, " "));
  }
  expect(shapes.size).toBe(6);
  expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/var\(--(?!g-|[cb]\))/);
});

it("StateMark prints word and form class and StateGlyph hides from assistive tech", () => {
  const { container } = render(
    <>
      {STATE_FORMS.map((form) => <StateMark key={form} form={form} />)}
      <StateMark form="bad" label="Eigener Text" />
      <StateGlyph form="run" />
    </>,
  );
  for (const form of STATE_FORMS) {
    expect(screen.getByText(STATE_WORDS[form])).toHaveClass("g-st", `g-st--${form}`);
  }
  expect(screen.getByText("Eigener Text")).toHaveClass("g-st--bad");
  expect(container.querySelector(".g-glyph--run")).toHaveAttribute("aria-hidden", "true");
});

it("StateMark names an unknown form instead of rendering a ghost mark", () => {
  for (const form of [undefined as unknown as StateForm, "weird" as StateForm]) {
    const { container, unmount } = render(<StateMark form={form} />);
    expect(screen.getByText("Unbekannt")).toHaveClass("g-st", "g-st--unknown");
    expect(container.querySelector(".g-st--undefined")).toBeNull();
    expect(container.querySelector(".g-st--weird")).toBeNull();
    unmount();
  }
});

it("StateGlyph renders no undefined shape class for an unknown form", () => {
  for (const form of [undefined as unknown as StateForm, "weird" as StateForm]) {
    const { container, unmount } = render(<StateGlyph form={form} />);
    expect(container.querySelector(".g-glyph--undefined")).toBeNull();
    expect(container.querySelector(".g-glyph--weird")).toBeNull();
    expect(container.querySelector(".g-glyph--unknown")).toHaveAttribute("aria-hidden", "true");
    unmount();
  }
});

const motion = readFileSync(resolve(__dirname, "../motion.css"), "utf8");

function declsOf(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  parse(motion).walkRules((rule) => { if (rule.selectors.includes(selector)) rule.walkDecls((d) => { found[d.prop] = d.value; }); });
  return found;
}

it("run ring is not infinite in calm", () => {
  const ring = declsOf(".g-st--run::before");
  // An infinite ring may only play while the ambient mode token says so (paused in Ruhig and under reduce).
  if (/\binfinite\b/.test(ring.animation ?? "")) expect(ring["animation-play-state"]).toBe("var(--g-ambient-play)");
  expect(ring.animation).toBeDefined();
  expect(declsOf(".g-st[data-ping]::before").animation).toMatch(/^g-ping .* 1$/);
});

afterEach(() => vi.useRealTimers());

it("StateMark pings once on a form change and never on mount", () => {
  vi.useFakeTimers();
  const { rerender } = render(<StateMark form="need" />);
  expect(screen.getByText("Braucht dich")).not.toHaveAttribute("data-ping");
  rerender(<StateMark form="run" label="x" />);
  expect(screen.getByText("x")).toHaveAttribute("data-ping");
  act(() => { vi.advanceTimersByTime(600); });
  expect(screen.getByText("x")).not.toHaveAttribute("data-ping");
  rerender(<StateMark form="run" label="y" />);
  expect(screen.getByText("y")).not.toHaveAttribute("data-ping");
});
