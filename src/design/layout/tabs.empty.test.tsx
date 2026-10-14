import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Tabs } from "./Tabs";

describe("Tabs", () => {
  it("does not throw when ArrowRight Home or End is pressed on an empty tab list", async () => {
    const onChange = vi.fn();
    const thrown: string[] = [];
    const onWindowError = (event: ErrorEvent) => {
      thrown.push(event.error instanceof Error ? event.error.message : String(event.message));
      event.preventDefault();
    };
    window.addEventListener("error", onWindowError);
    try {
      const tabs: readonly { id: string; label: string }[] = [];
      render(<Tabs idBase="k" aria-label="Bereiche" tabs={tabs} value="none" onChange={onChange} />);
      const list = screen.getByRole("tablist", { name: "Bereiche" });
      for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) fireEvent.keyDown(list, { key });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(thrown).toEqual([]);
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryAllByRole("tab")).toEqual([]);
    } finally {
      window.removeEventListener("error", onWindowError);
    }
  });

  it("does not mark a tab selected when the value matches no tab", () => {
    const onChange = vi.fn();
    const tabs: readonly { id: string; label: string }[] = [
      { id: "a", label: "Quota" },
      { id: "b", label: "Verlauf" },
    ];
    render(<Tabs idBase="k" aria-label="Bereiche" tabs={tabs} value="missing" onChange={onChange} />);
    const items = screen.getAllByRole("tab");
    expect(items.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "false"]);
    expect(items.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
