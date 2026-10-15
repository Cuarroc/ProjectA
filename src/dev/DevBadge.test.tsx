import { act, fireEvent, render, screen } from "@testing-library/react";
import { getIdentifier } from "@tauri-apps/api/app";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listFeatureFlags, isFeatureFlagEnabled, setFeatureFlagEnabled } from "../flags/featureFlags";
import { DevBadge } from "./DevBadge";

vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: vi.fn() }));
const info = vi.hoisted(() => ({ sha: "123456789abcdef", time: "2026-10-11T12:00:00.000Z" }));
vi.mock("./buildInfo", () => ({ buildInfo: () => info }));
beforeEach(() => {
  localStorage.clear();
  info.sha = "123456789abcdef";
});
afterEach(() => { vi.mocked(getIdentifier).mockReset(); });

it("shows the build commit from build info", async () => {
  info.sha = "fedcba987654321";
  vi.mocked(getIdentifier).mockResolvedValue("com.projecta.dev");
  render(<DevBadge />);
  fireEvent.click(await screen.findByRole("button", { name: "DEV · fedcba9" }));
  expect(screen.getByText("fedcba987654321")).toBeVisible();
});

it("localizes the local build fallback", async () => {
  info.sha = "local";
  vi.mocked(getIdentifier).mockResolvedValue("com.projecta.dev");
  render(<DevBadge />);
  fireEvent.click(await screen.findByRole("button", { name: "DEV · lokal" }));
  expect(screen.getByText("lokal")).toBeVisible();
});

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
    const start = flag.defaultEnabled;
    expect(toggle).toHaveAttribute("aria-checked", String(start));
    fireEvent.click(toggle);
    expect(isFeatureFlagEnabled(flag.id)).toBe(!start);
    expect(toggle).toHaveAttribute("aria-checked", String(!start));
    act(() => setFeatureFlagEnabled(flag.id, start));
    expect(toggle).toHaveAttribute("aria-checked", String(start));
  }
  fireEvent.keyDown(screen.getAllByRole("switch")[0], { key: "Escape" });
  expect(badge).toHaveFocus();
  expect(badge).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(badge);
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("region", { name: "Experimente" })).toBeNull();
});
