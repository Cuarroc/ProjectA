import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TresorPanel } from "./TresorPanel";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

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
const row = (name: string) => within(screen.getByRole("row", { name: new RegExp(name) }));
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

  it("MCP servers are not connected and name their package", async () => {
    backend([]);
    render(<TresorPanel />);
    const mcp = within(section("MCP-Server"));
    expect(mcp.getByText("MCP-Server noch nicht verbunden")).toBeInTheDocument();
    expect(mcp.getByText("V2-B19 (noch nicht gebaut)")).toBeInTheDocument();
  });

  it("only get_provider_overview and has_provider_key are invoked and the panel has no button", async () => {
    backend([provider("k1", "api_key", { vaultError: "vault_unreadable" }), provider("s1", "subscription")], { k1: true });
    render(<TresorPanel />);
    await row("Anbieter k1").findByText("Schlüssel hinterlegt");
    expect(new Set(mocks.invoke.mock.calls.map(([c]) => c))).toEqual(new Set(["get_provider_overview", "has_provider_key"]));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});
