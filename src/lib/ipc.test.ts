import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  approveSetupTrust,
  describeError,
  getDevelopmentPlan,
  getOmniRouteUsage,
  getSetupTrustView,
  importDevelopmentPlan,
  listLiveSessions,
  onSupervisorNotification,
  openExternal,
  type SupervisorNotification,
} from "./ipc";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("IPC audit regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed session inventory instead of permitting an idle update", async () => {
    for (const response of [null, {}, "", [42], ["session", null], [""]]) {
      vi.mocked(invoke).mockResolvedValue(response);
      await expect(listLiveSessions()).rejects.toThrow(/session inventory/i);
    }
    vi.mocked(invoke).mockResolvedValue([]);
    await expect(listLiveSessions()).resolves.toEqual([]);
    vi.mocked(invoke).mockResolvedValue(["starting-1"]);
    await expect(listLiveSessions()).resolves.toEqual(["starting-1"]);
    vi.mocked(invoke).mockRejectedValue(new Error("registry poisoned"));
    await expect(listLiveSessions()).rejects.toThrow("registry poisoned");
  });

  it("does not pass an unsafe recommendation URL to the webview fallback", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("opener unavailable"));
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternal("javascript:alert(document.domain)");

    expect(open).not.toHaveBeenCalled();
  });

  it("hands a web URL to the opener plugin and leaves the webview alone", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.mocked(invoke).mockResolvedValue(undefined);

    await openExternal("https://github.com/Cuarroc/ProjectA/pull/1");

    expect(invoke).toHaveBeenCalledWith("plugin:opener|open_url", {
      url: "https://github.com/Cuarroc/ProjectA/pull/1",
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("falls back to the webview only when the plugin refuses, and says so", async () => {
    const open = vi
      .spyOn(window, "open")
      .mockImplementation(() => ({ closed: false }) as unknown as Window);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(invoke).mockRejectedValue(new Error("opener.open_url not allowed"));

    await openExternal("https://example.org/");

    expect(open).toHaveBeenCalledWith("https://example.org/", "_blank", "noopener,noreferrer");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("rejects instead of resolving silently when the fallback pop-up is blocked too", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(invoke).mockRejectedValue(new Error("opener.open_url not allowed"));

    await expect(openExternal("https://example.org/")).rejects.toThrow(/blocked the pop-up/);
  });

  it("rejects an incomplete usage report instead of inventing negative facts and zero totals", async () => {
    vi.mocked(invoke).mockResolvedValue({ events: [] });

    await expect(getOmniRouteUsage()).rejects.toThrow();
  });

  // Review-F4-r14 (k3 Fund 1 / Sonnet Befund 1, blockierend): die alte Guard
  // wertete "" als fehlend und ließ den ganzen View fallen — die UI zeigte
  // nie eine Freigabe, das Gate scheiterte permanent ohne Ausweg. Seit r16
  // lautet der reale Leere-Token `tree=<oid>` (der Kern erzeugt "" nicht
  // mehr); dieser Test pinnt die Guard-Toleranz gegenüber dem historischen /
  // defensiven Payload, der DiffView-Test den echten.
  it("keeps the setup trust view when the candidate declares no input files", async () => {
    vi.mocked(invoke).mockResolvedValue({
      command: "make deps",
      status: "missing",
      repoIdentity: "/repo",
      commandNormalized: "make deps",
      baseSha: "base-1",
      inputsHash: "",
      inputFiles: [],
      mergeTreeOid: "oid-1",
      grantedAt: null,
    });

    const view = await getSetupTrustView("wk-1");

    expect(view).not.toBeNull();
    expect(view?.inputsHash).toBe("");
    expect(view?.inputFiles).toEqual([]);
    expect(view?.mergeTreeOid).toBe("oid-1");
    expect(view?.status).toBe("missing");
  });

  it("throws on an unusable setup trust payload instead of posing as 'no setup command'", async () => {
    // Review-F4-r19 (Opus Fund 4): a present-but-malformed payload (here:
    // no merge tree oid) must surface as an error — returning null renders
    // exactly like "project has no setup command" and hides the only
    // approval path behind silence.
    vi.mocked(invoke).mockResolvedValue({
      command: "make deps",
      status: "missing",
      repoIdentity: "/repo",
      commandNormalized: "make deps",
      baseSha: "base-1",
      inputsHash: "tree=t",
      inputFiles: [],
      grantedAt: null,
    });

    await expect(getSetupTrustView("wk-1")).rejects.toThrow();
  });

  it("sends the approval payload with the exact snake_case keys the core deserialises", async () => {
    // Review-F4-r18 (k3 Fund 1): the Rust side of this seam is pinned by
    // the_setup_trust_serde_contract_is_pinned — but a "camelCase
    // Vereinheitlichung" of this literal plus types.ts would typecheck, keep
    // every suite green, and break every approval at runtime. Pin the keys
    // that actually cross the boundary.
    vi.mocked(invoke).mockResolvedValue({
      repo_identity: "/repo",
      command_normalized: "make deps",
      base_sha: "b",
      inputs_hash: "tree=t",
    });

    await approveSetupTrust(
      "wk-1",
      {
        command: "make deps",
        status: "missing",
        repoIdentity: "/repo",
        commandNormalized: "make deps",
        baseSha: "b",
        inputsHash: "tree=t",
        inputFiles: [],
        mergeTreeOid: "t",
        grantedAt: null,
      },
      "t",
    );

    expect(invoke).toHaveBeenCalledWith("approve_setup_trust", {
      workerId: "wk-1",
      expected: {
        repo_identity: "/repo",
        command_normalized: "make deps",
        base_sha: "b",
        inputs_hash: "tree=t",
      },
      seenTreeOid: "t",
    });
  });

  // KI-6: the core's shared `refused: ` prefix is unified vocabulary for
  // 404/409 mapping (see api.rs::core_status), not prose for a human — but it
  // reached the UI verbatim through this single choke point every panel error
  // goes through.
  it("KI-6 strips the core's `refused: ` prefix before a message reaches the UI", () => {
    expect(describeError(new Error("refused: remote 'origin' already exists"))).toBe(
      "remote 'origin' already exists",
    );
    expect(describeError("refused: profile 'kimi' is switched off")).toBe(
      "profile 'kimi' is switched off",
    );
    // Only the leading, exact prefix — a message that merely mentions the
    // word elsewhere in the sentence is left alone.
    expect(describeError(new Error("git refused: nothing to commit"))).toBe(
      "git refused: nothing to commit",
    );
  });

  // Review W1-09 Runde 3 (deepseek-v4-flash P3): a message that is nothing but
  // the prefix was stripped down to an empty string, and the panel showed an
  // error with no text at all. The routing tag is still better than nothing.
  it("KI-6 keeps a bare refused prefix instead of an empty error text", () => {
    expect(describeError(new Error("refused: "))).toBe("refused: ");
    expect(describeError("refused:    ")).toBe("refused:    ");
  });
});

describe("development plan IPC", () => {
  beforeEach(() => vi.clearAllMocks());

  const snapshot = {
    contractVersion: 1,
    availability: "available",
    generatedAt: 42,
    projectId: "pj-1",
    sourceRevision: "sha-2",
    projection: {
      projectId: "pj-1", planId: "main", sourcePath: "docs/PLAN.md",
      sourceRevision: "sha-2", projectionRevision: 2, source: "original markdown",
      rollbackReason: "restore source", importedAt: 40,
      packages: [{
        projectId: "pj-1", planId: "main", packageId: "DF-01", parentId: null,
        sourcePath: "docs/PLAN.md", sourceRevision: "sha-2", sourceLine: 120,
        title: "Removed", dependencyIds: ["DF-00"], acceptance: "done",
        removed: true, noNewDispatch: true,
      }],
    },
  };

  it("reads the exact current or historical snapshot without importing", async () => {
    vi.mocked(invoke).mockResolvedValue(snapshot);
    await expect(getDevelopmentPlan("pj-1", "main")).resolves.toBe(snapshot);
    expect(invoke).toHaveBeenLastCalledWith("get_development_plan", {
      projectId: "pj-1", planId: "main", revision: null,
    });
    await expect(getDevelopmentPlan("pj-1", "main", 2)).resolves.toBe(snapshot);
    expect(invoke).toHaveBeenLastCalledWith("get_development_plan", {
      projectId: "pj-1", planId: "main", revision: 2,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("imports with only the Rust command fields and propagates errors", async () => {
    vi.mocked(invoke).mockResolvedValue(snapshot);
    await expect(importDevelopmentPlan("pj-1", "main", 1, "restore source")).resolves.toBe(snapshot);
    expect(invoke).toHaveBeenCalledWith("import_development_plan", {
      projectId: "pj-1", planId: "main", expectedProjectionRevision: 1,
      rollbackReason: "restore source",
    });
    vi.mocked(invoke).mockRejectedValue(new Error("projection revision conflict"));
    await expect(importDevelopmentPlan("pj-1", "main", 1)).rejects.toThrow("projection revision conflict");
  });

  it("rejects invalid JS revisions and identifiers before invoking Rust", async () => {
    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      await expect(getDevelopmentPlan("pj-1", "main", revision)).rejects.toThrow();
    }
    for (const revision of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      await expect(importDevelopmentPlan("pj-1", "main", revision)).rejects.toThrow();
    }
    await expect(getDevelopmentPlan(" ", "main")).rejects.toThrow();
    await expect(importDevelopmentPlan("pj-1", " ", 0)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a missing success envelope instead of producing an empty plan", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(getDevelopmentPlan("pj-1", "main")).rejects.toThrow(/response/);
    await expect(importDevelopmentPlan("pj-1", "main", 0)).rejects.toThrow(/response/);
  });
});

// W2-06 review K5: supervisor notices carry fixed codes only. A payload with
// an unknown kind, reason or finding (free text could carry secrets or goal
// titles) is dropped at the IPC boundary instead of reaching the UI.
describe("supervisor notification IPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function deliver(payloads: unknown[]): Promise<SupervisorNotification[]> {
    let emit: ((event: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementation(async (_name, handler) => {
      emit = handler as (event: { payload: unknown }) => void;
      return () => {};
    });
    const seen: SupervisorNotification[] = [];
    await onSupervisorNotification((notice) => seen.push(notice));
    expect(listen).toHaveBeenCalledWith("supervisor:notification", expect.any(Function));
    for (const payload of payloads) emit?.({ payload });
    return seen;
  }

  it("delivers only notices with a known kind and fixed code", async () => {
    const blocked = {
      kind: "blocked", projectId: "pj-1", rootGoalId: "g-1",
      reason: "deadline_exhausted", observedAt: 7,
    };
    const audit = {
      kind: "audit", projectId: "pj-1", finding: "unattested_supervisor_event",
      eventCursor: 3, observedAt: 7,
    };
    const degraded = { kind: "degraded", projectId: "pj-1", observedAt: 7 };
    const seen = await deliver([
      blocked,
      audit,
      degraded,
      { ...blocked, reason: "manual_hold: secret goal title" },
      { ...audit, finding: "C:\\Users\\me\\vault" },
      { kind: "restarted", projectId: "pj-1", observedAt: 7 },
      { ...blocked, projectId: "" },
      null,
    ]);
    expect(seen).toEqual([blocked, audit, degraded]);
  });

  // PR 152 review (GLM 4, Kimi 4): timestamps and cursors are integers.
  it("drops notices whose time or cursor is not a safe non-negative integer", async () => {
    const degraded = { kind: "degraded", projectId: "pj-1", observedAt: 7 };
    const audit = {
      kind: "audit", projectId: "pj-1", finding: "unattested_supervisor_event",
      eventCursor: 3, observedAt: 7,
    };
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 2 ** 53];
    const seen = await deliver([
      ...bad.map((observedAt) => ({ ...degraded, observedAt })),
      ...bad.map((eventCursor) => ({ ...audit, eventCursor })),
      { ...audit, eventCursor: 0 },
      degraded,
      audit,
    ]);
    expect(seen).toEqual([degraded, audit]);
  });

  it("accepts every listed block reason", async () => {
    const reasons = [
      "already_blocked", "deadline_exhausted", "token_allowance_unavailable",
      "token_budget_exhausted", "task_attempts_exhausted",
    ];
    const seen = await deliver(reasons.map((reason) => ({
      kind: "blocked", projectId: "pj-1", rootGoalId: "g-1", reason, observedAt: 1,
    })));
    expect(seen.map((notice) => notice.kind === "blocked" && notice.reason)).toEqual(reasons);
  });
});
