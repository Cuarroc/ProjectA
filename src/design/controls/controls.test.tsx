import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button, ButtonGroup } from "./Button";
import { Chip } from "./Chip";
import { FilterChip } from "./FilterChip";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";

const css = readFileSync(resolve(__dirname, "controls.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = readFileSync(resolve(__dirname, "../tokens.css"), "utf8");

describe("Button and Chip", () => {
  it("renders a non-submitting button with variant and size classes", () => {
    render(<Button variant="primary" size="lg">Go</Button>);
    const b = screen.getByRole("button", { name: "Go" });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveClass("g-btn", "g-btn--primary", "g-btn--lg");
  });

  it("keeps every cell of a button group at one size", () => {
    render(<ButtonGroup><Button>A</Button><Button>B</Button></ButtonGroup>);
    expect(screen.getByRole("group")).toHaveClass("g-btn-group");
    expect(css).toMatch(/\.g-btn-group\s*\{[^}]*grid-auto-columns:\s*1fr/);
  });

  it("renders a static chip that is not a control", () => {
    render(<Chip size="sm">tag</Chip>);
    expect(screen.getByText("tag")).toHaveClass("g-chip--sm");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("FilterChip", () => {
  it("toggles aria-pressed through onPressedChange and shows a zero count", () => {
    const Harness = () => {
      const [on, setOn] = useState(false);
      return <FilterChip pressed={on} count={0} onPressedChange={setOn}>Open</FilterChip>;
    };
    render(<Harness />);
    const chip = screen.getByRole("button", { name: "Open 0" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("lets a consumer onClick that calls preventDefault suppress the toggle", () => {
    const onPressedChange = vi.fn();
    render(
      <FilterChip pressed={false} onClick={(e) => e.preventDefault()} onPressedChange={onPressedChange}>Open</FilterChip>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onPressedChange).not.toHaveBeenCalled();
  });
});

describe("Switch", () => {
  it("exposes role switch and toggles on click and never while disabled", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<Switch aria-label="Sound" checked={false} onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole("switch", { name: "Sound" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    rerender(<Switch aria-label="Sound" checked disabled onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
  });

  it("lets a consumer onClick that calls preventDefault suppress the toggle", () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Sound" checked={false} onClick={(e) => e.preventDefault()} onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe("Segmented", () => {
  const options = [{ value: "a", label: "Light" }, { value: "b", label: "Dark" }, { value: "c", label: "System" }] as const;
  const Harness = () => {
    const [v, setV] = useState<"a" | "b" | "c">("a");
    return <Segmented aria-label="Theme" options={options} value={v} onChange={setV} />;
  };

  it("has one tab stop and moves selection and focus with arrows and wraps at the ends", () => {
    render(<Harness />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(radios[0], { key: "ArrowLeft" });
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
    expect(radios[2]).toHaveFocus();
    fireEvent.keyDown(radios[2], { key: "ArrowRight" });
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios[0], { key: "End" });
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios[2], { key: "Home" });
    expect(radios[0]).toHaveFocus();
  });

  it("selects an option on click", () => {
    render(<Harness />);
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[1]);
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(radios[0]).toHaveAttribute("aria-checked", "false");
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("ignores keys instead of throwing when there are no options", () => {
    const onChange = vi.fn();
    render(<Segmented aria-label="Empty" options={[]} value={"" as never} onChange={onChange} />);
    const group = screen.getByRole("radiogroup");
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) fireEvent.keyDown(group, { key });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("makes the first option the single checked tab stop when the value matches no option", () => {
    render(<Segmented aria-label="Theme" options={options} value={"x" as never} onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });
});

describe("controls.css", () => {
  it("uses only tokens that tokens.css defines", () => {
    const used = new Set(Array.from(css.matchAll(/var\((--g-[\w-]+)/g), (m) => m[1]));
    const missing = [...used].filter((n) => !tokens.includes(`${n}:`) && !/^--g-(dur-1|ease|t)$/.test(n));
    expect(missing).toEqual([]);
  });

  it("puts no shadow or highlight on solid fills or the selected segment", () => {
    for (const sel of [".g-btn--primary", ".g-btn--tint", ".g-sw", ".g-sw::after", '.g-seg button[aria-checked="true"]']) {
      const body = css.split("}").find((r) => r.trim().startsWith(sel + " {") || r.trim().startsWith(sel + "{")) ?? "";
      expect(body, sel).not.toMatch(/box-shadow|filter|gradient/);
    }
    expect(css).toMatch(/\.g-btn\s*\{[^}]*box-shadow:\s*none/);
  });
});
