import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentProfile, Project } from "../types";
import SettingsView from "./SettingsView";
import { saveUiDensity } from "../lib/settings";

const getProjectSetupCommand = vi.fn();
const setProjectSetupCommand = vi.fn(async (...args: unknown[]): Promise<void> => {
  void args;
});
const stateReads = vi.hoisted(() => ({
  getBudgets: vi.fn(() => new Promise(() => {})),
  getDigestEnabled: vi.fn(() => new Promise(() => {})),
  getRoutingStatus: vi.fn(() => new Promise(() => {})),
  getStuckAfterMinutes: vi.fn(() => new Promise(() => {})),
  setBudget: vi.fn(),
}));

// Everything the view loads besides the setup command stays in flight forever:
// its shape is not what these tests exercise.
vi.mock("../lib/ipc", () => ({
  describeError: (cause: unknown) => String(cause),
  deleteSessionBuffers: vi.fn(async () => {}),
  getBudgets: stateReads.getBudgets,
  getDigestEnabled: stateReads.getDigestEnabled,
  getLearningSettings: vi.fn(() => new Promise(() => {})),
  getProjectSetupCommand: (...args: unknown[]) => getProjectSetupCommand(...args),
  getRoutingStatus: stateReads.getRoutingStatus,
  getStuckAfterMinutes: stateReads.getStuckAfterMinutes,
  getEmergencyStop: vi.fn(() => new Promise(() => {})),
  setEmergencyStop: vi.fn(() => Promise.resolve()),
  getUpdaterState: vi.fn(() => new Promise(() => {})),
  listAgentProfiles: vi.fn(() => new Promise(() => {})),
  listLiveSessions: vi.fn(() => new Promise(() => {})),
  setBudget: stateReads.setBudget,
  setCategoryLearning: vi.fn(),
  setDigestEnabled: vi.fn(),
  setProductMode: vi.fn(),
  setProfileEnabled: vi.fn(),
  setProjectSetupCommand: (...args: unknown[]) => setProjectSetupCommand(...args),
  setStuckAfterMinutes: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(() => new Promise(() => {})) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(() => new Promise(() => {})) }));
vi.mock("../lib/settings", async (importActual) => ({
  ...(await importActual<typeof import("../lib/settings")>()),
  saveUiFontSize: vi.fn(),
  saveTerminalFont: vi.fn(),
  saveTerminalFontSize: vi.fn(),
  agentCategoryDescription: () => "",
  isMasterPromptEnabled: () => false,
  loadAgentCategories: () => [],
  loadMasterPrompt: () => "",
  loadWebPort: () => null,
  loadUiDensity: () => "comfortable",
  saveAgentCategories: vi.fn(),
  saveMasterPrompt: vi.fn(),
  saveWebPort: vi.fn(),
  saveUiDensity: vi.fn(),
  setMasterPromptEnabled: vi.fn(),
}));

function project(id: string): Project {
  return {
    id,
    name: `Project ${id}`,
    repoPath: `/tmp/${id}`,
    createdAt: 1,
    githubRemote: false,
    maxWorkers: null,
    testCommand: null,
  };
}

const PROPS = {
  density: "comfortable" as const,
  fonts: { uiFontSize: "normal" as const, terminalFont: "cascadia" as const, terminalFontSize: 13 },
  onFontsChange: vi.fn(),
  onDensityChange: vi.fn(),
  profiles: [],
  onSaveTestCommand: vi.fn(async () => {}),
  onSaveMaxWorkers: vi.fn(async () => {}),
};

