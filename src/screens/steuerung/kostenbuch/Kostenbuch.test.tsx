import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Kostenbuch } from "./Kostenbuch";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const ev = (id: string, provider: string, model: string, tokensIn: number, tokensOut: number) => ({
  id, ts: 1, profileId: null, provider, model, tokensIn, tokensOut, costUsd: 12.34, rawJson: "{}",
});
const totals = (requests: number, tokensIn: number, tokensOut: number) => ({
  requests, tokensIn, tokensOut, costUsd: 98.76, priced: requests,
});
const report = (events: unknown[], extra: Record<string, unknown> = {}) => ({
  online: true, authorized: true, events, today: totals(2, 1500, 300), total: totals(40, 2_500_000, 410_000),
  reportedCostUsd: 55.5, ...extra,
});
const EVENTS = [
  ev("a", "anthropic", "sonnet", 1000, 200),
  ev("b", "anthropic", "sonnet", 2000, 300),
  ev("c", "openai", "gpt", 500, 50),
];
function backend(value: unknown) {
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (cmd !== "get_omniroute_usage") throw new Error(`unexpected ${cmd}`);
    if (value instanceof Error) throw value.message;
    return value;
  });
}
const rowsOf = () => within(screen.getByRole("table")).getAllByRole("row").slice(1)
  .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));

describe("Kostenbuch", () => {
  beforeEach(() => mocks.invoke.mockReset());

  it("rows fold events per provider and model and their sum equals the events", async () => {
    backend(report(EVENTS));
    render(<Kostenbuch />);
    await screen.findByRole("table");
    expect(rowsOf()).toEqual([
      ["anthropic", "sonnet", "2", "3.000", "500"],
      ["openai", "gpt", "1", "500", "50"],
      ["Summe", "", "3", "3.500", "550"],
    ]);
    expect(screen.getByText(/neuesten 3 Anfragen/)).toBeTruthy();
  });

  it("an empty model name becomes unbekanntes Modell and is counted", async () => {
    backend(report([...EVENTS, ev("d", "openai", "", 10, 5)]));
    render(<Kostenbuch />);
    await screen.findByRole("table");
    expect(rowsOf()).toContainEqual(["openai", "unbekanntes Modell", "1", "10", "5"]);
    expect(rowsOf().at(-1)).toEqual(["Summe", "", "4", "3.510", "555"]);
  });

  it("today and total come from the report totals", async () => {
    backend(report(EVENTS));
    render(<Kostenbuch />);
    await screen.findByRole("table");
    const period = screen.getByRole("region", { name: "Zeitraum" });
    expect(period.textContent).toContain("Heute");
    expect(period.textContent).toContain("1.500");
    expect(period.textContent).toContain("Gesamt");
    expect(period.textContent).toContain("2.500.000");
    expect(period.textContent).toContain("410.000");
  });

  it("no currency sign or price is rendered even when the report carries costs", async () => {
    backend(report(EVENTS));
    const { container } = render(<Kostenbuch />);
    await screen.findByRole("table");
    expect(container.textContent).not.toMatch(/[$€]|USD|EUR|Dollar|Kosten|Preis/);
    expect(container.textContent).not.toMatch(/12,34|98,76|55,5/);
  });

  it("offline or unauthorized keeps the stored rows and says the book is frozen", async () => {
    backend(report(EVENTS, { online: false }));
    const first = render(<Kostenbuch />);
    expect(await screen.findByText("Stand eingefroren: OmniRoute nicht erreichbar")).toBeTruthy();
    expect(rowsOf()).toHaveLength(3);
    first.unmount();
    backend(report(EVENTS, { authorized: false }));
    render(<Kostenbuch />);
    expect(await screen.findByText("Stand eingefroren: Verwaltungszugang fehlt")).toBeTruthy();
    expect(rowsOf()).toHaveLength(3);
  });

  it("a failed read shows Kostenbuch nicht lesbar and no zero", async () => {
    backend(new Error("kaputt"));
    const { container } = render(<Kostenbuch />);
    expect(await screen.findByText("Kostenbuch nicht lesbar")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("zero events is an honest empty state", async () => {
    backend(report([]));
    render(<Kostenbuch />);
    expect(await screen.findByText("Noch keine Anfragen gebucht")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("region", { name: "Zeitraum" }).textContent).toContain("2.500.000");
  });

  it("Zeugnisse are not connected and name their package", async () => {
    backend(report(EVENTS));
    render(<Kostenbuch />);
    await screen.findByRole("table");
    const section = screen.getByRole("region", { name: "Zeugnisse" });
    expect(within(section).getByText("Zeugnisse noch nicht verbunden")).toBeTruthy();
    expect(within(section).getByText(/V2-B21b offen/)).toBeTruthy();
  });

  it("Neu lesen reads again and only get_omniroute_usage is invoked", async () => {
    backend(report(EVENTS));
    render(<Kostenbuch />);
    await screen.findByRole("table");
    backend(report([ev("z", "openai", "gpt", 7, 1)]));
    fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
    await waitFor(() => expect(rowsOf()[0]).toEqual(["openai", "gpt", "1", "7", "1"]));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(new Set(mocks.invoke.mock.calls.map((c) => c[0]))).toEqual(new Set(["get_omniroute_usage"]));
  });

  it("drops a reply that arrives after unmount", async () => {
    let resolve: (v: unknown) => void = () => {};
    mocks.invoke.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Kostenbuch />);
    expect(screen.getByText("Wird gelesen …")).toBeTruthy();
    unmount();
    resolve(report(EVENTS));
    await Promise.resolve();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
