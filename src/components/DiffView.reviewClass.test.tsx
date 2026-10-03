import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DiffFile } from "../types";
import DiffView from "./DiffView";

/** M3-02: the diff names the review class (AGENTS.md rule 5) per file and overall. */

const mk = (path: string): DiffFile => ({
  path,
  oldPath: null,
  additions: 1,
  deletions: 0,
  binary: false,
  hunks: [],
});

const state: { files: DiffFile[] } = { files: [] };

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
  commentLineOf: () => null,
  fileLabel: (path: string) => path,
  useWorkerDiff: () => ({
    diff: { baseBranch: "main", files: state.files, stat: "", code: null },
    comments: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    setComments: vi.fn(),
  }),
}));

describe("DiffView review class", () => {
  it("shows the highest class on top and a badge per file", () => {
    state.files = [mk("docs/PLAN.md"), mk("src/lib/diff.ts"), mk("src-tauri/src/store.rs")];
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const overall = screen.getByRole("status");
    expect(overall).toHaveTextContent("Prüfstufe A: braucht zwei Prüfer anderer Anbieter");
    const badges = Array.from(document.querySelectorAll(".diff-file-class")).map(
      (el) => el.textContent,
    );
    expect(badges).toEqual(["C", "B", "A"]);
  });

  it("says 'unbekannt' instead of guessing for an unmatched path", () => {
    state.files = [mk("Cargo.lock")];
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    expect(screen.getByRole("status")).toHaveTextContent("unbekannt – im Zweifel wie A behandeln");
  });

  it("counts a rename out of a seam with its old path", () => {
    state.files = [{ ...mk("src-tauri/src/other.rs"), oldPath: "src-tauri/src/store.rs" }];
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Prüfstufe A");
  });
});
