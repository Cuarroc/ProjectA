import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

// The 25 commands that were unmocked across the ui-shots baseline (index
// aggregates). Rich mode must answer each without throwing so showcase views
// (provider, settings, insights, review) render data instead of raw errors.
export const RICH_SHOWCASE_COMMANDS = [
  "get_activity",
  "get_agent_env_isolation",
  "get_budgets",
  "get_digest_enabled",
  "get_emergency_stop",
  "get_free_tier_summary",
  "get_learning_settings",
  "get_log_path",
  "get_maintenance",
  "get_omniroute_key_sync",
  "get_omniroute_usage",
  "get_project_setup_command",
  "get_project_skill_packs",
  "get_project_stats",
  "get_provider_overview",
  "get_reason_catalog",
  "get_resource_snapshot",
  "get_routing_status",
  "get_setup_trust_view",
  "get_stuck_after_minutes",
  "get_updater_state",
  "get_worker_diff",
  "list_diff_comments",
  "list_skill_packs",
  "plugin:app|version",
] as const;

// PR45 screenshot fixtures: one active project with a GitHub remote, one
// running worker with test badges on the board, one queued entry with an
// error label, two agent profiles for ad-hoc terminal tabs. The empty
// browser-smoke fixtures stay the default unless the e2e page sets
// window.__PROJECTA_E2E_RICH__ before loading the app.
const RICH_RESPONSES: Readonly<Record<string, unknown>> = {
  list_agent_profiles: [
    {
      id: "claude",
      name: "Claude",
      command: "claude",
      args: ["-p"],
      env: {},
      fallback: null,
      enabled: true,
    },
    {
      id: "opencode",
      name: "OpenCode",
      command: "opencode",
      args: [],
      env: {},
      fallback: null,
      enabled: true,
    },
  ],
  list_projects: [
    {
      id: "p1",
      name: "ProjectA",
      repoPath: "C:/Users/user1/Desktop/ProjectA",
      createdAt: 1758000000,
      githubRemote: false,
      maxWorkers: null,
      testCommand: "cargo test",
    },
  ],
  list_workers: [
    {
      id: "w1",
      projectId: "p1",
      task: "W1-02 OpenCode-Zustellung durch den Launch-Pfad",
      profileId: "opencode",
      branch: "codex/w1-02-opencode-delivery",
      worktreePath: "C:/Users/user1/Desktop/.projecta-worktrees/codex-w1-02",
      sessionId: "ses-w1",
      status: "running",
      kind: "worker",
      spawnedBy: null,
      pausedReason: null,
      createdAt: 1758500000,
    },
  ],
  get_board_state: {
    cards: [
      {
        worker: {
          id: "w1",
          projectId: "p1",
          task: "W1-02 OpenCode-Zustellung durch den Launch-Pfad",
          profileId: "opencode",
          branch: "codex/w1-02-opencode-delivery",
          worktreePath: "C:/Users/user1/Desktop/.projecta-worktrees/codex-w1-02",
          sessionId: "ses-w1",
          status: "running",
          kind: "worker",
          spawnedBy: null,
          pausedReason: null,
          createdAt: 1758500000,
        },
        column: "working",
        attentionReason: null,
        attentionCode: null,
        attentionGrade: null,
        attentionObservedAt: null,
        prUrl: "https://github.com/Cuarroc/ProjectA/pull/66",
        contextUsage: { used: 42, total: 100 },
        controlledBy: null,
        testStatus: "pass",
        testedAt: 1758600000,
      },
    ],
    coordinators: [],
  },
  list_queue: [
    {
      id: "tq-1",
      projectId: "p1",
      rawText: "HQ-Stylesheet Nachzug pruefen",
      sharpenedText: "HQ-Stylesheet-Nachzug gegen docs/dev-hq/DESIGN.md pruefen",
      profileId: null,
      status: "failed",
      priority: 5,
      workerId: null,
      error: "preflight: kein freier Worker-Slot",
      createdAt: 1758550000,
    },
  ],
  get_quota_state: [
    {
      profileId: "claude",
      state: "ok",
      blockedUntil: null,
      reason: null,
      omniRouteOnline: false,
    },
    {
      profileId: "opencode",
      state: "ok",
      blockedUntil: null,
      reason: null,
      omniRouteOnline: false,
    },
  ],
  list_live_sessions: ["ses-w1"],
  get_worker_readiness: null,
  // A few lines of fake agent output with a repeated word, so a screenshot
  // of the search bar (W1-21) has something to highlight in scrollback.
  get_scrollback:
    "$ cargo test\r\n" +
    "running 12 tests\r\n" +
    "test redact::tests::keeps_prefix ... ok\r\n" +
    "test redact::tests::strips_secret ... FEHLER: assertion failed\r\n" +
    "test pty::tests::resize ... ok\r\n" +
    "test pty::tests::write_after_close ... FEHLER: broken pipe\r\n" +
    "12 tests, 2 FEHLER\r\n" +
    "$ \r\n",
  create_orchestrator: null,
};

const BOOT_RESPONSES: Readonly<Record<string, unknown>> = {
  list_agent_profiles: [],
  list_projects: [],
  list_workers: [],
  list_questions: [],
  get_board_state: { cards: [], coordinators: [] },
  get_quota_state: [],
  list_queue: [],
  list_recommendations: [],
  list_learnings: [],
  list_role_variants: [],
  get_verdict_token: "e2e-verdict-token",
  get_panic_notice: null,
  web_interface_status: null,
  list_worker_messages: [],
  list_live_sessions: [],
};

/** Resolve a mocked IPC answer; throws the same error the browser smoke uses. */
export function lookupMockResponse(command: string, rich: boolean): unknown {
  const table = rich ? { ...BOOT_RESPONSES, ...RICH_RESPONSES } : BOOT_RESPONSES;
  if (!Object.prototype.hasOwnProperty.call(table, command)) {
    throw new Error(`browser smoke: unmocked command ${command}`);
  }
  return table[command];
}

declare global {
  interface Window {
    __PROJECTA_E2E_IPC_CALLS__?: string[];
    __PROJECTA_E2E_UNKNOWN_IPC__?: string[];
    __PROJECTA_E2E_RICH__?: boolean;
  }
}

const calls: string[] = [];
const unknown: string[] = [];
window.__PROJECTA_E2E_IPC_CALLS__ = calls;
window.__PROJECTA_E2E_UNKNOWN_IPC__ = unknown;

let adHocCounter = 0;

mockWindows("main");
mockIPC(
  (command, args) => {
    calls.push(command);
    if (command === "spawn_pty") {
      adHocCounter += 1;
      void args;
      return { sessionId: `ses-adhoc-${adHocCounter}` };
    }
    if (command === "write_pty" || command === "resize_pty" || command === "kill_pty") {
      return null;
    }
    const rich = window.__PROJECTA_E2E_RICH__ === true;
    try {
      return lookupMockResponse(command, rich);
    } catch (cause) {
      unknown.push(command);
      throw cause;
    }
  },
  { shouldMockEvents: true },
);
