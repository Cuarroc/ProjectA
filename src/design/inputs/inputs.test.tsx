import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Avatar } from "./Avatar";
import { Input, Textarea } from "./Input";
import { Kbd } from "./Kbd";
import { Lamp } from "./Lamp";
import { Meter } from "./Meter";
import { Select } from "./Select";

const css = readFileSync(resolve(__dirname, "inputs.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = readFileSync(resolve(__dirname, "../tokens.css"), "utf8");
const rule = (sel: string) => css.split("}").find((r) => r.trim().startsWith(sel + " {")) ?? "";

describe("Input and Select", () => {
  it("renders native fields that keep their value and change events and tab stop", () => {
    const onChange = vi.fn();
    render(<><Input aria-label="Name" mono compact defaultValue="x" onChange={onChange} /><Textarea aria-label="Note" /></>);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveClass("g-inp", "g-inp--mono", "g-inp--sm");
    expect(input.tabIndex).toBe(0);
    fireEvent.change(input, { target: { value: "y" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Note" }).tagName).toBe("TEXTAREA");
  });

  it("wraps a real select reachable by Tab with the chevron hidden from assistive tech", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Select aria-label="Provider" defaultValue="a" onChange={onChange}><option value="a">A</option><option value="b">B</option></Select>,
    );
    const select = screen.getByRole("combobox", { name: "Provider" });
    expect(select.tabIndex).toBe(0);
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(select).toHaveValue("b");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the compact select with the small height class", () => {
    render(<Select aria-label="Size" compact><option>A</option></Select>);
    expect(screen.getByRole("combobox", { name: "Size" })).toHaveClass("g-inp", "g-inp--sm");
  });

  it("marks a mono textarea with the mono class", () => {
    render(<Textarea aria-label="Log" mono />);
    expect(screen.getByRole("textbox", { name: "Log" })).toHaveClass("g-inp--area", "g-inp--mono");
  });

  it("paints invalid and disabled states and a focus ring and keeps width 100% inside its cell", () => {
    expect(rule(".g-inp")).toMatch(/box-sizing:\s*border-box/);
    expect(css).toMatch(/\.g-inp\[aria-invalid="true"\]\s*\{[^}]*--g-danger-line/);
    expect(css).toMatch(/\.g-inp:disabled\s*\{[^}]*not-allowed/);
    expect(css).toMatch(/\.g-inp:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--g-accent\)/);
  });
});

describe("Kbd, Avatar and Lamp", () => {
  it("renders a kbd that is not a control", () => {
    render(<Kbd>Ctrl K</Kbd>);
    expect(screen.getByText("Ctrl K").tagName).toBe("KBD");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides a decorative avatar and names a labelled one with size and tone as classes", () => {
    render(<><Avatar initials="AB" size="lg" tone={3} /><Avatar initials="CD" tone="lead" label="Lead agent" /></>);
    expect(screen.getByText("AB")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("AB")).toHaveClass("g-ava", "g-ava--lg", "g-ava--c3");
    expect(screen.getByRole("img", { name: "Lead agent" })).toHaveClass("g-ava--lead");
  });

  it("maps the owner and sys tones to their classes", () => {
    render(<><Avatar initials="OW" tone="owner" /><Avatar initials="SY" tone="sys" /></>);
    expect(screen.getByText("OW")).toHaveClass("g-ava--owner");
    expect(screen.getByText("SY")).toHaveClass("g-ava--sys");
  });

  it("keeps a labelled avatar named when the caller passes aria-hidden or its own role", () => {
    render(<Avatar initials="X" label="Agent X" aria-hidden role="presentation" aria-label="other" />);
    const ava = screen.getByRole("img", { name: "Agent X" });
    expect(ava).not.toHaveAttribute("aria-hidden");
  });

  it("keeps a decorative avatar hidden when the caller passes a role or name", () => {
    render(<Avatar initials="Y" role="img" aria-label="loud" />);
    const ava = screen.getByText("Y");
    expect(ava).toHaveAttribute("aria-hidden", "true");
    expect(ava).not.toHaveAttribute("role");
    expect(ava).not.toHaveAttribute("aria-label");
  });

  it("keeps a labelled lamp named and a decorative lamp hidden whatever the caller passes", () => {
    render(<><Lamp label="Online" aria-hidden role="presentation" /><Lamp aria-label="loud" role="img" data-testid="deco" /></>);
    expect(screen.getByRole("img", { name: "Online" })).not.toHaveAttribute("aria-hidden");
    const deco = screen.getByTestId("deco");
    expect(deco).toHaveAttribute("aria-hidden", "true");
    expect(deco).not.toHaveAttribute("aria-label");
    expect(deco).not.toHaveAttribute("role");
  });

  it("gives every lamp state a shape besides its colour", () => {
    render(<>{(["ok", "off", "warn", "busy", "bad"] as const).map((s) => <Lamp key={s} state={s} label={s} />)}</>);
    expect(screen.getByRole("img", { name: "warn" })).toHaveClass("g-lamp--warn");
    expect(screen.getByRole("img", { name: "ok" })).not.toHaveClass("g-lamp--ok");
    expect(rule(".g-lamp--warn")).toMatch(/rotate\(45deg\)/);
    expect(rule(".g-lamp--busy")).toMatch(/border:\s*2px solid[^;]*;\s*border-right-color:\s*transparent/);
    expect(rule(".g-lamp--bad")).toMatch(/clip-path:\s*polygon/);
    expect(render(<Lamp />).container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Meter", () => {
  it("exposes a clamped value and a width", () => {
    const { rerender } = render(<Meter aria-label="Quota" value={42} tone="hot" />);
    const m = screen.getByRole("meter", { name: "Quota" });
    expect(m).toHaveAttribute("aria-valuenow", "42");
    expect(m.firstElementChild).toHaveStyle({ width: "42%" });
    expect(m.firstElementChild).toHaveClass("g-meter--hot");
    rerender(<Meter aria-label="Quota" value={180} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
    rerender(<Meter aria-label="Quota" value={Number.NaN} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("Meter a11y", () => {
  it("keeps the computed range and value when the caller passes aria-value attributes", () => {
    render(<Meter aria-label="Quota" value={50} aria-valuenow={999} aria-valuemin={-5} aria-valuemax={7} />);
    const m = screen.getByRole("meter", { name: "Quota" });
    expect(m).toHaveAttribute("aria-valuenow", "50");
    expect(m).toHaveAttribute("aria-valuemin", "0");
    expect(m).toHaveAttribute("aria-valuemax", "100");
  });
});

describe("inputs.css", () => {
  it("uses only tokens that tokens.css defines", () => {
    const used = new Set(Array.from(css.matchAll(/var\((--g-[\w-]+)/g), (m) => m[1]));
    const missing = [...used].filter((n) => !tokens.includes(`${n}:`) && !/^--g-(dur-3|ease)$/.test(n));
    expect(missing).toEqual([]);
  });

  it("puts no shadow or highlight on solid fills", () => {
    for (const sel of [".g-ava--owner", ".g-ava--lead", ".g-lamp", ".g-lamp--bad", ".g-meter b", ".g-meter .g-meter--hot"]) {
      expect(rule(sel), sel).not.toBe("");
      expect(rule(sel), sel).not.toMatch(/box-shadow|filter|gradient/);
    }
  });

  it("switches the meter transition off for reduced motion", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*\.g-meter b\s*\{\s*transition:\s*none/);
  });
});
