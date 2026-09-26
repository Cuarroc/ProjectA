/** An agent launch profile as reported by the Rust core. */
export interface AgentProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
  /**
   * Extra environment every spawn of this profile carries. A base URL in here
   * is what makes a profile a routed one; see `isRoutedProfile`.
   */
  env: Record<string, string>;
  /**
   * The profile that takes this one's queued task while it is out of quota, or
   * `null` when a block simply means waiting. The dispatcher owns the walk.
   */
  fallback: string | null;
  /** A disabled profile stays on file but is no longer handed to new agents. */
  enabled: boolean;
}

/** A package from an imported plan projection, including retained tombstones. */
export interface DevelopmentPlanPackage {
  projectId: string;
  planId: string;
  packageId: string;
  parentId: string | null;
  sourcePath: string;
  sourceRevision: string;
  sourceLine: number;
  title: string;
  dependencyIds: string[];
  acceptance: string;
  removed: boolean;
  noNewDispatch: boolean;
}

export interface DevelopmentPlanProjection {
  projectId: string;
  planId: string;
  sourcePath: string;
  sourceRevision: string;
  projectionRevision: number;
  source: string;
  rollbackReason: string | null;
  importedAt: number;
  packages: DevelopmentPlanPackage[];
}

export interface DevelopmentPlanResponse {
  contractVersion: 1;
  availability: "available";
  generatedAt: number;
  projectId: string;
  sourceRevision: string;
  projection: DevelopmentPlanProjection;
}

/** One free pool as reported by `get_free_tier_summary`. */
export interface FreeTierPool {
  /** OmniRoute's provider id, e.g. "groq". */
  provider: string;
  /** What to show; the provider id when nothing friendlier was reported. */
  label: string;
  /** Requests or tokens left in the window, or `null` when not reported. */
  remaining: number | null;
  /** The window's ceiling, or `null` when not reported. */
  limit: number | null;
  /** How much of the pool is *left*, 0..100 — not how much is used. */
  remainingPercent: number | null;
  /** Unix seconds at which the window rolls over, or `null`. */
  resetsAt: number | null;
  /** OmniRoute's terms-of-service note, passed through as reported. */
  tosStatus: string | null;
  /** Whether the provider is in ProjectA's curated combo whitelist. */
  whitelisted: boolean;
}

/** What `get_free_tier_summary` answers, negative answers included. */
export interface FreeTierSummary {
  /** Whether `pools` carries numbers at all. */
  available: boolean;
  /** Why there are none — a missing login, an unreachable router. */
  reason: string | null;
  pools: FreeTierPool[];
  /** The curated provider ids the `projecta-free` combo may draw on. */
  whitelist: string[];
  /** Unix seconds at which this was observed. */
  observedAt: number;
}

/** Payload of `spawn_pty`. */
export interface SpawnPtyResult {
  sessionId: string;
}

/** Payload of `enhance_prompt`. */
/**
 * One thing the enhancer wants to know before it writes the prompt.
 *
 * `options` is the raw `"A, B, C"` the skill wrote, not a list: the core turns
 * it into the JSON array the Fragen tab reads, and a second parser here would
 * only be a second opinion about it.
 */
export interface EnhanceQuestion {
  question: string;
  options: string | null;
}

/**
 * What one enhance round produced. Exactly one of the two carries the answer:
 * a round that asked back has no prompt yet, and a round that wrote the prompt
 * has nothing left to ask.
 */
export interface EnhancePromptResult {
  /** The final prompt, or `null` when the enhancer asked back instead. */
  enhanced: string | null;
  questions: EnhanceQuestion[];
}

/** One answered question, on its way into the final round. */
export interface EnhanceAnswer {
  question: string;
  answer: string;
}

/** Lifecycle of a task while the dispatcher prepares and assigns it. */
export type QueueEntryStatus =
  | "queued"
  | "sharpening"
  | "ready"
  /** Claimed by the dispatcher; its worker is starting right now. */
  | "dispatching"
  | "dispatched"
  | "done"
  | "failed";

