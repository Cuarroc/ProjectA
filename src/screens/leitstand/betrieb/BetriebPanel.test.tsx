import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentProfile } from "../../../types";
import { BetriebPanel } from "./BetriebPanel";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const GB = 1024 ** 3;
const profiles = [{ id: "claude", name: "Claude Code" }] as AgentProfile[];
const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id, projectId: "p1", rawText: `Task ${id}`, sharpenedText: null, profileId: null,
  status: "queued", priority: 5, workerId: null, error: null, createdAt: 1, ...extra,
});
const snapshot = (extra: Record<string, unknown> = {}) => ({
  observedAt: 1, cpuPermille: null, ramProcessBytes: 2 * GB, ramTotalBytes: 16 * GB,
  diskAppBytes: null, diskFreeBytes: null, tokensIn: 0, tokensOut: 0, ...extra,
});

function backend(queue: unknown[], resources: unknown = snapshot()) {
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "list_queue") return queue;
    if (cmd === "get_resource_snapshot") return resources;
    throw new Error(`unexpected ${cmd}`);
  });
}
const section = (name: string) => screen.getByRole("region", { name });

describe("BetriebPanel", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("shows the preflight reason of a held task with its state chip and profile", async () => {
    backend([entry("t1", { status: "failed", profileId: "claude", error: "preflight: kein freier Worker-Slot" })]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const queue = within(section("Warteschlange"));
    expect(await queue.findByText("preflight: kein freier Worker-Slot")).toBeInTheDocument();
    expect(queue.getByText("Fehler")).toBeInTheDocument();
    expect(queue.getByText("Claude Code")).toBeInTheDocument();
    expect(queue.getByText("Task t1")).toBeInTheDocument();
  });

  it("names a queued task with the automatic profile and no reason line", async () => {
    backend([entry("t2")]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const queue = within(section("Warteschlange"));
    expect(await queue.findByText("Task t2")).toBeInTheDocument();
    expect(queue.getByText("Wartet")).toBeInTheDocument();
    expect(queue.getByText("Auto")).toBeInTheDocument();
    expect(queue.queryByText(/preflight/)).toBeNull();
  });

  it("shows the empty state only after a successful read of an empty queue", async () => {
    backend([]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    expect(await within(section("Warteschlange")).findByText("Warteschlange leer")).toBeInTheDocument();
  });

  it("says nothing is empty when the queue cannot be read", async () => {
    mocks.invoke.mockRejectedValue(new Error("down"));
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    expect(await within(section("Warteschlange")).findByText("Warteschlange nicht lesbar")).toBeInTheDocument();
    expect(screen.queryByText("Warteschlange leer")).toBeNull();
  });

  it("shows a missing RAM fact as an honest state without any number", async () => {
    backend([], snapshot({ ramTotalBytes: null }));
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const check = section("Startprüfung");
    expect(await within(check).findByText("Arbeitsspeicher noch nicht verbunden")).toBeInTheDocument();
    expect(within(check).getByText("Freie Worker-Slots noch nicht verbunden")).toBeInTheDocument();
    expect(check.textContent).not.toMatch(/\d/);
  });

  it("shows the RAM the frontend does get", async () => {
    backend([]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    expect(await within(section("Startprüfung")).findByText("2 GB von 16 GB")).toBeInTheDocument();
  });

  it("marks the watchdog as not connected and names its package", async () => {
    backend([]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    const dog = section("Wachhund");
    expect(within(dog).getByText("Wachhund noch nicht verbunden")).toBeInTheDocument();
    expect(dog).toHaveTextContent("V2-B22");
  });

  it("has no button and invokes only read commands and never enqueue or dispatch", async () => {
    backend([entry("t3"), entry("t4", { status: "ready" })]);
    render(<BetriebPanel projectId="p1" profiles={profiles} />);
    await screen.findByText("Task t3");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const commands = mocks.invoke.mock.calls.map(([cmd]) => cmd);
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) expect(["list_queue", "get_resource_snapshot"]).toContain(cmd);
  });
});
