import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { isBoardColumn } from "./board";
import type {
  ActivityEntry,
  AgentProfile,
  AnsweredBy,
  BoardCard,
  BoardColumn,
  Budget,
  ContextUsage,
  ControlledBy,
  CoordinatorInfo,
  DiffComment,
  DiffFile,
  DiffHunk,
  DiffLine,
  DiffLineKind,
  DevelopmentPlanResponse,
  EnhanceAnswer,
  EnhancePromptResult,
  FreeTierSummary,
  Learning,
  LearningStatus,
  Project,
  ProjectStats,
  Provider,
  ProviderUsage,
  PtyExitPayload,
  Question,
  QuestionScope,
  QuestionStatus,
  QueueEntry,
  QuotaState,
  QuotaStatus,
  Recommendation,
  RecommendationStatus,
  RoleVariant,
  RoleVariantStatus,
  SetupTrustGrant,
  SetupTrustView,
  SkillPack,
  SpawnPtyResult,
  StatsActivityDay,
  StatsCompletion,
  StatsLabelCount,
  StatsProfileTokens,
  StatsRange,
  StatsSession,
  StatsSessions,
  StatsTokenUsage,
  TestStatus,
  UsageEvent,
  UsageReport,
  UsageTotals,
  Worker,
  WorkerDiff,
  WorkerKind,
  WorkerReadiness,
  WorkerStatus,
  MessageRole,
  WorkerMessage,
  WorkerStatusEvent,
  SessionRestore,
} from "../types";

function requirePlanId(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
}

function requirePlanRevision(value: number, field: string, positive: boolean): void {
  if (!Number.isSafeInteger(value) || (positive ? value < 1 : value < 0)) {
    throw new Error(`${field} must be ${positive ? "a positive" : "a non-negative"} safe integer`);
  }
}

function requirePlanResponse(value: DevelopmentPlanResponse): DevelopmentPlanResponse {
  if (!value || value.contractVersion !== 1 || value.availability !== "available" ||
      !value.projection || !Array.isArray(value.projection.packages)) {
    throw new Error("development plan response is unavailable or malformed");
  }
  return value;
}

export async function getDevelopmentPlan(
  projectId: string, planId: string, revision?: number,
): Promise<DevelopmentPlanResponse> {
  requirePlanId(projectId, "projectId");
  requirePlanId(planId, "planId");
  if (revision !== undefined) requirePlanRevision(revision, "revision", true);
  return requirePlanResponse(await invoke<DevelopmentPlanResponse>("get_development_plan", {
    projectId, planId, revision: revision ?? null,
  }));
}

export async function importDevelopmentPlan(
  projectId: string, planId: string, expectedProjectionRevision: number,
  rollbackReason?: string,
): Promise<DevelopmentPlanResponse> {
  requirePlanId(projectId, "projectId");
  requirePlanId(planId, "planId");
  requirePlanRevision(expectedProjectionRevision, "expectedProjectionRevision", false);
  return requirePlanResponse(await invoke<DevelopmentPlanResponse>("import_development_plan", {
    projectId, planId, expectedProjectionRevision, rollbackReason: rollbackReason ?? null,
  }));
}

/**
 * Thin, typed wrappers around the Rust core's IPC surface. Argument names must
 * match the Tauri command signatures exactly.
 */

interface RawAgentProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string> | null;
  fallback?: string | null;
  enabled?: boolean | null;
}

/**
 * A core that predates the enabled flag reports profiles without it. Treating
 * those as switched off would silently empty the roster, so absence means on.
 * `env` and `fallback` are younger still, and both read as "none" when absent.
 */
export async function listAgentProfiles(): Promise<AgentProfile[]> {
  const raw = await invoke<RawAgentProfile[]>("list_agent_profiles");
  if (!Array.isArray(raw)) return [];
  return raw.map((profile) => ({
    ...profile,
    env: profile.env ?? {},
    fallback: profile.fallback ?? null,
    enabled: profile.enabled ?? true,
  }));
}

export async function spawnPty(args: {
  profileId: string;
  cwd?: string;
  cols: number;
  rows: number;
}): Promise<string> {
  const result = await invoke<SpawnPtyResult>("spawn_pty", {
    profileId: args.profileId,
    cwd: args.cwd,
    cols: args.cols,
    rows: args.rows,
  });
  return result.sessionId;
}

export function writePty(sessionId: string, data: string): Promise<void> {
  return invoke<void>("write_pty", { sessionId, data });
}

export function resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("resize_pty", { sessionId, cols, rows });
}

export function killPty(sessionId: string): Promise<void> {
  return invoke<void>("kill_pty", { sessionId });
}

export function getScrollback(sessionId: string): Promise<string> {
  return invoke<string>("get_scrollback", { sessionId });
}

interface RawSessionRestore {
  liveSession?: boolean | null;
  live_session?: boolean | null;
  workspace?: string | null;
  scrollback?: string | null;
  draft?: string | null;
  lastConfirmed?: string | null;
  last_confirmed?: string | null;
}

/**
 * Scrollback and draft after a crash or exit. The command never spawns, and
 * the UI must not treat the result as a live PTY even if a field were wrong.
 */
export async function getSessionRestore(workerId: string): Promise<SessionRestore> {
  const raw = await invoke<RawSessionRestore>("get_session_restore", { workerId });
  const live = raw.liveSession ?? raw.live_session ?? false;
  return {
    liveSession: live === true,
    workspace: raw.workspace === "missing" ? "missing" : "present",
    scrollback: nonEmpty(raw.scrollback),
    draft: nonEmpty(raw.draft),
    lastConfirmed: nonEmpty(raw.lastConfirmed ?? raw.last_confirmed),
  };
}

// -- projects (Phase 2) ------------------------------------------------------

/** A project as it comes off the wire, before the test gate is settled. */
type RawProject = Omit<Project, "testCommand" | "maxWorkers"> & {
  testCommand?: string | null;
  maxWorkers?: number | null;
};

/**
 * A project from a core that knows nothing about test gates simply has none —
 * the board must not grow a Tests button on a guess. A missing worker cap is
 * read the same way: absent means "no project-owned limit", never zero.
 */
function toProject(raw: RawProject): Project {
  return {
    ...raw,
    maxWorkers: raw.maxWorkers ?? null,
    testCommand: nonEmpty(raw.testCommand),
  };
}

export async function createProject(name: string, repoPath: string): Promise<Project> {
  return toProject(await invoke<RawProject>("create_project", { name, repoPath }));
}

export async function listProjects(): Promise<Project[]> {
  const raw = await invoke<RawProject[]>("list_projects");
  return Array.isArray(raw) ? raw.map(toProject) : [];
}

/** Forgets the project and archives its workers; nothing is deleted from disk. */
export function removeProject(id: string): Promise<void> {
  return invoke<void>("remove_project", { id });
}

// -- github (Phase GH) --------------------------------------------------------

/**
 * Creates a new GitHub repository for the project and links it as `origin`.
 * Resolves with the repository URL; failures come back as plain error strings.
 */
export function createGithubRepo(args: {
  projectId: string;
  name: string;
  private: boolean;
}): Promise<string> {
  return invoke<string>("create_github_repo", {
    projectId: args.projectId,
    name: args.name,
    private: args.private,
  });
}

/** Links an existing GitHub repository as the project's remote. */
export function linkGithubRemote(projectId: string, url: string): Promise<void> {
  return invoke<void>("link_github_remote", { projectId, url });
}

// -- workers (Phase 2) -------------------------------------------------------

/** A worker as it comes off the wire, before `kind` is settled. */
type RawWorker = Omit<Worker, "kind" | "spawnedBy" | "pausedReason"> & {
  kind?: string | null;
  spawnedBy?: string | null;
  pausedReason?: string | null;
};

/** Every kind the UI can render. Anything else falls back to `worker`. */
const WORKER_KINDS: ReadonlySet<string> = new Set<WorkerKind>([
  "worker",
  "orchestrator",
  "queen",
  "scout",
]);

function toWorkerKind(value: string | null | undefined): WorkerKind {
  return typeof value === "string" && WORKER_KINDS.has(value)
    ? (value as WorkerKind)
    : "worker";
}

/**
 * A worker without a `kind` is an ordinary worker — an unrecognised one must
 * never disappear from the board by being mistaken for a coordinator, which
 * the board keeps off its columns.
 */
function toWorker(raw: RawWorker): Worker {
  return {
    ...raw,
    kind: toWorkerKind(raw.kind),
    spawnedBy: raw.spawnedBy ?? null,
    pausedReason: raw.pausedReason ?? null,
  };
}

/**
 * `roleVariantId` is opt-in: a plain spawn must reach the core exactly as it
 * did before variants existed, so the key is only added when one was picked.
 */
export async function createWorker(args: {
  projectId: string;
  task: string;
  profileId: string;
  roleVariantId?: string;
}): Promise<Worker> {
  return toWorker(
    await invoke<RawWorker>("create_worker", {
      projectId: args.projectId,
      task: args.task,
      profileId: args.profileId,
      ...(args.roleVariantId === undefined ? {} : { roleVariantId: args.roleVariantId }),
    }),
  );
}

/** Every worker, or only those of `projectId`. */
export async function listWorkers(projectId?: string): Promise<Worker[]> {
  const raw = await invoke<RawWorker[]>("list_workers", { projectId });
  return Array.isArray(raw) ? raw.map(toWorker) : [];
}

/** Verified download followed by the backend's atomic session admission gate. */
export async function installUpdateWhenIdle(updateRid: number): Promise<void> {
  await invoke("install_update_when_idle", { updateRid });
}

/**
 * Owned session ids, including reserved and starting processes. Unavailable or
 * malformed inventory must reject: it cannot authorize an idle update.
 */
export async function listLiveSessions(): Promise<string[]> {
  const raw: unknown = await invoke("list_live_sessions");
  if (!Array.isArray(raw) || !raw.every((id): id is string => typeof id === "string" && id.length > 0)) {
    throw new Error("Invalid session inventory; update safety is unavailable");
  }
  return raw;
}

