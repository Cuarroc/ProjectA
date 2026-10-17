// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { de } from "../../i18n/de";
import { ConfirmDialog } from "./ConfirmDialog";

const props = { title: "Worker löschen?", description: "Das lässt sich nicht rückgängig machen.", confirmLabel: "Löschen" };

describe("ConfirmDialog", () => {
  it("is an alertdialog and focuses Abbrechen first and Esc cancels and confirm fires once", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open {...props} tone="danger" onConfirm={onConfirm} onCancel={onCancel} />);
    const dialog = screen.getByRole("alertdialog", { name: props.title });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(props.description);
    const cancel = screen.getByRole("button", { name: de["leitstand.cancel"] });
    expect(cancel).toHaveFocus();
    const confirm = screen.getByRole("button", { name: props.confirmLabel });
    expect(confirm).toHaveClass("g-btn--danger");
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("a click on the scrim does not close it", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open {...props} onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.mouseDown(screen.getByRole("alertdialog").parentElement as HTMLElement);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("confirms again after it was closed and reopened", () => {
    const onConfirm = vi.fn();
    const Harness = () => {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>Auf</button>
          <ConfirmDialog open={open} {...props} onConfirm={() => { onConfirm(); setOpen(false); }} onCancel={() => setOpen(false)} />
        </>
      );
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: props.confirmLabel }));
    fireEvent.click(screen.getByRole("button", { name: "Auf" }));
    fireEvent.click(screen.getByRole("button", { name: props.confirmLabel }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
