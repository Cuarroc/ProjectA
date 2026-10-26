import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { getIdentifier, getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import WebInterfacePanel from "../../components/WebInterfacePanel";
import { EinstellungenScreen } from "./EinstellungenScreen";

// Only the Tauri boundary is mocked; settings, panel and screen are the real modules.
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(), getIdentifier: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const KEY = "projecta.settings.webPort";
const RANGE = "Bitte eine Portnummer zwischen 1 und 65535 angeben.";
const starts = () => vi.mocked(invoke).mock.calls.filter(([c]) => c === "start_web_interface");

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    switch (command) {
      case "start_web_interface": return (args as { port: number }).port;
      case "web_interface_status": return null;
      case "get_log_path": return "logs/projecta.log";
      case "get_panic_notice": return { current: null, previous: null };
      case "get_reason_catalog": return [];
      case "get_emergency_stop": return false;
      default: return null;
    }
  });
  vi.mocked(getVersion).mockReset().mockResolvedValue("9.8.7");
  vi.mocked(getIdentifier).mockReset().mockResolvedValue("com.projecta.app");
  vi.mocked(check).mockReset().mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Settings() {
  const [path, navigate] = useState("/einstellungen");
  return <EinstellungenScreen path={path} onNavigate={navigate} onOpenClassic={() => undefined} />;
}
const input = () => screen.getByRole("textbox", { name: "Standard-Port Web-Ansicht" }) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "Port speichern" }));
const enter = (value: string) => { fireEvent.change(input(), { target: { value } }); save(); };

async function startFromPanel() {
  render(<WebInterfacePanel />);
  await screen.findByText("aus");
  fireEvent.click(screen.getByRole("button", { name: "Starten" }));
  await waitFor(() => expect(starts()).toHaveLength(1));
  const port = (starts()[0][1] as { port: number }).port;
  cleanup();
  vi.mocked(invoke).mockClear();
  return port;
}

it("Glass default web port is used on the next explicit web start", async () => {
  render(<Settings />);
  enter("9123");
  expect(localStorage.getItem(KEY)).toBe("9123");
  expect(starts()).toHaveLength(0);
  cleanup();

  expect(await startFromPanel()).toBe(9123);

  render(<Settings />);
  expect(input().value).toBe("9123");
  enter("");
  expect(localStorage.getItem(KEY)).toBeNull();
  cleanup();

  expect(await startFromPanel()).toBe(8787);
});

it.each(["abc", "0", "65536"])("rejects %s, keeps the stored port and starts nothing", (bad) => {
  localStorage.setItem(KEY, "9123");
  render(<Settings />);
  expect(input()).not.toHaveAttribute("aria-invalid");
  enter(bad);
  expect(localStorage.getItem(KEY)).toBe("9123");
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent(RANGE);
  expect(input()).toHaveAttribute("aria-invalid", "true");
  expect(input().getAttribute("aria-describedby")).toContain(alert.id);
  expect(starts()).toHaveLength(0);
});

it("clears the error once a valid value is saved and trims the input", () => {
  render(<Settings />);
  enter("70000");
  expect(screen.getByRole("alert")).toBeInTheDocument();
  enter(" 9010 ");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(localStorage.getItem(KEY)).toBe("9010");
});

it("is keyboard operable: focusable named input that submits on Enter", () => {
  render(<Settings />);
  input().focus();
  expect(input()).toHaveFocus();
  fireEvent.change(input(), { target: { value: "9200" } });
  fireEvent.submit(input().closest("form")!);
  expect(localStorage.getItem(KEY)).toBe("9200");
  expect(starts()).toHaveLength(0);
});

it("never claims a saved port when storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  render(<Settings />);
  enter("9123");
  expect(screen.queryByText(/9123/)).toBeNull();
  expect(screen.queryByText(/gespeichert:/i)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