/** A task waiting for, or already assigned by, the project's dispatcher. */
export interface QueueEntry {
  id: string;
  projectId: string;
  rawText: string;
  /** Present once the Prompt-Master has prepared the task. */
  sharpenedText: string | null;
  /** `null` lets the dispatcher choose a profile. */
  profileId: string | null;
  status: QueueEntryStatus;
  priority: number;
  /** The spawned worker after dispatch, otherwise `null`. */
  workerId: string | null;
  /**
   * Why dispatching failed, written by the core's `mark_queue_failed` —
   * including preflight blockers with their repair hints. `null`/absent for
   * every entry that has not failed.
   */
  error?: string | null;
  /** Unix seconds. */
  createdAt: number;
}

/** Payload of the `pty:exit:<sessionId>` event. */
export interface PtyExitPayload {
  code: number | null;
}

/** A git repository registered with ProjectA. */
export interface Project {
  id: string;
  name: string;
  repoPath: string;
  /** Unix seconds. */
  createdAt: number;
  /** Whether the repo already has a git remote pointing at GitHub. */
  githubRemote: boolean;
  /**
   * Cap on this project's concurrently running employees; `null` uses the
   * dispatcher's own default and `0` pauses dispatch. Coordinators never count
   * against it.
   */
  maxWorkers: number | null;
  /**
   * Command the project's tests run with, or `null` when no gate is set. The
   * core detects one when the project is created; the user can change it.
   */
  testCommand: string | null;
}

/**
 * Worker lifecycle as reported by the Rust core:
 * - `running`  — an agent is attached to a live PTY session
 * - `exited`   — the agent ended on its own; the worktree is still there
 * - `archived` — the user put the worker away; the worktree is still there
 */
export type WorkerStatus = "running" | "exited" | "archived";

/**
 * What a session is for:
 * - `worker`       — an agent on one task, in its own git worktree
 * - `orchestrator` — the project's coordinator; one per project, no card
 * - `queen`        — a domain coordinator that runs employees of its own
 * - `scout`        — a research session that proposes work, it does not do it
 *
 * Everything but `worker` coordinates instead of sitting on the board.
 */
export type WorkerKind = "worker" | "orchestrator" | "queen" | "scout";

/** One agent working on a task in its own git worktree. */
export interface Worker {
  id: string;
  projectId: string;
  task: string;
  profileId: string;
  branch: string;
  worktreePath: string;
  /** Live PTY session, or `null` when nothing is attached. */
  sessionId: string | null;
  status: WorkerStatus;
  /** Ordinary worker unless the core says otherwise. */
  kind: WorkerKind;
  /** The coordinator that started this one, or `null` when a human did. */
  spawnedBy: string | null;
  /**
   * Why this worker's agent was stopped without archiving it - today only the
   * budget watcher writes it. `null` is the ordinary case. A respawn clears it.
   */
  pausedReason: string | null;
  /** Unix seconds. */
  createdAt: number;
}

/** A live (or already exited) terminal session owned by the UI. */
export interface TerminalSession {
  sessionId: string;
  profileId: string;
  profileName: string;
  /** The worker this tab is bound to, or `null` for an ad-hoc session. */
  workerId: string | null;
  /** The project the tab belongs to, or `null` for an ad-hoc session. */
  projectId: string | null;
  /** Ad-hoc tabs are ordinary sessions; only workers carry a real kind. */
  kind: WorkerKind;
  /** Tab label: a short worker task, or the profile name for ad-hoc tabs. */
  title: string;
  exited: boolean;
  exitCode: number | null;
}

/**
 * Where a worker sits on the board. The Rust core derives this from the
 * worker's own signals; the user can pin it with a manual override.
 */
export type BoardColumn = "working" | "needs_you" | "in_review" | "ready_to_merge" | "done";

/** How much of an agent's context window is spoken for. */
export interface ContextUsage {
  /** Tokens currently in the window. */
  used: number;
  /** Size of the window. Always > 0; a card without a total has no usage. */
  total: number;
}

/**
 * The coordinator behind a card. `label` arrives ready to print — the domain
 * for a queen, `"Orchestrator"` for the orchestrator, a shortened task text
 * otherwise. The UI never shortens it a second time.
 */
