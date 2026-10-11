import { describe, expect, it } from "vitest";
import type { TerminalSession } from "../types";
import { initialSessionState, sessionReducer, type SessionState } from "./sessionReducer";

function tab(sessionId: string, workerId: string | null = null): TerminalSession {
  return {
    sessionId,
    profileId: "profile-1",
    profileName: "Profile",
    workerId,
    projectId: workerId === null ? null : "project-1",
    kind: "worker",
    title: `tab ${sessionId}`,
    exited: false,
    exitCode: null,
  };
}

/** Tabs a, b, c, ... in order, focus on `active`, optional open split. */
function stateOf(ids: string[], active: string | null, split?: string, primary = true): SessionState {
  return {
    ...initialSessionState,
    sessions: ids.map((id) => tab(id)),
    activeSessionId: active,
    splitOpen: split !== undefined,
    splitSessionId: split ?? null,
    splitPrimary: primary,
  };
}

function ids(state: SessionState): string[] {
  return state.sessions.map((session) => session.sessionId);
}

describe("sessionReducer", () => {
  it("opens a new worker tab and focuses it and clears the restore view", () => {
    const before = { ...stateOf(["a"], "a"), restoreWorkerId: "w-old" };
    const after = sessionReducer(before, { type: "openWorker", session: tab("b", "w-b") });
    expect(ids(after)).toEqual(["a", "b"]);
    expect(after.activeSessionId).toBe("b");
    expect(after.restoreWorkerId).toBeNull();
  });

  it("focuses an already open worker tab without a duplicate", () => {
    const before = stateOf(["a", "b"], "a");
    const after = sessionReducer(before, { type: "openWorker", session: tab("b", "w-b") });
    expect(ids(after)).toEqual(["a", "b"]);
    expect(after.activeSessionId).toBe("b");
  });

  it("opening the split worker swaps focus instead of showing it twice", () => {
    const after = sessionReducer(stateOf(["a", "b"], "a", "b"), {
      type: "openWorker",
      session: tab("b", "w-b"),
    });
    expect([after.activeSessionId, after.splitSessionId, after.splitPrimary]).toEqual(["b", "a", false]);
  });

  it("opens an ad-hoc tab at the end and focuses it", () => {
    const after = sessionReducer(stateOf(["a"], "a"), { type: "openAdHoc", session: tab("x") });
    expect(ids(after)).toEqual(["a", "x"]);
    expect(after.activeSessionId).toBe("x");
  });

  it("select of the other split column only swaps focus", () => {
    const after = sessionReducer(stateOf(["a", "b", "c"], "a", "c"), {
      type: "select",
      sessionId: "c",
    });
    expect(after.activeSessionId).toBe("c");
    expect(after.splitSessionId).toBe("a");
    expect(after.splitPrimary).toBe(false);
  });

  it("drop of the focused tab focuses the right neighbour", () => {
    const after = sessionReducer(stateOf(["a", "b", "c"], "b"), { type: "drop", sessionId: "b" });
    expect(ids(after)).toEqual(["a", "c"]);
    expect(after.activeSessionId).toBe("c");
  });

  it("drop of the last focused tab focuses the left neighbour", () => {
    const after = sessionReducer(stateOf(["a", "b", "c"], "c"), { type: "drop", sessionId: "c" });
    expect(ids(after)).toEqual(["a", "b"]);
    expect(after.activeSessionId).toBe("b");
  });

  it("drop of the split column session closes the split", () => {
    const after = sessionReducer(stateOf(["a", "b", "c"], "a", "c", false), {
      type: "drop",
      sessionId: "c",
    });
    expect(after.activeSessionId).toBe("a");
    expect(after.splitOpen).toBe(false);
    expect(after.splitSessionId).toBeNull();
    expect(after.splitPrimary).toBe(true);
  });

  it("drop that leaves fewer than two tabs closes the split", () => {
    const after = sessionReducer(stateOf(["a", "b"], "a", "b"), { type: "drop", sessionId: "a" });
    expect(ids(after)).toEqual(["b"]);
    expect(after.activeSessionId).toBe("b");
    expect(after.splitOpen).toBe(false);
    expect(after.splitSessionId).toBeNull();
  });

  it("drop of the focused tab never moves focus onto the split session", () => {
    const after = sessionReducer(stateOf(["a", "b", "c"], "b", "c"), { type: "drop", sessionId: "b" });
    expect(after.activeSessionId).toBe("a");
    expect(after.splitSessionId).toBe("c");
    expect(after.splitOpen).toBe(true);
  });

  it("toggleSplit opens on the right neighbour", () => {
    const after = sessionReducer(stateOf(["a", "b", "c"], "b"), { type: "toggleSplit" });
    expect(after.splitOpen).toBe(true);
    expect(after.splitSessionId).toBe("c");
    expect(after.activeSessionId).toBe("b");
    expect(after.splitPrimary).toBe(true);
  });

  it("toggleSplit falls back to the left neighbour on the last tab", () => {
    const after = sessionReducer(stateOf(["a", "b", "c"], "c"), { type: "toggleSplit" });
    expect(after.splitOpen).toBe(true);
    expect(after.splitSessionId).toBe("b");
  });

  it("toggleSplit closes an open split and resets the side", () => {
    const after = sessionReducer(stateOf(["a", "b"], "a", "b", false), { type: "toggleSplit" });
    expect([after.splitOpen, after.splitSessionId, after.splitPrimary]).toEqual([false, null, true]);
    expect(ids(after)).toEqual(["a", "b"]);
  });

  it("a session is never in both columns after any step", () => {
    let state = stateOf(["a", "b", "c", "d"], "b");
    const steps = [
      { type: "toggleSplit" },
      { type: "drop", sessionId: "b" },
      { type: "select", sessionId: "c" },
      { type: "openWorker", session: tab("a", "w-a") },
      { type: "drop", sessionId: "a" },
    ] as const;
    for (const step of steps) {
      state = sessionReducer(state, step);
      if (state.splitOpen) expect(state.splitSessionId).not.toBe(state.activeSessionId);
    }
    expect(state.activeSessionId).toBe("d");
  });

  it("showRestore remembers the worker without touching the tabs", () => {
    const before = stateOf(["a"], "a");
    const after = sessionReducer(before, { type: "showRestore", workerId: "w-9" });
    expect(after.restoreWorkerId).toBe("w-9");
    expect(after.sessions).toBe(before.sessions);
  });

  it("markExited sets the code without removing the tab", () => {
    const after = sessionReducer(stateOf(["a", "b"], "a"), {
      type: "markExited",
      sessionId: "b",
      code: 137,
    });
    expect(ids(after)).toEqual(["a", "b"]);
    expect(after.sessions[1].exited).toBe(true);
    expect(after.sessions[1].exitCode).toBe(137);
  });

});
