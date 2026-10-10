import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import type { Provider } from "../../types";
import { ErsteinrichtungScreen } from "./ErsteinrichtungScreen";

const overview = vi.hoisted(() => ({ value: { providers: [], loading: false, error: null, vaultError: null, refresh: () => {} } as unknown }));
vi.mock("../../lib/providers", () => ({ PROVIDER_POLL_MS: 30_000, useProviderOverview: () => overview.value }));

const provider = (name: string, connected: boolean) => ({ id: name.toLowerCase(), name, connected }) as Provider;
const setProviders = (providers: Provider[], extra: Record<string, unknown> = {}) => {
  overview.value = { providers, loading: false, error: null, vaultError: null, refresh: vi.fn(), ...extra };
};
const step = (n: number) => within(screen.getByRole("list", { name: "Schritte der Einrichtung" })).getAllByRole("listitem")[n - 1];

beforeEach(() => setProviders([provider("Claude Code", true), provider("Kimi CLI", false)]));

it("lists the six steps in order as an ordered list", () => {
  render(<ErsteinrichtungScreen hasProject onAction={() => {}} />);
  const list = screen.getByRole("list", { name: "Schritte der Einrichtung" });
  expect(list.tagName).toBe("OL");
  const titles = within(list).getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(titles).toEqual(["Willkommen", "Programme finden", "Abos prüfen", "Projekt wählen", "Team aufstellen", "Fertig"]);
  expect(within(step(3)).getByText("3")).toBeInTheDocument();
});

it("marks the sign-in step done when a provider is signed in", () => {
  render(<ErsteinrichtungScreen hasProject onAction={() => {}} />);
  expect(within(step(3)).getByText("Erledigt")).toBeInTheDocument();
  expect(within(step(3)).getByText("Angemeldet: Claude Code")).toBeInTheDocument();
});

it("keeps the sign-in step open and names who is missing when nobody is signed in", () => {
  setProviders([provider("Claude Code", false), provider("Kimi CLI", false)]);
  render(<ErsteinrichtungScreen hasProject={false} onAction={() => {}} />);
  expect(within(step(3)).queryByText("Erledigt")).toBeNull();
  expect(within(step(3)).getByText("Noch nicht angemeldet: Claude Code, Kimi CLI")).toBeInTheDocument();
  expect(within(step(4)).queryByText("Erledigt")).toBeNull();
  expect(step(3)).toHaveAttribute("aria-current", "step");
});

it("shows the repo scan as not connected and never a count", () => {
  render(<ErsteinrichtungScreen hasProject onAction={() => {}} />);
  const scan = within(step(4)).getByText("Noch nicht verbunden");
  expect(scan.closest(".g-hs")).not.toBeNull();
  expect(within(step(4)).queryByText(/Prüfungen|Lanes|gefunden/)).toBeNull();
});

it("reaches every step action by Tab in step order and reports the step id", () => {
  const onAction = vi.fn();
  render(<ErsteinrichtungScreen hasProject onAction={onAction} />);
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(6);
  for (const b of buttons) {
    expect(b).not.toBeDisabled();
    expect(b).not.toHaveAttribute("tabindex", "-1");
  }
  expect(buttons.map((b, i) => step(i + 1).contains(b))).toEqual([true, true, true, true, true, true]);
  fireEvent.click(buttons[2]);
  expect(onAction).toHaveBeenCalledWith("subs");
});
