import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { de } from "../../i18n/de";
import { Banner } from "./Banner";

afterEach(cleanup);

describe("Banner", () => {
  it("bad uses role alert and info uses status", () => {
    const { rerender } = render(<Banner kind="bad">Kaputt</Banner>);
    expect(screen.getByRole("alert")).toHaveTextContent("Kaputt");
    for (const kind of ["info", "ok", "warn"] as const) {
      rerender(<Banner kind={kind}>Text</Banner>);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent("Text");
    }
  });

  it("names its kind in words, not colour alone", () => {
    const { rerender } = render(<Banner kind="info">Text</Banner>);
    for (const kind of ["info", "ok", "warn", "bad"] as const) {
      rerender(<Banner kind={kind}>Text</Banner>);
      expect(screen.getByRole(kind === "bad" ? "alert" : "status")).toHaveTextContent(de[`banner.${kind}`]);
    }
  });

  it("passes a class and extra content through", () => {
    render(<Banner kind="warn" className="extra"><button>Los</button></Banner>);
    expect(screen.getByRole("status")).toHaveClass("g-banner", "g-banner--warn", "extra");
    expect(screen.getByRole("button", { name: "Los" })).toBeInTheDocument();
  });
});
