import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { STATE_FORMS, STATE_UNKNOWN_FORM, STATE_UNKNOWN_WORD, STATE_WORDS } from "../state/states";
import { Orb, type OrbState } from "./Orb";

const css = readFileSync(resolve(__dirname, "fabrik.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

it("renders an inner glyph and an accessible name for every state form and unknown", () => {
  for (const state of [...STATE_FORMS, STATE_UNKNOWN_FORM] as OrbState[]) {
    const word = state === STATE_UNKNOWN_FORM ? STATE_UNKNOWN_WORD : STATE_WORDS[state];
    const { unmount } = render(<Orb state={state} label="Agent 1" />);
    const orb = screen.getByRole("img", { name: `Agent 1, ${word}` });
    expect(orb).toHaveClass("g-orb", `g-orb--${state}`);
    expect(orb.querySelector(`.g-glyph--${state}`), state).toHaveAttribute("aria-hidden", "true");
    unmount();
  }
});

it("falls back to the unknown orb for a missing or newer form", () => {
  for (const state of [undefined, "weird" as OrbState]) {
    const { container, unmount } = render(<Orb state={state} label="Agent 2" />);
    expect(screen.getByRole("img", { name: `Agent 2, ${STATE_UNKNOWN_WORD}` })).toHaveClass("g-orb--unknown");
    expect(container.querySelector(".g-glyph--unknown")).not.toBeNull();
    expect(container.querySelector(".g-orb--undefined, .g-orb--weird")).toBeNull();
    unmount();
  }
});

it("fabrik.css fills each orb from its state token and uses tokens only without blur", () => {
  for (const form of STATE_FORMS) expect(css).toMatch(new RegExp(`\\.g-orb--${form}\\s*\\{[^}]*--c:\\s*var\\(--g-${form}\\)`));
  expect(css).toMatch(/\.g-orb--unknown\s*\{[^}]*--c:\s*var\(--g-muted\)/);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  expect(css).not.toMatch(/backdrop-filter/);
});
