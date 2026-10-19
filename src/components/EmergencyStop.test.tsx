import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

import EmergencyStop from "./EmergencyStop";

const ipc = vi.hoisted(() => ({
  getEmergencyStop: vi.fn(),
  setEmergencyStop: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: { active: boolean }) => {
    if (command === "get_emergency_stop") return ipc.getEmergencyStop();
    if (command === "set_emergency_stop") return ipc.setEmergencyStop(args?.active);
    throw new Error(`Unexpected IPC: ${command}`);
} }));

describe("EmergencyStop", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    ipc.getEmergencyStop.mockReset();
    ipc.setEmergencyStop.mockReset();
  });

  it("opens confirmation with the bounded stop promise and does not engage on the first click", async () => {
    ipc.getEmergencyStop.mockResolvedValue(false);
    render(<EmergencyStop />);
    const raise = screen.getByRole("button", { name: "Not-Aus auslösen" });
    await waitFor(() => expect(raise).toBeEnabled());
    fireEvent.click(raise);
    expect(ipc.setEmergencyStop).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Not-Aus bestätigen" }))
      .toHaveTextContent("Alle laufenden Agenten werden binnen 10 Sekunden beendet; neue Aufgaben werden gesperrt.");
  });

  it("engages exactly once only after explicit confirmation", async () => {
    ipc.getEmergencyStop.mockResolvedValue(false);
    ipc.setEmergencyStop.mockReturnValue(new Promise(() => {}));
    render(<EmergencyStop />);
    const raise = screen.getByRole("button", { name: "Not-Aus auslösen" });
    await waitFor(() => expect(raise).toBeEnabled());
    fireEvent.click(raise);
    const confirm = screen.getByRole("button", { name: "Ja, alles anhalten" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(ipc.setEmergencyStop.mock.calls).toEqual([[true]]);
  });

  it("cancels with Escape or Abbrechen without engaging and restores focus", async () => {
    ipc.getEmergencyStop.mockResolvedValue(false);
    render(<EmergencyStop />);
    const raise = screen.getByRole("button", { name: "Not-Aus auslösen" });
    await waitFor(() => expect(raise).toBeEnabled());
    for (const escape of [true, false]) {
      raise.focus();
      fireEvent.click(raise);
      const cancel = screen.getByRole("button", { name: "Abbrechen" });
      expect(cancel).toHaveFocus();
      if (escape) fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      else fireEvent.click(cancel);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(raise).toHaveFocus();
      expect(ipc.setEmergencyStop).not.toHaveBeenCalled();
    }
  });

  it("ignores Escape outside the dialog and never steals focus", async () => {
    ipc.getEmergencyStop.mockResolvedValue(false);
    render(<EmergencyStop />);
    const raise = screen.getByRole("button", { name: "Not-Aus auslösen" });
    await waitFor(() => expect(raise).toBeEnabled());
    fireEvent.click(raise);
    const dialog = screen.getByRole("dialog", { name: "Not-Aus bestätigen" });
    raise.focus();
    fireEvent.keyDown(raise, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    expect(raise).toHaveFocus();
    expect(ipc.setEmergencyStop).not.toHaveBeenCalled();
  });

  it("moves focus to the lift button after the confirmed stop engages", async () => {
    ipc.getEmergencyStop.mockResolvedValue(false);
    ipc.setEmergencyStop.mockResolvedValue(undefined);
    render(<EmergencyStop />);
    const raise = screen.getByRole("button", { name: "Not-Aus auslösen" });
    await waitFor(() => expect(raise).toBeEnabled());
    fireEvent.click(raise);
    fireEvent.click(screen.getByRole("button", { name: "Ja, alles anhalten" }));
    const lift = await screen.findByRole("button", { name: "Not-Aus aufheben" });
    await waitFor(() => expect(lift).toHaveFocus());
  });

  it("raises the stop and shows it active", async () => {
    let resolveInitial!: (active: boolean) => void;
    ipc.getEmergencyStop.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveInitial = resolve;
    }));
    ipc.setEmergencyStop.mockResolvedValue(undefined);
    render(<EmergencyStop />);
    const raise = await screen.findByRole("button", { name: "Not-Aus auslösen" });
    expect(raise).toBeDisabled();
    expect(ipc.setEmergencyStop).not.toHaveBeenCalled();
    // The button exists during loading; only an enabled button accepts the click.
    await act(async () => resolveInitial(false));
    await waitFor(() => expect(raise).toBeEnabled());
    fireEvent.click(raise);
    fireEvent.click(screen.getByRole("button", { name: "Ja, alles anhalten" }));
    await waitFor(() => expect(ipc.setEmergencyStop).toHaveBeenCalledWith(true));
    expect(await screen.findByRole("button", { name: "Not-Aus aufheben" })).toBeTruthy();
  });

  it("styles the raise control as a danger button", async () => {
    ipc.getEmergencyStop.mockResolvedValue(false);
    render(<EmergencyStop />);
    const raise = await screen.findByRole("button", { name: "Not-Aus auslösen" });
    expect(raise).toHaveClass("g-btn", "g-btn--danger");
  });

  it("keeps the large hit target of the raise control in the header", async () => {
    ipc.getEmergencyStop.mockResolvedValue(false);
    render(<EmergencyStop />);
    const raise = await screen.findByRole("button", { name: "Not-Aus auslösen" });
    expect(raise).toHaveClass("g-btn--lg");
    expect(raise).not.toHaveClass("g-btn--sm");
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
    const raise = screen.getByRole("button", { name: "Not-Aus auslösen" });
    await waitFor(() => expect(raise).toBeEnabled());
    fireEvent.click(raise);
    fireEvent.click(screen.getByRole("button", { name: "Ja, alles anhalten" }));
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

  it("does not let an older refresh undo a stop raised in this view", async () => {
    let resolveRefresh: (active: boolean) => void = () => {};
    ipc.getEmergencyStop
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    ipc.setEmergencyStop.mockResolvedValue(undefined);
    render(<EmergencyStop />);
    const raise = screen.getByRole("button", { name: "Not-Aus auslösen" });
    await waitFor(() => expect(raise).toBeEnabled());
    fireEvent.focus(window);
    fireEvent.click(raise);
    fireEvent.click(screen.getByRole("button", { name: "Ja, alles anhalten" }));
    expect(await screen.findByRole("button", { name: "Not-Aus aufheben" })).toBeTruthy();
    await act(async () => resolveRefresh(false));
    expect(screen.getByRole("button", { name: "Not-Aus aufheben" })).toBeTruthy();
  });

  it("polls the safety state every five seconds while visible", async () => {
    vi.useFakeTimers();
    ipc.getEmergencyStop.mockResolvedValue(false);
    render(<EmergencyStop />);
    await act(async () => undefined);
    expect(ipc.getEmergencyStop).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(ipc.getEmergencyStop).toHaveBeenCalledTimes(2);
  });

  it("uses the design lift button by default and lifts the stop", async () => {
    ipc.getEmergencyStop.mockResolvedValue(true);
    ipc.setEmergencyStop.mockResolvedValue(undefined);
    render(<EmergencyStop />);
    const lift = await screen.findByRole("button", { name: "Not-Aus aufheben" });
    expect(lift.className.split(/\s+/)).toContain("g-btn");
    expect(lift.className).not.toContain("button-ghost");
    fireEvent.click(lift);
    expect(await screen.findByRole("button", { name: "Not-Aus auslösen" })).toBeTruthy();
    expect(ipc.setEmergencyStop).toHaveBeenCalledWith(false);
  });
});
