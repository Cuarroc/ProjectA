import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import SettingsView from "../SettingsView";
import ProfilesPanel from "./ProfilesPanel";
import type { AgentProfile } from "../../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "1.6.6") }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));

const alpha: AgentProfile = {
  id: "alpha", name: "Alpha", command: "alpha", args: [], env: {}, fallback: null, enabled: true,
};
const beta: AgentProfile = {
  id: "beta", name: "Beta", command: "beta", args: [], env: {}, fallback: null, enabled: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});

it("names profile activation controls and announces roster errors", async () => {
  const refusal = deferred<void>();
  const budget = deferred<void>();
  const readback = deferred<AgentProfile[]>();
  let writing = false;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "set_profile_enabled") {
      if (!writing) { writing = true; return refusal.promise; }
      return null;
    }
    if (command === "list_agent_profiles") return readback.promise;
    if (command === "set_budget") return budget.promise;
    if (command === "get_budgets" || command === "list_live_sessions") return [];
    if (command === "get_updater_state") return { phase: "idle" };
    return null;
  });
  render(<SettingsView
    density="comfortable" onDensityChange={vi.fn()}
    fonts={{ uiFontSize: "normal", terminalFont: "cascadia", terminalFontSize: 13 }}
    onFontsChange={vi.fn()} profiles={[alpha, beta]} project={null}
    onSaveTestCommand={vi.fn(async () => {})} onSaveMaxWorkers={vi.fn(async () => {})}
  />);
  fireEvent.click(screen.getByRole("tab", { name: "Agent-Kategorien" }));
  await act(async () => {});
  const a = screen.getByText("Alpha", { selector: ".profile-name" }).closest("li")!;
  const b = screen.getByText("Beta", { selector: ".profile-name" }).closest("li")!;
  const aSwitch = a.querySelector<HTMLInputElement>('input[name="profile-enabled-alpha"]')!;
  const bSwitch = b.querySelector<HTMLInputElement>('input[name="profile-enabled-beta"]')!;
  expect(aSwitch).toBeChecked();
  expect(bSwitch).not.toBeChecked();
  expect(invoke).not.toHaveBeenCalledWith("set_profile_enabled", expect.anything());
  fireEvent.click(aSwitch);
  expect(invoke).toHaveBeenCalledWith("set_profile_enabled", { id: "alpha", enabled: false });
  expect(aSwitch).not.toBeChecked();
  expect(aSwitch).toBeDisabled();
  expect(bSwitch).toBeEnabled();
  const aBudget = within(screen.getByRole("group", { name: "Budget: Alpha" }));
  const bBudget = within(screen.getByRole("group", { name: "Budget: Beta" }));
  fireEvent.change(bBudget.getByLabelText("5 h"), { target: { value: "30" } });
  fireEvent.click(bBudget.getByRole("button", { name: "Budget" }));
  expect(invoke).toHaveBeenCalledWith("set_budget", { profileId: "beta", fiveHourPct: 30, sevenDayPct: null });
  expect(bBudget.getByRole("button", { name: "Budget" })).toBeDisabled();
  expect(aBudget.getByRole("button", { name: "Budget" })).toBeEnabled();
  expect(bSwitch).toBeEnabled();
  await act(async () => { refusal.reject("Profiländerung abgelehnt."); budget.reject("Budget bleibt unverändert."); });
  expect(await screen.findByText("Profiländerung abgelehnt.")).toBeVisible();
  expect(aSwitch).toBeChecked();
  expect(aSwitch).toBeEnabled();
  expect(invoke).not.toHaveBeenCalledWith("list_agent_profiles");
  expect.soft(screen.queryByRole("switch", { name: "Profil Alpha aktiv" })).toBe(aSwitch);
  expect.soft(screen.queryByRole("switch", { name: "Profil Beta aktiv" })).toBe(bSwitch);
  expect.soft(screen.queryAllByRole("alert").map((el) => el.textContent)).toEqual([
    "Profiländerung abgelehnt.", "Budget bleibt unverändert.",
  ]);
  fireEvent.click(bSwitch);
  expect(invoke).toHaveBeenCalledWith("set_profile_enabled", { id: "beta", enabled: true });
  expect(bSwitch).toBeChecked();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_agent_profiles"));
  expect(bSwitch).toBeDisabled();
  expect(aSwitch).toBeEnabled();
  expect(bBudget.getByRole("button", { name: "Budget" })).toBeEnabled();
  await act(async () => readback.resolve([{ ...alpha, enabled: false }, beta]));
  expect(aSwitch).not.toBeChecked();
  expect(bSwitch).not.toBeChecked();
  expect(bSwitch).toBeEnabled();
  expect(screen.queryByText("Profiländerung abgelehnt.")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Budget bleibt unverändert.");
});

it("preserves original profile identity and boolean callbacks with an honest empty roster", () => {
  const handleToggleProfile = vi.fn();
  const handleBudgetChange = vi.fn();
  const handleSaveBudget = vi.fn();
  const props = {
    profileList: [alpha, beta], profileError: null, budgetError: null,
    profileBusyId: null, budgetBusyId: "beta",
    budgetOf: () => ({ five: "", seven: "0" }),
    handleToggleProfile, handleBudgetChange, handleSaveBudget,
  };
  const { rerender } = render(<ProfilesPanel {...props} />);
  expect(handleToggleProfile).not.toHaveBeenCalled();
  const control = screen.getByRole("switch", { name: "Profil Alpha aktiv" });
  expect(control).toHaveAttribute("type", "checkbox");
  control.focus();
  expect(control).toHaveFocus();
  fireEvent.click(control);
  expect(handleToggleProfile).toHaveBeenCalledTimes(1);
  expect(handleToggleProfile.mock.calls[0][0]).toBe(alpha);
  expect(handleToggleProfile.mock.calls[0][1]).toBe(false);
  fireEvent.click(screen.getByRole("switch", { name: "Profil Beta aktiv" }));
  expect(handleToggleProfile.mock.calls[1][0]).toBe(beta);
  expect(handleToggleProfile.mock.calls[1][1]).toBe(true);
  const group = within(screen.getByRole("group", { name: "Budget: Alpha" }));
  expect(group.getByLabelText("5 h")).toHaveValue("");
  expect(group.getByLabelText("7 T.")).toHaveValue("0");
  fireEvent.change(group.getByLabelText("5 h"), { target: { value: "42" } });
  expect(handleBudgetChange).toHaveBeenCalledWith("alpha", { five: "42" });
  fireEvent.click(group.getByRole("button", { name: "Budget" }));
  expect(handleSaveBudget.mock.calls[0][0]).toBe(alpha);
  rerender(<ProfilesPanel {...props} profileList={[]} />);
  expect(screen.getByText("Keine Profile vorhanden.")).toBeVisible();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
