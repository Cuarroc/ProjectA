import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TresorPanel } from "./TresorPanel";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: async () => "com.projecta.app" }));

const provider = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Anbieter ${id}`, kind, connected: true, detail: null, quotaState: "ok",
  blockedUntil: null, omniRouteOnline: false, usage: null, vaultError: null, ...extra,
});

type Presence = Record<string, boolean | Error | Promise<boolean> | string>;
function backend(overview: unknown, presence: Presence = {}) {
  mocks.invoke.mockImplementation(async (cmd: string, args?: { providerId: string }) => {
    if (cmd === "get_provider_overview") {
      if (overview instanceof Error) throw overview.message;
      return overview;
    }
    if (cmd === "has_provider_key") {
      const answer = presence[args?.providerId ?? ""];
      if (answer instanceof Error) throw answer.message;
      return answer;
    }
    throw new Error(`unexpected ${cmd}`);
  });
}
const section = (name: string) => screen.getByRole("region", { name });
const rowOf = (name: string) => ({ name: new RegExp(name) });
const row = (name: string) => ({
  findByText: async (text: string) => within(await screen.findByRole("row", rowOf(name))).findByText(text),
  getByText: (text: string) => within(screen.getByRole("row", rowOf(name))).getByText(text),
});
const calls = (cmd: string) => mocks.invoke.mock.calls.filter(([c]) => c === cmd);

describe("TresorPanel", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("a subscription row says CLI login and asks the vault nothing", async () => {
    backend([provider("s1", "subscription"), provider("l1", "local")]);
    render(<TresorPanel />);
    expect(await row("Anbieter s1").findByText("Anmeldung über die CLI, kein Schlüssel im Tresor")).toBeInTheDocument();
    expect(row("Anbieter s1").getByText("Abo")).toBeInTheDocument();
    expect(row("Anbieter l1").getByText("kein Schlüssel nötig")).toBeInTheDocument();
    expect(calls("has_provider_key")).toHaveLength(0);
  });

  it("an api key row shows presence from has_provider_key and never a key value", async () => {
    let release: (v: boolean) => void = () => {};
    const slow = new Promise<boolean>((r) => { release = r; });
    backend([provider("k1", "api_key"), provider("k2", "api_key"), provider("k3", "api_key")], { k1: true, k2: false, k3: slow });
    render(<TresorPanel />);
    expect(await row("Anbieter k1").findByText("Schlüssel hinterlegt")).toBeInTheDocument();
    expect(row("Anbieter k2").getByText("kein Schlüssel hinterlegt")).toBeInTheDocument();
    expect(row("Anbieter k3").getByText("wird geprüft")).toBeInTheDocument();
    release(true);
    expect(await row("Anbieter k3").findByText("Schlüssel hinterlegt")).toBeInTheDocument();
    expect(calls("has_provider_key").map(([, a]) => a)).toEqual([{ providerId: "k1" }, { providerId: "k2" }, { providerId: "k3" }]);
  });

  it("a non-boolean answer is not rendered and says nicht prüfbar", async () => {
    backend([provider("k1", "api_key")], { k1: "sk-LEAKED-VALUE" });
    render(<TresorPanel />);
    expect(await row("Anbieter k1").findByText("nicht prüfbar")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("sk-LEAKED");
  });

  it("a rejected presence check says nicht prüfbar", async () => {
    backend([provider("k1", "api_key"), provider("k2", "api_key")], { k1: new Error("boom"), k2: true });
    render(<TresorPanel />);
    expect(await row("Anbieter k1").findByText("nicht prüfbar")).toBeInTheDocument();
    expect(await row("Anbieter k2").findByText("Schlüssel hinterlegt")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("boom");
  });

  it("a vault error is an alert and api key rows do not claim no key", async () => {
    backend([provider("k1", "api_key", { vaultError: "vault_corrupt" }), provider("s1", "subscription", { vaultError: "vault_corrupt" })], { k1: false });
    render(<TresorPanel />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Der Schlüsselspeicher ist beschädigt");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(await row("Anbieter k1").findByText("nicht prüfbar")).toBeInTheDocument();
    expect(screen.queryByText("kein Schlüssel hinterlegt")).toBeNull();
  });

  it("a failed overview shows Tresor nicht lesbar", async () => {
    backend(new Error("core down"));
    render(<TresorPanel />);
    expect(await screen.findByText("Tresor nicht lesbar")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(calls("has_provider_key")).toHaveLength(0);
  });

  it("says loading first and names an empty provider list", async () => {
    backend([]);
    render(<TresorPanel />);
    expect(within(section("Tresor")).getByText("Wird gelesen …")).toBeInTheDocument();
    expect(await screen.findByText("Keine Anbieter bekannt")).toBeInTheDocument();
  });

  it("MCP servers stay honest without an internal package note", async () => {
    backend([]);
    render(<TresorPanel />);
    const mcp = within(section("MCP-Server"));
    expect(mcp.getByText("MCP-Server noch nicht verbunden")).toBeInTheDocument();
    expect(mcp.queryByText(/V2-/)).toBeNull();
  });

  it("retries a failed vault overview from the panel", async () => {
    backend(new Error("SYNTHETIC-SECRET-SENTINEL"));
    render(<TresorPanel />);
    expect(await screen.findByText("Tresor nicht lesbar")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("SYNTHETIC-SECRET-SENTINEL");
    backend([provider("k1", "api_key"), provider("s1", "subscription"), provider("l1", "local")], { k1: true });
    fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
    expect(await row("Anbieter k1").findByText("Schlüssel hinterlegt")).toBeInTheDocument();
    expect(row("Anbieter s1").getByText("Anmeldung über die CLI, kein Schlüssel im Tresor")).toBeInTheDocument();
    expect(row("Anbieter l1").getByText("kein Schlüssel nötig")).toBeInTheDocument();
    expect(screen.queryByText("Tresor nicht lesbar")).toBeNull();
    expect(calls("get_provider_overview")).toHaveLength(2);
    expect(calls("has_provider_key").map(([, args]) => args)).toEqual([{ providerId: "k1" }]);
  });

  it("rereads key presence for unchanged provider ids on manual refresh", async () => {
    backend([provider("k1", "api_key")], { k1: false });
    render(<TresorPanel />);
    expect(await row("Anbieter k1").findByText("kein Schlüssel hinterlegt")).toBeInTheDocument();
    let resolvePresence!: (value: boolean) => void;
    backend([provider("k1", "api_key")], { k1: new Promise<boolean>((resolve) => { resolvePresence = resolve; }) });
    fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
    expect(screen.queryByText("kein Schlüssel hinterlegt")).toBeNull();
    expect(await row("Anbieter k1").findByText("wird geprüft")).toBeInTheDocument();
    await act(async () => { resolvePresence(true); });
    expect(await row("Anbieter k1").findByText("Schlüssel hinterlegt")).toBeInTheDocument();
    expect(calls("get_provider_overview")).toHaveLength(2);
    expect(calls("has_provider_key").map(([, args]) => args)).toEqual([{ providerId: "k1" }, { providerId: "k1" }]);
  });

  it("ignores old key presence after a newer vault read", async () => {
    let resolveOld!: (value: boolean) => void;
    backend([provider("k1", "api_key")], { k1: new Promise<boolean>((resolve) => { resolveOld = resolve; }) });
    render(<TresorPanel />);
    expect(await row("Anbieter k1").findByText("wird geprüft")).toBeInTheDocument();
    backend([provider("k1", "api_key")], { k1: true });
    fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
    expect(await row("Anbieter k1").findByText("Schlüssel hinterlegt")).toBeInTheDocument();
    await act(async () => { resolveOld(false); });
    expect(row("Anbieter k1").getByText("Schlüssel hinterlegt")).toBeInTheDocument();
    expect(screen.queryByText("kein Schlüssel hinterlegt")).toBeNull();
    expect(calls("has_provider_key")).toHaveLength(2);
  });

  it("prevents another vault read while the overview is pending", async () => {
    let resolveOverview!: (value: unknown[]) => void;
    backend(new Promise<unknown[]>((resolve) => { resolveOverview = resolve; }));
    render(<TresorPanel />);
    const refresh = screen.getByRole("button", { name: "Neu lesen" });
    expect(refresh).toBeEnabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    fireEvent.click(refresh);
    expect(calls("get_provider_overview")).toHaveLength(1);
    fireEvent.click(refresh);
    expect(calls("get_provider_overview")).toHaveLength(1);
    await act(async () => { resolveOverview([]); });
    expect(refresh).toHaveAttribute("aria-busy", "false");
    refresh.focus();
    await waitFor(() => expect(document.activeElement).toBe(refresh));
    backend(new Promise<unknown[]>((resolve) => { resolveOverview = resolve; }));
    fireEvent.click(refresh);
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(document.activeElement).toBe(refresh);
    fireEvent.click(refresh);
    expect(calls("get_provider_overview")).toHaveLength(2);
    await act(async () => { resolveOverview([]); });
    await waitFor(() => {
      expect(refresh).toHaveAttribute("aria-busy", "false");
      expect(document.activeElement).toBe(refresh);
    });
  });

  it("does not start another overview if reread is clicked before the button shows busy", async () => {
    backend(new Promise(() => {}));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      flushSync(() => {
        root.render(<TresorPanel />);
      });
      const refresh = host.querySelector("button");
      if (refresh === null) throw new Error("missing reread button");
      // The reader starts in an effect. Until that effect's state lands, the
      // button must not claim a read that the first paint never started, and a
      // click in that gap must not open a second read.
      expect(refresh.getAttribute("aria-busy")).toBe("false");
      const started = calls("get_provider_overview").length;
      flushSync(() => {
        fireEvent.click(refresh);
      });
      flushSync(() => {
        fireEvent.click(refresh);
      });
      await act(async () => {});
      expect(calls("get_provider_overview")).toHaveLength(Math.max(started, 1));
      expect(refresh.getAttribute("aria-busy")).toBe("true");
      fireEvent.click(refresh);
      expect(calls("get_provider_overview")).toHaveLength(Math.max(started, 1));
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("keeps the newer vault read busy when the replaced read goes idle", async () => {
    backend([]);
    render(<TresorPanel />);
    expect(await screen.findByText("Keine Anbieter bekannt")).toBeInTheDocument();
    const refresh = screen.getByRole("button", { name: "Neu lesen" });
    expect(refresh).toHaveAttribute("aria-busy", "false");
    backend(new Promise(() => {}));
    fireEvent.click(refresh);
    expect(refresh).toHaveAttribute("aria-busy", "true");
    fireEvent.click(refresh);
    expect(calls("get_provider_overview")).toHaveLength(2);
    expect(refresh).toHaveAttribute("aria-busy", "true");
  });

  it("is idle by the time the settled vault read is visible on a slow frame", async () => {
    backend([]);
    render(<TresorPanel />);
    const refresh = screen.getByRole("button", { name: "Neu lesen" });
    // Normally React's scheduler runs the table commit, the passive-effect flush
    // and the follow-up render in one macrotask, so nobody sees in between. A
    // loaded machine spends its 5 ms slice and yields there; an observer (a
    // microtask) then sees the table with the old busy flag. Spend every slice.
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => (now += 10));
    let busyWhenShown: string | null = null;
    const watch = new MutationObserver(() => {
      if (busyWhenShown === null && screen.queryByText("Keine Anbieter bekannt") !== null) busyWhenShown = refresh.getAttribute("aria-busy");
    });
    watch.observe(document.body, { childList: true, subtree: true });
    try {
      await waitFor(() => expect(busyWhenShown).not.toBeNull());
    } finally {
      watch.disconnect();
      clock.mockRestore();
    }
    expect(busyWhenShown).toBe("false");
  });

  it("stays busy for a strict-mode overview until that read settles", async () => {
    let resolveOverview!: (value: unknown[]) => void;
    backend(new Promise<unknown[]>((resolve) => { resolveOverview = resolve; }));
    render(<StrictMode><TresorPanel /></StrictMode>);
    const refresh = screen.getByRole("button", { name: "Neu lesen" });
    expect(refresh).toHaveAttribute("aria-busy", "true");
    const started = calls("get_provider_overview").length;
    expect(started).toBeGreaterThan(0);
    fireEvent.click(refresh);
    expect(calls("get_provider_overview")).toHaveLength(started);
    await act(async () => { resolveOverview([]); });
    expect(refresh).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("Keine Anbieter bekannt")).toBeInTheDocument();
  });

  it("puts the reread button directly in the vault card", async () => {
    backend([]);
    render(<TresorPanel />);
    await screen.findByText("Keine Anbieter bekannt");
    const vault = section("Tresor");
    const refresh = within(vault).getByRole("button", { name: "Neu lesen" });
    expect(refresh.parentElement).toBe(vault);
    expect(refresh).toHaveClass("tr-reread");
  });

  it("only get_provider_overview and has_provider_key are invoked and the panel only offers the read button", async () => {
    backend([provider("k1", "api_key", { vaultError: "vault_unreadable" }), provider("s1", "subscription")], { k1: true });
    render(<TresorPanel />);
    await row("Anbieter k1").findByText("Schlüssel hinterlegt");
    expect(new Set(mocks.invoke.mock.calls.map(([c]) => c))).toEqual(new Set(["get_provider_overview", "has_provider_key"]));
    expect(screen.getAllByRole("button")).toEqual([screen.getByRole("button", { name: "Neu lesen" })]);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});