export interface ControlledBy {
  workerId: string;
  kind: WorkerKind;
  label: string;
}

/**
 * How the project's test command last ended for a worker. A card without a
 * status has never been tested, which is why `null` lives beside this union
 * rather than inside it.
 */
export type TestStatus = "pass" | "fail" | "running";

/** One card on the board: a worker plus the board-only facts about it. */
export interface BoardCard {
  worker: Worker;
  column: BoardColumn;
  /** Why the worker wants attention, or `null` when it does not. */
  attentionReason: string | null;
  /**
   * F1 reason-code beside the sentence. `null` when nothing is signalling.
   * F3 sorts the inbox by this, not by parsing `attentionReason`.
   */
  attentionCode: string | null;
  /** Blockadegrad of `attentionCode`, or `null` when there is no code. */
  attentionGrade: "blocking" | "attention" | "info" | null;
  /** Unix seconds when the current attention code first appeared. */
  attentionObservedAt?: number | null;
  /** Pull request opened for this worker's branch, or `null`. */
  prUrl: string | null;
  /** Context window fill, or `null` while the core has nothing to report. */
  contextUsage: ContextUsage | null;
  /** Who started this worker, or `null` when the human did. */
  controlledBy: ControlledBy | null;
  /** Last test result, or `null` when the tests have never run for it. */
  testStatus: TestStatus | null;
  /** Unix seconds of that test run, or `null` when it never ran. */
  testedAt: number | null;
}

/**
 * A coordinator of the active project, shown in the board banner rather than
 * on a column. `sessionId` is `null` once its terminal is gone.
 */
export interface CoordinatorInfo {
  workerId: string;
  kind: WorkerKind;
  label: string;
  status: WorkerStatus;
  sessionId: string | null;
}

/**
 * Whether a profile may be spawned right now:
 * - `ok`      — quota is available
 * - `blocked` — the provider is refusing; `reason` says why
 * - `unknown` — the core cannot tell, so the profile stays usable
 */
export type QuotaStatus = "ok" | "blocked" | "unknown";

/** Payload of `get_quota_state`, one entry per agent profile. */
export interface QuotaState {
  profileId: string;
  state: QuotaStatus;
  /** Unix seconds at which the block lifts, or `null` when open-ended. */
  blockedUntil: number | null;
  reason: string | null;
  /** Whether the OmniRoute fallback is reachable. */
  omniRouteOnline: boolean;
}

/**
 * One agent profile's percentage ceilings, as `get_budgets` reports them.
 *
 * The percentages are read against the provider's own rate-limit windows;
 * `null` on a window means there is no ceiling on it. A profile with no
 * ceiling at all is absent from the list rather than present with two nulls.
 */
export interface Budget {
  profileId: string;
  fiveHourPct: number | null;
  sevenDayPct: number | null;
}

/**
 * One request OmniRoute logged, as the usage ledger stores it.
 *
 * Two fields are honestly incomplete and the view must render them as such
 * rather than as zeroes - see `UsageReport`.
 */
export interface UsageEvent {
  id: string;
  /** Unix seconds, from OmniRoute's own timestamp. */
  ts: number;
  /** The profile this row could be attributed to, or `null` for most of them. */
  profileId: string | null;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  /** `null` when OmniRoute's log did not price the row, which it never does. */
  costUsd: number | null;
  /** The source line, verbatim. */
  rawJson: string;
}

/** Requests, tokens and dollars over a window of the ledger. */
export interface UsageTotals {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** How many of the counted rows carried a price at all. */
  priced: number;
}

/**
 * What OmniRoute has routed, as `get_omniroute_usage` reports it.
 *
 * Fleet-wide: OmniRoute's log is keyed by provider account and has no project
 * dimension, so there is nothing to filter by. `authorized: false` means the
 * management API is closed - no token, or one the router refused - and the
 * ledger is frozen at whatever it already held.
 */