describe("SettingsView setup command", { timeout: 15000 }, () => {
  it("keeps the field dead until the current project's command has loaded", async () => {
    // Review-F4-r4 (Sonnet Fund 1): after switching projects, a save must not
    // carry the previous project's setup command into the new one. The field
    // and its button stay disabled until the read for the project on screen
    // has landed.
    let resolveB: (command: string | null) => void = () => {};
    getProjectSetupCommand.mockImplementation((projectId: string) => {
      if (projectId === "pj-b") {
        return new Promise<string | null>((resolve) => {
          resolveB = resolve;
        });
      }
      return Promise.resolve("npm ci");
    });

    const { rerender } = render(<SettingsView {...PROPS} project={project("pj-a")} />);
    const field = await screen.findByLabelText(/Setup-Kommando/);
    const save = within(field.closest(".settings-command-row") as HTMLElement).getByRole(
      "button",
      { name: "Speichern" },
    );
    await waitFor(() => expect(field).toHaveValue("npm ci"));
    await waitFor(() => expect(save).toBeEnabled());

    // Switch to pj-b while its read is still in flight: the field must not
    // keep pj-a's command editable or saveable.
    rerender(<SettingsView {...PROPS} project={project("pj-b")} />);
    await waitFor(() => expect(save).toBeDisabled());
    expect(field).toHaveValue("");

    // Once pj-b's answer lands, the field belongs to pj-b.
    resolveB(null);
    await waitFor(() => expect(save).toBeEnabled());
    expect(getProjectSetupCommand).toHaveBeenCalledWith("pj-b");
    expect(setProjectSetupCommand).not.toHaveBeenCalled();
  });

  it("offers a retry when the stored command cannot be loaded", async () => {
    // Review-F4-r16 (Opus Fund 6): a failed load (e.g. a transient DB lock)
    // left field and button dead with no way back short of switching
    // projects away and back. The error now carries a retry.
    getProjectSetupCommand.mockRejectedValueOnce(new Error("database is locked"));
    render(<SettingsView {...PROPS} project={project("pj-a")} />);

    const field = await screen.findByLabelText(/Setup-Kommando/);
    expect(field).toBeDisabled();
    const retry = await screen.findByRole("button", { name: "Erneut versuchen" });

    getProjectSetupCommand.mockResolvedValue("npm ci");
    fireEvent.click(retry);
    await waitFor(() => expect(field).toHaveValue("npm ci"));
    await waitFor(() => expect(field).toBeEnabled());
    // (No call count: StrictMode double-invokes the effect; the retried
    // value landing in the field is the behavior that matters.)
  });

  it("saves the command for the project on screen", async () => {
    getProjectSetupCommand.mockResolvedValue(null);
    render(<SettingsView {...PROPS} project={project("pj-a")} />);
    const field = await screen.findByLabelText(/Setup-Kommando/);
    const save = within(field.closest(".settings-command-row") as HTMLElement).getByRole(
      "button",
      { name: "Speichern" },
    );
    await waitFor(() => expect(save).toBeEnabled());

    fireEvent.change(field, { target: { value: "npm ci" } });
    fireEvent.click(save);
    await waitFor(() => {
      expect(setProjectSetupCommand).toHaveBeenCalledWith("pj-a", "npm ci");
    });
  });

  it("names the project a late save answer belongs to", async () => {
    // Review-F4-r7 (Sonnet Fund 1): a save started under pj-a whose answer
    // lands after the switch to pj-b must not flash an unqualified success or
    // drop its error under pj-b's field — the message names pj-a.
    let rejectSave: (cause: unknown) => void = () => {};
    getProjectSetupCommand.mockResolvedValue(null);
    setProjectSetupCommand.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const { rerender } = render(<SettingsView {...PROPS} project={project("pj-a")} />);
    const field = await screen.findByLabelText(/Setup-Kommando/);
    const save = within(field.closest(".settings-command-row") as HTMLElement).getByRole(
      "button",
      { name: "Speichern" },
    );
    await waitFor(() => expect(save).toBeEnabled());

    fireEvent.change(field, { target: { value: "npm ci" } });
    fireEvent.click(save);
    rerender(<SettingsView {...PROPS} project={project("pj-b")} />);
    rejectSave(new Error("db locked"));

    await screen.findByText(/Setup-Kommando für Project pj-a nicht gespeichert/);
    expect(document.querySelector(".settings-error")).toBeNull();
  });

  it("does not let a late save answer of the old project poison the new project's baseline", async () => {
    // Review-F4-r22 (k3 Fund 2): pj-a's save resolves AFTER pj-b has loaded.
    // The original-value baseline belongs to the project on screen; a late
    // foreign answer must not overwrite it — otherwise pj-b's unchanged save
    // toasts "Freigabe verfallen" while the store correctly KEEPS the grant.
    let resolveSaveA: () => void = () => {};
    setProjectSetupCommand
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSaveA = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    getProjectSetupCommand.mockImplementation((projectId: string) =>
      Promise.resolve(projectId === "pj-b" ? "make" : null),
    );
    const { rerender } = render(<SettingsView {...PROPS} project={project("pj-a")} />);
    const field = await screen.findByLabelText(/Setup-Kommando/);
    const save = within(field.closest(".settings-command-row") as HTMLElement).getByRole(
      "button",
      { name: "Speichern" },
    );
    await waitFor(() => expect(save).toBeEnabled());

    fireEvent.change(field, { target: { value: "npm ci" } });
    fireEvent.click(save);

    rerender(<SettingsView {...PROPS} project={project("pj-b")} />);
    await waitFor(() => expect(field).toHaveValue("make"));

    // pj-a's answer lands late — after pj-b's read. Wait for its (named)
    // toast: only then has the answer been processed — and, with the bug,
    // the baseline poisoned.
    resolveSaveA();
    await screen.findByText(/verfallen — Project pj-a/);
    // An unchanged save on pj-b reads as unchanged, never as trust-voiding.
    fireEvent.click(save);
    await screen.findByText(/gespeichert, unverändert — Project pj-b/);
  });

  it("does not let a hanging save of the old project lock the new one", async () => {
    // Review-F4-r8 (Sonnet Fund 1): a save started under pj-a that is still in
    // flight must not leave pj-b's button disabled once pj-b has loaded, and
    // its late answer must not unlock pj-b either.
    getProjectSetupCommand.mockResolvedValue(null);
    setProjectSetupCommand.mockImplementation(() => new Promise<void>(() => {}));
    const { rerender } = render(<SettingsView {...PROPS} project={project("pj-a")} />);
    const field = await screen.findByLabelText(/Setup-Kommando/);
    const save = within(field.closest(".settings-command-row") as HTMLElement).getByRole(
      "button",
      { name: "Speichern" },
    );
    await waitFor(() => expect(save).toBeEnabled());

    fireEvent.change(field, { target: { value: "npm ci" } });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());

    rerender(<SettingsView {...PROPS} project={project("pj-b")} />);
    // pj-b's read lands immediately; its button must be usable — pj-a's
    // hanging save holds no lock here.
    await waitFor(() => expect(save).toBeEnabled());
  });

  it("does not let a hanging test-command save of the old project lock the new one", async () => {
    // Review-F4-r9 (k3 Fund 1): the test-command handler is the sibling of
    // the setup handler — same switch discipline.
    let resolveSave: () => void = () => {};
    const onSaveTestCommand = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    getProjectSetupCommand.mockResolvedValue(null);
    const { rerender } = render(
      <SettingsView {...PROPS} onSaveTestCommand={onSaveTestCommand} project={project("pj-a")} />,
    );
    const field = screen.getByLabelText(/Test-Kommando/);
    const save = within(field.closest(".settings-command-row") as HTMLElement).getByRole(
      "button",
      { name: "Speichern" },
    );

    fireEvent.change(field, { target: { value: "npm test" } });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());

    rerender(
      <SettingsView {...PROPS} onSaveTestCommand={onSaveTestCommand} project={project("pj-b")} />,
    );
    await waitFor(() => expect(save).toBeEnabled());
    resolveSave();
  });
});

