import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Badge } from "./Badge";
import { ListRow } from "./ListRow";

afterEach(cleanup);

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";

describe("ListRow", () => {
  it("exposes selected state and is one tab stop", () => {
    render(
      <>
        <ListRow role="option" aria-selected>first<Badge count={3} /></ListRow>
        <ListRow current>second</ListRow>
        <ListRow>third</ListRow>
      </>,
    );
    const first = screen.getByRole("option", { name: /first/ });
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "second" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "third" }).hasAttribute("aria-current")).toBe(false);
    // The badge inside a row never adds a second stop; the row itself is not skipped.
    expect(first.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    expect(first.tabIndex).toBe(0);
  });

  it("is a native button that fires once per activation, which is what Enter and Space give", () => {
    const onClick = vi.fn();
    render(<ListRow onClick={onClick}>row</ListRow>);
    const row = screen.getByRole("button", { name: "row" });
    expect((row as HTMLButtonElement).type).toBe("button");
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("selected look covers every non-false aria-current token", () => {
    const css = readFileSync(resolve(__dirname, "surface.css"), "utf8");
    // page, step, location and date all mean "current"; only "false" must not select.
    expect(css).not.toContain('aria-current="true"');
    expect(css.match(/\[aria-current\]:not\(\[aria-current="false"\]\)/g)).toHaveLength(2);
  });

  it("does not activate while disabled", () => {
    const onClick = vi.fn();
    render(<ListRow disabled onClick={onClick}>row</ListRow>);
    fireEvent.click(screen.getByRole("button", { name: "row" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
