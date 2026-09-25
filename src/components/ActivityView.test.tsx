import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityEntry } from "../types";

const mocks = vi.hoisted(() => ({
  getActivity: vi.fn(),
  getDigest: vi.fn(),
  listDigests: vi.fn(),
  describeError: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  getActivity: mocks.getActivity,
  getDigest: mocks.getDigest,
  listDigests: mocks.listDigests,
  describeError: mocks.describeError,
}));

import ActivityView from "./ActivityView";

function entry(id: string, summary: string): ActivityEntry {
  return {
    id,
    createdAt: 1_700_000_000,
    category: "status",
    projectId: "p1",
    workerId: null,
    workerLabel: null,
    summary,
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

describe("ActivityView", () => {
  beforeEach(() => {
    mocks.getActivity.mockReset();
  });

  it("ignoriert die späte Antwort des vorherigen Projekts (Race: langsam alt, schnell neu)", async () => {
    const slow = deferred<ActivityEntry[]>();
    mocks.getActivity.mockImplementation((projectId?: string) =>
      projectId === "p1" ? slow.promise : Promise.resolve([entry("n1", "Neues Projekt")]),
    );

    const { rerender } = render(<ActivityView projectId="p1" />);

    // The old project's request is still in flight; the switch fires a fast
    // one whose answer must win.
    rerender(<ActivityView projectId="p2" />);
    expect(await screen.findByText("Neues Projekt")).toBeInTheDocument();

    // Now the stale answer arrives — it must not overwrite the new feed.
    await act(async () => {
      slow.resolve([entry("a1", "Altes Projekt")]);
    });

    expect(screen.queryByText("Altes Projekt")).not.toBeInTheDocument();
    expect(screen.getByText("Neues Projekt")).toBeInTheDocument();
  });
});
