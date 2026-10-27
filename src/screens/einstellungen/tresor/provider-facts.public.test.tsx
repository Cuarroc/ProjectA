import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TresorPanel } from "./TresorPanel";

const boundary = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: boundary.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

it("shows observed provider facts without converting missing usage to zero", async () => {
  vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000);
  const interval = vi.spyOn(window, "setInterval");
  // Literal wire data exercises the real reader, normalizer and mounted table.
  let overview: unknown = [
    { id: "zero", name: "Recorded zero", kind: "api_key", connected: true, quotaState: "ok",
      detail: "Recorded detail", usage: { percent: 0, used: "0", limit: "100 requests",
        source: "api", windowLabel: "Recorded day", observedAt: 2_000_000_000, resetsAt: 2_000_003_600 } },
    { id: "missing", name: "Unmeasured", kind: "api_key", connected: false, quotaState: "unknown", usage: null },
    { id: "text", name: "Recorded text", kind: "subscription", connected: true, quotaState: "blocked",
      detail: "Recorded cooldown", blockedUntil: 2_000_003_600,
      usage: { percent: null, used: "56.2 M tokens", limit: "80 M tokens", source: "hook",
        windowLabel: "Recorded session", observedAt: 1, resetsAt: 1 } },
    { id: "local", name: "Recorded local", kind: "local", connected: false, quotaState: "unknown",
      usage: { percent: null, used: null, limit: null, source: "local",
        windowLabel: "lokal — kein Kontingent", observedAt: 2_000_000_000, resetsAt: null } },
    { id: "future", name: "Unknown source", kind: "subscription", connected: true, quotaState: "unknown",
      usage: { percent: null, used: "0", limit: null, source: "future-source <b>raw</b>",
        windowLabel: "Recorded window", observedAt: 2_000_000_000, resetsAt: null } },
  ];
  boundary.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "get_provider_overview") {
      if (overview instanceof Error) throw overview;
      return overview;
    }
    if (command === "has_provider_key") return true;
    throw new Error(`Unexpected command: ${command}`);
  });
  const view = render(<TresorPanel />);
  await screen.findAllByText("Schlüssel hinterlegt");
  const row = (name: string) => screen.getByRole("row", { name: new RegExp(name) });
  const fact = (name: string, label: string, value: string | RegExp) => {
    const term = within(row(name)).getByText(label, { selector: "dt" });
    expect(term.nextElementSibling).toHaveTextContent(value);
  };
  expect(within(row("Recorded zero")).getByText("Recorded detail")).toBeVisible();
  fact("Recorded zero", "Verbrauch", /^0 %$/);
  fact("Recorded zero", "Genutzt", /^0$/);
  fact("Recorded zero", "Grenzwert", "100 requests");
  fact("Recorded zero", "Quelle", /^api$/);
  fact("Recorded zero", "Fenster", "Recorded day");
  fact("Recorded zero", "Stand", /\d{2}:\d{2}/);
  fact("Recorded zero", "Kontingent-Reset", "Reset in 1 h");
  expect(row("Recorded zero")).not.toHaveTextContent("veraltet");
  fact("Unmeasured", "Verbrauch", "Nicht gemessen");
  fact("Unmeasured", "Quelle", "unbekannt");
  expect(row("Unmeasured")).not.toHaveTextContent(/0\s*%|frei|bereit|verifiziert/i);
  expect(within(row("Recorded text")).getByText(/Recorded cooldown — frei/)).toBeVisible();
  fact("Recorded text", "Verbrauch", "Nicht gemessen");
  fact("Recorded text", "Genutzt", "56.2 M tokens");
  fact("Recorded text", "Grenzwert", "80 M tokens");
  fact("Recorded text", "Quelle", "hook");
  fact("Recorded text", "Fenster", "Recorded session");
  fact("Recorded text", "Stand", /\d{2}:\d{2} · veraltet/);
  fact("Recorded text", "Kontingent-Reset", "Reset fällig");
  fact("Recorded local", "Quelle", "local");
  fact("Recorded local", "Fenster", "lokal — kein Kontingent");
  fact("Recorded local", "Grenzwert", "Nicht gemessen");
  fact("Recorded local", "Kontingent-Reset", "unbekannt");
  fact("Unknown source", "Quelle", "future-source <b>raw</b>");
  fact("Unknown source", "Genutzt", /^0$/);
  expect(row("Unknown source").querySelector("b")).toBeNull();
  expect(row("Unknown source")).not.toHaveTextContent(/0\s*%|API.verifiziert|bereit/i);
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Anbieter", "Art", "Zugang", "Verbindung (Kern)", "Kontingent",
  ]);
  overview = new Error("PRIVATE-FACTS-ERROR");
  fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
  expect(await screen.findByText("Tresor nicht lesbar")).toBeVisible();
  expect(screen.queryByText("Recorded detail")).toBeNull();
  expect(document.body).not.toHaveTextContent("PRIVATE-FACTS-ERROR");
  overview = [{ id: "zero", name: "Recorded zero", kind: "api_key", usage: null }];
  fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
  await screen.findByText("Schlüssel hinterlegt");
  fact("Recorded zero", "Verbrauch", "Nicht gemessen");
  expect(screen.queryByText("Recorded detail")).toBeNull();
  let resolveLate!: (value: unknown) => void;
  overview = new Promise((resolve) => { resolveLate = resolve; });
  fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
  view.unmount();
  await act(async () => { resolveLate([{ id: "late", name: "Late facts", usage: null }]); });
  expect(screen.queryByText("Late facts")).toBeNull();
  expect(boundary.invoke.mock.calls.filter(([cmd]) => cmd === "get_provider_overview")).toHaveLength(4);
  expect(new Set(boundary.invoke.mock.calls.map(([cmd]) => cmd))).toEqual(new Set(["get_provider_overview", "has_provider_key"]));
  expect(interval).not.toHaveBeenCalled();
});
