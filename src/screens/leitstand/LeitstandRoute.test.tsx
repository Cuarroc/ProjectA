import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("../../components/TerminalView", () => ({ default: () => null }));

import App from "../../App";

const FLAG_KEY = "projecta.settings.featureFlag.d1_neue_oberflaeche";
const NOW = Math.floor(Date.now() / 1000);
const worker = { id: "w1", projectId: "p1", task: "Fix the start block", profileId: "claude", branch: "claude/w1", worktreePath: "wt", sessionId: null, status: "running", createdAt: NOW - 600 };
const question = { id: "q1", projectId: "p1", workerId: "w1", scope: "worker", question: "Cover only this case?", optionsJson: '["Only this case"]', status: "open", answer: null, createdAt: NOW - 240, expiresAt: null };
const go = (hash: string) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("projecta.activeProjectId", "p1");
  window.location.hash = "";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "list_workers") return Promise.resolve([]);
    // The old app forgets a stored project that is not in the list, so p1 has to exist.
    if (command === "list_projects") return Promise.resolve([{ id: "p1", name: "Demo", path: "demo", createdAt: NOW }]);
    if (command === "list_agent_profiles") return Promise.resolve([{ id: "claude", name: "Claude Code" }]);
    if (command === "list_questions") return Promise.resolve([question]);
    if (command === "get_board_state") {
      return Promise.resolve({ cards: [{ worker, column: "needs_you", attention_reason: "Fragt", attention_code: "agent_reported", attention_grade: "blocking", pr_url: null }], coordinators: [] });
    }
    if (command === "get_panic_notice") return Promise.resolve({ current: null, previous: null });
    if (command === "get_reason_catalog") return Promise.resolve([]);
    return new Promise(() => {});
  });
});
afterEach(cleanup);

describe("Leitstand route behind D1", () => {
  it("shows the cards and the Braucht dich list from the real board and question data at /leitstand", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    const agents = await screen.findByRole("region", { name: "Agenten" });
    expect(await within(agents).findByRole("heading", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Braucht dich/ })).toHaveTextContent("1");
    const needs = await screen.findByRole("complementary", { name: "Braucht dich" });
    expect(await within(needs).findByText("Cover only this case?")).toBeInTheDocument();
    expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
  });

  it("picks up the project the old app chooses after this route has mounted", async () => {
    localStorage.removeItem("projecta.activeProjectId");
    localStorage.setItem(FLAG_KEY, "1");
    render(<App />);
    expect(await screen.findByRole("region", { name: "Agenten" })).toBeInTheDocument();
  });

  it("keeps the old Work view reachable as the tab Klassisch", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    await screen.findByRole("region", { name: "Agenten" });
    fireEvent.click(screen.getByRole("link", { name: "Klassisch" }));
    await waitFor(() => expect(window.location.hash).toBe("#/leitstand/klassisch"));
    await waitFor(() => expect(container.querySelector(".g-mount-legacy:not([hidden]) > .app")).not.toBeNull());
    expect(screen.queryByRole("region", { name: "Agenten" })).toBeNull();
    expect(screen.getByRole("link", { name: "Klassisch" })).toHaveAttribute("aria-current", "page");
  });

  it("opens the old Work view directly at /leitstand/klassisch", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/leitstand/klassisch";
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".g-mount-legacy:not([hidden]) > .app")).not.toBeNull());
    expect(screen.queryByRole("region", { name: "Agenten" })).toBeNull();
    await go("#/leitstand");
    expect(await screen.findByRole("region", { name: "Agenten" })).toBeInTheDocument();
  });

  it("renders no new Leitstand while the switch is off", async () => {
    window.location.hash = "#/leitstand";
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app")).not.toBeNull());
    expect(container.querySelector(".g-mount")).toBeNull();
    expect(screen.queryByRole("region", { name: "Agenten" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Braucht dich" })).toBeNull();
  });
});
