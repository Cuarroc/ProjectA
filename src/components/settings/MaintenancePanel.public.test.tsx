import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import MaintenancePanel from "./MaintenancePanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

type Handler = () => Promise<unknown>;
const backend = (read: Handler, enter: Handler = async () => undefined, leave: Handler = async () => undefined) =>
  vi.mocked(invoke).mockImplementation(async (cmd: string) => ({ get_maintenance: read, enter_maintenance: enter, leave_maintenance: leave })[cmd]!());
const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([name]) => name === cmd).length;
const start = () => screen.findByRole("button", { name: "Wartungsmodus starten" });
const openDialog = async () => {
  fireEvent.click(await waitFor(async () => { const b = await start(); expect(b).toBeEnabled(); return b; }));
  return screen.findByRole("alertdialog", { name: "Wartungsmodus starten?" });
};

beforeEach(() => { vi.mocked(invoke).mockReset(); });

describe("MaintenancePanel at the Tauri boundary", () => {
  it("keeps start unavailable while loading and after a failed read", async () => {
    let fail!: (cause: string) => void;
    backend(() => new Promise((_, reject) => { fail = reject; }));
    render(<MaintenancePanel />);
    expect(await start()).toBeDisabled();
    await act(async () => fail("store unavailable"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/store unavailable/);
    expect(await start()).toBeDisabled();
  });

  it("requires an explicit named maintenance confirmation before mutating", async () => {
    backend(async () => false);
    render(<MaintenancePanel />);
    const dialog = await openDialog();
    expect(calls("enter_maintenance")).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ja, Wartungsmodus starten" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Aktiv");
    expect(calls("enter_maintenance")).toBe(1);
  });

  it("focuses cancel first and cancels or escapes without mutating", async () => {
    backend(async () => false);
    render(<MaintenancePanel />);
    const dialog = await openDialog();
    const [first] = within(dialog).getAllByRole("button");
    expect(first).toHaveTextContent("Abbrechen");
    expect(first).toHaveFocus();
    fireEvent.click(first);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await openDialog();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls("enter_maintenance")).toBe(0);
  });

  it("fences a pending request against duplicate confirm or cancel or escape", async () => {
    let finish!: () => void;
    backend(async () => false, () => new Promise((resolve) => { finish = () => resolve(undefined); }));
    render(<MaintenancePanel />);
    const dialog = await openDialog();
    const confirm = within(dialog).getByRole("button", { name: "Ja, Wartungsmodus starten" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(calls("enter_maintenance")).toBe(1);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    for (const button of within(dialog).getAllByRole("button")) expect(button).toBeDisabled();
    await act(async () => finish());
    expect(await screen.findByRole("status")).toHaveTextContent("Aktiv");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("keeps the prior state and the backend refusal after a rejected enter and then retries", async () => {
    const enter = vi.fn<Handler>().mockRejectedValueOnce("1 session(s) still active").mockResolvedValue(undefined);
    backend(async () => false, enter);
    render(<MaintenancePanel />);
    fireEvent.click(within(await openDialog()).getByRole("button", { name: "Ja, Wartungsmodus starten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still active/);
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(within(await openDialog()).getByRole("button", { name: "Ja, Wartungsmodus starten" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Aktiv");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(calls("enter_maintenance")).toBe(2);
  });

  it("leaves an active maintenance and keeps it active when leaving fails", async () => {
    const leave = vi.fn<Handler>().mockRejectedValueOnce("write blocked").mockResolvedValue(undefined);
    backend(async () => true, undefined, leave);
    render(<MaintenancePanel />);
    expect(await screen.findByRole("status")).toHaveTextContent("Aktiv");
    const end = screen.getByRole("button", { name: "Wartungsmodus beenden" });
    fireEvent.click(end);
    expect(await screen.findByRole("alert")).toHaveTextContent(/write blocked/);
    expect(screen.getByRole("status")).toHaveTextContent("Aktiv");
    fireEvent.click(end);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(calls("leave_maintenance")).toBe(2);
    expect(calls("enter_maintenance")).toBe(0);
  });
});
