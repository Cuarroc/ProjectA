import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Commands the App issues while booting into the dialog (empty project list
 * still mounts Sidebar after bootstrap). A missing mock here is the red test
 * for T-3: the smoke must fail instead of returning `undefined` and lying.
 */
const BOOT_COMMANDS: Record<string, unknown> = {
  list_agent_profiles: [],
  list_projects: [],
  list_workers: [],
  list_questions: [],
  get_board_state: { cards: [], coordinators: [] },
  get_quota_state: [],
  list_queue: [],
  list_recommendations: [],
  list_learnings: [],
  list_role_variants: [],
  get_verdict_token: "token",
  get_panic_notice: null,
  web_interface_status: null,
  list_worker_messages: [],
  list_live_sessions: [],
};

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../components/TerminalView", () => ({ default: () => null }));

import App from "../App";

describe("boot smoke", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.listen.mockResolvedValue(() => undefined);
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation((command: string) => {
      if (!Object.prototype.hasOwnProperty.call(BOOT_COMMANDS, command)) {
        throw new Error(`boot smoke: unmocked command ${command}`);
      }
      return Promise.resolve(BOOT_COMMANDS[command]);
    });
  });

  it("renders the workspace when every boot command is mocked", async () => {
    render(<App />);
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("list_projects");
    });
    await waitFor(() => {
      expect(document.querySelector(".app")).not.toBeNull();
    });
  });

  it("records every invoked command so a missing mock cannot pass silently", async () => {
    const unknown: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      if (!Object.prototype.hasOwnProperty.call(BOOT_COMMANDS, command)) {
        unknown.push(command);
        return Promise.reject(new Error(`boot smoke: unmocked command ${command}`));
      }
      return Promise.resolve(BOOT_COMMANDS[command]);
    });
    render(<App />);
    await waitFor(() => {
      expect(document.querySelector(".app")).not.toBeNull();
    });
    expect(unknown).toEqual([]);
  });
});
