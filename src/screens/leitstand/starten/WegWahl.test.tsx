import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WegWahl } from "./WegWahl";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: async () => "com.projecta.app" }));

const profile = (id: string, name: string, command: string, extra: Record<string, unknown> = {}) => ({
  id, name, command, args: [], env: {}, fallback: null, enabled: true, ...extra,
});
const PROFILES = [
  profile("p-claude", "Claude Weg", "claude", { args: ["--model", "model-x"] }),
  profile("p-codex", "Codex Weg", "codex"),
  profile("p-kimi", "Kimi Weg", "kimi", { fallback: "p-claude" }),
  profile("p-off", "Aus Weg", "opencode", { enabled: false }),
];
const quota = (profileId: string, state: string, extra: Record<string, unknown> = {}) => ({
  profileId, state, blockedUntil: null, reason: null, omniRouteOnline: true, ...extra,
});

function backend(opts: { profiles?: unknown[] | Error; quotas?: unknown[] | Error } = {}) {
  const { profiles = PROFILES, quotas = [quota("p-claude", "ok"), quota("p-codex", "ok"), quota("p-kimi", "ok")] } = opts;
  mocks.invoke.mockImplementation(async (cmd: string) => {
    const answer = cmd === "list_agent_profiles" ? profiles : cmd === "get_quota_state" ? quotas : undefined;
    if (answer === undefined) throw new Error(`unexpected ${cmd}`);
    if (answer instanceof Error) throw answer;
    return answer;
  });
}
const radio = (name: RegExp | string) => screen.findByRole("radio", { name });

