import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Badge } from "./Badge";

afterEach(cleanup);

describe("Badge", () => {
  it("renders text and never colour alone", () => {
    const { rerender } = render(<Badge count={0} />);
    expect(screen.getByText("0").className).toContain("g-badge");
    rerender(<Badge tone="accent">neu</Badge>);
    expect(screen.getByText("neu").className).toContain("g-badge--accent");
  });

  it("draws nothing without a finite count or a tag", () => {
    const { container, rerender } = render(<Badge />);
    expect(container.firstChild).toBeNull();
    rerender(<Badge count={Number.NaN} />);
    expect(container.firstChild).toBeNull();
    rerender(<Badge count={Number.POSITIVE_INFINITY} />);
    expect(container.firstChild).toBeNull();
  });

  it("false or empty children render no badge", () => {
    const { container, rerender } = render(<Badge>{false}</Badge>);
    expect(container.firstChild).toBeNull();
    rerender(<Badge>{""}</Badge>);
    expect(container.firstChild).toBeNull();
    rerender(<Badge count={4}>{false}</Badge>);
    expect(screen.getByText("4").className).toContain("g-badge");
  });

  it("falls back to the neutral look for an unknown tone", () => {
    const loose = { tone: "danger" } as object;
    render(<Badge {...loose}>x</Badge>);
    expect(screen.getByText("x").className).not.toContain("danger");
  });

  it("is static text and never takes focus", () => {
    const loose = { tabIndex: 0 } as object;
    render(<Badge {...loose}>x</Badge>);
    expect(screen.getByText("x").hasAttribute("tabindex")).toBe(false);
  });
});