describe("SettingsView tabs (APP-5)", () => {
  // Own setup: this block must pass when run alone (`vitest -t`, red-first).
  beforeEach(() => {
    getProjectSetupCommand.mockResolvedValue(null);
  });

  it("offers an accessible density choice and reports the change immediately", () => {
    const onDensityChange = vi.fn();
    render(<SettingsView {...PROPS} project={project("pj-a")} density="comfortable" onDensityChange={onDensityChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Kompakt" }));
    expect(saveUiDensity).toHaveBeenCalledWith("compact");
    expect(onDensityChange).toHaveBeenCalledWith("compact");
  });

  it("offers UI text size, terminal font and terminal size and reports each change", () => {
    const onFontsChange = vi.fn();
    render(<SettingsView {...PROPS} project={project("pj-a")} onFontsChange={onFontsChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Groß" }));
    expect(onFontsChange).toHaveBeenLastCalledWith({ ...PROPS.fonts, uiFontSize: "large" });
    fireEvent.change(screen.getByLabelText("Terminal-Schrift"), { target: { value: "consolas" } });
    expect(onFontsChange).toHaveBeenLastCalledWith({ ...PROPS.fonts, terminalFont: "consolas" });
    fireEvent.change(screen.getByLabelText(/Terminal-Schriftgröße/), { target: { value: "16" } });
    expect(onFontsChange).toHaveBeenLastCalledWith({ ...PROPS.fonts, terminalFontSize: 16 });
  });

  it("arrow keys switch the section and focus follows and the panel names its tab", () => {
    render(<SettingsView {...PROPS} project={project("pj-a")} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex).filter((index) => index === 0)).toHaveLength(1);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tablist", { name: "Settings section" }), { key: "ArrowRight" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs[1]);
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", tabs[1].id);
    expect(tabs[1]).toHaveAttribute("aria-controls", panel.id);
  });
});

describe("SettingsView global state resync", () => {
  it("shows values changed by a second writer after window focus", async () => {
    const profile: AgentProfile = {
      id: "codex", name: "Codex", command: "codex", args: [], env: {}, fallback: null, enabled: true,
    };
    stateReads.getDigestEnabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    stateReads.getStuckAfterMinutes.mockResolvedValueOnce(10).mockResolvedValueOnce(20);
    stateReads.getRoutingStatus
      .mockResolvedValueOnce({ mode: "cheap", reviewIndependent: true, reviewDetail: "" })
      .mockResolvedValueOnce({ mode: "reliable", reviewIndependent: true, reviewDetail: "" });
    stateReads.getBudgets
      .mockResolvedValueOnce([{ profileId: "codex", fiveHourPct: 50, sevenDayPct: 80 }])
      .mockResolvedValueOnce([{ profileId: "codex", fiveHourPct: 60, sevenDayPct: 90 }]);
    render(<SettingsView {...PROPS} profiles={[profile]} project={project("pj-a")} />);
    expect(await screen.findByLabelText("Stuck-Diagnose (Minuten)")).toHaveValue("10");

    fireEvent.focus(window);

    await waitFor(() => expect(screen.getByLabelText("Stuck-Diagnose (Minuten)")).toHaveValue("20"));
    expect(screen.getByRole("checkbox", { name: "Tages-Digest schreiben" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Reliable" })).toBeChecked();
    fireEvent.click(screen.getByRole("tab", { name: "Agent-Kategorien" }));
    expect(screen.getByLabelText("5 h")).toHaveValue("60");
    expect(screen.getByLabelText("7 T.")).toHaveValue("90");

    fireEvent.change(screen.getByLabelText("5 h"), { target: { value: "65" } });
    stateReads.getBudgets.mockResolvedValueOnce([
      { profileId: "codex", fiveHourPct: 70, sevenDayPct: 90 },
    ]);
    const callsBeforeFocus = stateReads.getBudgets.mock.calls.length;
    fireEvent.focus(window);
    await waitFor(() => expect(stateReads.getBudgets).toHaveBeenCalledTimes(callsBeforeFocus + 1));
    expect(screen.getByLabelText("5 h")).toHaveValue("65");

    let resolveStale: (rows: [{ profileId: string; fiveHourPct: number; sevenDayPct: number }]) => void = () => {};
    stateReads.getBudgets.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }));
    stateReads.setBudget.mockResolvedValue({ profileId: "codex", fiveHourPct: 65, sevenDayPct: 90 });
    fireEvent.focus(window);
    fireEvent.click(screen.getByRole("button", { name: "Budget" }));
    await waitFor(() => expect(stateReads.setBudget).toHaveBeenCalled());
    await act(async () => resolveStale([{ profileId: "codex", fiveHourPct: 70, sevenDayPct: 90 }]));
    expect(screen.getByLabelText("5 h")).toHaveValue("65");
  });
});
