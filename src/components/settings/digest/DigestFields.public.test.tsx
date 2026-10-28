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

const label = "Tages-Digest schreiben";
const hint = "Schreibt einmal pro Stunde für den Tag, der bereits vorbei ist, eine Markdown-Seite nach <repo>/.pa/memory/digests/ — Board-Stand, Tagesverlauf, Worker-Aktivität, Quota und Budget. Kein Agent, keine Tokens: alles kommt aus Daten, die ProjectA ohnehin hat. .pa/ ist gitignored, die Seiten sind Lesestoff für den Vault.";

describe("GeneralTab digest (public)", () => {
  it("keeps the global switch controlled and calls each next boolean once", () => {
    const p = props();
    const { rerender } = render(<GeneralTab {...p} />);
    const control = screen.getByRole("switch", { name: label });
    expect(control.tagName).toBe("BUTTON");
    expect(control).toHaveAttribute("type", "button");
    expect(control).toHaveAttribute("name", "digest-enabled");
    expect(control).toBeEnabled();
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveAccessibleDescription(hint);
    fireEvent.click(control);
    expect(p.handleToggleDigest).toHaveBeenCalledTimes(1);
    expect(p.handleToggleDigest).toHaveBeenNthCalledWith(1, true);
    expect(control).toHaveAttribute("aria-checked", "false");
    rerender(<GeneralTab {...p} digestEnabled />);
    expect(control).toHaveAttribute("aria-checked", "true");
    fireEvent.click(control);
    expect(p.handleToggleDigest).toHaveBeenCalledTimes(2);
    expect(p.handleToggleDigest).toHaveBeenNthCalledWith(2, false);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("keeps digest label hint and error ids unique and stable across instances", () => {
    const p = props();
    const error = "Digest konnte nicht gespeichert werden.";
    const panels = (firstError: string | null) => <>
      <section aria-label="First"><GeneralTab {...p} digestError={firstError} /></section>
      <section aria-label="Second"><GeneralTab {...p} digestEnabled digestError="Zweiter Fehler." /></section>
    </>;
    const { rerender } = render(panels(error));
    const first = within(screen.getByRole("region", { name: "First" }));
    const second = within(screen.getByRole("region", { name: "Second" }));
    const controls = [first.getByRole("switch", { name: label }), second.getByRole("switch", { name: label })];
    const ids = controls.flatMap((control) => [
      control.id,
      control.getAttribute("aria-labelledby")!,
      ...control.getAttribute("aria-describedby")!.split(" "),
    ]);
    expect(new Set(ids).size).toBe(8);
    for (const id of ids) expect(document.getElementById(id)).toBeInTheDocument();
    expect(first.getByLabelText(label)).toBe(controls[0]);
    expect(second.getByLabelText(label)).toBe(controls[1]);
    expect(controls[0]).toHaveAccessibleDescription(`${hint} ${error}`);
    expect(controls[1]).toHaveAccessibleDescription(`${hint} Zweiter Fehler.`);
    const describedBy = controls[0].getAttribute("aria-describedby");
    rerender(panels("Neuer Fehler."));
    expect(controls[0].getAttribute("aria-describedby")).toBe(describedBy);
    expect(controls[0].id).toBe(ids[0]);
    expect(controls[0]).toHaveAccessibleDescription(`${hint} Neuer Fehler.`);
    rerender(panels(null));
    expect(first.queryByText("Neuer Fehler.")).not.toBeInTheDocument();
    expect(controls[0]).toHaveAccessibleDescription(hint);
    expect(controls[0].id).toBe(ids[0]);
  });
});
