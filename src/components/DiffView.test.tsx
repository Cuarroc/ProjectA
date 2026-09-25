import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DiffComment, SetupTrustView, WorkerReadiness } from "../types";
import DiffView from "./DiffView";

const getWorkerReadiness = vi.fn();
const getSetupTrustView = vi.fn();
const approveSetupTrust = vi.fn();
const setDiffCommentDisposition = vi.fn();
const setReviewVerdict = vi.fn();
const refresh = vi.fn(async () => {});
const setComments = vi.fn();

/** The tuple of the diff snapshot on screen — deliberately NOT readiness.code. */
const DIFF_CODE = { workerHeadSha: "sha-dw", baseTipSha: "sha-db", mergeTreeOid: "oid-dm" };
/** Per-test control over the mocked hook's loading state and snapshot tuple. */
const diffState: { loading: boolean; code: typeof DIFF_CODE | null } = {
  loading: false,
  code: DIFF_CODE,
};

const comments: DiffComment[] = [
  {
    id: "dc-1",
    workerId: "wk-1",
    file: "src/a.ts",
    line: 4,
    body: "bitte umbenennen",
    sentToAgent: false,
    createdAt: 1,
    disposition: "open",
  },
];

const readiness: WorkerReadiness = {
  lifecycle: "exited",
  readiness: "blocked",
  blockers: [
    {
      code: "tests_stale",
      message: "Tests sind nicht an diesen Merge-Tree gebunden",
      nextStep: "Tests erneut laufen lassen",
    },
  ],
  checkedAt: 1,
  ahead: 2,
  behind: 1,
  code: { workerHeadSha: "sha-w", baseTipSha: "sha-b", mergeTreeOid: "oid-m" },
};

vi.mock("../lib/ipc", () => ({
  addDiffComment: vi.fn(),
  deleteDiffComment: vi.fn(),
  listDiffComments: vi.fn(async () => []),
  getWorkerReadiness: (...args: unknown[]) => getWorkerReadiness(...args),
  getSetupTrustView: (...args: unknown[]) => getSetupTrustView(...args),
  approveSetupTrust: (...args: unknown[]) => approveSetupTrust(...args),
  setDiffCommentDisposition: (...args: unknown[]) => setDiffCommentDisposition(...args),
  setReviewVerdict: (...args: unknown[]) => setReviewVerdict(...args),
  describeError: (cause: unknown) => String(cause),
}));

// Default for the tests above the setup-trust block: no setup command
// configured means no view, and the section stays out of the way.
getSetupTrustView.mockResolvedValue(null);

vi.mock("../lib/diff", () => ({
  commentLineOf: () => null,
  fileLabel: (path: string) => path,
  useWorkerDiff: () => ({
    diff: { baseBranch: "main", files: [], stat: "", code: diffState.code },
    comments,
    loading: diffState.loading,
    error: null,
    refresh,
    setComments,
  }),
}));

