import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Kostenbuch } from "./Kostenbuch";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: async () => "com.projecta.app" }));

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

function pendingRead() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Kostenbuch", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

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
    render(<Kostenbuch />);
    expect(await screen.findByText("Kostenbuch nicht lesbar")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("region", { name: "Zeitraum" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Verbrauch je Modell" })).toBeNull();
  });

  it("zero events is an honest empty state", async () => {
    backend(report([]));
    render(<Kostenbuch />);
    expect(await screen.findByText("Noch keine Anfragen gebucht")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("region", { name: "Zeitraum" }).textContent).toContain("2.500.000");
  });

  it("Zeugnisse stay honest without an internal package note", async () => {
    backend(report(EVENTS));
    render(<Kostenbuch />);
    await screen.findByRole("table");
    const section = screen.getByRole("region", { name: "Zeugnisse" });
    expect(within(section).getByText("Zeugnisse noch nicht verbunden")).toBeTruthy();
    expect(within(section).queryByText(/V2-/)).toBeNull();
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

  it("shows loading instead of old totals during a manual ledger read", async () => {
    backend(report(EVENTS));
    render(<Kostenbuch />);
    await screen.findByRole("table");
    const button = screen.getByRole("button", { name: "Neu lesen" });
    const next = pendingRead();
    mocks.invoke.mockReturnValueOnce(next.promise);
    fireEvent.click(button);
    expect(screen.getByText("Wird gelesen …")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("region", { name: "Zeitraum" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Verbrauch je Modell" })).toBeNull();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    const fresh = report([ev("z", "openai", "gpt", 7, 1)], {
      today: totals(1, 7, 1), total: totals(41, 2_500_007, 410_001),
    });
    await act(async () => next.resolve(fresh));
    expect(rowsOf()).toEqual([
      ["openai", "gpt", "1", "7", "1"], ["Summe", "", "1", "7", "1"],
    ]);
    const period = screen.getByRole("region", { name: "Zeitraum" });
    expect(period).toHaveTextContent("1 Anfragen · 7 Tokens rein · 1 Tokens raus");
    expect(period).toHaveTextContent("41 Anfragen · 2.500.007 Tokens rein · 410.001 Tokens raus");
    expect(screen.queryByText("Wird gelesen …")).toBeNull();
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");

    const failure = pendingRead();
    mocks.invoke.mockReturnValueOnce(failure.promise);
    fireEvent.click(button);
    await act(async () => failure.reject(new Error("unreadable")));
    expect(screen.getByText("Kostenbuch nicht lesbar")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("region", { name: "Zeitraum" })).toBeNull();
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");

    const retry = pendingRead();
    mocks.invoke.mockReturnValueOnce(retry.promise);
    fireEvent.click(button);
    expect(screen.queryByText("Kostenbuch nicht lesbar")).toBeNull();
    expect(screen.getByText("Wird gelesen …")).toBeTruthy();
    expect(button).toBeDisabled();
    await act(async () => retry.resolve(fresh));
    expect(rowsOf().at(-1)).toEqual(["Summe", "", "1", "7", "1"]);
    expect(button).toBeEnabled();
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
  });

  it("does not start a second ledger read while a refresh is pending", async () => {
    backend(report(EVENTS));
    render(<Kostenbuch />);
    await screen.findByRole("table");
    const next = pendingRead();
    mocks.invoke.mockReturnValueOnce(next.promise);
    const button = screen.getByRole("button", { name: "Neu lesen" });
    fireEvent.click(button);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    // Call onClick directly, bypassing the DOM disabled guard, to prove
    // read() has its own busy guard independent of the button's disabled state
    const propsKey = Object.keys(button).find((k) => k.startsWith("__reactProps$"));
    const onClick = (button as unknown as Record<string, Record<string, (e: unknown) => void>>)[propsKey!].onClick;
    act(() => onClick({}));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve(report(EVENTS)));
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(new Set(mocks.invoke.mock.calls.map((c) => c[0]))).toEqual(new Set(["get_omniroute_usage"]));
  });

  it("a superseded in-flight ledger read still finishes and enables Neu lesen", async () => {
    const first = pendingRead();
    const second = pendingRead();
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd !== "get_omniroute_usage") throw new Error(`unexpected ${cmd}`);
      return report(EVENTS);
    });
    mocks.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(
      <StrictMode>
        <Kostenbuch />
      </StrictMode>,
    );
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    const button = screen.getByRole("button", { name: "Neu lesen" });
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Neu lesen", busy: true })).toBe(button);
    await act(async () => {
      first.resolve(report(EVENTS));
    });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Wird gelesen …")).toBeTruthy();
    expect(button).toBeDisabled();
    await act(async () => {
      second.resolve(report([ev("z", "openai", "gpt", 7, 1)]));
    });
    expect(rowsOf()[0]).toEqual(["openai", "gpt", "1", "7", "1"]);
    expect(screen.getByRole("button", { name: "Neu lesen", busy: false })).toBeEnabled();
  });

  it("Neu lesen is already busy when the ledger request starts", async () => {
    backend(report(EVENTS));
    render(<Kostenbuch />);
    await screen.findByRole("table");
    const button = screen.getByRole("button", { name: "Neu lesen" });
    const next = pendingRead();
    let busyAtStart = false;
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd !== "get_omniroute_usage") throw new Error(`unexpected ${cmd}`);
      busyAtStart = (button as HTMLButtonElement).disabled && button.getAttribute("aria-busy") === "true";
      return next.promise;
    });
    fireEvent.click(button);
    expect(busyAtStart).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Neu lesen", busy: true })).toBeDisabled();
    await act(async () => next.resolve(report(EVENTS)));
    expect(screen.getByRole("button", { name: "Neu lesen", busy: false })).toBeEnabled();
  });
});