export interface UsageReport {
  online: boolean;
  authorized: boolean;
  events: UsageEvent[];
  today: UsageTotals;
  total: UsageTotals;
  /**
   * OmniRoute's own lifetime spend. The per-request log carries tokens but no
   * price, so this is the only real dollar figure there is; it belongs beside
   * the token counts, never distributed across them.
   */
  reportedCostUsd: number | null;
}

// -- project statistics (Phase 20) -------------------------------------------

/** How far back the statistics tab looks. */
export type StatsRange = "today" | "week" | "month" | "all";

/** One label with its count: a board column, a worker kind, a queue state. */
export interface StatsLabelCount {
  key: string;
  count: number;
}

/**
 * A project's shape, as `get_project_stats` reports it.
 *
 * Mixed by design, and `rangeScoped` is what says how: the counts named in it
 * respect the selected window, everything else is a snapshot of right now. A
 * board column is a fact about the present - "wie viele Karten waren letzte
 * Woche in review" is not a question this data can answer.
 */
export interface StatsOverview {
  workersTotal: number;
  workersActive: number;
  workersArchived: number;
  byColumn: StatsLabelCount[];
  byKind: StatsLabelCount[];
  needsAttention: number;
  queue: StatsLabelCount[];
  queueTotal: number;
  learningsPending: number;
  messages: number;
  statusEvents: number;
  diffComments: number;
  workersCreated: number;
  /** The camelCase names of the fields above that respect the window. */
  rangeScoped: string[];
}

/** One profile's slice of the OmniRoute ledger. */
export interface StatsProfileTokens {
  /** `null` is the ledger's own "could not attribute", and it is common. */
  profileId: string | null;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  /** Whether a worker of this project ever ran under this profile. */
  usedByProject: boolean;
}

/**
 * What OmniRoute routed inside the window.
 *
 * Fleet-wide and not per project: the router's log carries a model, a provider
 * and sometimes a profile, but no session and no client, so a request cannot
 * be traced to a worker. The whole value is `null` when the ledger has nothing
 * for the window - see {@link ProjectStats.tokens}.
 */
export interface StatsTokenUsage {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** How many rows carried a price at all. Usually none. */
  priced: number;
  byProfile: StatsProfileTokens[];
  /** The profiles this project's workers were spawned with. */
  projectProfiles: string[];
}

/** One agent session of this project. */
export interface StatsSession {
  sessionId: string;
  workerId: string;
  task: string;
  startedAt: number;
  endedAt: number | null;
  /** Seconds, or `null` while the session is still open. */
  duration: number | null;
  /** `null` for a session that ended without the platform naming a code. */
  exitCode: number | null;
}

/** How this project's sessions went. */
export interface StatsSessions {
  total: number;
  /** Still attached, or ended in a way the app never saw. */
  open: number;
  ended: number;
  totalSeconds: number;
  medianSeconds: number | null;
  failed: number;
  unknownExit: number;
  failureRatio: number | null;
  recent: StatsSession[];
}

/** One day of the activity timeline. Quiet days are present, at zero. */
export interface StatsActivityDay {
  /** `YYYY-MM-DD` in UTC. */
  date: string;
  day: number;
  messages: number;
  statusEvents: number;
}

/** One term of the completion estimate, with the arithmetic behind it. */
export interface StatsCompletionComponent {
  /** `workers`, `queue` or `tests`. */
  key: string;
  /** Its share of the blend, over the components that had data. */
  weight: number;
  score: number;
  /** The arithmetic in words, for the tooltip. */
  detail: string;
}

/** One worker's contribution to the estimate. */
export interface StatsWorkerContribution {
  workerId: string;
  task: string;
  /** A board column, or `archived`. */
  column: string;
  weight: number;
}

/**
 * A derived percentage and everything it was derived from.
 *
 * `percent` is `null` when there is nothing to estimate from. The UI says
 * "geschätzt" beside it and never "fertig zu X %": there is no machine
 * readable plan per project, so this is an interpretation of the board, not a
 * measurement.
 */
export interface StatsCompletion {
  percent: number | null;
  components: StatsCompletionComponent[];
  workers: StatsWorkerContribution[];
  /** The core's own weighting matrix, as `[column, weight]` pairs. */
  columnWeights: Array<[string, number]>;
}

