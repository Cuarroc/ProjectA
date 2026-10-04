import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import MaintenancePanel from "./MaintenancePanel";

const ipc = vi.hoisted(() => ({
  enterMaintenance: vi.fn(),
  leaveMaintenance: vi.fn(),
}));
vi.mock("../../lib/ipc", () => ({ ...ipc, describeError: (e: unknown) => String(e) }));

describe("MaintenancePanel", () => {
  beforeEach(() => {
    ipc.enterMaintenance.mockReset();
    ipc.leaveMaintenance.mockReset();
  });

  it("enters maintenance only after confirmation and shows the badge", async () => {
    ipc.enterMaintenance.mockResolvedValue(undefined);
    render(<MaintenancePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Wartungsmodus starten" }));
    expect(ipc.enterMaintenance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ja, Wartungsmodus starten" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Aktiv");
    expect(ipc.enterMaintenance).toHaveBeenCalledTimes(1);
  });

  it("leaves maintenance and drops the badge", async () => {
    ipc.enterMaintenance.mockResolvedValue(undefined);
    ipc.leaveMaintenance.mockResolvedValue(undefined);
    render(<MaintenancePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Wartungsmodus starten" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, Wartungsmodus starten" }));
    fireEvent.click(await screen.findByRole("button", { name: "Wartungsmodus beenden" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(ipc.leaveMaintenance).toHaveBeenCalledTimes(1);
  });

  it("shows an IPC error and keeps the badge off", async () => {
    ipc.enterMaintenance.mockRejectedValue("1 session(s) still active");
    render(<MaintenancePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Wartungsmodus starten" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, Wartungsmodus starten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still active/);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
