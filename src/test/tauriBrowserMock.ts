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

  // Showcase IPC (German example data, D1) for rich provider/settings/insights/review.
  get_activity: [
    {
      id: "act-1",
      createdAt: 1758600100,
      category: "worker",
      projectId: "p1",
      workerId: "w1",
      workerLabel: "OpenCode-Zustellung",
      summary: "Worker gestartet und schreibt Tests",
    },
  ],
  get_agent_env_isolation: "allowlist",
  get_budgets: [
    { profileId: "claude", fiveHourPct: 42, sevenDayPct: 18 },
    { profileId: "opencode", fiveHourPct: 11, sevenDayPct: 7 },
  ],
  get_digest_enabled: true,
  get_emergency_stop: false,
  get_free_tier_summary: {
    available: true,
    reason: null,
    pools: [
      {
        provider: "groq",
        label: "Groq Free",
        remaining: 8000,
        limit: 10000,
        remainingPercent: 80,
        resetsAt: 1758686400,
        tosStatus: "ok",
        whitelisted: true,
      },
    ],
    whitelist: ["groq"],
    observedAt: 1758600200,
  },
  get_learning_settings: {
    worker: true,
    queen: true,
    employee: true,
    scout: false,
    orchestrator: true,
  },
  get_log_path: "AppData/ProjectA/logs/projecta.log",
  get_maintenance: false,
  get_omniroute_key_sync: true,
  get_omniroute_usage: {
    online: true,
    authorized: true,
    events: [
      {
        id: "ue-1",
        ts: 1758600150,
        profileId: "opencode",
        model: "demo-modell",
        provider: "omni",
        tokensIn: 1200,
        tokensOut: 340,
        costUsd: null,
        rawJson: "{}",
      },
    ],
    today: { requests: 3, tokensIn: 2400, tokensOut: 700, costUsd: 0, priced: 0 },
    total: { requests: 40, tokensIn: 52000, tokensOut: 18000, costUsd: 0, priced: 0 },
    reportedCostUsd: null,
  },
  get_project_setup_command: "cargo test",
  get_project_skill_packs: ["pack-review", "pack-tests"],
  get_project_stats: {
    projectId: "p1",
    projectName: "Beispielprojekt",
    range: "week",
    since: 1758000000,
    generatedAt: 1758600400,
    overview: {
      workersTotal: 1,
      workersActive: 1,
      workersArchived: 0,
      byColumn: [{ key: "working", count: 1 }],
      byKind: [{ key: "worker", count: 1 }],
      needsAttention: 0,
      queue: [{ key: "failed", count: 1 }],
      queueTotal: 1,
      learningsPending: 0,
      messages: 4,
      statusEvents: 2,
      diffComments: 1,
      workersCreated: 1,
      rangeScoped: ["messages", "workersCreated"],
    },
    tokens: null,
    sessions: {
      total: 1,
      open: 1,
      ended: 0,
      totalSeconds: 0,
      medianSeconds: null,
      failed: 0,
      unknownExit: 0,
      failureRatio: null,
      recent: [],
    },
    timeline: [],
    completion: { percent: 35, components: [], workers: [], columnWeights: [] },
  },
  get_provider_overview: [
    {
      id: "claude",
      name: "Claude Code",
      kind: "subscription",
      connected: true,
      detail: "Anmeldung aktiv",
      quotaState: "ok",
      blockedUntil: null,
      omniRouteOnline: true,
      usage: {
        percent: 42,
        used: "42 %",
        limit: "100 %",
        windowLabel: "5-Stunden-Fenster",
        resetsAt: 1758686400,
        source: "api",
        observedAt: 1758600200,
      },
      vaultError: null,
    },
    {
      id: "opencode",
      name: "OpenCode",
      kind: "api_key",
      connected: true,
      detail: "Schluessel hinterlegt",
      quotaState: "ok",
      blockedUntil: null,
      omniRouteOnline: false,
      usage: {
        percent: 11,
        used: "1,1 k Tokens",
        limit: "10 k Tokens",
        windowLabel: "Tagesfenster",
        resetsAt: 1758686400,
        source: "local",
        observedAt: 1758600200,
      },
      vaultError: null,
    },
  ],
  get_reason_catalog: [
    {
      code: "quota_blocked",
      grade: "blocking",
      line: "Kontingent erreicht — warte auf das naechste Zeitfenster",
    },
  ],
  get_resource_snapshot: {
    observedAt: 1758600200,
    cpuPermille: 230,
    ramProcessBytes: 180000000,
    ramTotalBytes: 16000000000,
    diskAppBytes: 420000000,
    diskFreeBytes: 80000000000,
    tokensIn: 52000,
    tokensOut: 18000,
  },
  get_routing_status: {
    mode: "reliable",
    reviewIndependent: true,
    reviewDetail: "Review laeuft unabhaengig vom Hauptpfad",
  },
  get_setup_trust_view: {
    command: "cargo test",
    status: "granted",
    repoIdentity: "repos/beispiel-projekt",
    commandNormalized: "cargo test",
    baseSha: "abcd1234",
    inputsHash: "tree=deadbeef",
    inputFiles: ["Cargo.toml"],
    mergeTreeOid: "treeoid01",
    grantedAt: 1758500000,
  },
  get_stuck_after_minutes: 15,
  get_updater_state: { phase: "up-to-date", version: "1.6.1" },
  get_worker_diff: {
    baseBranch: "main",
    stat: "1 file changed, 2 insertions(+), 1 deletion(-)",
    code: {
      workerHeadSha: "headsha01",
      baseTipSha: "basesha01",
      mergeTreeOid: "treeoid01",
    },
    files: [
      {
        path: "src/beispiel.rs",
        oldPath: null,
        additions: 2,
        deletions: 1,
        binary: false,
        hunks: [
          {
            header: "@@ -1,2 +1,3 @@",
            lines: [
              { kind: "context", content: "fn main() {}", oldLine: 1, newLine: 1 },
              { kind: "del", content: "// alt", oldLine: 2, newLine: null },
              { kind: "add", content: "// Hinweis fuer Review", oldLine: null, newLine: 2 },
            ],
          },
        ],
      },
    ],
  },
  list_diff_comments: [
    {
      id: "dc-1",
      workerId: "w1",
      file: "src/beispiel.rs",
      line: 2,
      body: "Bitte den Hinweis auf Deutsch belassen.",
      sentToAgent: false,
      createdAt: 1758600300,
      disposition: "open",
    },
  ],
  list_skill_packs: [
    { id: "pack-review", name: "Review-Hilfen", description: "Checklisten fuer die Pruefung" },
    { id: "pack-tests", name: "Test-Muster", description: "Vorlagen fuer rote Tests zuerst" },
  ],
  "plugin:app|version": "1.6.1",
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