/** Everything the statistics tab shows, in one document. */
export interface ProjectStats {
  projectId: string;
  projectName: string;
  range: StatsRange;
  /** The window's first second, or `null` for `all`. */
  since: number | null;
  generatedAt: number;
  overview: StatsOverview;
  /**
   * `null` means "nicht gemessen": the OmniRoute ledger has no row for this
   * window. Deliberately not zeroes - an agent that talks to its vendor
   * directly spends tokens this app has no way of counting, so a `0` would be
   * the one number that is certainly wrong.
   */
  tokens: StatsTokenUsage | null;
  sessions: StatsSessions;
  timeline: StatsActivityDay[];
  completion: StatsCompletion;
}

/** Payload of the `worker:status` event. */
export interface WorkerStatusEvent {
  workerId: string;
  column: BoardColumn;
  attentionReason: string | null;
  attentionCode: string | null;
  attentionGrade: "blocking" | "attention" | "info" | null;
  attentionObservedAt: number | null;
}

/**
 * The fixed set of agent categories the settings manage. A category is a role
 * an agent can take; the profile is just how one of them gets started.
 */
export type AgentCategoryId = "worker" | "queen" | "employee" | "scout" | "orchestrator";

/** Per-category configuration, stored in the UI's own settings. */
export interface AgentCategoryConfig {
  id: AgentCategoryId;
  /** Whether agents of this category are offered in dialogs at all. */
  active: boolean;
  /**
   * The profile new agents of this category start with, or `null` when no
   * preference has been set (the dispatcher or user picks).
   */
  defaultProfileId: string | null;
}

/** Usage information for one provider, as reported by `get_provider_overview`. */
export interface ProviderUsage {
  /** 0..100, or `null` when no percentage is available. */
  percent: number | null;
  /** Human-readable consumption, e.g. "56,2 M Tokens", or `null`. */
  used: string | null;
  /** Human-readable limit, or `null`. */
  limit: string | null;
  /** e.g. "5-Stunden-Fenster" or "lokal — kein Kontingent". */
  windowLabel: string;
  /** Unix seconds at which the window resets, or `null`. */
  resetsAt: number | null;
  /**
   * Where the usage numbers came from. The core owns this vocabulary; a value
   * beyond the four known kinds is passed through, never relabeled.
   */
  source: "hook" | "api" | "local" | "heuristic" | (string & {});
  /** Unix seconds at which the observation was made. */
  observedAt: number;
}

/** One LLM provider as reported by `get_provider_overview`. */
export interface Provider {
  id: string;
  name: string;
  /** How the provider is authenticated. */
  kind: "subscription" | "api_key" | "local";
  /** Whether the core currently has a working connection to the provider. */
  connected: boolean;
  /** Human-readable detail line, or `null` when none. */
  detail: string | null;
  /** Whether this provider has quota / keys available. */
  quotaState: "ok" | "blocked" | "unknown";
  /** Unix seconds at which a block lifts, or `null` when open-ended / not blocked. */
  blockedUntil: number | null;
  /** Whether this provider is reachable through the OmniRoute fallback. */
  omniRouteOnline: boolean;
  /** Optional usage data for the current billing window. */
  usage: ProviderUsage | null;
  /**
   * The key vault's read error, repeated on every row; `null` when the vault
   * read cleanly. Starts with a stable code (`vault_corrupt`,
   * `vault_decrypt_failed`, `vault_unreadable`) so the UI can tell a broken
   * key store apart from "no keys stored".
   */
  vaultError: string | null;
}

/** What a diff line does to the file. */
export type DiffLineKind = "add" | "del" | "context";

/** One rendered line of a hunk, with the line numbers of both sides. */
export interface DiffLine {
  kind: DiffLineKind;
  /** Line text without the leading +/-/space marker. */
  content: string;
  /** Line number before the change, or `null` on an added line. */
  oldLine: number | null;
  /** Line number after the change, or `null` on a deleted line. */
  newLine: number | null;
}

/** One `@@ … @@` block of a file diff. */
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

