import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import MasterPromptTab, { type MasterPromptTabProps } from "./MasterPromptTab";

const setup = (props: Partial<MasterPromptTabProps> = {}) => {
  const spies = { setMasterPrompt: vi.fn(), handleToggleMaster: vi.fn(), handleSaveMasterPrompt: vi.fn() };
  render(<MasterPromptTab masterPrompt="" masterEnabled={false} {...spies} {...props} />);
  return spies;
};

it("names the master prompt preview and preserves the controlled draft", () => {
  const { setMasterPrompt, handleSaveMasterPrompt } = setup({ masterPrompt: "  Regel A\n\nRegel B \n" });
  const preview = screen.getByRole("region", { name: "Vorschau" });
  expect(preview.querySelector("pre")?.textContent).toBe("  Regel A\n\nRegel B \n\n\n---\n\n<Aufgabe des Agenten>");

  const area = screen.getByRole("textbox", { name: "Globaler Masterprompt" });
  expect(area.tagName).toBe("TEXTAREA");
  expect(area.tabIndex).toBeGreaterThanOrEqual(0);
  area.focus();
  expect(area).toHaveFocus();
  expect(area).toHaveValue("  Regel A\n\nRegel B \n");
  fireEvent.change(area, { target: { value: "  neu \n" } });
  expect(setMasterPrompt).toHaveBeenCalledExactlyOnceWith("  neu \n");
  expect(handleSaveMasterPrompt).not.toHaveBeenCalled();
});

it("shows the empty wording for a blank draft", () => {
  setup({ masterPrompt: " \n\t " });
  expect(screen.getByRole("region", { name: "Vorschau" })).toHaveTextContent("(kein Masterprompt gesetzt)");
  expect(screen.queryByText(/Aufgabe des Agenten/)).toBeNull();
});

it("saves once from the keyboard-focusable button", () => {
  const { handleSaveMasterPrompt } = setup({ masterPrompt: "x" });
  const save = screen.getByRole("button", { name: "Speichern" });
  expect(save.tagName).toBe("BUTTON");
  expect(save).toHaveAttribute("type", "button");
  expect(save).toBeEnabled();
  expect(save.tabIndex).toBeGreaterThanOrEqual(0);
  save.focus();
  expect(save).toHaveFocus();
  fireEvent.click(save);
  expect(handleSaveMasterPrompt).toHaveBeenCalledTimes(1);
});

it.each([false, true])("delegates the switch to the parent while enabled is %s", (enabled) => {
  const { handleToggleMaster } = setup({ masterEnabled: enabled });
  const toggle = screen.getByRole("switch", { name: "Masterprompt für alle Agenten verwenden" });
  expect(toggle.tagName).toBe("INPUT");
  expect(toggle).toHaveAttribute("type", "checkbox");
  expect(toggle).toBeEnabled();
  expect(toggle.tabIndex).toBeGreaterThanOrEqual(0);
  expect(toggle).toHaveProperty("checked", enabled);
  toggle.focus();
  expect(toggle).toHaveFocus();
  fireEvent.click(toggle);
  expect(handleToggleMaster).toHaveBeenCalledExactlyOnceWith(!enabled);
  // Controlled: the leaf does not flip its own state, the parent decides.
  expect(toggle).toHaveProperty("checked", enabled);
});
