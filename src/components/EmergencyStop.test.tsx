import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import EmergencyStop from "./EmergencyStop";

const ipc = vi.hoisted(() => ({
  getEmergencyStop: vi.fn(),
  setEmergencyStop: vi.fn(),
}));
vi.mock("../lib/ipc", () => ({ ...ipc, describeError: (e: unknown) => String(e) }));

describe("EmergencyStop", () => {
  beforeEach(() => {
    ipc.getEmergencyStop.mockReset();
    ipc.setEmergencyStop.mockReset();
  });

  it("raises the stop and shows it active", async () => {
    ipc.getEmergencyStop.mockResolvedValue(false);
    ipc.setEmergencyStop.mockResolvedValue(undefined);
    render(<EmergencyStop />);
    fireEvent.click(await screen.findByRole("button", { name: "Not-Aus auslösen" }));
    expect(await screen.findByRole("button", { name: "Not-Aus aufheben" })).toBeTruthy();
    expect(ipc.setEmergencyStop).toHaveBeenCalledWith(true);
  });

  it("treats an unreadable state as stopped", async () => {
    ipc.getEmergencyStop.mockRejectedValue("db down");
    render(<EmergencyStop />);
    expect(await screen.findByRole("button", { name: "Not-Aus aufheben" })).toBeTruthy();
  });

  it("keeps the stop up and shows the error when the end was not confirmed", async () => {
    ipc.getEmergencyStop.mockResolvedValue(false);
    ipc.setEmergencyStop.mockRejectedValue("1 agent session(s) still alive after 10s");
    render(<EmergencyStop />);
    fireEvent.click(await screen.findByRole("button", { name: "Not-Aus auslösen" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/still alive after 10s/));
    expect(screen.getByRole("button", { name: "Not-Aus aufheben" })).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(/Stillstand ist nicht bestätigt/);
    expect(screen.queryByText(/alle Agenten sind beendet/)).toBeNull();
  });

  it("shows a stop raised through the API while settings stays open", async () => {
    ipc.getEmergencyStop.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<EmergencyStop />);
    expect(await screen.findByRole("button", { name: "Not-Aus auslösen" })).toBeTruthy();

    fireEvent.focus(window);

    expect(await screen.findByRole("button", { name: "Not-Aus aufheben" })).toBeTruthy();
  });
});