/** One changed file of a worker diff. */
export interface DiffFile {
  path: string;
  /** Previous path on a rename, otherwise `null`. */
  oldPath: string | null;
  additions: number;
  deletions: number;
  /** Git prints no hunks for a binary file; the counts stay at zero too. */
  binary: boolean;
  hunks: DiffHunk[];
}

/** Payload of `get_worker_diff`: the worker's branch against its base. */
export interface WorkerDiff {
  baseBranch: string;
  files: DiffFile[];
  /** `git diff --stat` text, as the core produced it. */
  stat: string;
  /** The merge-tree tuple of this snapshot; the review verdict binds to it. */
  code: ReviewCode | null;
}

/** A review note the user pinned to one line of a worker's diff. */
export interface DiffComment {
  id: string;
  workerId: string;
  file: string;
  /** Line number in the post-change file. */
  line: number;
  body: string;
  /** Once the agent has been told, the comment can no longer be deleted. */
  sentToAgent: boolean;
  /** Unix seconds. */
  createdAt: number;
  /** `open` until the reviewer marks it `done`. */
  disposition: "open" | "done";
}

/** One merge blocker from the F4 engine — codes stay the engine vocabulary. */
export interface ReadinessBlocker {
  code: string;
  message: string;
  nextStep: string;
}

/** The merge-tree tuple a review surface is looking at. */
export interface ReviewCode {
  workerHeadSha: string;
  baseTipSha: string;
  mergeTreeOid: string;
}

/** IPC shape of `get_worker_readiness`. */
export interface WorkerReadiness {
  lifecycle: string;
  readiness: string;
  blockers: ReadinessBlocker[];
  checkedAt: number;
  ahead: number;
  behind: number;
  /** What the surface sees; sent back with the verdict. `null` = unmeasured. */
  code: ReviewCode | null;
}

/**
 * The setup-trust grant as the core expects it back on approval. Field names
 * stay snake_case: the payload is the core's `TrustGrant`, verbatim.
 */
export interface SetupTrustGrant {
  repo_identity: string;
  command_normalized: string;
  base_sha: string;
  inputs_hash: string;
}

/**
 * IPC shape of `get_setup_trust_view`: everything the person sees before
 * trusting the setup command — the shown values are exactly what the
 * approval binds.
 */
export interface SetupTrustView {
  command: string;
  status: "missing" | "mismatch" | "granted";
  repoIdentity: string;
  commandNormalized: string;
  baseSha: string;
  inputsHash: string;
  inputFiles: string[];
  /** The candidate tree this view was measured on — shown and re-checked. */
  mergeTreeOid: string;
  grantedAt: number | null;
}

/** IPC shape of `get_session_restore`. `liveSession` is never a live PTY. */
export type WorkspaceState = "present" | "missing";

export interface SessionRestore {
  liveSession: boolean;
  workspace: WorkspaceState;
  scrollback: string | null;
  draft: string | null;
  lastConfirmed: string | null;
}

/** What the worker workspace shows: its terminal, its diff, or its message history. */
export type WorkerDetailView = "terminal" | "diff" | "history";

/** Author of one message in the worker history. */
export type MessageRole = "user" | "agent" | "system";

/** One message reported by the agent's hooks or the lifecycle. */
export interface WorkerMessage {
  id: string;
  workerId: string;
  role: MessageRole;
  content: string;
  /** Unix seconds. */
  createdAt: number;
}

/** One installed skill pack, as reported by `list_skill_packs`. */
export interface SkillPack {
  id: string;
  name: string;
  description: string;
}

/**
 * Where one of the scout's suggestions stands with the user:
 * - `new`       — waiting for a verdict
 * - `accepted`  — turned into a queued task
 * - `dismissed` — the user said no
 */
export type RecommendationStatus = "new" | "accepted" | "dismissed";

/** One piece of work a scout session suggests for the project. */
export interface Recommendation {
  id: string;
  projectId: string;
  title: string;
  /** Repository or issue the suggestion came from, or `null` for free research. */
  url: string | null;
  /** The scout's verdict, in prose. */
  rationale: string;
  /** Rough size the scout put on it, or `null` when it did not say. */
  effort: string | null;
  status: RecommendationStatus;
  /** Unix seconds. */
  createdAt: number;
}

