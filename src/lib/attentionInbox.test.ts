import { describe, expect, it } from "vitest";

import type { BoardCard, Recommendation, Worker } from "../types";
import {
  buildInbox,
  cardsToSources,
  goalForCode,
  recommendationsToSources,
  restoreToSources,
  redactPayload,
} from "./attentionInbox";
import { inQuietHours, planNotifications } from "./attentionNotify";

function worker(id: string): Worker {
  return {
    id,
    projectId: "pj-1",
    task: id,
    profileId: "codex",
    branch: `nacht/${id}`,
    worktreePath: `C:\\Users\\me\\wt\\${id}`,
    sessionId: null,
    status: "running",
    kind: "worker",
    spawnedBy: null,
    pausedReason: null,
    createdAt: 1,
  };
}

function card(id: string, code: string, grade: "blocking" | "attention" | "info"): BoardCard {
  return {
    worker: worker(id),
    column: "needs_you",
    attentionReason: "Kontingent oder Rate-Limit erreicht — warte oder wechsle das Profil",
    attentionCode: code,
    attentionGrade: grade,
    prUrl: null,
    contextUsage: null,
    controlledBy: null,
    testStatus: null,
    testedAt: null,
  };
}

describe("F3 Attention-Inbox", () => {
  it("coalesces five like worker events into one row", () => {
    const sources = cardsToSources(
      [1, 2, 3, 4, 5].map((n) => card(`wk-${n}`, "quota_blocked", "blocking")),
      10,
    );
    const inbox = buildInbox(sources);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].count).toBe(5);
    expect(inbox[0].code).toBe("quota_blocked");
    expect(inbox[0].title).toMatch(/^5 Worker:/);
    expect(inbox[0].workerIds).toHaveLength(5);
    expect(inbox[0].goal).toBe("agents");
  });

  it("sorts by grade then age, and keeps several blockers visible at once", () => {
    const inbox = buildInbox([
      {
        kind: "signal",
        workerId: "wk-info",
        projectId: "pj-1",
        code: "review_draft",
        grade: "info",
        reason: "Draft",
        observedAt: 1,
      },
      {
        kind: "signal",
        workerId: "wk-old",
        projectId: "pj-1",
        code: "quota_blocked",
        grade: "blocking",
        reason: "Quota",
        observedAt: 5,
      },
      {
        kind: "blocker",
        workerId: "wk-conflict",
        projectId: "pj-1",
        code: "conflicting",
        message: "Merge-Baum konfliktet",
        nextStep: "Konflikte im Worktree lösen",
        observedAt: 9,
      },
      {
        kind: "signal",
        workerId: "wk-new",
        projectId: "pj-1",
        code: "agent_exited",
        grade: "blocking",
        reason: "Exited",
        observedAt: 20,
      },
    ]);
    expect(inbox.map((row) => row.code)).toEqual([
      "quota_blocked",
      "conflicting",
      "agent_exited",
      "review_draft",
    ]);
    expect(inbox.filter((row) => row.grade === "blocking")).toHaveLength(3);
  });

  it("preserves the engine observation time when projecting board signals", () => {
    const old = { ...card("wk-old", "quota_blocked", "blocking"), attentionObservedAt: 5 };
    const recent = {
      ...card("wk-recent", "agent_exited", "blocking"),
      attentionObservedAt: 20,
    };

    const sources = cardsToSources([recent, old], 99);

    expect(sources.map((source) => source.observedAt)).toEqual([20, 5]);
    expect(buildInbox(sources).map((row) => row.code)).toEqual([
      "quota_blocked",
      "agent_exited",
    ]);
  });

  it("does not drop a blocker when a notification tag is dismissed", () => {
    const sources = cardsToSources([card("wk-1", "quota_blocked", "blocking")]);
    const inbox = buildInbox(sources);
    const plan = planNotifications([], inbox, {
      now: new Date("2026-09-04T12:00:00"),
      dismissedKeys: new Set([inbox[0].key]),
    });
    expect(inbox).toHaveLength(1);
    expect(plan.notifications).toHaveLength(0);
    expect(plan.badge).toBe(1);
  });

  it("opens review for merge blockers and work for a pending decision", () => {
    expect(goalForCode("decision_pending")).toBe("work");
    expect(goalForCode("conflicting")).toBe("review");
    expect(goalForCode("quota_blocked")).toBe("agents");
  });

  it("puts new recommendations on the same list", () => {
    const recos: Recommendation[] = [
      {
        id: "rc-1",
        projectId: "pj-1",
        title: "Dateiwaechter statt Polling",
        url: null,
        rationale: "weniger Last",
        effort: "S",
        status: "new",
        createdAt: 3,
      },
      {
        id: "rc-2",
        projectId: "pj-1",
        title: "alt",
        url: null,
        rationale: "weg",
        effort: null,
        status: "dismissed",
        createdAt: 1,
      },
    ];
    const inbox = buildInbox([
      ...cardsToSources([card("wk-1", "quota_blocked", "blocking")]),
      ...recommendationsToSources(recos),
    ]);
    expect(inbox.map((row) => row.source)).toEqual(["signal", "recommendation"]);
  });

  it("redacts paths and tokens in the notification body", () => {
    const plan = planNotifications(
      [],
      [
        {
          key: "signal:agent_exited",
          code: "agent_exited",
          grade: "blocking",
          count: 1,
          workerIds: ["wk-1"],
          projectId: "pj-1",
          title: "Beendet in C:\\Users\\me\\wt\\wk-1 sk-abcdefghijklmnopqrst",
          reason: null,
          nextStep: null,
          goal: "agents",
          observedAt: 1,
          source: "signal",
        },
      ],
      { now: new Date("2026-09-04T12:00:00") },
    );
    expect(plan.notifications[0].body).not.toMatch(/C:\\Users/);
    expect(plan.notifications[0].body).not.toMatch(/sk-/);
    expect(redactPayload("PA_VERDICT_TOKEN_ABC")).toBe("[redacted]");
  });

  it("suppresses toasts in quiet hours but keeps the badge", () => {
    const inbox = buildInbox(cardsToSources([card("wk-1", "quota_blocked", "blocking")]));
    const plan = planNotifications([], inbox, {
      now: new Date("2026-09-04T23:15:00"),
    });
    expect(inQuietHours(new Date("2026-09-04T23:15:00"), { startHour: 22, endHour: 8 })).toBe(
      true,
    );
    expect(plan.quiet).toBe(true);
    expect(plan.notifications).toHaveLength(0);
    expect(plan.badge).toBe(1);
  });

  it("names an exited worker as session_ended without inventing a live PTY", () => {
    const exited: Worker = {
      ...worker("wk-rest"),
      status: "exited",
      sessionId: null,
    };
    const sources = restoreToSources([exited], 10);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      kind: "signal",
      code: "session_ended",
      grade: "attention",
      workerId: "wk-rest",
    });
    expect(restoreToSources([{ ...exited, sessionId: "live" }])).toHaveLength(0);
  });
});
