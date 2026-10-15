import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import EmergencyStop from "./EmergencyStop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const call = vi.mocked(invoke);
beforeEach(() => { call.mockReset(); });

it("uses design controls and confirms one stop IPC only after completion", async () => {
  let finish!: () => void;
  call.mockImplementation((command) => command === "get_emergency_stop"
    ? Promise.resolve(false)
    : new Promise<void>((resolve) => { finish = resolve; }));
  render(<EmergencyStop />);
  const raise = screen.getByRole("button", { name: "Not-Aus auslösen" });
  await waitFor(() => expect(raise).toBeEnabled());
  expect(raise).toHaveClass("g-btn", "g-btn--danger");
  expect(raise).toHaveAttribute("type", "button");
  expect(screen.getByTestId("emergency-stop").querySelector('[class*="settings-"]')).toBeNull();
  raise.focus();
  expect(raise).toHaveFocus();
  call.mockClear();
  fireEvent.click(raise);
  expect(raise).toBeDisabled();
  expect(screen.getByRole("status")).not.toHaveTextContent("alle Agenten sind beendet");
  fireEvent.click(raise);
  expect(call.mock.calls).toEqual([["set_emergency_stop", { active: true }]]);
  await act(async () => finish());
  expect(screen.getByRole("status")).toHaveTextContent("alle Agenten sind beendet");
  const lift = screen.getByRole("button", { name: "Not-Aus aufheben" });
  expect(lift).toHaveClass("g-btn");
  expect(lift).toBeEnabled();
  fireEvent.click(lift);
  expect(lift).toBeDisabled();
  fireEvent.click(lift);
  expect(call.mock.calls).toEqual([
    ["set_emergency_stop", { active: true }], ["set_emergency_stop", { active: false }],
  ]);
  await act(async () => finish());
  expect(screen.getByRole("button", { name: "Not-Aus auslösen" })).toBeEnabled();
});
