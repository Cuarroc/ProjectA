// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { Sheet, type SheetProps } from "./Sheet";

const css = readFileSync(resolve(__dirname, "layout.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("Sheet slots", () => {
  it("takes a size and label ids and keeps the scrim open when asked", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} size="sm" role="alertdialog" aria-labelledby="t1" aria-describedby="d1" dismissOnScrim={false}>
        <h2 id="t1">Titel</h2>
        <p id="d1">Text</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Titel" });
    expect(dialog).toHaveAttribute("data-size", "sm");
    expect(dialog).toHaveAccessibleDescription("Text");
    expect(dialog).not.toHaveAttribute("aria-label");
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    for (const size of ["sm", "lg"]) expect(css).toContain(`.g-sheet[data-size="${size}"]`);
  });

  it("without the new props it is the same dialog as before", () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} aria-label="Alt"><button>Ok</button></Sheet>);
    const dialog = screen.getByRole("dialog", { name: "Alt" });
    expect(dialog).toHaveAttribute("data-size", "md");
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Sheet accessible name", () => {
  it("requires aria-label or aria-labelledby and renders a named dialog", () => {
    // Compile-time: tsc (npm run typecheck) enforces these; vitest only runs the render.
    expectTypeOf<{ open: true; onClose: () => void }>().not.toMatchTypeOf<SheetProps>();
    expectTypeOf<{ open: true; onClose: () => void; "aria-label": string }>().toMatchTypeOf<SheetProps>();
    expectTypeOf<{ open: true; onClose: () => void; "aria-labelledby": string }>().toMatchTypeOf<SheetProps>();
    render(<Sheet open onClose={() => {}} aria-labelledby="n1"><h2 id="n1">Name</h2></Sheet>);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Name");
  });
});