describe("WegWahl", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("retries a failed profile read without remounting the selection", async () => {
    let reads = 0;
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_quota_state") return [quota("p-claude", "blocked", { reason: "Wochenlimit erreicht" }), quota("p-codex", "ok")];
      if (cmd !== "list_agent_profiles") throw new Error(`unexpected ${cmd}`);
      if (++reads < 3) throw new Error("offline");
      return PROFILES;
    });
    const onChange = vi.fn();
    render(<WegWahl value="p-codex" onChange={onChange} />);
    const retry = await screen.findByRole("button", { name: "Erneut versuchen" });
    expect(screen.getByText("Personas nicht lesbar")).toBeInTheDocument();
    expect(screen.queryByText("Keine Persona eingeschaltet")).toBeNull();
    fireEvent.click(retry);
    expect(screen.getByText("Wird gelesen …")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Erneut versuchen" }));
    expect(await radio("Codex Weg")).toBeChecked();
    expect(await radio("Claude Weg")).toBeDisabled();
    expect(await radio("Kimi Weg")).toHaveAccessibleDescription(/unbekannt/);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(await radio("Kimi Weg"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("p-kimi");
    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd).sort()).toEqual([
      "get_quota_state", "list_agent_profiles", "list_agent_profiles", "list_agent_profiles",
    ]);
  });

  it("labels a configured model as a request rather than an observed model", async () => {
    backend({ profiles: [...PROFILES, profile("p-name", "GPT special model", "codex")] });
    render(<WegWahl value={null} onChange={() => {}} />);
    expect(await radio("Claude Weg")).toHaveAccessibleDescription(/Modellvorgabe: model-x.*Modell wird beim Start beobachtet/);
    expect(await radio("Codex Weg")).toHaveAccessibleDescription(/Modell wird beim Start beobachtet/);
    expect(await radio("GPT special model")).toHaveAccessibleDescription(/Modell wird beim Start beobachtet/);
    expect(await radio("GPT special model")).not.toHaveAccessibleDescription(/Modellvorgabe|GPT/);
  });

  it("keeps one retry in flight and ignores its answer after unmount", async () => {
    let reads = 0;
    let resolveOld!: (rows: unknown[]) => void;
    let resolveRetry!: (rows: unknown[]) => void;
    const old = new Promise<unknown[]>((resolve) => { resolveOld = resolve; });
    const pending = new Promise<unknown[]>((resolve) => { resolveRetry = resolve; });
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_quota_state") return Promise.resolve([]);
      if (cmd !== "list_agent_profiles") throw new Error(`unexpected ${cmd}`);
      reads++;
      return reads === 1 ? old : reads === 2 ? Promise.reject(new Error("offline")) : pending;
    });
    const onChange = vi.fn();
    const { unmount } = render(<StrictMode><WegWahl value={null} onChange={onChange} /></StrictMode>);
    const retry = await screen.findByRole("button", { name: "Erneut versuchen" });
    act(() => {
      retry.click();
      retry.click();
    });
    expect(reads).toBe(3);
    expect(screen.getByText("Wird gelesen …")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).toBeNull();
    await act(async () => { resolveOld(PROFILES); });
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("Wird gelesen …")).toBeInTheDocument();
    unmount();
    await act(async () => { resolveRetry(PROFILES); });
    expect(screen.queryByRole("radio")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(new Set(mocks.invoke.mock.calls.map(([cmd]) => cmd))).toEqual(new Set(["get_quota_state", "list_agent_profiles"]));
  });

  it("one radio per enabled profile with CLI label and pinned model", async () => {
    backend();
    render(<WegWahl value={null} onChange={() => {}} />);
    const group = await screen.findByRole("radiogroup", { name: "Persona und Weg" });
    await radio("Claude Weg");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(group).toHaveTextContent("Claude Code");
    expect(await radio("Claude Weg")).toHaveAccessibleDescription(/Claude Code.*Modellvorgabe: model-x.*Modell wird beim Start beobachtet/);
    expect(screen.queryByRole("radio", { name: "Aus Weg" })).toBeNull();
  });

  it("a profile without a pinned model says Modell wird beim Start beobachtet", async () => {
    backend();
    render(<WegWahl value={null} onChange={() => {}} />);
    expect(await radio("Codex Weg")).toHaveAccessibleDescription(/Modell wird beim Start beobachtet/);
    expect(await radio("Claude Weg")).toHaveAccessibleDescription(/Modellvorgabe: model-x.*Modell wird beim Start beobachtet/);
  });

  it("a blocked profile is disabled with its reason and never calls onChange", async () => {
    backend({ quotas: [quota("p-claude", "blocked", { reason: "Wochenlimit erreicht" }), quota("p-codex", "ok")] });
    const onChange = vi.fn();
    render(<WegWahl value={null} onChange={onChange} />);
    const blocked = await radio("Claude Weg");
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAccessibleDescription(/Wochenlimit erreicht/);
    fireEvent.click(blocked);
    fireEvent.click(screen.getByText("Claude Weg"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a failed quota read leaves options selectable and says unbekannt not frei", async () => {
    backend({ quotas: new Error("offline") });
    const onChange = vi.fn();
    render(<WegWahl value={null} onChange={onChange} />);
    const option = await radio("Codex Weg");
    expect(option).toBeEnabled();
    expect(option).toHaveAccessibleDescription(/unbekannt/);
    expect(screen.queryByText("frei")).toBeNull();
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("p-codex");
  });

  it("selecting a free profile calls onChange with its id and value marks it checked", async () => {
    backend();
    const onChange = vi.fn();
    const { rerender } = render(<WegWahl value={null} onChange={onChange} />);
    const option = await radio("Codex Weg");
    expect(option).toHaveAccessibleDescription(/frei/);
    expect(option).not.toBeChecked();
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("p-codex");
    rerender(<WegWahl value="p-codex" onChange={onChange} />);
    expect(await radio("Codex Weg")).toBeChecked();
    expect(await radio("Claude Weg")).not.toBeChecked();
  });

  it("the failover target is named by profile name", async () => {
    backend({ profiles: [...PROFILES, profile("p-lost", "Lost Weg", "codex", { fallback: "ghost" })] });
    render(<WegWahl value={null} onChange={() => {}} />);
    expect(await radio("Kimi Weg")).toHaveAccessibleDescription(/Failover: Claude Weg/);
    expect(await radio("Lost Weg")).toHaveAccessibleDescription(/Failover: ghost/);
    expect(await radio("Codex Weg")).not.toHaveAccessibleDescription(/Failover/);
  });

  it("Ort Aufwand and MCP are not connected and show no number", async () => {
    backend();
    const { container } = render(<WegWahl value={null} onChange={() => {}} />);
    await radio("Codex Weg");
    for (const word of ["Ort noch nicht verbunden", "Aufwand noch nicht verbunden", "MCP noch nicht verbunden"]) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
    expect(screen.queryByText(/V2-/)).toBeNull();
    const honest = container.querySelectorAll(".g-hs");
    expect(honest).toHaveLength(3);
    for (const el of honest) expect(el.textContent).not.toMatch(/\d/);
  });

  it("a failed profile read shows Personas nicht lesbar", async () => {
    backend({ profiles: new Error("offline") });
    render(<WegWahl value={null} onChange={() => {}} />);
    expect(await screen.findByText("Personas nicht lesbar")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("says Keine Persona eingeschaltet when every profile is off", async () => {
    backend({ profiles: [PROFILES[3]] });
    render(<WegWahl value={null} onChange={() => {}} />);
    expect(screen.getByText("Wird gelesen …")).toBeInTheDocument();
    expect(await screen.findByText("Keine Persona eingeschaltet")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("only list_agent_profiles and get_quota_state are invoked", async () => {
    backend();
    render(<WegWahl value={null} onChange={() => {}} />);
    fireEvent.click(await radio("Codex Weg"));
    const commands = new Set(mocks.invoke.mock.calls.map((call) => call[0]));
    expect([...commands].sort()).toEqual(["get_quota_state", "list_agent_profiles"]);
  });
});
