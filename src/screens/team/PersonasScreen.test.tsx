import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { PersonasScreen } from "./PersonasScreen";
import { modelOf } from "./personas";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const profile = (id: string, name: string, command: string, extra: Record<string, unknown> = {}) => ({
  id, name, command, args: [], env: {}, fallback: null, enabled: true, ...extra,
});
const ROSTER = [
  profile("p-a", "Planer", "claude", { args: ["--model", "claude-opus-5-5"] }),
  profile("p-b", "Prüfer", "claude"),
  profile("p-c", "Umsetzer", "codex", { args: ["--model=gpt-6-astra"], fallback: "p-a" }),
];
const feed = (rows: unknown[]) => vi.mocked(invoke).mockResolvedValue(rows);
const card = async (name: string) => within(await screen.findByRole("article", { name }));

beforeEach(() => { vi.mocked(invoke).mockReset(); });

it("reads a pinned model from the profile arguments and nothing else", () => {
  expect(modelOf(["--model", "kimi-k3"])).toBe("kimi-k3");
  expect(modelOf(["-m", "glm-5.2"])).toBe("glm-5.2");
  expect(modelOf(["--model=x-1"])).toBe("x-1");
  expect(modelOf(["--model"])).toBeNull();
  expect(modelOf(["--verbose"])).toBeNull();
});

it("renders one card per profile with name and CLI and the model it states", async () => {
  feed(ROSTER);
  render(<PersonasScreen />);
  expect(await screen.findAllByRole("article")).toHaveLength(3);
  const planer = await card("Planer");
  expect(planer.getByText("Claude Code")).toBeInTheDocument();
  expect(planer.getByText("claude-opus-5-5")).toBeInTheDocument();
  expect((await card("Umsetzer")).getByText("gpt-6-astra")).toBeInTheDocument();
  expect((await card("Prüfer")).getByText("Modell nicht angegeben")).toBeInTheDocument();
});

it("narrows the list by provider and keeps every chip count", async () => {
  feed(ROSTER);
  render(<PersonasScreen />);
  await screen.findAllByRole("article");
  const group = within(screen.getByRole("group", { name: "Nach Anbieter filtern" }));
  expect(group.getByRole("button", { name: /Alle\s*3/ })).toHaveAttribute("aria-pressed", "true");
  expect(group.getByRole("button", { name: /Claude Code\s*2/ })).toBeInTheDocument();
  fireEvent.click(group.getByRole("button", { name: /Codex\s*1/ }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article", { name: "Umsetzer" })).toBeInTheDocument();
  expect(group.getByRole("button", { name: /Claude Code\s*2/ })).toHaveAttribute("aria-pressed", "false");
});

it("shows the error state when listAgentProfiles rejects", async () => {
  vi.mocked(invoke).mockImplementation(() => Promise.reject(new Error("core offline")));
  render(<PersonasScreen />);
  expect(await screen.findByText("Personas konnten nicht geladen werden")).toBeInTheDocument();
  expect(screen.queryByRole("article")).toBeNull();
});

it("shows the empty and the loading state in words", async () => {
  vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
  const first = render(<PersonasScreen />);
  expect(screen.getByText("Personas werden geladen …")).toBeInTheDocument();
  first.unmount();
  feed([]);
  render(<PersonasScreen />);
  expect(await screen.findByText("Noch keine Persona")).toBeInTheDocument();
});

it("marks rights autonomy and MCP as not connected and invents no value", async () => {
  feed([ROSTER[1]]);
  render(<PersonasScreen />);
  const c = await card("Prüfer");
  for (const field of ["Failover", "Rechte", "Autonomie", "MCP-Server"]) {
    const row = c.getByText(field).closest(".ps-fact") as HTMLElement;
    expect(within(row).getByText("noch nicht verbunden")).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/\d/);
  }
});

it("shows the failover target the profile actually carries", async () => {
  feed(ROSTER);
  render(<PersonasScreen />);
  const row = (await card("Umsetzer")).getByText("Failover").closest(".ps-fact") as HTMLElement;
  expect(within(row).getByText("Planer")).toBeInTheDocument();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_agent_profiles"));
});