// Die Accessible-Name-Queries (findByRole mit name, toHaveAccessibleName)
// berechnen Namen ueber dem ganzen gerenderten Baum. Lokal ~1 s, auf dem
// belasteten CI-Runner ueber 5 s (Run 34032433636: Timeout bei 5000 ms).
// Headroom statt Flake: das Verhalten ist korrekt, nur die Uhr war zu knapp.
describe("DiffView", { timeout: 15000 }, () => {
  it("renders engine blockers and names them for assistive tech", async () => {
    getWorkerReadiness.mockResolvedValue(readiness);
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

    const row = await screen.findByRole("option", { name: /tests_stale/i });
    expect(row).toHaveAccessibleName(/tests_stale/);
    expect(row).toHaveAccessibleName(/Nächster Schritt: Tests erneut laufen lassen/);
    expect(screen.getByLabelText(/2 Commits voraus, 1 Commits zurück/)).toBeInTheDocument();
    expect(screen.getByLabelText("Review-Readiness")).toBeInTheDocument();
  });

  it("moves through blockers with the keyboard", async () => {
    getWorkerReadiness.mockResolvedValue({
      ...readiness,
      blockers: [
        ...readiness.blockers,
        { code: "dirty", message: "Arbeitsbaum ist schmutzig", nextStep: "committen" },
      ],
    });
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const surface = await screen.findByRole("listbox", { name: "Merge-Blocker" });
    await screen.findByRole("option", { name: /tests_stale/i });
    fireEvent.keyDown(surface, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /dirty/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("jumps through blockers with Home and End", async () => {
    getWorkerReadiness.mockResolvedValue({
      ...readiness,
      blockers: [
        ...readiness.blockers,
        { code: "dirty", message: "Arbeitsbaum ist schmutzig", nextStep: "committen" },
      ],
    });
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const surface = await screen.findByRole("listbox", { name: "Merge-Blocker" });
    await screen.findByRole("option", { name: /tests_stale/i });
    fireEvent.keyDown(surface, { key: "End" });
    expect(screen.getByRole("option", { name: /dirty/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(surface, { key: "Home" });
    expect(screen.getByRole("option", { name: /tests_stale/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("toggles comment disposition through the core", async () => {
    getWorkerReadiness.mockResolvedValue(readiness);
    setDiffCommentDisposition.mockResolvedValue(undefined);
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const toggle = await screen.findByRole("button", {
      name: /Kommentar src\/a.ts:4 erledigt/,
    });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(setDiffCommentDisposition).toHaveBeenCalledWith("dc-1", "done");
    });
  });

  it("stamps the desktop approval from the readiness panel", async () => {
    getWorkerReadiness.mockClear();
    getWorkerReadiness.mockResolvedValue(readiness);
    setReviewVerdict.mockResolvedValue(undefined);
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const approve = await screen.findByRole("button", { name: "Review freigeben" });
    fireEvent.click(approve);
    await waitFor(() => {
      // The verdict carries the tuple of the diff snapshot on screen — not
      // the readiness poll's — so panel and approval can never drift apart.
      expect(setReviewVerdict).toHaveBeenCalledWith("wk-1", "approved", DIFF_CODE);
    });
    // The panel shows the core's answer, not the click's: readiness reloads
    // (once on mount, once after the verdict).
    await waitFor(() => {
      expect(getWorkerReadiness).toHaveBeenCalledTimes(2);
    });
  });

  it("binds the verdict to the diff snapshot, not a fresher readiness poll", async () => {
    // Review-r4 (Codex): the diff loads for code A; code B lands before the
    // click and the readiness poll already shows B. The verdict must still
    // bind to the diff snapshot A — the core then refuses and orders a
    // reload — never silently approve B, which nobody reviewed.
    const codeB = { workerHeadSha: "sha-w2", baseTipSha: "sha-b2", mergeTreeOid: "oid-m2" };
    getWorkerReadiness.mockClear();
    getWorkerReadiness.mockResolvedValue({ ...readiness, code: codeB });
    setReviewVerdict.mockRejectedValue(
      new Error("the code changed since the review was loaded; reload and review again"),
    );
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const approve = await screen.findByRole("button", { name: "Review freigeben" });
    fireEvent.click(approve);
    await waitFor(() => {
      expect(setReviewVerdict).toHaveBeenCalledWith("wk-1", "approved", DIFF_CODE);
    });
    // The refusal resyncs the panel: diff and readiness reload to B, and the
    // core's message is shown in the readiness panel.
    await screen.findByRole("alert");
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the verdict buttons dead while the diff snapshot is in flight", async () => {
    // Review-r4 (Codex): no verdict for a tuple whose diff is still loading.
    diffState.loading = true;
    try {
      getWorkerReadiness.mockResolvedValue(readiness);
      render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
      const approve = await screen.findByRole("button", { name: "Review freigeben" });
      const request = screen.getByRole("button", { name: "Änderungen anfordern" });
      expect(approve).toBeDisabled();
      expect(request).toBeDisabled();
    } finally {
      diffState.loading = false;
    }
  });

  it("keeps the verdict buttons dead when the snapshot has no measurable tuple", async () => {
    // Review-r5 (Sonnet): a conflicted merge tree is code: null with
    // loading done — a clickable verdict would only loop on a misleading
    // "reload" refusal, although nothing but real rework can help.
    diffState.code = null;
    try {
      getWorkerReadiness.mockResolvedValue({
        ...readiness,
        blockers: [
          {
            code: "conflicting",
            message: "Merge-Tree hat Konflikte",
            nextStep: "Konflikt im Worker-Branch auflösen",
          },
        ],
      });
      render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
      const approve = await screen.findByRole("button", { name: "Review freigeben" });
      const request = screen.getByRole("button", { name: "Änderungen anfordern" });
      expect(approve).toBeDisabled();
      expect(request).toBeDisabled();
    } finally {
      diffState.code = DIFF_CODE;
    }
  });

  it("stamps a changes request from the readiness panel", async () => {
    getWorkerReadiness.mockResolvedValue(readiness);
    setReviewVerdict.mockResolvedValue(undefined);
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const request = await screen.findByRole("button", { name: "Änderungen anfordern" });
    fireEvent.click(request);
    await waitFor(() => {
      expect(setReviewVerdict).toHaveBeenCalledWith("wk-1", "changes_requested", DIFF_CODE);
    });
  });

  const SETUP_VIEW: SetupTrustView = {
    command: "npm install",
    status: "missing",
    repoIdentity: "C:\\repo",
    commandNormalized: "npm install",
    baseSha: "base-sha-1234567890",
    inputsHash: "inputs-hash-1",
    inputFiles: ["package.json", "package-lock.json"],
    mergeTreeOid: "oid-dm",
    grantedAt: null,
  };

  it("shows the verdict refusal even when the resync itself fails", async () => {
    // Review-F4-r22 (k3 Fund 1): the verdict catch resyncs diff + readiness
    // with Promise.all — a rejecting refresh must not throw OUT of the
    // catch and swallow the refusal message (unhandled rejection looking
    // like a no-op click).
    getWorkerReadiness.mockResolvedValue(readiness);
    setReviewVerdict.mockRejectedValue(new Error("the diff moved; reload and review again"));
    refresh.mockClear();
    refresh.mockRejectedValueOnce(new Error("invoke down"));
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Review freigeben" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/the diff moved/);
  });

  it("keeps the verdict refusal visible when the resync settles late", async () => {
    // Review-F4-r23 (Opus Fund 1): Promise.all short-circuits on the first
    // rejection — a fast-failing refresh would set the refusal, then a late
    // loadReadiness would null it again (the alert blinks away). allSettled
    // waits for BOTH before the error is shown.
    getWorkerReadiness.mockClear();
    getWorkerReadiness.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(readiness), 20)),
    );
    getSetupTrustView.mockClear();
    getSetupTrustView.mockResolvedValue(null);
    setReviewVerdict.mockRejectedValue(new Error("the diff moved; reload and review again"));
    refresh.mockClear();
    refresh.mockRejectedValueOnce(new Error("invoke down"));
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Review freigeben" }));
    // Let every resync promise settle (the delayed readiness lands at 20 ms).
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(screen.getByRole("alert")).toHaveTextContent(/the diff moved/);
  });

  it("grants setup trust for exactly the inputs on screen", async () => {
    getWorkerReadiness.mockClear();
    getWorkerReadiness.mockResolvedValue(readiness);
    getSetupTrustView.mockClear();
    getSetupTrustView.mockResolvedValue(SETUP_VIEW);
    approveSetupTrust.mockResolvedValue(undefined);
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

    const section = await screen.findByLabelText("Setup-Vertrauen");
    expect(section).toHaveTextContent("npm install");
    expect(section).toHaveTextContent("package.json, package-lock.json");
    expect(section).toHaveTextContent("base-sha");

    fireEvent.click(screen.getByRole("button", { name: "Setup freigeben" }));
    await waitFor(() => {
      // The approval binds what the panel shows AND the tree the diff on
      // screen was read from — the same discipline as the verdict binding
      // (review-F4-r18, Opus Fund 1).
      expect(approveSetupTrust).toHaveBeenCalledWith("wk-1", SETUP_VIEW, DIFF_CODE.mergeTreeOid);
    });
    // Granted or refused, the panel re-reads the core's answer (once on
    // mount, once after the approval).
    await waitFor(() => {
      expect(getWorkerReadiness).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps the approve path reachable when the candidate declares no input files", async () => {
    // Review-F4-r15 (k3 Fund 2 / Sonnet Fund 2): the empty-inputs branch is
    // the whole point of the r14 ipc fix — a candidate without any declared
    // TRUST_INPUTS file must still render the section, say so, and approve
    // with the hash it shows. A rebuild that hides the section behind
    // `inputFiles.length > 0` would restore the r14 deadlock unnoticed.
    // Seit r16 (Opus Fund 1) lautet der reale Token `tree=<oid>` — die
    // Freigabe bindet immer den Kandidaten-Baum, und die Anzeige sagt das.
    const EMPTY_VIEW: SetupTrustView = {
      ...SETUP_VIEW,
      command: "make deps",
      commandNormalized: "make deps",
      inputsHash: "tree=9f86d081884c7d65",
      inputFiles: [],
      mergeTreeOid: "oid-dm",
    };
    getWorkerReadiness.mockClear();
    getWorkerReadiness.mockResolvedValue(readiness);
    getSetupTrustView.mockClear();
    getSetupTrustView.mockResolvedValue(EMPTY_VIEW);
    approveSetupTrust.mockResolvedValue(undefined);
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

    const section = await screen.findByLabelText("Setup-Vertrauen");
    expect(section).toHaveTextContent("keine deklarierten Dateien im Merge-Kandidaten");
    expect(section).toHaveTextContent("Die Freigabe gilt für genau diesen Merge-Kandidaten");

    fireEvent.click(screen.getByRole("button", { name: "Setup freigeben" }));
    await waitFor(() => {
      expect(approveSetupTrust).toHaveBeenCalledWith("wk-1", EMPTY_VIEW, DIFF_CODE.mergeTreeOid);
    });
  });

  it("keeps the approve button dead until a diff is on screen", async () => {
    // Review-F4-r19 (k3 Fund 2): without a read diff there is no tree to
    // bind the approval to — the button must be DISABLED, not a silent
    // no-op (the early return in approveSetup alone would swallow clicks
    // without any feedback).
    diffState.code = null;
    try {
      getWorkerReadiness.mockResolvedValue(readiness);
      getSetupTrustView.mockClear();
      getSetupTrustView.mockResolvedValue(SETUP_VIEW);
      approveSetupTrust.mockClear();
      render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

      const button = await screen.findByRole("button", { name: "Setup freigeben" });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(approveSetupTrust).not.toHaveBeenCalled();
    } finally {
      diffState.code = DIFF_CODE;
    }
  });

  it("locks the approval when panel and diff show different candidate trees", async () => {
    // Review-F4-r19 (Opus Fund 1): panel and diff are two independent
    // measurements. If they diverge, the approval must lock with a visible
    // reason and an explicit reload — not loop refusals, and never approve
    // a tree nobody read.
    getWorkerReadiness.mockResolvedValue(readiness);
    getSetupTrustView.mockClear();
    getSetupTrustView.mockResolvedValue({ ...SETUP_VIEW, mergeTreeOid: "oid-ANDERER" });
    approveSetupTrust.mockClear();
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

    await screen.findByText(/verschiedene Kandidaten-Bäume/);
    expect(screen.getByRole("button", { name: "Setup freigeben" })).toBeDisabled();
    expect(approveSetupTrust).not.toHaveBeenCalled();
  });

  it("recovers from a diverged panel by resyncing BOTH measurements", async () => {
    // Review-F4-r20 (k3 Fund 1): the recovery button must re-measure panel
    // AND diff — when the PANEL is the stale side, refreshing only the diff
    // locks the approval forever.
    getWorkerReadiness.mockResolvedValue(readiness);
    getSetupTrustView.mockClear();
    getSetupTrustView.mockResolvedValue({ ...SETUP_VIEW, mergeTreeOid: "oid-ANDERER" });
    approveSetupTrust.mockClear();
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

    await screen.findByText(/verschiedene Kandidaten-Bäume/);
    // The resync now measures the converged state on both sides.
    getSetupTrustView.mockResolvedValue(SETUP_VIEW);
    refresh.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Diff und Panel neu laden" }));

    // BOTH halves of the recovery must fire — the panel half alone would
    // leave a stale diff locked forever (the mirrored r20 Fund 1).
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Setup freigeben" })).toBeEnabled();
    });
    expect(screen.queryByText(/verschiedene Kandidaten-Bäume/)).toBeNull();
  });

  it("shows the core's refusal when the shown grant went stale", async () => {
    getWorkerReadiness.mockResolvedValue(readiness);
    getSetupTrustView.mockClear();
    getSetupTrustView.mockResolvedValue(SETUP_VIEW);
    approveSetupTrust.mockRejectedValue(
      new Error("the setup inputs changed since they were shown; reload and review again"),
    );
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Setup freigeben" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/setup inputs changed/);
  });

  it("shows the grant without an approve button once it holds", async () => {
    getWorkerReadiness.mockResolvedValue(readiness);
    getSetupTrustView.mockClear();
    getSetupTrustView.mockResolvedValue({ ...SETUP_VIEW, status: "granted", grantedAt: 1 });
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

    const section = await screen.findByLabelText("Setup-Vertrauen");
    expect(section).toHaveTextContent("Setup freigegeben");
    expect(screen.queryByRole("button", { name: "Setup freigeben" })).toBeNull();
  });

  it("shows a note instead of vanishing when the setup-trust view cannot be read", async () => {
    getWorkerReadiness.mockResolvedValue(readiness);
    getSetupTrustView.mockClear();
    getSetupTrustView.mockRejectedValue(new Error("cannot measure the merge candidate"));
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);

    await screen.findByText(/Setup-Vertrauen nicht lesbar/);
    expect(screen.queryByLabelText("Setup-Vertrauen")).toBeNull();
  });
});

describe("DiffView readiness listbox wiring (APP-8)", () => {
  it("the listbox carries tabindex and aria-activedescendant and the section does not", async () => {
    getWorkerReadiness.mockResolvedValue(readiness);
    render(<DiffView workerId="wk-1" branch="nacht/wk-1" />);
    const first = await screen.findByRole("option", { name: /tests_stale/i });
    const listbox = screen.getByRole("listbox", { name: "Merge-Blocker" });
    expect(listbox).toHaveAttribute("tabindex", "0");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(first.id);
    expect(screen.getByLabelText("Review-Readiness")).not.toHaveAttribute("aria-activedescendant");
  });
});
