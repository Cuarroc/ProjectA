import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./TerminalView", () => ({ default: () => null }));

import App from "../App";
import ThemeBackdrop from "./ThemeBackdrop";

describe("ThemeBackdrop", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_projects" || command === "list_agent_profiles") return Promise.resolve([]);
      if (command === "list_workers" || command === "list_questions") return Promise.resolve([]);
      if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
      return Promise.resolve(undefined);
    });
  });

  it("ThemeBackdrop renders nothing for klassisch", () => {
    const { container } = render(<ThemeBackdrop style="klassisch" />);
    expect(container.firstChild).toBeNull();
  });

  it("app root carries data-theme-style", async () => {
    const { container } = render(<App />);
    await waitFor(() =>
      expect(container.querySelector(".app")).toHaveAttribute("data-theme-style", "klassisch"),
    );
  });
});
