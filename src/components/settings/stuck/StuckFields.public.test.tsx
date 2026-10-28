import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GeneralTab, { type GeneralTabProps } from "../GeneralTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => false) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const props = (): GeneralTabProps => ({
  density: "comfortable",
  onDensityChange: vi.fn(),
  fonts: { uiFontSize: "normal", terminalFont: "monospace", terminalFontSize: 13 },
  onFontsChange: vi.fn(),
  project: null,
  portInput: "",
  setPortInput: vi.fn(),
  portError: null,
  handleSavePort: vi.fn(),
  digestEnabled: false,
  handleToggleDigest: vi.fn(),
  digestError: null,
  envStage: "strict",
  handleEnvStage: vi.fn(),
  envStageError: null,
  stuckInput: "",
  setStuckInput: vi.fn(),
  savingStuck: false,
  handleSaveStuck: vi.fn(),
  stuckError: null,
  routing: null,
  savingRouting: false,
  routingError: null,
  handleProductMode: vi.fn(),
  testCommandInput: "",
  setTestCommandInput: vi.fn(),
  savingTestCommand: false,
  handleSaveTestCommand: vi.fn(),
  testCommandError: null,
  setupCommandInput: "",
  setSetupCommandInput: vi.fn(),
  setupCommandLoadedFor: null,
  savingSetupCommand: false,
  handleSaveSetupCommand: vi.fn(),
  setupCommandError: null,
  setSetupLoadAttempt: vi.fn(),
  maxWorkersInput: "",
  setMaxWorkersInput: vi.fn(),
  savingMaxWorkers: false,
  handleSaveMaxWorkers: vi.fn(),
  maxWorkersError: null,
});

const label = "Stuck-Diagnose (Minuten)";
const hint = "Wie lange ein laufender Worker gleichzeitig ohne Terminal-Ausgabe und ohne Änderung in seinem Worktree bleiben darf, bevor die Karte als „vermutlich festgefahren“ auf needs_you landet. Beides zusammen ist der Punkt: wer liest und denkt, schreibt nichts ins Terminal; wer kompiliert, schreibt keine Dateien. Ein leeres Feld nimmt den Standard.";

describe("GeneralTab stuck threshold (public)", () => {
  it("exposes the existing stuck threshold as a named group with linked hint and error", () => {
    const p = props();
    const { rerender } = render(<GeneralTab {...p} stuckInput="17" />);
    const group = within(screen.getByRole("group", { name: label }));
    const input = group.getByRole("textbox", { name: label });
    expect(input).toHaveAccessibleDescription(hint);
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("placeholder", "Standard: 10");
    expect(input).toBeEnabled();
    expect(input).toHaveValue("17");
    expect(input).not.toHaveAttribute("aria-invalid");
    const hintId = input.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)).toHaveTextContent(hint);
    rerender(<GeneralTab {...p} stuckInput="17" stuckError="Bitte ganze Minuten" />);
    const error = group.getByRole("alert");
    expect(error).toHaveTextContent("Bitte ganze Minuten");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toEqual([hintId, error.id]);
    expect(input).toHaveAccessibleDescription(`${hint} Bitte ganze Minuten`);
    rerender(<GeneralTab {...p} stuckInput="17" />);
    expect(group.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAttribute("aria-describedby", hintId);
    expect(input).toHaveAccessibleDescription(hint);
    expect(input).toHaveValue("17");
    const save = group.getByRole("button", { name: "Speichern" });
    expect(save).toBeEnabled();
    expect(save).toHaveAttribute("type", "button");
    for (const [index, raw] of ["", "0", "17", "bad input"].entries()) {
      fireEvent.change(input, { target: { value: raw } });
      expect(p.setStuckInput).toHaveBeenNthCalledWith(index + 1, raw);
      expect(input).toHaveValue("17");
    }
    expect(p.setStuckInput).toHaveBeenCalledTimes(4);
    expect(p.handleSaveStuck).not.toHaveBeenCalled();
    fireEvent.click(save);
    expect(p.handleSaveStuck).toHaveBeenCalledTimes(1);
    fireEvent.click(save);
    expect(p.handleSaveStuck).toHaveBeenCalledTimes(2);
    rerender(<GeneralTab {...p} stuckInput="bad input" savingStuck />);
    expect(group.getByRole("button", { name: "Speichern" })).toBe(save);
    expect(save).toHaveAttribute("aria-busy", "true");
    expect(save).toBeDisabled();
    expect(input).toBeEnabled();
    expect(input).toHaveValue("bad input");
    fireEvent.change(input, { target: { value: "0" } });
    expect(p.setStuckInput).toHaveBeenLastCalledWith("0");
    expect(p.setStuckInput).toHaveBeenCalledTimes(5);
    fireEvent.click(save);
    expect(p.handleSaveStuck).toHaveBeenCalledTimes(2);
    rerender(<GeneralTab {...p} stuckInput="" />);
    expect(input).toHaveValue("");
    expect(save).toBeEnabled();
    expect(save).not.toHaveAttribute("aria-busy");
    expect(p.handleSaveStuck).toHaveBeenCalledTimes(2);
  });
});
