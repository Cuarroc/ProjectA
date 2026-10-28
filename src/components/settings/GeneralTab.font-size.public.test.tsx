import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadFontSettings, type FontSettings } from "../../lib/settings";
import GeneralTab, { type GeneralTabProps } from "./GeneralTab";

const unchanged = () => {};
const props: Omit<GeneralTabProps, "fonts" | "onFontsChange"> = {
  density: "comfortable", onDensityChange: unchanged, project: null,
  portInput: "", setPortInput: unchanged, portError: null, handleSavePort: unchanged,
  digestEnabled: false, handleToggleDigest: unchanged, digestError: null,
  envStage: "inherit", handleEnvStage: unchanged, envStageError: null,
  stuckInput: "10", setStuckInput: unchanged, savingStuck: false,
  handleSaveStuck: unchanged, stuckError: null, routing: null, savingRouting: false,
  routingError: null, handleProductMode: unchanged,
  testCommandInput: "", setTestCommandInput: unchanged, savingTestCommand: false,
  handleSaveTestCommand: unchanged, testCommandError: null,
  setupCommandInput: "", setSetupCommandInput: unchanged, setupCommandLoadedFor: null,
  savingSetupCommand: false, handleSaveSetupCommand: unchanged, setupCommandError: null,
  setSetupLoadAttempt: unchanged, maxWorkersInput: "3", setMaxWorkersInput: unchanged,
  savingMaxWorkers: false, handleSaveMaxWorkers: unchanged, maxWorkersError: null,
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("selects and persists UI font size through the named keyboard group", () => {
  const onChange = vi.fn<(fonts: FontSettings) => void>();
  function Harness() {
    const [fonts, setFonts] = useState(loadFontSettings);
    return <GeneralTab {...props} fonts={fonts} onFontsChange={(next) => {
      onChange(next);
      setFonts(next);
    }} />;
  }
  const first = render(<Harness />);
  const group = screen.getByRole("radiogroup", { name: "Schriftgröße der App" });
  const normal = within(group).getByRole("radio", { name: "Normal", checked: true });
  expect(normal).toHaveAttribute("tabindex", "0");
  normal.focus();
  fireEvent.keyDown(normal, { key: "End" });
  const large = within(group).getByRole("radio", { name: "Groß", checked: true });
  expect(large).toHaveFocus();
  expect(large).toHaveAttribute("tabindex", "0");
  expect(normal).toHaveAttribute("tabindex", "-1");
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    uiFontSize: "large", terminalFont: "cascadia", terminalFontSize: 13,
  });
  expect(localStorage.getItem("projecta.settings.uiFontSize")).toBe("large");

  first.unmount();
  render(<Harness />);
  const restored = screen.getByRole("radiogroup", { name: "Schriftgröße der App" });
  expect(within(restored).getByRole("radio", { name: "Groß", checked: true }))
    .toHaveAttribute("tabindex", "0");
  expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.click(within(restored).getByRole("radio", { name: "Normal" }));
  expect(within(restored).getByRole("radio", { name: "Normal", checked: true }))
    .toHaveAttribute("tabindex", "0");
  expect(localStorage.getItem("projecta.settings.uiFontSize")).toBeNull();
  expect(onChange).toHaveBeenNthCalledWith(2, {
    uiFontSize: "normal", terminalFont: "cascadia", terminalFontSize: 13,
  });

  fireEvent.click(within(restored).getByRole("radio", { name: "Klein" }));
  expect(within(restored).getByRole("radio", { name: "Klein", checked: true }))
    .toHaveAttribute("tabindex", "0");
  expect(localStorage.getItem("projecta.settings.uiFontSize")).toBe("small");
  expect(onChange).toHaveBeenNthCalledWith(3, {
    uiFontSize: "small", terminalFont: "cascadia", terminalFontSize: 13,
  });
  expect(onChange).toHaveBeenCalledTimes(3);
  expect(localStorage.getItem("projecta.settings.terminalFont")).toBeNull();
  expect(localStorage.getItem("projecta.settings.terminalFontSize")).toBeNull();
});
