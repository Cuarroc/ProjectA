import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DiffFile } from "../types";
import DiffView from "./DiffView";

/**
 * APP-14 of the ui-ux-pro-max audit: every commentable diff line used to be
 * its own tab stop, so an 800-line diff cost 800 Tab presses to get past.
 * One row per file is the tab stop; ArrowUp/Down, Home and End move it.
 * This file carries its own mock of ../lib/diff because DiffView.test.tsx
 * mocks the diff away entirely.
 */

const file: DiffFile = {
  path: "src/a.ts",
  oldPath: null,
  additions: 3,
  deletions: 1,
  binary: false,
  hunks: [
    {
      header: "@@ -1,3 +1,4 @@",
      lines: [
        { kind: "context", content: "const a = 1;", oldLine: 1, newLine: 1 },
        { kind: "del", content: "const b = 2;", oldLine: 2, newLine: null },
        { kind: "add", content: "const b = 3;", oldLine: null, newLine: 2 },
        { kind: "add", content: "const c = 4;", oldLine: null, newLine: 3 },
      ],
    },
    {
      header: "@@ -10,1 +11,2 @@",
      lines: [
        { kind: "context", content: "export {};", oldLine: 10, newLine: 11 },
        { kind: "add", content: "export const d = 5;", oldLine: null, newLine: 12 },
      ],
    },
  ],
};

vi.mock("../lib/ipc", () => ({
  addDiffComment: vi.fn(),
  deleteDiffComment: vi.fn(),
  listDiffComments: vi.fn(async () => []),
  getWorkerReadiness: vi.fn(() => new Promise(() => {})),
  getSetupTrustView: vi.fn(async () => null),
  approveSetupTrust: vi.fn(),
  setDiffCommentDisposition: vi.fn(),
  setReviewVerdict: vi.fn(),
  describeError: (cause: unknown) => String(cause),
}));

vi.mock("../lib/diff", () => ({
  commentLineOf: (line: { newLine: number | null; oldLine: number | null }) => line.newLine ?? line.oldLine,
  fileLabel: (path: string) => path,
  useWorkerDiff: () => ({
    diff: { baseBranch: "main", files: [file], stat: "", code: null },
    comments: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    setComments: vi.fn(),
  }),
}));

const rows = () => screen.getAllByRole("button", { name: /^Kommentar zu Zeile/ });

describe("DiffView line rows (APP-14)", () => {
  it("exposes exactly one tab stop among the commentable lines", () => {
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const lines = rows();
    expect(lines).toHaveLength(5);
    expect(lines.map((row) => row.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it("moves the stop with the arrow keys across hunks and wraps at the ends", () => {
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const lines = rows();
    lines[0].focus();
    fireEvent.keyDown(lines[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(lines[1]);
    expect(rows().map((row) => row.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
    fireEvent.keyDown(lines[1], { key: "End" });
    expect(document.activeElement).toBe(lines[4]);
    fireEvent.keyDown(lines[4], { key: "ArrowDown" });
    expect(document.activeElement).toBe(lines[0]);
    fireEvent.keyDown(lines[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(lines[4]);
    fireEvent.keyDown(lines[4], { key: "Home" });
    expect(document.activeElement).toBe(lines[0]);
  });

  it("still opens the comment box with Enter on the focused row", () => {
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const lines = rows();
    lines[2].focus();
    fireEvent.keyDown(lines[2], { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Kommentar zu Zeile 3" })).toBeInTheDocument();
  });
});
