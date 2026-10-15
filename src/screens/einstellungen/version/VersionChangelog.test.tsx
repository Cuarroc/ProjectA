import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as changelog from "../../../lib/changelog";
import { VersionChangelog } from "./VersionChangelog";

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

it("shows fallback notes instead of empty lists when every group is empty", () => {
  // The parser currently removes empty groups; exercise the defensive view branch directly.
  vi.spyOn(changelog, "parseChangelog").mockReturnValueOnce([
    { version: "2.0.0", date: "2026-10-15", beta: false, notes: ["Release note."],
      groups: [{ title: "Changes", items: [] }, { title: "Fixes", items: [] }] },
    { version: "1.0.0", date: "2026-10-14", beta: false, notes: [],
      groups: [{ title: "Changes", items: [] }] },
  ]);
  render(<VersionChangelog source="" />);
  expect(screen.queryAllByRole("list")).toHaveLength(0);
  expect(screen.getByText("Release note.")).toBeVisible();
  expect(screen.getByText("Keine Neuigkeiten vorhanden")).toBeVisible();
});

it("orders versions numerically and limits releases and changes", () => {
  render(<VersionChangelog source={`
## v1.9.0 — 15.10.2026
- Older change
## v1.11.0 (Beta) — 15.10.2026
- **Newest change:** Long explanation omitted from the brief.
- Plain change
- Third change
- Fourth change
## v1.8.0 — 14.10.2026
- Oldest change
## v1.10.0 — 15.10.2026
- Middle change
`} />);
  expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent))
    .toEqual(["v1.11.0", "v1.10.0", "v1.9.0"]);
  const latest = screen.getAllByRole("article")[0];
  expect(within(latest).getAllByRole("listitem").map((li) => li.textContent))
    .toEqual(["Newest change", "Plain change", "Third change"]);
  expect(latest).toHaveTextContent("Beta");
  expect(latest.querySelector("time")).toHaveAttribute("datetime", "2026-10-15");
  expect(latest.querySelector("time")).toHaveTextContent("15.10.2026");
  expect(screen.queryByText("Oldest change")).toBeNull();
  expect(screen.queryByText("Fourth change")).toBeNull();
});

it("keeps plain text and note-only releases brief and reports an empty changelog", () => {
  render(<VersionChangelog source={`## v2.0.0 — 15.10.2026
- <img src=x onerror=alert(1)>
- ${"x".repeat(200)}
## v1.0.0 — 14.10.2026
A release with only a note.
`} />);
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText(`${"x".repeat(159)}…`)).toBeVisible();
  expect(screen.getByText("A release with only a note.")).toBeVisible();
  cleanup();
  render(<VersionChangelog source="" />);
  expect(screen.getByText("Keine Neuigkeiten vorhanden")).toBeVisible();
  expect(screen.queryByRole("article")).toBeNull();
});