/** Kills the agent, keeps the worktree. Returns the updated worker. */
export async function archiveWorker(workerId: string): Promise<Worker> {
  return toWorker(await invoke<RawWorker>("archive_worker", { workerId }));
}

/** Attaches a fresh agent to an existing worktree. Returns the updated worker. */
export async function respawnWorker(workerId: string): Promise<Worker> {
  return toWorker(await invoke<RawWorker>("respawn_worker", { workerId }));
}

// -- test gate (Phase 12) ----------------------------------------------------

/**
 * Runs the project's test command in the worker's worktree. Resolves once the
 * run is over; the card's new test status arrives with the next board fetch.
 */
export async function runWorkerTests(workerId: string): Promise<Worker> {
  return toWorker(await invoke<RawWorker>("run_worker_tests", { workerId }));
}

/** Sets the project's test command, or drops the gate entirely with `null`. */
export function setProjectTestCommand(
  projectId: string,
  command: string | null,
): Promise<void> {
  return invoke<void>("set_project_test_command", { projectId, command });
}

// -- dispatcher (Phase 9) ----------------------------------------------------

/**
 * Sets the project's cap on concurrently running employees.
 *
 * `null` means "no project-owned limit, use the dispatcher's default" — it is
 * emphatically not the same as `0`, and callers must not fold one into the
 * other. The core reads the cap on every sweep, so a change lands without a
 * restart; coordinators never count against it.
 */
export function setProjectMaxWorkers(
  projectId: string,
  maxWorkers: number | null,
): Promise<void> {
  return invoke<void>("set_project_max_workers", { projectId, maxWorkers });
}

// -- merge (Phase 13) --------------------------------------------------------

/**
 * Merges the worker's branch and archives it. Whether that goes through a
 * GitHub PR or a local merge is the core's call; the caller only says whether
 * the worktree should be dropped afterwards. Rejects with the raw git/gh
 * output, which the merge dialog shows verbatim.
 */
export async function mergeWorker(workerId: string, removeWorktree: boolean): Promise<Worker> {
  return toWorker(await invoke<RawWorker>("merge_worker", { workerId, removeWorktree }));
}

// -- orchestrator (Phase 4) --------------------------------------------------

/**
 * The project's orchestrator session. Idempotent per project: if one is
 * already running, the core hands that one back instead of starting a second.
 */
export async function createOrchestrator(projectId: string): Promise<Worker> {
  return toWorker(await invoke<RawWorker>("create_orchestrator", { projectId }));
}

/**
 * Hands a prompt to the project's orchestrator. Find-or-create lives in the
 * core, so the returned worker is the orchestrator the text actually went to —
 * an existing one or a freshly started one.
 */
export async function sendToOrchestrator(projectId: string, text: string): Promise<Worker> {
  return toWorker(await invoke<RawWorker>("send_to_orchestrator", { projectId, text }));
}

// -- board (Phase 3) ---------------------------------------------------------

interface RawContextUsage {
  used?: number | null;
  total?: number | null;
}

/**
 * The board entry as it comes off the wire. The Rust core serialises structs as
 * camelCase, but the board payload is assembled by hand, so accept either
 * spelling for the board-only fields rather than betting on one.
 */
interface RawBoardCard {
  worker: RawWorker;
  column: string;
  attention_reason?: string | null;
  attentionReason?: string | null;
  attention_code?: string | null;
  attentionCode?: string | null;
  attention_grade?: string | null;
  attentionGrade?: string | null;
  attention_observed_at?: number | null;
  attentionObservedAt?: number | null;
  pr_url?: string | null;
  prUrl?: string | null;
  context_usage?: RawContextUsage | null;
  contextUsage?: RawContextUsage | null;
  controlled_by?: RawControlledBy | null;
  controlledBy?: RawControlledBy | null;
  test_status?: string | null;
  testStatus?: string | null;
  tested_at?: number | null;
  testedAt?: number | null;
}

/** The coordinator reference on a card, and the shared half of a banner entry. */
interface RawControlledBy {
  worker_id?: string | null;
  workerId?: string | null;
  kind?: string | null;
  label?: string | null;
}

interface RawCoordinatorInfo extends RawControlledBy {
  status?: string | null;
  session_id?: string | null;
  sessionId?: string | null;
}

