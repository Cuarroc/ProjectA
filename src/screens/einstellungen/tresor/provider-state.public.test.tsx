import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TresorPanel } from "./TresorPanel";

const boundary = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: boundary.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

// Literal wire rows: expectations below do not use the production formatters.
const rows = [
  { id: "stored", name: "Stored only", kind: "api_key", connected: false, quotaState: "unknown", vaultError: null },
  { id: "online", name: "Core online", kind: "api_key", connected: true, quotaState: "ok", vaultError: null },
  { id: "subscription", name: "CLI subscription", kind: "subscription", connected: true, quotaState: "blocked", vaultError: null },
  { id: "local", name: "Local engine", kind: "local", connected: false, quotaState: "unknown", vaultError: null },
];
let overview: unknown;
let presence: unknown;
const row = (name: string) => within(screen.getByRole("row", { name: new RegExp(name) }));
const commands = () => boundary.invoke.mock.calls.map(([command]) => command);

beforeEach(() => {
  overview = rows;
  presence = true;
  boundary.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "get_provider_overview") {
      if (overview instanceof Error) throw overview;
      return overview;
    }
    if (command === "has_provider_key") {
      if (presence instanceof Error) throw presence;
      return presence;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(() => vi.restoreAllMocks());

it("shows core connection and unknown quota separately from key presence", async () => {
  render(<TresorPanel />);
  await screen.findAllByText("Schlüssel hinterlegt");
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Anbieter", "Art", "Zugang", "Verbindung (Kern)", "Kontingent",
  ]);
  for (const [name, kind, access, connection, quota] of [
    ["Stored only", "API-Key", "Schlüssel hinterlegt", "Nicht verbunden", "Unbekannt"],
    ["Core online", "API-Key", "Schlüssel hinterlegt", "Verbunden", "OK"],
    ["CLI subscription", "Abo", "Anmeldung über die CLI, kein Schlüssel im Tresor", "Verbunden", "Blockiert"],
    ["Local engine", "Lokal", "kein Schlüssel nötig", "Nicht verbunden", "Unbekannt"],
  ]) {
    for (const text of [kind, access, connection, quota]) expect(row(name).getByText(text)).toBeVisible();
  }
  expect(row("Stored only").queryByText(/bereit|verfügbar|0\s*%|Modell/i)).toBeNull();
  expect(boundary.invoke.mock.calls.filter(([cmd]) => cmd === "has_provider_key").map(([, args]) => args)).toEqual([
    { providerId: "stored" }, { providerId: "online" },
  ]);
  expect(new Set(commands())).toEqual(new Set(["get_provider_overview", "has_provider_key"]));
  expect(screen.getAllByRole("button")).toEqual([screen.getByRole("button", { name: "Neu lesen" })]);
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
});

it("recovers from unavailable overview and keeps empty data honest", async () => {
  overview = new Error("PRIVATE-ERROR-MARKER");
  render(<TresorPanel />);
  expect(await screen.findByText("Tresor nicht lesbar")).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
  expect(document.body).not.toHaveTextContent("PRIVATE-ERROR-MARKER");
  expect(commands()).toEqual(["get_provider_overview"]);
  overview = [];
  fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
  expect(await screen.findByText("Keine Anbieter bekannt")).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
  expect(commands()).toEqual(["get_provider_overview", "get_provider_overview"]);
});

it("keeps failed vault presence unknown and offers recovery without mutation", async () => {
  overview = [{ id: "broken", name: "Broken vault", kind: "api_key", connected: false, quotaState: "unknown", vaultError: "vault_corrupt" }];
  presence = new Error("PRIVATE-VAULT-MARKER");
  render(<TresorPanel />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Der Schlüsselspeicher ist beschädigt");
  expect(await screen.findByText("nicht prüfbar")).toBeVisible();
  expect(screen.queryByText("kein Schlüssel hinterlegt")).toBeNull();
  expect(document.body).not.toHaveTextContent("PRIVATE-VAULT-MARKER");
  overview = rows;
  presence = false;
  fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
  await screen.findAllByText("kein Schlüssel hinterlegt");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(new Set(commands())).toEqual(new Set(["get_provider_overview", "has_provider_key"]));
});

it("rereads core state manually and drops old key replies without polling", async () => {
  const interval = vi.spyOn(window, "setInterval");
  let resolveOld!: (value: boolean) => void;
  presence = new Promise<boolean>((resolve) => { resolveOld = resolve; });
  await act(async () => { render(<TresorPanel />); });
  expect(screen.getAllByText("wird geprüft")).toHaveLength(2);
  overview = [{ id: "stored", name: "Stored only", kind: "api_key", connected: true, quotaState: "blocked", vaultError: null }];
  presence = false;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Neu lesen" })); });
  expect(screen.getByText("kein Schlüssel hinterlegt")).toBeVisible();
  await act(async () => { resolveOld(true); });
  expect(row("Stored only").getByText("kein Schlüssel hinterlegt")).toBeVisible();
  expect(screen.queryByText("Schlüssel hinterlegt")).toBeNull();
  expect(commands().filter((cmd) => cmd === "get_provider_overview")).toHaveLength(2);
  expect(interval).not.toHaveBeenCalled();
  expect(new Set(commands())).toEqual(new Set(["get_provider_overview", "has_provider_key"]));
});
