import { act, fireEvent, render, screen } from "@testing-library/react";
import { getIdentifier } from "@tauri-apps/api/app";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listFeatureFlags, isFeatureFlagEnabled, setFeatureFlagEnabled } from "../flags/featureFlags";
import { DevBadge } from "./DevBadge";

vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("__BUILD_SHA__", "123456789abcdef");
  vi.stubGlobal("__BUILD_TIME__", "2026-10-11T12:00:00.000Z");
});
afterEach(() => { vi.mocked(getIdentifier).mockReset(); vi.unstubAllGlobals(); });

it("renders nothing outside the dev channel", async () => {
  for (const identifier of ["com.projecta.app", "com.projecta.dev.other", ""]) {
    vi.mocked(getIdentifier).mockResolvedValue(identifier);
    const view = await act(async () => render(<DevBadge />));
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
  }
  let reject!: (reason: Error) => void;
  vi.mocked(getIdentifier).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  const view = render(<DevBadge />);
  expect(view.container).toBeEmptyDOMElement();
  await act(async () => reject(new Error("browser preview")));
  expect(view.container).toBeEmptyDOMElement();
});

it("toggles a feature flag from the experiments list", async () => {
  vi.mocked(getIdentifier).mockResolvedValue("com.projecta.dev");
  render(<DevBadge />);
  const badge = await screen.findByRole("button", { name: "DEV · 1234567" });
  expect(screen.queryByRole("region", { name: "Experimente" })).toBeNull();
  fireEvent.click(badge);
  expect(screen.getByText("123456789abcdef")).toBeVisible();
  expect(screen.getByText("2026-10-11T12:00:00.000Z")).toBeVisible();
  expect(screen.getAllByRole("switch")).toHaveLength(listFeatureFlags().length);
  for (const flag of listFeatureFlags()) {
    const toggle = screen.getByRole("switch", { name: flag.label });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(isFeatureFlagEnabled(flag.id)).toBe(true);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    act(() => setFeatureFlagEnabled(flag.id, false));
    expect(toggle).toHaveAttribute("aria-checked", "false");
  }
  fireEvent.keyDown(screen.getAllByRole("switch")[0], { key: "Escape" });
  expect(badge).toHaveFocus();
  expect(badge).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(badge);
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("region", { name: "Experimente" })).toBeNull();
});