/**
 * Where one of the critic's insights stands with the user:
 * - `pending`  — waiting to be read
 * - `approved` — taken into the playbook
 * - `rejected` — the user said no
 */
export type LearningStatus = "pending" | "approved" | "rejected";

/** One insight a critic distilled from a finished run, awaiting review. */
export interface Learning {
  id: string;
  projectId: string;
  workerId: string;
  profileId: string;
  /** The pattern the critic filed it under, or `null` when it named none. */
  patternLabel: string | null;
  content: string;
  status: LearningStatus;
  /** Unix seconds. */
  createdAt: number;
}

/**
 * Where a proposed role variant stands with the user:
 * - `pending`  — waiting to be reviewed
 * - `approved` — offered as a spawnable role
 * - `rejected` — the user said no
 */
export type RoleVariantStatus = "pending" | "approved" | "rejected";

/** A curated, specialised variant of a base profile, awaiting or past review. */
export interface RoleVariant {
  id: string;
  projectId: string;
  name: string;
  baseProfileId: string;
  patternLabel: string;
  systemPromptAddition: string;
  version: number;
  status: RoleVariantStatus;
  /** Unix seconds. */
  createdAt: number;
}

/**
 * Which fleet table an activity entry came from. The core owns this
 * vocabulary; a value beyond the known kinds is passed through, never
 * relabeled — the badge falls back to the raw word.
 */
export type ActivityCategory =
  | "worker"
  | "status"
  | "message"
  | "queue"
  | "recommendation"
  | "learning"
  | "role"
  | (string & {});

/** One line of the fleet-wide activity feed, as reported by `get_activity`. */
export interface ActivityEntry {
  id: string;
  /** Unix seconds. */
  createdAt: number;
  category: ActivityCategory;
  projectId: string;
  /** The worker the entry is about, or `null` for project-level events. */
  workerId: string | null;
  /** The worker's task, shortened by the core, or `null` when there is none. */
  workerLabel: string | null;
  /** One factual line about what happened, already truncated by the core. */
  summary: string;
}

/**
 * Whether a question belongs to a running worker or was asked before there was
 * one. A `preflight` question has no terminal to answer into; its answer feeds
 * the round of prompt sharpening that asked it.
 */
export type QuestionScope = "worker" | "preflight";

/**
 * What became of a question. The three closed states are kept apart on
 * purpose: "the human chose this", "the clock ran out" and "the worker had too
 * many open already" are different facts about a decision, and the view must
 * not fold them back together.
 */
export type QuestionStatus = "open" | "answered" | "expired" | "refused";

/**
 * Who closed a question, when somebody did.
 *
 * `"human"` is the only value that is evidence: it means the answer came
 * through the window, which no agent can reach. `"unverified"` means a caller
 * answered over the API or `pa answer` without the verdict token — which looks
 * exactly the same whether it was a person at a terminal or the asking agent
 * itself, so it claims nothing more than that.
 */
export type AnsweredBy = "human" | "unverified";

/** One blocking decision an agent handed back, as reported by the core. */
export interface Question {
  id: string;
  projectId: string;
  /** `null` on a `preflight` question: it is asked before there is a worker. */
  workerId: string | null;
  scope: QuestionScope;
  question: string;
  /**
   * The offered answers as the asker wrote them: a JSON array in a string, or
   * `null` when none were offered. Text rather than an array because the core
   * never reads it; a string that will not parse means "no options", not a
   * broken question.
   */
  optionsJson: string | null;
  status: QuestionStatus;
  /** The answer text, present on every closed row — automatic ones included. */
  answer: string | null;
  /** Unix seconds. */
  createdAt: number;
  answeredAt: number | null;
  /**
   * `null` when nobody answered: the row is still open, or the clock or the
   * budget rule closed it. This one field is where the "who" comes from — the
   * status says what happened, never who.
   */
  answeredBy: AnsweredBy | null;
  /** When the clock answers for the human. `null` on a row that never waited. */
  expiresAt: number | null;
}
