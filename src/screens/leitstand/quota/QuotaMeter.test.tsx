import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { quotaView, type QuotaViewInput } from "./forecast";
import { QuotaMeter } from "./QuotaMeter";

const view = (over: Partial<QuotaViewInput> = {}) =>
  quotaView({ state: "ok", fiveHourPct: null, sevenDayPct: null, fallbackName: null, ...over });

it("shows zu wenig Daten and no meter when the percent is missing", () => {
  render(<QuotaMeter view={view()} name="Claude Code" />);
  expect(screen.getByText("zu wenig Daten")).toBeInTheDocument();
  expect(screen.queryByRole("meter")).toBeNull();
});

it("shows a meter named after the profile and the percent plus the sentence", () => {
  render(<QuotaMeter view={view({ fiveHourPct: 40 })} name="Claude Code" />);
  const meter = screen.getByRole("meter");
  expect(meter).toHaveAttribute("aria-valuenow", "40");
  expect(meter.getAttribute("aria-label")).toMatch(/Claude Code.*40|40.*Claude Code/);
  expect(screen.getByText("zu wenig Daten")).toBeInTheDocument();
});

it("shows the failover name only when the view carries it", () => {
  const { rerender } = render(<QuotaMeter view={view({ state: "blocked", fallbackName: "Lokal" })} name="Claude Code" />);
  expect(screen.getByText("Failover: Lokal")).toBeInTheDocument();
  rerender(<QuotaMeter view={view({ state: "ok", fallbackName: "Lokal" })} name="Claude Code" />);
  expect(screen.queryByText(/Failover/)).toBeNull();
});
