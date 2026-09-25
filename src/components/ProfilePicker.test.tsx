import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentProfile } from "../types";
import ProfilePicker from "./ProfilePicker";

const profile = (id: string, name: string): AgentProfile => ({
  id,
  name,
  command: id,
  args: [],
  env: {},
  fallback: null,
  enabled: true,
});

const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe("ProfilePicker (APP-7 / APP-18)", () => {
  it("offers a visible way out and hands focus back to the opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Neu";
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { unmount } = render(
      <ProfilePicker profiles={[profile("claude", "Claude")]} loading={false} error={null} onPick={vi.fn()} onClose={onClose} />,
    );
    await nextFrame();
    // The picker focuses its first entry itself; the trap must not override that.
    expect(document.activeElement).toHaveTextContent("Claude");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps Tab inside the dialog", async () => {
    render(
      <ProfilePicker profiles={[profile("claude", "Claude"), profile("codex", "Codex")]} loading={false} error={null} onPick={vi.fn()} onClose={vi.fn()} />,
    );
    await nextFrame();
    const dialog = screen.getByRole("dialog");
    screen.getByRole("button", { name: "Abbrechen" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toHaveTextContent("Claude");
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abbrechen" }));
  });
});