interface RawBoardState {
  cards?: RawBoardCard[] | null;
  coordinators?: RawCoordinatorInfo[] | null;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * A half-filled or nonsensical usage payload renders worse than none at all,
 * so anything that is not two usable numbers collapses to `null`.
 */
function toContextUsage(raw: RawContextUsage | null | undefined): ContextUsage | null {
  if (!raw) return null;
  const { used, total } = raw;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return null;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return null;
  return { used, total };
}

/**
 * A controller without an id or a label cannot be rendered as anything but a
 * blank chip, so a half-filled payload collapses to "started by the user".
 */
function toControlledBy(raw: RawControlledBy | null | undefined): ControlledBy | null {
  if (!raw) return null;
  const workerId = nonEmpty(raw.workerId ?? raw.worker_id);
  const label = nonEmpty(raw.label);
  if (workerId === null || label === null) return null;
  return { workerId, kind: toWorkerKind(raw.kind), label };
}

/**
 * A coordinator the core still reports is present; an unrecognised status must
 * not paint it as dead, so anything unknown reads as running.
 */
function toWorkerStatus(value: string | null | undefined): WorkerStatus {
  return value === "exited" || value === "archived" ? value : "running";
}

function toCoordinatorInfo(raw: RawCoordinatorInfo): CoordinatorInfo | null {
  const base = toControlledBy(raw);
  if (base === null) return null;
  return {
    ...base,
    status: toWorkerStatus(raw.status),
    sessionId: nonEmpty(raw.sessionId ?? raw.session_id),
  };
}

/** Every result the badge can paint. Anything else reads as "never ran". */
const TEST_STATUSES: ReadonlySet<string> = new Set<TestStatus>(["pass", "fail", "running"]);

/**
 * An unknown verdict must not be painted as a pass or a fail, so it collapses
 * to "never ran" — the same thing a card without the field at all shows.
 */
function toTestStatus(value: string | null | undefined): TestStatus | null {
  return typeof value === "string" && TEST_STATUSES.has(value) ? (value as TestStatus) : null;
}

/** A timestamp is only worth printing when it is a usable Unix second. */
function toTimestamp(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Every grade F3 can sort on. Anything else is treated as missing. */
const ATTENTION_GRADES: ReadonlySet<string> = new Set(["blocking", "attention", "info"]);

function toAttentionGrade(
  value: string | null | undefined,
): "blocking" | "attention" | "info" | null {
  return typeof value === "string" && ATTENTION_GRADES.has(value)
    ? (value as "blocking" | "attention" | "info")
    : null;
}

function toBoardCard(raw: RawBoardCard): BoardCard {
  return {
    worker: toWorker(raw.worker),
    // An unknown column must not swallow the worker: park it in the first one.
    column: isBoardColumn(raw.column) ? raw.column : "working",
    attentionReason: nonEmpty(raw.attentionReason ?? raw.attention_reason),
    attentionCode: nonEmpty(raw.attentionCode ?? raw.attention_code),
    attentionGrade: toAttentionGrade(raw.attentionGrade ?? raw.attention_grade),
    attentionObservedAt: toTimestamp(
      raw.attentionObservedAt ?? raw.attention_observed_at,
    ),
    prUrl: nonEmpty(raw.prUrl ?? raw.pr_url),
    contextUsage: toContextUsage(raw.contextUsage ?? raw.context_usage),
    controlledBy: toControlledBy(raw.controlledBy ?? raw.controlled_by),
    testStatus: toTestStatus(raw.testStatus ?? raw.test_status),
    testedAt: toTimestamp(raw.testedAt ?? raw.tested_at),
  };
}

/** The cards of a board plus the coordinators that stand above them. */
export interface BoardStateResult {
  cards: BoardCard[];
  coordinators: CoordinatorInfo[];
}

/** The whole board, or only the cards of `projectId`. */
export async function getBoardState(projectId?: string): Promise<BoardStateResult> {
  const raw = await invoke<RawBoardState | RawBoardCard[]>("get_board_state", { projectId });
  // The command used to answer with a bare card array. Keeping that shape
  // working costs one branch and keeps the board alive against an older core.
  const cards = Array.isArray(raw) ? raw : (raw?.cards ?? []);
  const coordinators = Array.isArray(raw) ? [] : (raw?.coordinators ?? []);
  return {
    cards: cards.map(toBoardCard),
    coordinators: coordinators.map(toCoordinatorInfo).filter(isPresent),
  };
}

/** Pins a worker to a column, or clears the pin with `null`. */
export function setWorkerColumnOverride(
  workerId: string,
  column: BoardColumn | null,
): Promise<void> {
  return invoke<void>("set_worker_column_override", { workerId, column });
}

// -- quota (Phase 3.6) -------------------------------------------------------

interface RawQuotaState {
  profileId?: string | null;
  profile_id?: string | null;
  state?: string | null;
  blockedUntil?: number | null;
  blocked_until?: number | null;
  reason?: string | null;
  omniRouteOnline?: boolean | null;
  omni_route_online?: boolean | null;
}

function toQuotaStatus(value: string | null | undefined): QuotaStatus {
  // Anything the core has not taught us about must stay usable, not blocked.
  return value === "ok" || value === "blocked" ? value : "unknown";
}

function toQuotaState(raw: RawQuotaState): QuotaState | null {
  const profileId = nonEmpty(raw.profileId ?? raw.profile_id);
  if (profileId === null) return null;
  const blockedUntil = raw.blockedUntil ?? raw.blocked_until ?? null;
  return {
    profileId,
    state: toQuotaStatus(raw.state),
    blockedUntil:
      typeof blockedUntil === "number" && Number.isFinite(blockedUntil) ? blockedUntil : null,
    reason: nonEmpty(raw.reason),
    omniRouteOnline: (raw.omniRouteOnline ?? raw.omni_route_online) === true,
  };
}

/** Per-profile spawn availability, plus the OmniRoute reachability flag. */
export async function getQuotaState(): Promise<QuotaState[]> {
  const raw = await invoke<RawQuotaState[]>("get_quota_state");
  if (!Array.isArray(raw)) return [];
  return raw.map(toQuotaState).filter((entry): entry is QuotaState => entry !== null);
}

// -- budgets (Phase 18) ------------------------------------------------------

interface RawBudget {
  profileId?: string | null;
  profile_id?: string | null;
  fiveHourPct?: number | null;
  five_hour_pct?: number | null;
  sevenDayPct?: number | null;
  seven_day_pct?: number | null;
}

/** A percentage the core could not have meant is read as "no ceiling". */
function toPercent(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : null;
}

function toBudget(raw: RawBudget): Budget | null {
  const profileId = raw.profileId ?? raw.profile_id;
  if (typeof profileId !== "string" || profileId === "") return null;
  return {
    profileId,
    fiveHourPct: toPercent(raw.fiveHourPct ?? raw.five_hour_pct),
    sevenDayPct: toPercent(raw.sevenDayPct ?? raw.seven_day_pct),
  };
}

/** The percentage ceilings per profile; a profile without one is absent. */
export async function getBudgets(): Promise<Budget[]> {
  const raw = await invoke<RawBudget[]>("get_budgets");
  if (!Array.isArray(raw)) return [];
  return raw.map(toBudget).filter(isPresent);
}

/**
 * Writes one profile's ceilings and answers with what is stored afterwards.
 * `null` on a window removes its ceiling; both windows are always sent, so
 * what comes back is exactly what the form said.
 */
export async function setBudget(
  profileId: string,
  fiveHourPct: number | null,
  sevenDayPct: number | null,
): Promise<Budget> {
  const stored = await invoke<RawBudget>("set_budget", {
    profileId,
    fiveHourPct,
    sevenDayPct,
  });
  return (
    toBudget(stored ?? {}) ?? { profileId, fiveHourPct: null, sevenDayPct: null }
  );
}

// -- daily digests (Phase 18) ------------------------------------------------

/** The days this project has a digest for, newest first. */
export async function listDigests(projectId: string): Promise<string[]> {
  const raw = await invoke<string[]>("list_digests", { projectId });
  return Array.isArray(raw) ? raw.filter((date): date is string => typeof date === "string") : [];
}

/** One day's digest as Markdown, or `null` when that day has no page. */
export async function getDigest(projectId: string, date: string): Promise<string | null> {
  const raw = await invoke<string | null>("get_digest", { projectId, date });
  return typeof raw === "string" ? raw : null;
}

/** Whether the hourly digest writer runs at all. On unless switched off. */
export async function getDigestEnabled(): Promise<boolean> {
  return (await invoke<boolean>("get_digest_enabled")) !== false;
}

export function setDigestEnabled(enabled: boolean): Promise<void> {
  return invoke<void>("set_digest_enabled", { enabled });
}

// -- stuck diagnosis (Phase 18) ----------------------------------------------

/**
 * After how many quiet minutes a running worker is called stuck, or `null`
 * when the core's own default applies. Quiet means both channels at once: no
 * terminal output and no change in the worktree.
 */
export async function getStuckAfterMinutes(): Promise<number | null> {
  const raw = await invoke<number | null>("get_stuck_after_minutes");
  return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}

/** Sets that threshold; `null` puts the core's default back. */
export function setStuckAfterMinutes(minutes: number | null): Promise<void> {
  return invoke<void>("set_stuck_after_minutes", { minutes });
}

export type ProductMode = "reliable" | "cheap" | "review";

export interface RoutingStatus {
  mode: ProductMode;
  reviewIndependent: boolean;
  reviewDetail: string;
}

export async function getRoutingStatus(): Promise<RoutingStatus> {
  const raw = await invoke<RoutingStatus>("get_routing_status");
  const mode =
    raw?.mode === "reliable" || raw?.mode === "cheap" || raw?.mode === "review"
      ? raw.mode
      : "cheap";
  return {
    mode,
    reviewIndependent: Boolean(raw?.reviewIndependent),
    reviewDetail: typeof raw?.reviewDetail === "string" ? raw.reviewDetail : "",
  };
}

export function setProductMode(mode: ProductMode): Promise<void> {
  return invoke<void>("set_product_mode", { mode });
}

export interface ResourceSnapshot {
  observedAt: number;
  cpuPermille: number | null;
  ramProcessBytes: number | null;
  ramTotalBytes: number | null;
  diskAppBytes: number | null;
  diskFreeBytes: number | null;
  tokensIn: number;
  tokensOut: number;
}

function optionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** F5 baseline: CPU/RAM/disk plus OmniRoute token totals. Missing is not zero. */
export async function getResourceSnapshot(): Promise<ResourceSnapshot> {
  const raw = await invoke<Record<string, unknown>>("get_resource_snapshot");
  return {
    observedAt: typeof raw?.observedAt === "number" ? raw.observedAt : 0,
    cpuPermille: optionalCount(raw?.cpuPermille),
    ramProcessBytes: optionalCount(raw?.ramProcessBytes),
    ramTotalBytes: optionalCount(raw?.ramTotalBytes),
    diskAppBytes: optionalCount(raw?.diskAppBytes),
    diskFreeBytes: optionalCount(raw?.diskFreeBytes),
    tokensIn: typeof raw?.tokensIn === "number" ? raw.tokensIn : 0,
    tokensOut: typeof raw?.tokensOut === "number" ? raw.tokensOut : 0,
  };
}

/** Settings: wipe every persisted scrollback and draft. */
export function deleteSessionBuffers(): Promise<number> {
  return invoke<number>("delete_session_buffers");
}

export interface PanicNotice {
  current: string | null;
  previous: string | null;
}

export interface ReasonExplanation {
  code: string;
  grade: "blocking" | "attention" | "info";
  line: string;
}

export async function getLogPath(): Promise<string> {
  return invoke<string>("get_log_path");
}

export async function getPanicNotice(): Promise<PanicNotice> {
  const raw = await invoke<PanicNotice | null>("get_panic_notice");
  return {
    current: raw?.current ?? null,
    previous: raw?.previous ?? null,
  };
}

export function getReasonCatalog(): Promise<ReasonExplanation[]> {
  return invoke<ReasonExplanation[]>("get_reason_catalog");
}

export function exportDiagnosis(): Promise<string> {
  return invoke<string>("export_diagnosis");
}

export function revealLogPath(): Promise<void> {
  return invoke<void>("reveal_log_path");
}

// -- prompt enhancement (Phase 3.5) ------------------------------------------

interface RawEnhanceQuestion {
  question?: string | null;
  options?: string | null;
}

interface RawEnhanceResult {
  enhanced?: string | null;
  questions?: RawEnhanceQuestion[] | null;
}

/**
 * Read one round's answer back, treating anything unreadable as absent.
 *
 * A question with no text is nothing anybody could answer, so it is dropped
 * rather than shown as an empty card — the same rule the core's parser
 * follows, applied once more at the door.
 */
function toEnhanceResult(raw: RawEnhanceResult): EnhancePromptResult {
  const enhanced = typeof raw.enhanced === "string" && raw.enhanced.trim() !== ""
    ? raw.enhanced
    : null;
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .map((entry) => ({
      question: typeof entry.question === "string" ? entry.question.trim() : "",
      options: typeof entry.options === "string" && entry.options.trim() !== ""
        ? entry.options
        : null,
    }))
    .filter((entry) => entry.question !== "");
  return { enhanced, questions };
}

/**
 * Runs one round of prompt sharpening. Backed by a headless agent call, so it
 * can take minutes; failures come back as plain error strings.
 *
 * Without `answers` this is the first round, and the enhancer may answer with
 * questions instead of a prompt (Phase 21 P1). With them it is the second and
 * last: the core forbids further questions there, so a surface that sends
 * answers gets a prompt or an error — never a third round.
 */
export async function enhancePrompt(args: {
  draft: string;
  targetProfile?: string;
  answers?: EnhanceAnswer[];
}): Promise<EnhancePromptResult> {
  const raw = await invoke<RawEnhanceResult>("enhance_prompt", {
    draft: args.draft,
    targetProfile: args.targetProfile,
    answers: args.answers,
  });
  return toEnhanceResult(raw);
}

// -- diff review (Phase 5) ---------------------------------------------------

interface RawDiffLine {
  kind?: string | null;
  content?: string | null;
  oldLine?: number | null;
  old_line?: number | null;
  newLine?: number | null;
  new_line?: number | null;
}

interface RawDiffHunk {
  header?: string | null;
  lines?: RawDiffLine[] | null;
}

interface RawDiffFile {
  path?: string | null;
  oldPath?: string | null;
  old_path?: string | null;
  additions?: number | null;
  deletions?: number | null;
  binary?: boolean | null;
  hunks?: RawDiffHunk[] | null;
}

interface RawWorkerDiff {
  baseBranch?: string | null;
  base_branch?: string | null;
  files?: RawDiffFile[] | null;
  stat?: string | null;
  code?: RawReviewCode | null;
}

interface RawDiffComment {
  id?: string | null;
  workerId?: string | null;
  worker_id?: string | null;
  file?: string | null;
  line?: number | null;
  body?: string | null;
  sentToAgent?: boolean | null;
  sent_to_agent?: boolean | null;
  createdAt?: number | null;
  created_at?: number | null;
  disposition?: string | null;
}

function toCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** A line number is either a positive integer or absent; 0 is neither. */
function toLineNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/**
 * An unrecognised kind renders as context: a line the UI does not understand
 * must still be readable, and it must not be mistaken for a change.
 */
function toDiffLineKind(value: string | null | undefined): DiffLineKind {
  return value === "add" || value === "del" ? value : "context";
}

function toDiffLine(raw: RawDiffLine): DiffLine {
  return {
    kind: toDiffLineKind(raw.kind),
    content: raw.content ?? "",
    oldLine: toLineNumber(raw.oldLine ?? raw.old_line),
    newLine: toLineNumber(raw.newLine ?? raw.new_line),
  };
}

function toDiffHunk(raw: RawDiffHunk): DiffHunk {
  return {
    header: raw.header ?? "",
    lines: Array.isArray(raw.lines) ? raw.lines.map(toDiffLine) : [],
  };
}

/** A file without a path cannot be addressed by a comment, so it is dropped. */
function toDiffFile(raw: RawDiffFile): DiffFile | null {
  const path = nonEmpty(raw.path);
  if (path === null) return null;
  const oldPath = nonEmpty(raw.oldPath ?? raw.old_path);
  return {
    path,
    oldPath: oldPath === path ? null : oldPath,
    additions: toCount(raw.additions),
    deletions: toCount(raw.deletions),
    binary: raw.binary === true,
    hunks: Array.isArray(raw.hunks) ? raw.hunks.map(toDiffHunk) : [],
  };
}

function toWorkerDiff(raw: RawWorkerDiff): WorkerDiff {
  const files = Array.isArray(raw.files) ? raw.files : [];
  return {
    baseBranch: nonEmpty(raw.baseBranch ?? raw.base_branch) ?? "base",
    files: files.map(toDiffFile).filter((file): file is DiffFile => file !== null),
    stat: raw.stat ?? "",
    code: toReviewCode(raw.code),
  };
}

/** A comment the UI cannot pin to a line is worse than no comment at all. */
function toDiffComment(raw: RawDiffComment): DiffComment | null {
  const id = nonEmpty(raw.id);
  const file = nonEmpty(raw.file);
  const line = toLineNumber(raw.line);
  if (id === null || file === null || line === null) return null;
  const createdAt = raw.createdAt ?? raw.created_at;
  return {
    id,
    workerId: nonEmpty(raw.workerId ?? raw.worker_id) ?? "",
    file,
    line,
    body: raw.body ?? "",
    sentToAgent: (raw.sentToAgent ?? raw.sent_to_agent) === true,
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
    disposition: raw.disposition === "done" ? "done" : "open",
  };
}

/** The worker's branch against the project's base branch, hunk by hunk. */
export async function getWorkerDiff(workerId: string): Promise<WorkerDiff> {
  return toWorkerDiff(await invoke<RawWorkerDiff>("get_worker_diff", { workerId }));
}

/** Pins a review note to one line of one file. */
export async function addDiffComment(args: {
  workerId: string;
  file: string;
  line: number;
  body: string;
}): Promise<DiffComment> {
  const raw = await invoke<RawDiffComment>("add_diff_comment", {
    workerId: args.workerId,
    file: args.file,
    line: args.line,
    body: args.body,
  });
  const comment = toDiffComment(raw);
  if (comment === null) throw new Error("The core returned an unusable diff comment.");
  return comment;
}

export async function listDiffComments(workerId: string): Promise<DiffComment[]> {
  const raw = await invoke<RawDiffComment[]>("list_diff_comments", { workerId });
  if (!Array.isArray(raw)) return [];
  return raw.map(toDiffComment).filter((entry): entry is DiffComment => entry !== null);
}

/** Only an unsent comment can be withdrawn; the core rejects the rest. */
export function deleteDiffComment(id: string): Promise<void> {
  return invoke<void>("delete_diff_comment", { id });
}

export function setDiffCommentDisposition(
  id: string,
  disposition: "open" | "done",
): Promise<void> {
  return invoke<void>("set_diff_comment_disposition", { id, disposition });
}

interface RawReadinessBlocker {
  code?: string | null;
  message?: string | null;
  nextStep?: string | null;
  next_step?: string | null;
}

interface RawReviewCode {
  workerHeadSha?: string | null;
  worker_head_sha?: string | null;
  baseTipSha?: string | null;
  base_tip_sha?: string | null;
  mergeTreeOid?: string | null;
  merge_tree_oid?: string | null;
}

interface RawWorkerReadiness {
  lifecycle?: string | null;
  readiness?: string | null;
  blockers?: RawReadinessBlocker[] | null;
  checkedAt?: number | null;
  checked_at?: number | null;
  ahead?: number | null;
  behind?: number | null;
  code?: RawReviewCode | null;
}

/** The same blockers the merge path evaluates. Absence is unknown, not ready. */
export async function getWorkerReadiness(workerId: string): Promise<WorkerReadiness> {
  const raw = await invoke<RawWorkerReadiness>("get_worker_readiness", { workerId });
  const blockers = Array.isArray(raw.blockers) ? raw.blockers : [];
  return {
    lifecycle: raw.lifecycle ?? "unknown",
    readiness: raw.readiness ?? "unknown",
    blockers: blockers
      .map((blocker) => {
        const code = nonEmpty(blocker.code);
        if (code === null) return null;
        return {
          code,
          message: blocker.message ?? "",
          nextStep: blocker.nextStep ?? blocker.next_step ?? "",
        };
      })
      .filter((blocker): blocker is WorkerReadiness["blockers"][number] => blocker !== null),
    checkedAt:
      typeof raw.checkedAt === "number" && Number.isFinite(raw.checkedAt)
        ? raw.checkedAt
        : typeof raw.checked_at === "number" && Number.isFinite(raw.checked_at)
          ? raw.checked_at
          : 0,
    ahead: typeof raw.ahead === "number" && Number.isFinite(raw.ahead) ? raw.ahead : 0,
    behind: typeof raw.behind === "number" && Number.isFinite(raw.behind) ? raw.behind : 0,
    code: toReviewCode(raw.code),
  };
}

function toReviewCode(raw: RawReviewCode | null | undefined): WorkerReadiness["code"] {
  if (!raw) return null;
  const workerHeadSha = nonEmpty(raw.workerHeadSha) ?? nonEmpty(raw.worker_head_sha);
  const baseTipSha = nonEmpty(raw.baseTipSha) ?? nonEmpty(raw.base_tip_sha);
  const mergeTreeOid = nonEmpty(raw.mergeTreeOid) ?? nonEmpty(raw.merge_tree_oid);
  if (!workerHeadSha || !baseTipSha || !mergeTreeOid) return null;
  return { workerHeadSha, baseTipSha, mergeTreeOid };
}

/** The two verdicts a reviewer can stamp on a worker. */
export type ReviewDecision = "approved" | "changes_requested";

/**
 * Stamps the human review verdict on a worker, bound to the merge-tree tuple
 * the review surface is looking at. The desktop is one of only two
 * authorities allowed to do this; the core refuses a click whose `expected`
 * no longer matches git and orders a reload, so a stale diff can never
 * approve code nobody reviewed.
 */
export function setReviewVerdict(
  workerId: string,
  decision: ReviewDecision,
  expected: WorkerReadiness["code"],
): Promise<void> {
  return invoke<void>("set_review_verdict", { workerId, decision, expected });
}

interface RawSetupTrustView {
  command?: string | null;
  status?: string | null;
  repoIdentity?: string | null;
  commandNormalized?: string | null;
  baseSha?: string | null;
  inputsHash?: string | null;
  inputFiles?: string[] | null;
  mergeTreeOid?: string | null;
  grantedAt?: number | null;
}

/**
 * What the review surface shows before trusting the project's setup command.
 * `null` means the project has no setup command and there is nothing to
 * trust.
 */
export async function getSetupTrustView(workerId: string): Promise<SetupTrustView | null> {
  const raw = await invoke<RawSetupTrustView | null>("get_setup_trust_view", { workerId });
  if (!raw) return null;
  const command = nonEmpty(raw.command);
  const repoIdentity = nonEmpty(raw.repoIdentity);
  const commandNormalized = nonEmpty(raw.commandNormalized);
  const baseSha = nonEmpty(raw.baseSha);
  // An empty inputs hash is legitimate: a merge candidate without any of the
  // declared TRUST_INPUTS files binds the empty OID list. Dropping the view
  // here would remove the only approval path and deadlock the gate
  // (review-F4-r14, k3 Fund 1 / Sonnet Befund 1).
  const inputsHash = typeof raw.inputsHash === "string" ? raw.inputsHash : null;
  const mergeTreeOid = nonEmpty(raw.mergeTreeOid);
  if (
    !command ||
    !repoIdentity ||
    !commandNormalized ||
    !baseSha ||
    inputsHash === null ||
    !mergeTreeOid
  ) {
    // A present-but-unusable payload must not pose as "no setup command"
    // (which renders as nothing) — throw, so the view shows the error note
    // (review-F4-r19, Opus Fund 4).
    throw new Error("setup trust view payload is unusable (missing or malformed fields)");
  }
  const status =
    raw.status === "granted" || raw.status === "mismatch" ? raw.status : ("missing" as const);
  return {
    command,
    status,
    repoIdentity,
    commandNormalized,
    baseSha,
    inputsHash,
    inputFiles: Array.isArray(raw.inputFiles)
      ? raw.inputFiles.filter((name) => typeof name === "string" && name.trim() !== "")
      : [],
    mergeTreeOid,
    grantedAt:
      typeof raw.grantedAt === "number" && Number.isFinite(raw.grantedAt) ? raw.grantedAt : null,
  };
}

/**
 * Grants setup trust for exactly what the panel shows: the expected payload
 * is rebuilt from the displayed view, so a click can never trust inputs the
 * person did not see. The core re-computes the grant and refuses a stale
 * one with an order to reload. `seenTreeOid` is the merge tree of the diff
 * the reviewer was looking at — the core refuses an approval for a tree
 * nobody read (review-F4-r18, Opus Fund 1).
 */
export function approveSetupTrust(
  workerId: string,
  view: SetupTrustView,
  seenTreeOid: string,
): Promise<SetupTrustGrant> {
  const expected: SetupTrustGrant = {
    repo_identity: view.repoIdentity,
    command_normalized: view.commandNormalized,
    base_sha: view.baseSha,
    inputs_hash: view.inputsHash,
  };
  // The core answers with the stored grant; callers resync instead of
  // reading it, but the contract names it honestly.
  return invoke<SetupTrustGrant>("approve_setup_trust", { workerId, expected, seenTreeOid });
}

/**
 * Sets the project's setup command, or clears it with `null`. Any change
 * voids the stored trust grant, because the grant covers the normalised
 * command.
 */
export function setProjectSetupCommand(
  projectId: string,
  command: string | null,
): Promise<void> {
  return invoke<void>("set_project_setup_command", { projectId, command });
}

/** The stored setup command; `null` means none is configured. */
export async function getProjectSetupCommand(projectId: string): Promise<string | null> {
  const raw = await invoke<string | null>("get_project_setup_command", { projectId });
  return nonEmpty(raw);
}

// -- skill packs (Phase 6) ---------------------------------------------------

interface RawSkillPack {
  id?: string | null;
  name?: string | null;
  description?: string | null;
}

/** A pack without an id cannot be enabled, so it is dropped. */
function toSkillPack(raw: RawSkillPack): SkillPack | null {
  const id = nonEmpty(raw.id);
  if (id === null) return null;
  return {
    id,
    // A pack the core ships without a label is still selectable under its id.
    name: nonEmpty(raw.name) ?? id,
    description: raw.description?.trim() ?? "",
  };
}

/** Every skill pack shipped with the app, whether enabled anywhere or not. */
export async function listSkillPacks(): Promise<SkillPack[]> {
  const raw = await invoke<RawSkillPack[]>("list_skill_packs");
  if (!Array.isArray(raw)) return [];
  return raw.map(toSkillPack).filter((pack): pack is SkillPack => pack !== null);
}

/** The pack ids enabled for this project. A project starts with all of them. */
export async function getProjectSkillPacks(projectId: string): Promise<string[]> {
  const raw = await invoke<unknown>("get_project_skill_packs", { projectId });
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry !== "");
}

/** Replaces the project's enabled set; the core writes it through at once. */
export function setProjectSkillPacks(projectId: string, packs: string[]): Promise<void> {
  return invoke<void>("set_project_skill_packs", { projectId, packs });
}

// -- providers (Phase 7.2) ---------------------------------------------------

interface RawProvider {
  id?: string | null;
  name?: string | null;
  kind?: string | null;
  connected?: boolean | null;
  detail?: string | null;
  quotaState?: string | null;
  quota_state?: string | null;
  blockedUntil?: number | null;
  blocked_until?: number | null;
  omniRouteOnline?: boolean | null;
  omni_route_online?: boolean | null;
  usage?: RawProviderUsage | null;
  vaultError?: string | null;
  vault_error?: string | null;
}

interface RawProviderUsage {
  percent?: number | null;
  used?: string | null;
  limit?: string | null;
  windowLabel?: string | null;
  window_label?: string | null;
  resetsAt?: number | null;
  resets_at?: number | null;
  source?: string | null;
  observedAt?: number | null;
  observed_at?: number | null;
}

function toProviderKind(value: string | null | undefined): Provider["kind"] {
  return value === "subscription" || value === "api_key" || value === "local" ? value : "local";
}

function toProviderQuotaState(value: string | null | undefined): Provider["quotaState"] {
  return value === "ok" || value === "blocked" || value === "unknown" ? value : "unknown";
}

function toProviderUsageSource(value: string | null | undefined): ProviderUsage["source"] {
  const source = typeof value === "string" ? value.trim() : "";
  // Honest passthrough: the core owns this vocabulary, downstream only ever
  // branches on "local", and an unseen source must stay itself rather than
  // masquerade as another kind. Only a wholly missing one needs any default.
  return source === "" ? "heuristic" : (source as ProviderUsage["source"]);
}

/**
 * Defensive normalisation: a missing, malformed, or half-empty usage payload is
 * treated as `null`, just like the rest of the provider normalisation.
 */
function toProviderUsage(raw: RawProviderUsage | null | undefined): ProviderUsage | null {
  if (!raw) return null;

  const observedAt = raw.observedAt ?? raw.observed_at ?? null;
  if (typeof observedAt !== "number" || !Number.isFinite(observedAt)) return null;

  const percent = raw.percent ?? null;
  if (percent !== null && (typeof percent !== "number" || !Number.isFinite(percent))) return null;

  const resetsAt = raw.resetsAt ?? raw.resets_at ?? null;
  if (resetsAt !== null && (typeof resetsAt !== "number" || !Number.isFinite(resetsAt))) return null;

  const windowLabel = nonEmpty(raw.windowLabel ?? raw.window_label);
  if (windowLabel === null) return null;

  return {
    percent: percent === null ? null : Math.max(0, Math.min(100, percent)),
    used: nonEmpty(raw.used),
    limit: nonEmpty(raw.limit),
    windowLabel,
    resetsAt,
    source: toProviderUsageSource(raw.source),
    observedAt,
  };
}

function toProvider(raw: RawProvider): Provider | null {
  const id = nonEmpty(raw.id);
  const name = nonEmpty(raw.name);
  if (id === null || name === null) return null;
  const blockedUntil = raw.blockedUntil ?? raw.blocked_until ?? null;
  return {
    id,
    name,
    kind: toProviderKind(raw.kind),
    connected: raw.connected === true,
    detail: nonEmpty(raw.detail),
    quotaState: toProviderQuotaState(raw.quotaState ?? raw.quota_state),
    blockedUntil:
      typeof blockedUntil === "number" && Number.isFinite(blockedUntil) ? blockedUntil : null,
    omniRouteOnline: (raw.omniRouteOnline ?? raw.omni_route_online) === true,
    usage: toProviderUsage(raw.usage),
    vaultError: nonEmpty(raw.vaultError ?? raw.vault_error),
  };
}

/** Every provider known to the core, plus its key-presence and reachability. */
export async function getProviderOverview(): Promise<Provider[]> {
  const raw = await invoke<RawProvider[]>("get_provider_overview");
  if (!Array.isArray(raw)) return [];
  return raw.map(toProvider).filter((provider): provider is Provider => provider !== null);
}

/** Stores an API key for the named provider. */
export function setProviderKey(providerId: string, key: string): Promise<void> {
  return invoke<void>("set_provider_key", { providerId, key });
}

/** Removes any stored API key for the named provider. */
export function deleteProviderKey(providerId: string): Promise<void> {
  return invoke<void>("delete_provider_key", { providerId });
}

/**
 * Whether the user opted in to handing stored provider keys to the local
 * OmniRoute process (F-SEC-4). Off unless switched on.
 */
export async function getOmniRouteKeySync(): Promise<boolean> {
  return (await invoke<boolean>("get_omniroute_key_sync")) === true;
}

/** Records the key-sync opt-in; switching it on pushes the stored keys once. */
export function setOmniRouteKeySync(enabled: boolean): Promise<void> {
  return invoke<void>("set_omniroute_key_sync", { enabled });
}

/** Whether the core has a key on file for the named provider. */
export function hasProviderKey(providerId: string): Promise<boolean> {
  return invoke<boolean>("has_provider_key", { providerId });
}

/**
 * What is left in OmniRoute's free pools (phase 19 T5).
 *
 * The core answers `{ available: false, reason }` rather than throwing when the
 * router is unreachable or the management login is missing, so the negative
 * case reaches the UI as a sentence to show instead of an error to swallow.
 * Everything the payload did not report stays `null`.
 */
export async function getFreeTierSummary(): Promise<FreeTierSummary> {
  const raw = await invoke<Partial<FreeTierSummary> | null>("get_free_tier_summary");
  return {
    available: raw?.available === true,
    reason: nonEmpty(raw?.reason),
    pools: Array.isArray(raw?.pools) ? raw.pools : [],
    whitelist: Array.isArray(raw?.whitelist) ? raw.whitelist : [],
    observedAt: typeof raw?.observedAt === "number" ? raw.observedAt : 0,
  };
}

// -- task queue (Phase 7) ----------------------------------------------------

/** Adds a task for the project's dispatcher; it may sharpen it before dispatch. */
export function enqueueTask(args: {
  projectId: string;
  rawText: string;
  profileId?: string;
  sharpen: boolean;
  priority?: number;
}): Promise<QueueEntry> {
  return invoke<QueueEntry>("enqueue_task", {
    projectId: args.projectId,
    rawText: args.rawText,
    profileId: args.profileId,
    sharpen: args.sharpen,
    priority: args.priority,
  });
}

/** Every queued task, or only the entries belonging to `projectId`. */
export function listQueue(projectId?: string): Promise<QueueEntry[]> {
  return invoke<QueueEntry[]>("list_queue", { projectId });
}

/** Removes a task that has not yet been dispatched. */
export function cancelQueuedTask(id: string): Promise<void> {
  return invoke<void>("cancel_queued_task", { id });
}

// -- scout & recommendations (Phase 7.1) -------------------------------------

interface RawRecommendation {
  id?: string | null;
  projectId?: string | null;
  project_id?: string | null;
  title?: string | null;
  url?: string | null;
  rationale?: string | null;
  effort?: string | null;
  status?: string | null;
  createdAt?: number | null;
  created_at?: number | null;
}

/** An unrecognised verdict is treated as undecided, never as already handled. */
function toRecommendationStatus(value: string | null | undefined): RecommendationStatus {
  return value === "accepted" || value === "dismissed" ? value : "new";
}

/** Without an id a suggestion can be neither accepted nor dismissed: drop it. */
function toRecommendation(raw: RawRecommendation): Recommendation | null {
  const id = nonEmpty(raw.id);
  if (id === null) return null;
  const createdAt = raw.createdAt ?? raw.created_at;
  return {
    id,
    projectId: nonEmpty(raw.projectId ?? raw.project_id) ?? "",
    // A nameless suggestion is still actionable, so it gets a stand-in label.
    title: nonEmpty(raw.title) ?? "Ohne Titel",
    url: nonEmpty(raw.url),
    rationale: raw.rationale?.trim() ?? "",
    effort: nonEmpty(raw.effort),
    status: toRecommendationStatus(raw.status),
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/** Starts a scout session that judges the given repositories. */
export async function triageRepos(projectId: string, urls: string[]): Promise<Worker> {
  return toWorker(await invoke<RawWorker>("triage_repos", { projectId, urls }));
}

/** Starts a scout session for free-form research on the project. */
export async function createScout(projectId: string): Promise<Worker> {
  return toWorker(await invoke<RawWorker>("create_scout", { projectId }));
}

/** Everything the project's scouts have suggested so far. */
export async function listRecommendations(projectId: string): Promise<Recommendation[]> {
  const raw = await invoke<RawRecommendation[]>("list_recommendations", { projectId });
  if (!Array.isArray(raw)) return [];
  return raw.map(toRecommendation).filter((entry): entry is Recommendation => entry !== null);
}

/** Records a verdict without acting on it; use `acceptRecommendation` to queue. */
export function setRecommendationStatus(id: string, status: RecommendationStatus): Promise<void> {
  return invoke<void>("set_recommendation_status", { id, status });
}

/** Turns the suggestion into a queued task; the dispatcher takes it from there. */
export function acceptRecommendation(id: string): Promise<QueueEntry> {
  return invoke<QueueEntry>("accept_recommendation", { id });
}

// -- web interface (Phase 8) --------------------------------------------------

/** Starts the localhost web interface and returns the port it bound to. */
export function startWebInterface(port: number): Promise<number> {
  return invoke<number>("start_web_interface", { port });
}

export function stopWebInterface(): Promise<void> {
  return invoke<void>("stop_web_interface");
}

/** The port the web interface is serving on, or `null` while it is off. */
export function getWebInterfaceStatus(): Promise<number | null> {
  return invoke<number | null>("web_interface_status");
}

// -- worker history (Phase P2) ----------------------------------------------

interface RawWorkerMessage {
  id?: string | null;
  workerId?: string | null;
  worker_id?: string | null;
  role?: string | null;
  content?: string | null;
  createdAt?: number | null;
  created_at?: number | null;
}

function toMessageRole(value: string | null | undefined): MessageRole {
  return value === "user" || value === "agent" || value === "system" ? value : "system";
}

function toWorkerMessage(raw: RawWorkerMessage): WorkerMessage | null {
  const id = nonEmpty(raw.id);
  const workerId = nonEmpty(raw.workerId ?? raw.worker_id);
  const content = nonEmpty(raw.content);
  if (id === null || workerId === null || content === null) return null;
  const createdAt = raw.createdAt ?? raw.created_at;
  return {
    id,
    workerId,
    role: toMessageRole(raw.role),
    content,
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/** Messages for one worker, oldest first. The command may not exist yet;
 * the caller decides whether an error is worth surfacing. */
export async function listWorkerMessages(workerId: string, limit = 200): Promise<WorkerMessage[]> {
  const raw = await invoke<RawWorkerMessage[]>("list_worker_messages", { workerId, limit });
  if (!Array.isArray(raw)) return [];
  return raw.map(toWorkerMessage).filter((entry): entry is WorkerMessage => entry !== null);
}

// -- landing page (design studio) --------------------------------------------

/** The project's landing-page markdown, or `null` when none was saved yet. */
export function getLandingPage(projectId: string): Promise<string | null> {
  return invoke<string | null>("get_landing_page", { projectId });
}

/** Replaces the landing page; `null` clears it. */
export function setLandingPage(
  projectId: string,
  markdown: string | null,
): Promise<void> {
  return invoke<void>("set_landing_page", { projectId, markdown });
}

// -- learnings (Phase 14) ---------------------------------------------------

interface RawLearning {
  id?: string | null;
  projectId?: string | null;
  project_id?: string | null;
  workerId?: string | null;
  worker_id?: string | null;
  profileId?: string | null;
  profile_id?: string | null;
  patternLabel?: string | null;
  pattern_label?: string | null;
  content?: string | null;
  status?: string | null;
  createdAt?: number | null;
  created_at?: number | null;
}

/** An unrecognised verdict is treated as unread, never as already handled. */
function toLearningStatus(value: string | null | undefined): LearningStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

/** Without an id or a text there is nothing to review or approve: drop it. */
function toLearning(raw: RawLearning): Learning | null {
  const id = nonEmpty(raw.id);
  const content = nonEmpty(raw.content);
  if (id === null || content === null) return null;
  const createdAt = raw.createdAt ?? raw.created_at;
  return {
    id,
    projectId: nonEmpty(raw.projectId ?? raw.project_id) ?? "",
    workerId: nonEmpty(raw.workerId ?? raw.worker_id) ?? "",
    profileId: nonEmpty(raw.profileId ?? raw.profile_id) ?? "",
    patternLabel: nonEmpty(raw.patternLabel ?? raw.pattern_label),
    content,
    status: toLearningStatus(raw.status),
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/** Everything the project's critics have distilled so far, in every status. */
export async function listLearnings(projectId: string): Promise<Learning[]> {
  const raw = await invoke<RawLearning[]>("list_learnings", { projectId });
  if (!Array.isArray(raw)) return [];
  return raw.map(toLearning).filter(isPresent);
}

/**
 * The token the control API's four review routes ask for on top of the API
 * token.
 *
 * It is minted at startup and written to no file, so this call is the only way
 * to it — which is the point: the API token sits in `projecta-api.json`, which
 * every agent may read, and approving a learning writes into the playbook that
 * every later agent is prompted with. Approving from this window needs no token
 * at all, since a Tauri command is not reachable from outside the window; what
 * needs one is `pa learnings approve` in a terminal, and this is where the
 * human reads it off.
 */
export function getVerdictToken(): Promise<string> {
  return invoke<string>("get_verdict_token");
}

/** Takes the insight into the playbook, with whatever text the user settled on. */
export function approveLearning(id: string, text: string): Promise<void> {
  return invoke<void>("approve_learning", { id, text });
}

export function rejectLearning(id: string): Promise<void> {
  return invoke<void>("reject_learning", { id });
}

/**
 * Runs the critic over one finished worker and answers with how many new
 * learnings it filed. The run reads a whole session, so it takes minutes.
 */
export function runLearningCritic(workerId: string): Promise<number> {
  return invoke<number>("run_learning_critic", { workerId });
}

/** A disabled profile is kept, but no longer offered to new agents. */
export function setProfileEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke<void>("set_profile_enabled", { id, enabled });
}

/** Whether agents of that category get a critic run at all. */
export function setCategoryLearning(category: string, enabled: boolean): Promise<void> {
  return invoke<void>("set_category_learning", { category, enabled });
}

/** Learning switches by category key; a missing key means the default, on. */
export async function getLearningSettings(): Promise<Record<string, boolean>> {
  const raw = await invoke<Record<string, boolean>>("get_learning_settings");
  return raw ?? {};
}

// -- role variants (Phase 15) -----------------------------------------------

interface RawRoleVariant {
  id?: string | null;
  projectId?: string | null;
  project_id?: string | null;
  name?: string | null;
  baseProfileId?: string | null;
  base_profile_id?: string | null;
  patternLabel?: string | null;
  pattern_label?: string | null;
  systemPromptAddition?: string | null;
  system_prompt_addition?: string | null;
  version?: number | null;
  status?: string | null;
  createdAt?: number | null;
  created_at?: number | null;
}

/** An unrecognised verdict is treated as unreviewed, never as already handled. */
function toRoleVariantStatus(value: string | null | undefined): RoleVariantStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

/**
 * A variant without an id, a name or a base profile can neither be reviewed
 * nor spawned, so it is dropped rather than shown as an empty card. A missing
 * version is the first one — treating it as 0 would fake a supersede.
 */
function toRoleVariant(raw: RawRoleVariant): RoleVariant | null {
  const id = nonEmpty(raw.id);
  const name = nonEmpty(raw.name);
  const baseProfileId = nonEmpty(raw.baseProfileId ?? raw.base_profile_id);
  if (id === null || name === null || baseProfileId === null) return null;
  const version = raw.version;
  const createdAt = raw.createdAt ?? raw.created_at;
  return {
    id,
    projectId: nonEmpty(raw.projectId ?? raw.project_id) ?? "",
    name,
    baseProfileId,
    patternLabel: nonEmpty(raw.patternLabel ?? raw.pattern_label) ?? "",
    systemPromptAddition: raw.systemPromptAddition ?? raw.system_prompt_addition ?? "",
    version:
      typeof version === "number" && Number.isFinite(version) && version >= 1
        ? Math.floor(version)
        : 1,
    status: toRoleVariantStatus(raw.status),
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/** The project's proposed and accepted roles; the core leaves rejected ones out. */
export async function listRoleVariants(projectId: string): Promise<RoleVariant[]> {
  const raw = await invoke<RawRoleVariant[]>("list_role_variants", { projectId });
  if (!Array.isArray(raw)) return [];
  return raw.map(toRoleVariant).filter(isPresent);
}

/** Makes the variant spawnable, superseding the version it was built on. */
export function approveRoleVariant(id: string): Promise<void> {
  return invoke<void>("approve_role_variant", { id });
}

export function rejectRoleVariant(id: string): Promise<void> {
  return invoke<void>("reject_role_variant", { id });
}

// -- activity feed (Phase 16) -------------------------------------------------

interface RawActivityEntry {
  id?: string | null;
  createdAt?: number | null;
  created_at?: number | null;
  category?: string | null;
  projectId?: string | null;
  project_id?: string | null;
  workerId?: string | null;
  worker_id?: string | null;
  workerLabel?: string | null;
  worker_label?: string | null;
  summary?: string | null;
}

/**
 * An entry without an id or a summary cannot be rendered as anything but a
 * blank line, so it is dropped. The category passes through untouched: the
 * core owns that vocabulary.
 */
function toActivityEntry(raw: RawActivityEntry): ActivityEntry | null {
  const id = nonEmpty(raw.id);
  const summary = nonEmpty(raw.summary);
  if (id === null || summary === null) return null;
  const createdAt = raw.createdAt ?? raw.created_at;
  return {
    id,
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
    category: nonEmpty(raw.category) ?? "status",
    projectId: nonEmpty(raw.projectId ?? raw.project_id) ?? "",
    workerId: nonEmpty(raw.workerId ?? raw.worker_id),
    workerLabel: nonEmpty(raw.workerLabel ?? raw.worker_label),
    summary,
  };
}

/**
 * The fleet-wide event feed, newest first; scoped to `projectId` when given.
 * The core applies its own default and cap when `limit` is left out.
 */
export async function getActivity(
  projectId?: string,
  limit?: number,
): Promise<ActivityEntry[]> {
  const raw = await invoke<RawActivityEntry[]>("get_activity", { projectId, limit });
  if (!Array.isArray(raw)) return [];
  return raw.map(toActivityEntry).filter(isPresent);
}

// -- the OmniRoute usage ledger (Phase 19 T3) --------------------------------

interface RawUsageEvent {
  id?: string | null;
  ts?: number | null;
  profileId?: string | null;
  model?: string | null;
  provider?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
  rawJson?: string | null;
}

interface RawUsageTotals {
  requests?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
  priced?: number | null;
}

interface RawUsageReport {
  online?: boolean | null;
  authorized?: boolean | null;
  events?: RawUsageEvent[] | null;
  today?: RawUsageTotals | null;
  total?: RawUsageTotals | null;
  reportedCostUsd?: number | null;
}

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A price the core did not have stays absent; it never becomes a zero. */
function price(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toUsageEvent(raw: RawUsageEvent): UsageEvent | null {
  if (typeof raw.id !== "string" || raw.id === "") return null;
  return {
    id: raw.id,
    ts: count(raw.ts),
    profileId: typeof raw.profileId === "string" && raw.profileId !== "" ? raw.profileId : null,
    model: raw.model ?? "",
    provider: raw.provider ?? "",
    tokensIn: count(raw.tokensIn),
    tokensOut: count(raw.tokensOut),
    costUsd: price(raw.costUsd),
    rawJson: raw.rawJson ?? "",
  };
}

function toUsageTotals(raw: RawUsageTotals | null | undefined): UsageTotals {
  return {
    requests: count(raw?.requests),
    tokensIn: count(raw?.tokensIn),
    tokensOut: count(raw?.tokensOut),
    costUsd: count(raw?.costUsd),
    priced: count(raw?.priced),
  };
}

/**
 * The OmniRoute ledger: the newest rows and the totals beside them.
 *
 * Fleet-wide by construction - see {@link UsageReport}. The core applies its
 * own default and cap when `limit` is left out.
 *
 * A report that lacks the core's own fields (`online`, `authorized`, `today`,
 * `total`) is rejected rather than completed with invented values: defaulting
 * them would turn a malformed answer into "offline", "no token" and zero
 * totals on screen - three claims nobody made. Note that `authorized: false`
 * is a complete, legitimate report; only missing fields are rejected.
 */
export async function getOmniRouteUsage(limit?: number): Promise<UsageReport> {
  const raw = await invoke<RawUsageReport>("get_omniroute_usage", { limit });
  if (
    raw === null ||
    typeof raw !== "object" ||
    typeof raw.online !== "boolean" ||
    typeof raw.authorized !== "boolean" ||
    !Array.isArray(raw.events) ||
    raw.today === null ||
    typeof raw.today !== "object" ||
    raw.total === null ||
    typeof raw.total !== "object"
  ) {
    throw new Error("OmniRoute-Nutzung: unvollständiger Bericht vom Kern");
  }
  return {
    online: raw.online,
    authorized: raw.authorized,
    events: raw.events.map(toUsageEvent).filter(isPresent),
    today: toUsageTotals(raw.today),
    total: toUsageTotals(raw.total),
    reportedCostUsd: price(raw.reportedCostUsd),
  };
}

// -- project statistics (Phase 20) -------------------------------------------

function toLabelCounts(raw: unknown): StatsLabelCount[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is { key: string; count?: number } =>
      typeof (row as { key?: unknown })?.key === "string",
    )
    .map((row) => ({ key: row.key, count: count(row.count) }));
}

function toTokenUsage(raw: unknown): StatsTokenUsage | null {
  // The whole section is optional, and the absence has to survive the trip:
  // an object of zeroes here would print as "0 Tokens" and read as a
  // measurement. See {@link ProjectStats.tokens}.
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const byProfile: StatsProfileTokens[] = Array.isArray(value.byProfile)
    ? value.byProfile.map((row: Record<string, unknown>) => ({
        profileId: typeof row?.profileId === "string" && row.profileId !== "" ? row.profileId : null,
        requests: count(row?.requests as number),
        tokensIn: count(row?.tokensIn as number),
        tokensOut: count(row?.tokensOut as number),
        usedByProject: row?.usedByProject === true,
      }))
    : [];
  return {
    requests: count(value.requests as number),
    tokensIn: count(value.tokensIn as number),
    tokensOut: count(value.tokensOut as number),
    costUsd: count(value.costUsd as number),
    priced: count(value.priced as number),
    byProfile,
    projectProfiles: Array.isArray(value.projectProfiles)
      ? value.projectProfiles.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function toSessions(raw: unknown): StatsSessions {
  const value = (raw ?? {}) as Record<string, unknown>;
  const recent: StatsSession[] = Array.isArray(value.recent)
    ? value.recent.map((row: Record<string, unknown>) => ({
        sessionId: typeof row?.sessionId === "string" ? row.sessionId : "",
        workerId: typeof row?.workerId === "string" ? row.workerId : "",
        task: typeof row?.task === "string" ? row.task : "",
        startedAt: count(row?.startedAt as number),
        endedAt: price(row?.endedAt as number),
        duration: price(row?.duration as number),
        exitCode: price(row?.exitCode as number),
      }))
    : [];
  return {
    total: count(value.total as number),
    open: count(value.open as number),
    ended: count(value.ended as number),
    totalSeconds: count(value.totalSeconds as number),
    medianSeconds: price(value.medianSeconds as number),
    failed: count(value.failed as number),
    unknownExit: count(value.unknownExit as number),
    failureRatio: price(value.failureRatio as number),
    recent,
  };
}

function toCompletion(raw: unknown): StatsCompletion {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    // `null` is the real answer for a project there is nothing to estimate
    // from; `price` is the helper that keeps a missing number missing.
    percent: price(value.percent as number),
    components: Array.isArray(value.components)
      ? value.components.map((row: Record<string, unknown>) => ({
          key: typeof row?.key === "string" ? row.key : "",
          weight: count(row?.weight as number),
          score: count(row?.score as number),
          detail: typeof row?.detail === "string" ? row.detail : "",
        }))
      : [],
    workers: Array.isArray(value.workers)
      ? value.workers.map((row: Record<string, unknown>) => ({
          workerId: typeof row?.workerId === "string" ? row.workerId : "",
          task: typeof row?.task === "string" ? row.task : "",
          column: typeof row?.column === "string" ? row.column : "working",
          weight: count(row?.weight as number),
        }))
      : [],
    columnWeights: Array.isArray(value.columnWeights)
      ? (value.columnWeights.filter(
          (pair) => Array.isArray(pair) && typeof pair[0] === "string",
        ) as Array<[string, number]>)
      : [],
  };
}

/**
 * One project's statistics over `range`.
 *
 * One call for the whole tab: the sections are polled together, and five reads
 * would only give the tiles five different clocks.
 */
export async function getProjectStats(
  projectId: string,
  range: StatsRange,
): Promise<ProjectStats> {
  const raw = await invoke<Record<string, unknown>>("get_project_stats", { projectId, range });
  const overview = (raw?.overview ?? {}) as Record<string, unknown>;
  const timeline: StatsActivityDay[] = Array.isArray(raw?.timeline)
    ? raw.timeline.map((row: Record<string, unknown>) => ({
        date: typeof row?.date === "string" ? row.date : "",
        day: count(row?.day as number),
        messages: count(row?.messages as number),
        statusEvents: count(row?.statusEvents as number),
      }))
    : [];
  return {
    projectId: typeof raw?.projectId === "string" ? raw.projectId : projectId,
    projectName: typeof raw?.projectName === "string" ? raw.projectName : "",
    range,
    since: price(raw?.since as number),
    generatedAt: count(raw?.generatedAt as number),
    overview: {
      workersTotal: count(overview.workersTotal as number),
      workersActive: count(overview.workersActive as number),
      workersArchived: count(overview.workersArchived as number),
      byColumn: toLabelCounts(overview.byColumn),
      byKind: toLabelCounts(overview.byKind),
      needsAttention: count(overview.needsAttention as number),
      queue: toLabelCounts(overview.queue),
      queueTotal: count(overview.queueTotal as number),
      learningsPending: count(overview.learningsPending as number),
      messages: count(overview.messages as number),
      statusEvents: count(overview.statusEvents as number),
      diffComments: count(overview.diffComments as number),
      workersCreated: count(overview.workersCreated as number),
      rangeScoped: Array.isArray(overview.rangeScoped)
        ? overview.rangeScoped.filter((name): name is string => typeof name === "string")
        : [],
    },
    tokens: toTokenUsage(raw?.tokens),
    sessions: toSessions(raw?.sessions),
    timeline,
    completion: toCompletion(raw?.completion),
  };
}

// -- blocking decisions (Phase 21) -------------------------------------------

interface RawQuestion {
  id?: string | null;
  projectId?: string | null;
  workerId?: string | null;
  scope?: string | null;
  question?: string | null;
  optionsJson?: string | null;
  status?: string | null;
  answer?: string | null;
  createdAt?: number | null;
  answeredAt?: number | null;
  answeredBy?: string | null;
  expiresAt?: number | null;
}

/** A worker id is what makes a question a worker's; an absent one is preflight. */
function toQuestionScope(value: string | null | undefined): QuestionScope {
  return value === "preflight" ? "preflight" : "worker";
}

/**
 * An unknown status is read as `open`, which is the only reading that can do
 * no harm: it leaves the row in the list to be decided instead of filing it
 * away as already handled.
 */
function toQuestionStatus(value: string | null | undefined): QuestionStatus {
  return value === "answered" || value === "expired" || value === "refused" ? value : "open";
}

/**
 * Anything the core did not explicitly call `human` becomes `unverified` or
 * `null` — never `human`. This field is the whole basis of "a person decided
 * this", so the failure mode has to be understating it.
 */
function toAnsweredBy(value: string | null | undefined): AnsweredBy | null {
  if (value === "human") return "human";
  return nonEmpty(value) === null ? null : "unverified";
}

/** A row without an id or a question text is nothing anyone could answer. */
function toQuestion(raw: RawQuestion): Question | null {
  const id = nonEmpty(raw.id);
  const question = nonEmpty(raw.question);
  if (id === null || question === null) return null;
  return {
    id,
    projectId: nonEmpty(raw.projectId) ?? "",
    workerId: nonEmpty(raw.workerId),
    scope: toQuestionScope(raw.scope),
    question,
    optionsJson: nonEmpty(raw.optionsJson),
    status: toQuestionStatus(raw.status),
    answer: raw.answer ?? null,
    createdAt: count(raw.createdAt),
    answeredAt: price(raw.answeredAt),
    answeredBy: toAnsweredBy(raw.answeredBy),
    expiresAt: price(raw.expiresAt),
  };
}

/**
 * The decisions of one project, oldest first — every status when `status` is
 * left out.
 *
 * One unfiltered call carries the open list and the history behind it, so the
 * tab never shows two lists read a poll apart.
 */
export async function listQuestions(args?: {
  projectId?: string;
  status?: QuestionStatus;
}): Promise<Question[]> {
  const raw = await invoke<RawQuestion[]>("list_questions", {
    projectId: args?.projectId,
    status: args?.status,
  });
  if (!Array.isArray(raw)) return [];
  return raw.map(toQuestion).filter(isPresent);
}

/**
 * Answers one open question and gives the closed row back.
 *
 * No token travels with it: a Tauri command is reachable only from the window,
 * so the core records this as `human` on its own. That is exactly the claim
 * {@link Question.answeredBy} exists to make, and the reason the same answer
 * sent over the HTTP route is not allowed to make it.
 *
 * `null` means the answer went through but the row that came back was not
 * readable here — the question is closed either way, and a refetch is the
 * honest way to find out what it now says.
 */
export async function answerQuestion(id: string, answer: string): Promise<Question | null> {
  return toQuestion(await invoke<RawQuestion>("answer_question", { id, answer }));
}

/**
 * Asks a blocking question from the window instead of from an agent's
 * terminal.
 *
 * Nothing in this tab calls it — `pa ask` is the path the feature was built
 * for. It is here for the preflight dialogue, which asks before there is a
 * worker and therefore passes no `workerId`. `options` is the raw `"A,B,C"`
 * string; the core builds the JSON array.
 */
export async function askQuestion(args: {
  projectId: string;
  workerId?: string;
  question: string;
  options?: string;
}): Promise<Question | null> {
  return toQuestion(await invoke<RawQuestion>("ask_question", args));
}

// -- events ------------------------------------------------------------------

export function onPtyOutput(
  sessionId: string,
  handler: (chunk: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(`pty:output:${sessionId}`, (event) => handler(event.payload));
}

export function onPtyExit(
  sessionId: string,
  handler: (payload: PtyExitPayload) => void,
): Promise<UnlistenFn> {
  return listen<PtyExitPayload>(`pty:exit:${sessionId}`, (event) => handler(event.payload));
}

/** Fires on every visible column or attention change, for every worker. */
export function onWorkerStatus(
  handler: (payload: WorkerStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<{
    workerId: string;
    column: string;
    attentionReason?: string | null;
    attentionCode?: string | null;
    attentionGrade?: string | null;
    attentionObservedAt?: number | null;
  }>("worker:status", (event) => {
    const {
      workerId,
      column,
      attentionReason,
      attentionCode,
      attentionGrade,
      attentionObservedAt,
    } = event.payload;
    if (!workerId || !isBoardColumn(column)) return;
    handler({
      workerId,
      column,
      attentionReason: nonEmpty(attentionReason),
      attentionCode: nonEmpty(attentionCode),
      attentionGrade: toAttentionGrade(attentionGrade),
      attentionObservedAt: toTimestamp(attentionObservedAt),
    });
  });
}

/** Block reason codes of the Rust `BlockReason` enum (store/supervisor.rs). */
export const SUPERVISOR_BLOCK_REASONS = [
  "already_blocked",
  "deadline_exhausted",
  "token_allowance_unavailable",
  "token_budget_exhausted",
  "task_attempts_exhausted",
] as const;
export type SupervisorBlockReason = (typeof SUPERVISOR_BLOCK_REASONS)[number];

/** Audit finding codes of the Rust `AuditFinding` enum (store/supervisor.rs). */
export const SUPERVISOR_AUDIT_FINDINGS = ["unattested_supervisor_event"] as const;
export type SupervisorAuditFinding = (typeof SUPERVISOR_AUDIT_FINDINGS)[number];

/**
 * W2-06: one committed change of the continuous policy supervisor. Ids and
 * fixed reason codes only; details (error text, checkpoints) stay behind the
 * authorized project context read.
 */
export type SupervisorNotification =
  | {
      kind: "blocked";
      projectId: string;
      rootGoalId: string;
      reason: SupervisorBlockReason;
      observedAt: number;
    }
  | { kind: "degraded"; projectId: string; observedAt: number }
  | { kind: "recovered"; projectId: string; observedAt: number }
  | {
      kind: "audit";
      projectId: string;
      finding: SupervisorAuditFinding;
      eventCursor: number;
      observedAt: number;
    };

/** A safe, non-negative integer; rejects NaN, Infinity, fractions and 2^53+. */
function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isCode<T extends string>(codes: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (codes as readonly string[]).includes(value);
}

/**
 * W2-06 review K5: the payload is re-checked at the IPC boundary. Anything
 * with another kind or a code outside the closed sets (free text could carry
 * secrets or goal titles) is dropped rather than shown.
 */
function toSupervisorNotification(raw: unknown): SupervisorNotification | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const projectId = typeof p.projectId === "string" ? p.projectId : "";
  if (!projectId || !isCount(p.observedAt)) return null;
  const observedAt = p.observedAt;
  switch (p.kind) {
    case "blocked":
      if (typeof p.rootGoalId !== "string" || !p.rootGoalId) return null;
      if (!isCode(SUPERVISOR_BLOCK_REASONS, p.reason)) return null;
      return { kind: "blocked", projectId, rootGoalId: p.rootGoalId, reason: p.reason, observedAt };
    case "degraded":
    case "recovered":
      return { kind: p.kind, projectId, observedAt };
    case "audit":
      if (!isCount(p.eventCursor) || p.eventCursor === 0) return null;
      if (!isCode(SUPERVISOR_AUDIT_FINDINGS, p.finding)) return null;
      return { kind: "audit", projectId, finding: p.finding, eventCursor: p.eventCursor, observedAt };
    default:
      return null;
  }
}

/**
 * Fires once per supervisor state change (block, degraded/recovered health,
 * audit finding). Payloads outside the closed code sets are dropped.
 */
export function onSupervisorNotification(
  handler: (payload: SupervisorNotification) => void,
): Promise<UnlistenFn> {
  return listen<unknown>("supervisor:notification", (event) => {
    const notice = toSupervisorNotification(event.payload);
    if (notice) handler(notice);
  });
}

/**
 * Hands a URL to the OS through the opener plugin (registered in main.rs,
 * scoped to http(s) in capabilities/default.json - see
 * src/opener-config.test.ts). The webview is only the fallback for the case
 * the plugin refuses, and that case is logged: until P2-J (02.09.2026) the
 * plugin was never registered, every call took this fallback, and nothing
 * said so - `window.open` under WebView2 then opened nothing at all.
 *
 * Only web URLs may leave the app: a `javascript:` or `data:` URL handed to
 * the opener or the webview fallback would run with the user's privileges, so
 * anything but `http(s)` is refused before either path is tried.
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url.trim())) return;
  try {
    await invoke<void>("plugin:opener|open_url", { url });
  } catch (err) {
    console.warn("openExternal: opener plugin refused, falling back to the webview", err);
    // `window.open` answers `null` when the webview blocks the pop-up. That is
    // the second silent failure this function used to swallow; it is now an
    // error the caller can show (P2-D routes it into the dialog's error lane).
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      throw new Error(
        `openExternal: opener plugin refused and the webview blocked the pop-up for ${url}`,
      );
    }
  }
}

/**
 * The core's shared `refused: ` prefix (see `workers::ERR_REFUSED`) is
 * routing vocabulary for `api.rs::core_status` to turn into a 409 — it names
 * no channel a human reads. Stripping it here, at the one place every panel's
 * error text passes through, keeps that vocabulary intact for the mapping
 * while a reviewer sees the reason instead of the routing tag it rides on
 * (KI-6). Only the exact, leading prefix: a message that merely mentions the
 * word mid-sentence is left as the core wrote it.
 */
const REFUSED_PREFIX = "refused: ";

/**
 * Errors coming back over IPC are plain strings as often as they are Errors.
 *
 * A message that is nothing but the prefix keeps it: an empty error text
 * tells the reviewer less than the routing tag does (Review W1-09 Runde 3).
 */
export function describeError(error: unknown): string {
  const message = describeErrorRaw(error);
  if (!message.startsWith(REFUSED_PREFIX)) return message;
  const reason = message.slice(REFUSED_PREFIX.length);
  return reason.trim() === "" ? message : reason;
}

function describeErrorRaw(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error);
}
