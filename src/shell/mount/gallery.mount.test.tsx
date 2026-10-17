import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("../../components/TerminalView", () => ({ default: () => null }));

import App from "../../App";
import { de } from "../../i18n/de";

beforeAll(async () => { await import("./ShellMount"); });
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
  window.location.hash = "#/designsystem";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => {
    if (["list_projects", "list_workers", "list_agent_profiles", "list_questions", "list_queue", "get_provider_overview", "get_reason_catalog"].includes(command)) return Promise.resolve([]);
    if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
    if (command === "get_panic_notice") return Promise.resolve({ current: null, previous: null });
    return new Promise(() => {});
  });
});
afterEach(cleanup);

it("#/designsystem mounts the gallery", async () => {
  const { container } = render(<App />);
  expect(await screen.findByRole("heading", { level: 1, name: de["gallery.title"] }, { timeout: 5000 })).toBeInTheDocument();
  expect(container.querySelector(".g-mount")).toHaveAttribute("data-fresh", "on");
  expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
});
