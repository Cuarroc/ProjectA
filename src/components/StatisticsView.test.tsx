import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectStats, StatsRange } from "../types";

const mocks = vi.hoisted(() => ({ getProjectStats: vi.fn() }));

vi.mock("../lib/ipc", () => ({ getProjectStats: mocks.getProjectStats }));

import StatisticsView from "./StatisticsView";

function statsFixture(projectName: string, range: StatsRange): ProjectStats {
  return {
    projectId: "p1",
    projectName,
    range,
    since: null,
    generatedAt: 1_700_000_000,
    overview: {
      workersTotal: 1,
      workersActive: 1,
      workersArchived: 0,
      byColumn: [],
      byKind: [],
      needsAttention: 0,
      queue: [],
      queueTotal: 0,
      learningsPending: 0,
      messages: 0,
      statusEvents: 0,
      diffComments: 0,
      workersCreated: 0,
      rangeScoped: [],
    },
    tokens: null,
    sessions: {
      total: 0,
      open: 0,
      ended: 0,
      totalSeconds: 0,
      medianSeconds: null,
      failed: 0,
      unknownExit: 0,
      failureRatio: null,
      recent: [],
    },
    timeline: [],
    completion: { percent: null, components: [], workers: [], columnWeights: [] },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The heading is one span; match its full text, not a substring node. */
const heading =
  (name: string) =>
  (_: string, el: Element | null) =>
    el?.textContent === `Statistik — ${name}`;

describe("StatisticsView", () => {
  beforeEach(() => {
    mocks.getProjectStats.mockReset();
  });

  it("ignoriert die späte Antwort des alten Zeitraums (Race: langsam alt, schnell neu)", async () => {
    const slow = deferred<ProjectStats>();
    mocks.getProjectStats.mockImplementation((_projectId: string, range: StatsRange) => {
      if (range === "all") return slow.promise;
      return Promise.resolve(statsFixture(range === "today" ? "HeuteNeu" : "Woche", range));
    });

    render(<StatisticsView projectId="p1" />);

    // The tab bar only exists once the first window has loaded.
    expect(await screen.findByText(heading("Woche"))).toBeInTheDocument();

    // "Gesamt" is slow; before its answer returns, the user moves on to
    // "Heute", which answers immediately and must win.
    fireEvent.click(screen.getByRole("button", { name: "Gesamt" }));
    fireEvent.click(screen.getByRole("button", { name: "Heute" }));
    expect(await screen.findByText(heading("HeuteNeu"))).toBeInTheDocument();

    // Now the stale "Gesamt" answer arrives — it must not write under the new
    // window's label.
    await act(async () => {
      slow.resolve(statsFixture("GesamtAlt", "all"));
    });

    expect(screen.queryByText(heading("GesamtAlt"))).not.toBeInTheDocument();
    expect(screen.getByText(heading("HeuteNeu"))).toBeInTheDocument();
  });

  it("zeigt die Zahlen des gewählten Zeitraums", async () => {
    mocks.getProjectStats.mockImplementation((_projectId: string, range: StatsRange) =>
      Promise.resolve(statsFixture("Projekt", range)),
    );

    render(<StatisticsView projectId="p1" />);

    await waitFor(() => expect(mocks.getProjectStats).toHaveBeenCalledWith("p1", "week"));
    expect(await screen.findByText(heading("Projekt"))).toBeInTheDocument();
  });
});

describe("StatisticsView range control (APP-5)", () => {
  it("is a group of pressed buttons and not a tablist without keyboard support", async () => {
    mocks.getProjectStats.mockImplementation((_projectId: string, range: StatsRange) =>
      Promise.resolve(statsFixture("Projekt", range)),
    );
    render(<StatisticsView projectId="p1" />);
    await waitFor(() => expect(mocks.getProjectStats).toHaveBeenCalledWith("p1", "week"));
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Zeitraum" });
    const pressed = group.querySelectorAll('[aria-pressed="true"]');
    expect(pressed).toHaveLength(1);
  });
});

describe("StatisticsView heading outline (APP-15)", () => {
  it("the page title is an h2 and its cards are h3s beneath it", async () => {
    mocks.getProjectStats.mockImplementation((_projectId: string, range: StatsRange) =>
      Promise.resolve(statsFixture("Projekt", range)),
    );
    render(<StatisticsView projectId="p1" />);
    expect(await screen.findByRole("heading", { level: 2, name: heading("Projekt") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Übersicht" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Übersicht" })).not.toBeInTheDocument();
  });
});
