import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import AttentionInbox from "./components/AttentionInbox";
import BoardRail from "./components/BoardRail";
import BoardView from "./components/BoardView";
import BootstrapScreen from "./components/BootstrapScreen";
import CommandChat from "./components/CommandChat";
import ConversationView from "./components/ConversationView";
import DesignStudio from "./components/DesignStudio";
import DiagnosticsPanel from "./components/DiagnosticsPanel";
import DiffView from "./components/DiffView";
import ErrorBoundary from "./components/ErrorBoundary";
import HistoryView from "./components/HistoryView";
import InsightsView from "./components/InsightsView";
import LearningsPanel from "./components/LearningsPanel";
import LiveStatus from "./components/LiveStatus";
import NewWorkerDialog from "./components/NewWorkerDialog";
import ProfilePicker from "./components/ProfilePicker";
import ProviderDialog from "./components/ProviderDialog";
import QuestionsView from "./components/QuestionsView";
import QueuePanel from "./components/QueuePanel";
import RecommendationsPanel from "./components/RecommendationsPanel";
import SessionRestorePanel from "./components/SessionRestorePanel";
import SettingsView from "./components/SettingsView";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import TabBar from "./components/TabBar";
import TerminalView from "./components/TerminalView";
import ViewBar from "./components/ViewBar";
import WebInterfacePanel from "./components/WebInterfacePanel";
import WorkerPanel from "./components/WorkerPanel";
import { handleTablistKey, tabStop } from "./lib/tabs";
import {
  archiveWorker,
  createOrchestrator,
  createProject,
  createWorker,
  describeError,
  killPty,
  listAgentProfiles,
  listProjects,
  listWorkers,
  getPanicNotice,
  onPtyExit,
  removeProject,
  mergeWorker,
  respawnWorker,
  runWorkerTests,
  sendToOrchestrator,
  setProjectMaxWorkers,
  setProjectTestCommand,
  setWorkerColumnOverride,
  spawnPty,
} from "./lib/ipc";
import { isCoordinatorKind } from "./lib/board";
import { isCategoryActive, loadUiDensity, type UiDensity } from "./lib/settings";
import { GOAL_LABELS, type AppGoal } from "./lib/goals";
import type { InboxEntry } from "./lib/attentionInbox";
import { shortTask } from "./lib/text";
import { useOrchestratorChat } from "./lib/orchestratorChat";
import { useAttentionBlockers } from "./lib/useAttentionBlockers";
import { useBoard } from "./lib/useBoard";
import { useQuestions } from "./lib/useQuestions";
import type {
  AgentProfile,
  BoardColumn,
  CoordinatorInfo,
  Project,
  TerminalSession,
  Worker,
  WorkerDetailView,
} from "./types";

/**
 * Placeholder geometry used at spawn time. `TerminalView` measures the real
 * container on mount and immediately issues a `resize_pty`.
 */
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

/** The active project survives a restart; nothing else in the UI does. */
const ACTIVE_PROJECT_KEY = "projecta.activeProjectId";

/** Whether the board rail is open. A layout choice, so it outlives a restart. */
const RAIL_OPEN_KEY = "projecta.railOpen";

/** Marks an orchestrator tab apart from the worker tabs beside it. */
const ORCHESTRATOR_PREFIX = "◆ Orchestrator";

/** The same for a queen; what follows the separator is its domain. */
const QUEEN_PREFIX = "♛ Queen";

/** How a queen's task text names the domain it coordinates. */
const QUEEN_TASK_PREFIX = "Queen: ";

type BootstrapState = "loading" | "ready" | "error";

/**
 * A queen's domain, or `null` when its task does not carry one — a queen the
 * core started differently still deserves a readable tab.
 */
function queenDomain(task: string): string | null {
  const trimmed = task.trim();
  if (!trimmed.startsWith(QUEEN_TASK_PREFIX)) return null;
  const domain = trimmed.slice(QUEEN_TASK_PREFIX.length).trim();
  return domain === "" ? null : domain;
}

/** The three things there are to look at for one worker. */
const DETAIL_VIEWS: ReadonlyArray<{ id: WorkerDetailView; label: string }> = [
  { id: "terminal", label: "Terminal" },
  { id: "diff", label: "Diff" },
  { id: "history", label: "Verlauf" },
];

function readStoredProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null; // storage disabled — the app works, it just forgets.
  }
}

function readStoredRailOpen(): boolean {
  try {
    // Absent means "never chosen", and the rail is what makes the board
    // visible next to the dialog — so it starts open.
    return localStorage.getItem(RAIL_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeStoredRailOpen(open: boolean): void {
  try {
    localStorage.setItem(RAIL_OPEN_KEY, open ? "true" : "false");
  } catch {
    // Storage disabled — the rail just forgets between runs.
  }
}

function writeStoredProjectId(projectId: string | null): void {
  try {
    if (projectId === null) localStorage.removeItem(ACTIVE_PROJECT_KEY);
    else localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
  } catch {
    // Storage disabled — nothing to do.
  }
}

function AppContent() {
  const [density, setDensity] = useState<UiDensity>(loadUiDensity);
  // Variant B opens on the conversation: the first question the app answers is
  // "what is going on", not "which cards exist".
  const [goal, setGoal] = useState<AppGoal>("work");
  const [workSurface, setWorkSurface] = useState<"dialog" | "board">("dialog");
  // Terminal or diff for the worker whose tab is in front. The choice outlives
  // a tab switch: reviewing two workers in a row should not need two clicks.
  const [detailView, setDetailView] = useState<WorkerDetailView>("terminal");
  // One place for "show this view of the worker": the diff belongs to Review,
  // everything else to Agents. Click and arrow keys share it.
  const selectDetailView = (id: WorkerDetailView) => {
    setDetailView(id);
    setGoal(id === "diff" ? "review" : "agents");
  };
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(readStoredProjectId);
  const [railOpen, setRailOpen] = useState<boolean>(readStoredRailOpen);
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>("loading");

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [busyWorkerId, setBusyWorkerId] = useState<string | null>(null);
  /** Exited worker whose persisted buffer is on screen. Not a live PTY. */
  const [restoreWorkerId, setRestoreWorkerId] = useState<string | null>(null);
  const [busyOrchestratorProjectId, setBusyOrchestratorProjectId] = useState<string | null>(null);

  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // The terminal area shows one pane, or two side by side. `activeSessionId` is
  // always the focused session and `splitSessionId` the other pane's;
  // `splitPrimary` records which side the focused one sits on, so moving focus
  // never makes the two panes swap what they show.
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitSessionId, setSplitSessionId] = useState<string | null>(null);
  const [splitPrimary, setSplitPrimary] = useState(true);

  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [workerDialogOpen, setWorkerDialogOpen] = useState(false);
  const [creatingWorker, setCreatingWorker] = useState(false);
  const [workerDialogError, setWorkerDialogError] = useState<string | null>(null);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The rail shows the board beside every other view, so the full board no
  // longer needs one of its own — and hiding it there keeps the two from
  // saying the same thing twice in one window.
  const railVisible = railOpen && !(goal === "work" && workSurface === "board");

  // Initial fetch, `worker:status` updates and the polling fallback all live in
  // here. It used to sleep on the Workers view; it no longer can. The rail and
  // the status bar's attention count read cards from every view, and a number
  // that says nobody is waiting because the board stopped looking would be
  // worse than no number at all.
  const bootstrapReady = bootstrapState === "ready";
  const board = useBoard(activeProjectId, bootstrapReady);
  const attentionBlockers = useAttentionBlockers(activeProjectId, workers);

  // Owned here for the same reason the board is: the number of open questions
  // is shown on the Fragen segment and in the rail, so it has to be right from
  // every view, not only from the one that lists them. The Fragen view's
  // project/fleet switch lives in this hook for the same reason — the two
  // counters quote the list, so they must be counting the same thing.
  const questions = useQuestions(activeProjectId, bootstrapReady);

  // Owned here, not in a view: the conversation shows up as the main surface
  // and as the command bar under every other view, and switching between them
  // must not restart the thread. The worker list already knows the project's
  // orchestrator row — the live one wins, otherwise the most recent one —
  // and handing its id down is what lets the hook read the history that
  // exists before this session's first message.
  const activeOrchestratorId = useMemo(() => {
    const own = workers.filter(
      (worker) => worker.kind === "orchestrator" && worker.projectId === activeProjectId,
    );
    const live = own.find((worker) => worker.status === "running" && worker.sessionId !== null);
    const latest = own.length > 0 ? own[own.length - 1] : null;
    return (live ?? latest)?.id ?? null;
  }, [workers, activeProjectId]);
  const chat = useOrchestratorChat(activeProjectId, activeOrchestratorId);
  // Der Attention-Eintrag des Orchestrators, den dieser Dialog gerade zeigt.
  // Eine reine Weiterreichung: der Eintrag entsteht in `status.rs` aus einem
  // Reason-Code, das Board projiziert ihn, der Dialog rendert ihn. Fiele diese
  // Zeile weg, hätte der Dialog wieder eine eigene Fehlerwahrheit — genau das
  // verbietet der Plan (P2-D).
  const activeOrchestratorAttention = useMemo(() => {
    if (activeOrchestratorId === null) return null;
    return board.attentionByWorker[activeOrchestratorId] ?? null;
  }, [activeOrchestratorId, board.attentionByWorker]);

  // A panic from the previous run must be visible without knowing Diagnose
  // exists. The tab is the notice; switching onto it is the product
  // requirement (P2-H), not a second banner.
  useEffect(() => {
    let cancelled = false;
    void getPanicNotice()
      .then((notice) => {
        if (!cancelled && notice.current) setGoal("settings");
      })
      .catch(() => {
        /* the Diagnose tab still loads its own copy */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Exit subscriptions live for as long as the session does, independently of
  // whether it currently has a tab: a detached worker still has to flip to
  // `exited` when its agent ends.
  const exitUnlisteners = useRef(new Map<string, UnlistenFn>());

  // Mirrors for callbacks that must not re-bind on every state change.
  const sessionsRef = useRef<TerminalSession[]>(sessions);
  sessionsRef.current = sessions;
  const profilesRef = useRef<AgentProfile[]>(profiles);
  profilesRef.current = profiles;
  const projectsRef = useRef<Project[]>(projects);
  projectsRef.current = projects;
  const workersRef = useRef<Worker[]>(workers);
  workersRef.current = workers;
  // Which project is on screen *now*: an answer read after its await must not
  // write under a project the user has already switched away from.
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const refreshBoardRef = useRef(board.refresh);
  refreshBoardRef.current = board.refresh;

  // -- sessions -------------------------------------------------------------

  const markExited = useCallback((sessionId: string, code: number | null) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.sessionId === sessionId ? { ...session, exited: true, exitCode: code } : session,
      ),
    );
    setWorkers((prev) =>
      prev.map((worker) =>
        worker.sessionId === sessionId
          ? { ...worker, sessionId: null, status: "exited" as const }
          : worker,
      ),
    );
    // The card's status dot and column both hang off this; do not make the
    // board wait for the next poll.
    refreshBoardRef.current();
  }, []);

  const subscribeExit = useCallback(
    async (sessionId: string) => {
      if (exitUnlisteners.current.has(sessionId)) return;
      // The exit event is the last thing this channel ever carries: once it
      // arrives, the listener's job is done. `exitSeen` covers the window
      // where the event fires before `listen` has even resolved.
      let exitSeen = false;
      const unlisten = await onPtyExit(sessionId, (payload) => {
        markExited(sessionId, payload.code);
        exitSeen = true;
        if (exitUnlisteners.current.delete(sessionId)) unlisten();
      });
      // A concurrent call may have won the race while we awaited.
      if (exitUnlisteners.current.has(sessionId)) {
        unlisten();
        return;
      }
      if (exitSeen) {
        unlisten();
        return;
      }
      exitUnlisteners.current.set(sessionId, unlisten);
    },
    [markExited],
  );

  const unsubscribeExit = useCallback((sessionId: string) => {
    const unlisten = exitUnlisteners.current.get(sessionId);
    if (unlisten) {
      unlisten();
      exitUnlisteners.current.delete(sessionId);
    }
  }, []);

  /** Drop the tab. The session itself is somebody else's business. */
  const dropTab = useCallback((sessionId: string) => {
    const current = sessionsRef.current;
    const index = current.findIndex((session) => session.sessionId === sessionId);
    if (index === -1) return;
    const remaining = current.filter((session) => session.sessionId !== sessionId);
    setSessions(remaining);
    setActiveSessionId((active) => {
      if (active !== sessionId) return active;
      const neighbour = remaining[index] ?? remaining[index - 1];
      return neighbour ? neighbour.sessionId : null;
    });
    // Either pane losing its session collapses the split: one session cannot
    // fill two panes, and two terminals on one PTY would fight over its size.
    setSplitSessionId((other) => {
      if (other === sessionId) {
        setSplitOpen(false);
        setSplitPrimary(true);
        return null;
      }
      if (remaining.length < 2) {
        setSplitOpen(false);
        setSplitPrimary(true);
        return null;
      }
      return other;
    });
  }, []);

  /**
   * Closing an ad-hoc tab kills its process — nothing else points at it.
   * Closing a worker tab only detaches: the agent keeps running and the worker
   * panel can bring it back.
   */
  const handleCloseTab = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.sessionId === sessionId);
      dropTab(sessionId);
      if (session?.workerId) return;
      unsubscribeExit(sessionId);
      void killPty(sessionId).catch(() => {
        // The process may already be gone; closing the tab is what matters.
      });
    },
    [dropTab, unsubscribeExit],
  );

  // Drop every event subscription when the app itself goes away.
  useEffect(() => {
    const registry = exitUnlisteners.current;
    return () => {
      for (const unlisten of registry.values()) unlisten();
      registry.clear();
    };
  }, []);

  // -- profiles -------------------------------------------------------------

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfilesError(null);
    try {
      setProfiles(await listAgentProfiles());
    } catch (cause) {
      setProfilesError(describeError(cause));
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const profileName = useCallback(
    (profileId: string) =>
      profilesRef.current.find((profile) => profile.id === profileId)?.name ?? profileId,
    [],
  );

  // -- projects -------------------------------------------------------------

  const projectsToken = useRef(0);

  const loadProjects = useCallback(async (mode: "bootstrap" | "refresh") => {
    const token = ++projectsToken.current;
    if (mode === "bootstrap") setBootstrapState("loading");
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const list = await listProjects();
      if (projectsToken.current !== token) return;
      setProjects(list);
      setActiveProjectId((current) => {
        if (current && list.some((project) => project.id === current)) return current;
        return list[0]?.id ?? null;
      });
      if (mode === "bootstrap") setBootstrapState("ready");
    } catch (cause) {
      if (projectsToken.current !== token) return;
      if (mode === "bootstrap") {
        // Startup errors can contain transport or filesystem details. The full
        // app already has local diagnostics; the first screen stays safe and actionable.
        console.error("ProjectA could not load projects during startup", cause);
        setBootstrapState("error");
      } else {
        setProjectsError(describeError(cause));
      }
    } finally {
      if (projectsToken.current === token) setProjectsLoading(false);
    }
  }, []);

  const refreshProjects = useCallback(() => loadProjects("refresh"), [loadProjects]);

  useEffect(() => {
    void loadProjects("bootstrap");
  }, [loadProjects]);

  useEffect(() => {
    writeStoredProjectId(activeProjectId);
  }, [activeProjectId]);

  const handleCreateProject = useCallback(async (name: string, repoPath: string) => {
    setProjectsError(null);
    try {
      const project = await createProject(name, repoPath);
      setProjects((prev) => [...prev, project]);
      setActiveProjectId(project.id);
      return true;
    } catch (cause) {
      setProjectsError(describeError(cause));
      return false;
    }
  }, []);

  const handleRemoveProject = useCallback(
    (projectId: string) => {
      void (async () => {
        try {
          await removeProject(projectId);
        } catch (cause) {
          setError(describeError(cause));
          return;
        }
        // The core killed every agent of that project; the tabs stay until the
        // user closes them, but they are dead terminals now.
        for (const worker of workersRef.current) {
          if (worker.projectId === projectId && worker.sessionId) {
            markExited(worker.sessionId, null);
          }
        }
        const remaining = projectsRef.current.filter((project) => project.id !== projectId);
        setProjects(remaining);
        setActiveProjectId((current) =>
          current === projectId ? remaining[0]?.id ?? null : current,
        );
      })();
    },
    [markExited],
  );

  // -- workers --------------------------------------------------------------

  // Guards against a slow response for a project the user already left.
  const workersToken = useRef(0);

  const loadWorkers = useCallback(
    async (projectId: string | null) => {
      const token = ++workersToken.current;
      if (!projectId) {
        setWorkers([]);
        setWorkersError(null);
        return;
      }
      setWorkersLoading(true);
      setWorkersError(null);
      try {
        const list = await listWorkers(projectId);
        if (workersToken.current !== token) return;
        setWorkers(list);
        for (const worker of list) {
          if (worker.sessionId) void subscribeExit(worker.sessionId);
        }
      } catch (cause) {
        if (workersToken.current === token) setWorkersError(describeError(cause));
      } finally {
        if (workersToken.current === token) setWorkersLoading(false);
      }
    },
    [subscribeExit],
  );

  useEffect(() => {
    if (!bootstrapReady) return;
    void loadWorkers(activeProjectId);
  }, [activeProjectId, bootstrapReady, loadWorkers]);

  /**
   * A coordinator tab is labelled by what it coordinates, not by a task: the
   * orchestrator by its project, a queen by its domain. Only a worker's tab
   * carries the task itself.
   */
  const sessionTitle = useCallback((worker: Worker) => {
    if (worker.kind === "orchestrator") {
      const project = projectsRef.current.find((entry) => entry.id === worker.projectId);
      return project ? `${ORCHESTRATOR_PREFIX} · ${project.name}` : ORCHESTRATOR_PREFIX;
    }
    if (worker.kind === "queen") {
      const domain = queenDomain(worker.task);
      return domain === null ? QUEEN_PREFIX : `${QUEEN_PREFIX} · ${shortTask(domain)}`;
    }
    return shortTask(worker.task);
  }, []);

  /** Focus the worker's terminal, opening a tab for it if there is none yet. */
  const openWorkerTab = useCallback(
    (worker: Worker) => {
      const sessionId = worker.sessionId;
      if (!sessionId) return;
      setSessions((prev) => {
        if (prev.some((session) => session.sessionId === sessionId)) return prev;
        return [
          ...prev,
          {
            sessionId,
            profileId: worker.profileId,
            profileName: profileName(worker.profileId),
            workerId: worker.id,
            projectId: worker.projectId,
            kind: worker.kind,
            title: sessionTitle(worker),
            exited: false,
            exitCode: null,
          },
        ];
      });
      setActiveSessionId(sessionId);
      setRestoreWorkerId(null);
      void subscribeExit(sessionId);
    },
    [profileName, sessionTitle, subscribeExit],
  );

  /**
   * The project's orchestrator terminal. Already on screen — focus it; already
   * running — attach a tab; otherwise ask the core for one. Only the active
   * project's workers are in memory, so a click on another project's entry
   * re-reads that project's list rather than starting a second orchestrator.
   */
  const handleOpenOrchestrator = useCallback(
    (projectId: string) => {
      if (busyOrchestratorProjectId !== null) return;
      setActiveProjectId(projectId);
      setGoal("agents");

      const openTab = sessionsRef.current.find(
        (session) =>
          session.kind === "orchestrator" && session.projectId === projectId && !session.exited,
      );
      if (openTab) {
        setActiveSessionId(openTab.sessionId);
        return;
      }

      const running = workersRef.current.find(
        (worker) =>
          worker.kind === "orchestrator" &&
          worker.projectId === projectId &&
          worker.status === "running" &&
          worker.sessionId !== null,
      );
      if (running) {
        openWorkerTab(running);
        return;
      }

      if (!isCategoryActive("orchestrator")) {
        setError(
          "Orchestrator-Kategorie ist aus — es wird kein neuer Orchestrator gestartet.",
        );
        return;
      }

      void (async () => {
        setBusyOrchestratorProjectId(projectId);
        try {
          const loaded = await listWorkers(projectId).catch(() => null);
          const live =
            loaded?.find(
              (worker) =>
                worker.kind === "orchestrator" &&
                worker.status === "running" &&
                worker.sessionId !== null,
            ) ?? null;
          const orchestrator = live ?? (await createOrchestrator(projectId));
          setWorkers((prev) =>
            prev.some((entry) => entry.id === orchestrator.id)
              ? prev.map((entry) => (entry.id === orchestrator.id ? orchestrator : entry))
              : [...prev, orchestrator],
          );
          openWorkerTab(orchestrator);
        } catch (cause) {
          setError(describeError(cause));
        } finally {
          setBusyOrchestratorProjectId(null);
        }
      })();
    },
    [busyOrchestratorProjectId, openWorkerTab],
  );

  const openWorkerDialog = useCallback(() => {
    setWorkerDialogError(null);
    setWorkerDialogOpen(true);
    void loadProfiles();
  }, [loadProfiles]);

  const handleCreateWorker = useCallback(
    (task: string, profileId: string, roleVariantId?: string) => {
      const projectId = activeProjectId;
      if (!projectId) return;
      void (async () => {
        setCreatingWorker(true);
        setWorkerDialogError(null);
        try {
          const worker = await createWorker({ projectId, task, profileId, roleVariantId });
          setWorkers((prev) => [...prev, worker]);
          setWorkerDialogOpen(false);
          refreshBoardRef.current();
          // A brand-new agent is worth watching start.
          openWorkerTab(worker);
          setGoal("agents");
        } catch (cause) {
          setWorkerDialogError(describeError(cause));
        } finally {
          setCreatingWorker(false);
        }
      })();
    },
    [activeProjectId, openWorkerTab],
  );

  const handleRespawnWorker = useCallback(
    (worker: Worker) => {
      void (async () => {
        setBusyWorkerId(worker.id);
        try {
          const updated = await respawnWorker(worker.id);
          setWorkers((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
          // The old session is gone; its tab would only replay dead scrollback.
          if (worker.sessionId && worker.sessionId !== updated.sessionId) {
            unsubscribeExit(worker.sessionId);
            dropTab(worker.sessionId);
          }
          refreshBoardRef.current();
          openWorkerTab(updated);
        } catch (cause) {
          setError(describeError(cause));
        } finally {
          setBusyWorkerId(null);
        }
      })();
    },
    [dropTab, openWorkerTab, unsubscribeExit],
  );

  const handleArchiveWorker = useCallback(
    (worker: Worker) => {
      void (async () => {
        setBusyWorkerId(worker.id);
        try {
          const updated = await archiveWorker(worker.id);
          setWorkers((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
          if (worker.sessionId) {
            unsubscribeExit(worker.sessionId);
            dropTab(worker.sessionId);
          }
          refreshBoardRef.current();
        } catch (cause) {
          setError(describeError(cause));
        } finally {
          setBusyWorkerId(null);
        }
      })();
    },
    [dropTab, unsubscribeExit],
  );

  // -- board ----------------------------------------------------------------

  /**
   * A card stands for a running terminal, so opening one means going to that
   * terminal — the board hands the workspace over rather than embedding it.
   */
  const toggleRail = useCallback(() => {
    setRailOpen((open) => {
      writeStoredRailOpen(!open);
      return !open;
    });
  }, []);

  const handleOpenCard = useCallback(
    (worker: Worker) => {
      if (worker.sessionId === null) {
        setRestoreWorkerId(worker.id);
        setDetailView("terminal");
        setGoal("agents");
        return;
      }
      setRestoreWorkerId(null);
      openWorkerTab(worker);
      setDetailView("terminal");
      setGoal("agents");
    },
    [openWorkerTab],
  );

  /** Same jump as opening a card, but landing on the diff instead. */
  const handleOpenCardDiff = useCallback(
    (worker: Worker) => {
      if (worker.sessionId === null) {
        setRestoreWorkerId(worker.id);
        setDetailView("diff");
        setGoal("review");
        return;
      }
      openWorkerTab(worker);
      setDetailView("diff");
      setGoal("review");
    },
    [openWorkerTab],
  );

  /**
   * F2-IA Deep Link: Attention → Work / Agents / Review. Projekt und Task
   * bleiben die Auswahl; nur das Ziel wechselt.
   */
  const handleOpenInbox = useCallback(
    (entry: InboxEntry) => {
      const worker = workersRef.current.find((row) => row.id === entry.workerIds[0]);
      if (entry.goal === "work") {
        setWorkSurface(worker?.kind === "orchestrator" ? "dialog" : "board");
        setGoal("work");
        return;
      }
      if (!worker) return;
      if (entry.goal === "review") handleOpenCardDiff(worker);
      else handleOpenCard(worker);
    },
    [handleOpenCard, handleOpenCardDiff],
  );

  /**
   * A banner chip carries a worker id, not a worker, and `openWorkerTab` needs
   * the real thing. `list_workers` returns every worker of a project with no
   * filter on `kind`, so a coordinator is in the snapshot like any other one —
   * a miss only means the snapshot predates it, and a reload settles that.
   */
  const handleOpenCoordinator = useCallback(
    (coordinator: CoordinatorInfo) => {
      const known = workersRef.current.find((entry) => entry.id === coordinator.workerId);
      if (known) {
        openWorkerTab(known);
        setDetailView("terminal");
        setGoal("agents");
        return;
      }
      const projectId = activeProjectId;
      if (projectId === null) return;
      // The click is a navigation wish either way: the workers view comes up
      // now, and the tab follows once the reload proves the worker exists.
      setDetailView("terminal");
      setGoal("agents");
      void (async () => {
        try {
          const loaded = await listWorkers(projectId);
          // A slow answer must not land under the project the user switched
          // to while it was in flight — same guard as `loadWorkers`.
          if (activeProjectIdRef.current !== projectId) return;
          const worker = loaded.find((entry) => entry.id === coordinator.workerId);
          if (!worker) {
            setError(`${coordinator.label} ist nicht mehr verfügbar.`);
            return;
          }
          setWorkers(loaded);
          openWorkerTab(worker);
        } catch (cause) {
          if (activeProjectIdRef.current !== projectId) return;
          setError(describeError(cause));
        }
      })();
    },
    [activeProjectId, openWorkerTab],
  );

  /** A dispatched queue entry names its worker, but it may not be in the
   * active worker snapshot yet. Reload before opening its terminal tab. */
  const handleFocusQueuedWorker = useCallback(
    (workerId: string) => {
      const projectId = activeProjectId;
      if (projectId === null) return;
      setDetailView("terminal");
      setGoal("agents");
      void (async () => {
        try {
          const loaded = await listWorkers(projectId);
          if (activeProjectIdRef.current !== projectId) return;
          const worker = loaded.find((entry) => entry.id === workerId);
          if (!worker) {
            setError("Der zugeordnete Worker ist noch nicht verfügbar.");
            return;
          }
          setWorkers(loaded);
          openWorkerTab(worker);
        } catch (cause) {
          if (activeProjectIdRef.current !== projectId) return;
          setError(describeError(cause));
        }
      })();
    },
    [activeProjectId, openWorkerTab],
  );

  /**
   * A scout the recommendations panel just started is not in the worker
   * snapshot yet, so it is folded in before its terminal is brought forward.
   */
  const handleOpenScout = useCallback(
    (worker: Worker) => {
      setWorkers((prev) =>
        prev.some((entry) => entry.id === worker.id)
          ? prev.map((entry) => (entry.id === worker.id ? worker : entry))
          : [...prev, worker],
      );
      refreshBoardRef.current();
      openWorkerTab(worker);
      setDetailView("terminal");
      setGoal("agents");
    },
    [openWorkerTab],
  );

  const handleMoveWorker = useCallback((worker: Worker, column: BoardColumn | null) => {
    void (async () => {
      try {
        await setWorkerColumnOverride(worker.id, column);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        // Either the override took and the column moved, or it did not and the
        // card snaps back to whatever the core still believes.
        refreshBoardRef.current();
      }
    })();
  }, []);

  /**
   * Runs the project's test command for one worker. The rejection is passed on
   * deliberately: the board shows it on the card that asked for it, which says
   * more than a banner over the whole board would.
   */
  const handleRunTests = useCallback(async (worker: Worker) => {
    try {
      const updated = await runWorkerTests(worker.id);
      setWorkers((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
    } finally {
      // A verdict landed, or the run blew up mid-way and left the card
      // "running" — either way the card needs the core's current answer.
      refreshBoardRef.current();
    }
  }, []);

  /**
   * Merges one worker's branch. The rejection is handed straight on: the merge
   * dialog shows the core's git/gh output verbatim and stays open with it,
   * which a banner over the board could not do.
   */
  const handleMergeWorker = useCallback(async (worker: Worker, removeWorktree: boolean) => {
    try {
      const updated = await mergeWorker(worker.id, removeWorktree);
      setWorkers((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
    } finally {
      // The core archives the worker on success, so the card only reaches
      // "done" once the board has been refetched — and on failure the card
      // still needs whatever the core believes now.
      refreshBoardRef.current();
    }
  }, []);

  /**
   * Stores the project's test command. The local copy is patched rather than
   * refetched: the board's Tests button hangs off it and should appear the
   * moment the user saves one.
   */
  const handleSetTestCommand = useCallback(
    async (projectId: string, command: string | null) => {
      await setProjectTestCommand(projectId, command);
      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId ? { ...project, testCommand: command } : project,
        ),
      );
    },
    [],
  );

  /**
   * Same shape as the test command above, and for the same reason: settings
   * reads the cap back out of this list, so a write that only reached the core
   * would be undone by the stale entry on the next project switch — silently,
   * because an empty field means "queue default" rather than "unknown".
   */
  const handleSetMaxWorkers = useCallback(
    async (projectId: string, maxWorkers: number | null) => {
      await setProjectMaxWorkers(projectId, maxWorkers);
      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId ? { ...project, maxWorkers } : project,
        ),
      );
    },
    [],
  );

  /**
   * Hands the prompt to the core, which reuses the project's orchestrator or
   * starts one — so there is nothing left for the caller to require. A freshly
   * started orchestrator has to appear on the board at once, hence the refresh.
   */
  const handleSendToOrchestrator = useCallback(async (projectId: string, text: string) => {
    await sendToOrchestrator(projectId, text);
    refreshBoardRef.current();
  }, []);

  // -- ad-hoc sessions (the Phase 1 plus button) ----------------------------

  const openPicker = useCallback(() => {
    setPickerOpen(true);
    void loadProfiles();
  }, [loadProfiles]);

  const handlePick = useCallback(
    (profile: AgentProfile) => {
      setPickerOpen(false);
      void (async () => {
        setSpawning(true);
        try {
          const sessionId = await spawnPty({
            profileId: profile.id,
            cols: INITIAL_COLS,
            rows: INITIAL_ROWS,
          });
          setSessions((prev) => [
            ...prev,
            {
              sessionId,
              profileId: profile.id,
              profileName: profile.name,
              workerId: null,
              projectId: null,
              kind: "worker" as const,
              title: profile.name,
              exited: false,
              exitCode: null,
            },
          ]);
          setActiveSessionId(sessionId);
          await subscribeExit(sessionId);
        } catch (cause) {
          setError(describeError(cause));
        } finally {
          setSpawning(false);
        }
      })();
    },
    [subscribeExit],
  );

  /**
   * Pick a session from the tab bar. While the split is open the pick lands in
   * the focused pane — unless it is already the other pane's session, in which
   * case focus simply moves there rather than showing it twice.
   */
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (sessionId === splitSessionId) {
        setSplitSessionId(activeSessionId);
        setActiveSessionId(sessionId);
        setSplitPrimary((primary) => !primary);
        return;
      }
      setActiveSessionId(sessionId);
    },
    [activeSessionId, splitSessionId],
  );

  // -- render ---------------------------------------------------------------

  const activeSession = sessions.find((session) => session.sessionId === activeSessionId) ?? null;
  const splitSession = sessions.find((session) => session.sessionId === splitSessionId) ?? null;
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  // Only an ordinary worker has a branch to diff or a message history; ad-hoc
  // tabs and the orchestrator do not, so they never get the switch.
  const restoreWorker =
    restoreWorkerId === null
      ? null
      : (workers.find((worker) => worker.id === restoreWorkerId) ?? null);
  const activeWorker =
    activeSession && activeSession.kind === "worker" && activeSession.workerId !== null
      ? workers.find((worker) => worker.id === activeSession.workerId) ?? null
      : restoreWorker?.kind === "worker"
        ? restoreWorker
        : null;
  const showDiff =
    activeWorker !== null &&
    (detailView === "diff" || (goal === "review" && detailView !== "history"));
  const showHistory = activeWorker !== null && detailView === "history";
  const showTerminal = !showDiff && !showHistory;
  // Splits only make sense in terminal view; diff and history stay single-pane.
  const splitVisible = showTerminal && splitOpen;
  // Left pane, right pane. Which side holds the focused session is `splitPrimary`.
  const paneSessions: Array<TerminalSession | null> = splitPrimary
    ? [activeSession, splitSession]
    : [splitSession, activeSession];
  // Orchestrators are coordinators, not tasks: they are not counted as workers.
  const taskWorkerCount = workers.filter((worker) => worker.kind === "worker").length;
  const liveOrchestratorProjectIds = workers
    .filter(
      (worker) =>
        worker.kind === "orchestrator" &&
        worker.status === "running" &&
        worker.sessionId !== null,
    )
    .map((worker) => worker.projectId);

  // The fleet's one interrupting number. It comes off the board cards, which
  // the status bar cannot read itself, and stays right even when the rail is
  // collapsed away.
  const attentionCount = board.cards.filter(
    (card) => card.column === "needs_you" && !isCoordinatorKind(card.worker.kind),
  ).length;

  if (!bootstrapReady) {
    return (
      <BootstrapScreen
        error={bootstrapState === "error"}
        onRetry={() => void loadProjects("bootstrap")}
      />
    );
  }

  return (
    <div className={`app${railVisible ? " app-railed" : ""}`} data-density={density}>
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        loading={projectsLoading}
        error={projectsError}
        onCreate={handleCreateProject}
        onSelect={setActiveProjectId}
        onRemove={handleRemoveProject}
        onOpenOrchestrator={handleOpenOrchestrator}
        onSendToOrchestrator={handleSendToOrchestrator}
        liveOrchestratorProjectIds={liveOrchestratorProjectIds}
        busyOrchestratorProjectId={busyOrchestratorProjectId}
        onRefreshProjects={() => void refreshProjects()}
      >
        <QueuePanel
          projectId={activeProjectId}
          profiles={profiles}
          profilesLoading={profilesLoading}
          onFocusWorker={handleFocusQueuedWorker}
          onOpenQuestions={() => setGoal("attention")}
        />
        <RecommendationsPanel projectId={activeProjectId} onOpenWorker={handleOpenScout} />
        {/* Below the suggestions on purpose: the same inbox rhythm, one step later. */}
        <LearningsPanel projectId={activeProjectId} />
        {/* A switch, not a view: the interface itself opens in the browser. */}
        <WebInterfacePanel />
        {/* The board supersedes the panel; only one of them is on screen. */}
        {goal === "agents" || goal === "review" ? (
          <WorkerPanel
            workers={workers}
            profiles={profiles}
            activeWorkerId={activeSession?.workerId ?? restoreWorkerId}
            hasProject={activeProject !== null}
            loading={workersLoading}
            error={workersError}
            busyWorkerId={busyWorkerId}
            onNew={openWorkerDialog}
            onOpen={handleOpenCard}
            onRespawn={handleRespawnWorker}
            onArchive={handleArchiveWorker}
          />
        ) : null}
      </Sidebar>
      {railVisible ? (
        <BoardRail
          cards={board.cards}
          activeWorkerId={activeSession?.workerId ?? restoreWorkerId}
          hasProject={activeProject !== null}
          loading={board.loading}
          error={board.error}
          onOpen={handleOpenCard}
          onOpenBoard={() => {
            setWorkSurface("board");
            setGoal("work");
          }}
          openQuestions={questions.open.length}
          questionsFleetWide={questions.scope === "all"}
          onOpenQuestions={() => setGoal("attention")}
          onCollapse={toggleRail}
        />
      ) : null}
      <main className="main">
        <LiveStatus
          view={GOAL_LABELS[goal]}
          questions={questions.open.length}
          attention={attentionCount}
        />
        <ViewBar
          goal={goal}
          workSurface={workSurface}
          onChange={(next) => {
            setGoal(next);
            if (next === "work") setWorkSurface("dialog");
            if (next === "agents") setDetailView("terminal");
            if (next === "review") setDetailView("diff");
          }}
          projectName={activeProject?.name ?? null}
          workerCount={taskWorkerCount}
          questionCount={questions.open.length}
          questionsFleetWide={questions.scope === "all"}
          onNewWorker={openWorkerDialog}
          newWorkerDisabled={activeProject === null || !isCategoryActive("worker")}
          railOpen={railOpen}
          onToggleRail={toggleRail}
        />
        {goal === "work" && workSurface === "dialog" ? (
          <ErrorBoundary label="Die Unterhaltung">
            <div className="convo-area" key="convo-area" id="goal-panel" role="tabpanel" aria-labelledby={`goal-tab-${goal}`}>
              <ConversationView
                // A different project is a different conversation: the draft,
                // the scroll position and a stale enhance error all belong to
                // the one being left behind.
                key={activeProjectId ?? "none"}
                chat={chat}
                runtimeAttention={activeOrchestratorAttention}
                projectId={activeProjectId}
                projectName={activeProject?.name ?? null}
                onOpenOrchestrator={() => {
                  if (activeProjectId !== null) handleOpenOrchestrator(activeProjectId);
                }}
                onOpenQuestions={() => setGoal("attention")}
              />
            </div>
          </ErrorBoundary>
        ) : goal === "work" ? (
          <ErrorBoundary label="Das Board">
            <div className="board-area" key="board-area" id="goal-panel" role="tabpanel" aria-labelledby={`goal-tab-${goal}`}>
              <BoardView
                cards={board.cards}
                coordinators={board.coordinators}
                profiles={profiles}
                activeWorkerId={activeSession?.workerId ?? restoreWorkerId}
                hasProject={activeProject !== null}
                testCommand={activeProject?.testCommand ?? null}
                githubRemote={activeProject?.githubRemote ?? false}
                loading={board.loading}
                error={board.error}
                busyWorkerId={busyWorkerId}
                onNew={openWorkerDialog}
                onOpen={handleOpenCard}
                onOpenDiff={handleOpenCardDiff}
                onRespawn={handleRespawnWorker}
                onMove={handleMoveWorker}
                onOpenCoordinator={handleOpenCoordinator}
                onRunTests={handleRunTests}
                onMerge={handleMergeWorker}
              />
            </div>
          </ErrorBoundary>
        ) : goal === "attention" ? (
          <ErrorBoundary label="Die Fragen">
            <div className="questions-area" key="questions-area" id="goal-panel" role="tabpanel" aria-labelledby={`goal-tab-${goal}`}>
              <AttentionInbox
                cards={board.cards}
                workers={workers}
                projectId={activeProjectId}
                blockers={attentionBlockers.blockers}
                blockersError={attentionBlockers.error}
                onOpen={handleOpenInbox}
              />
              <QuestionsView
                questions={questions}
                projects={projects}
                activeProjectId={activeProjectId}
                workers={workers}
                onOpenWorker={handleOpenCard}
              />
            </div>
          </ErrorBoundary>
        ) : goal === "insights" ? (
          <ErrorBoundary label="Insights">
            <div className="goal-passthrough" key="insights-area" id="goal-panel" role="tabpanel" aria-labelledby={`goal-tab-${goal}`}>
              <InsightsView
                profiles={profiles}
                cards={board.cards}
                workers={workers}
                projectId={activeProjectId}
              />
            </div>
          </ErrorBoundary>
        ) : goal === "settings" ? (
          <ErrorBoundary label="Die Einstellungen">
            <div className="settings-area" key="settings-area" id="goal-panel" role="tabpanel" aria-labelledby={`goal-tab-${goal}`}>
              <SettingsView
                density={density}
                onDensityChange={setDensity}
                profiles={profiles}
                project={activeProject}
                onSaveTestCommand={(command) =>
                  // Only reachable with a project on screen; the section is
                  // disabled without one.
                  activeProject === null
                    ? Promise.resolve()
                    : handleSetTestCommand(activeProject.id, command)
                }
                onSaveMaxWorkers={(maxWorkers) =>
                  activeProject === null
                    ? Promise.resolve()
                    : handleSetMaxWorkers(activeProject.id, maxWorkers)
                }
              />
              <section className="settings-landing" aria-label="Landing Page">
                <h2 className="section-title">Landing Page</h2>
                <DesignStudio projectId={activeProjectId} />
              </section>
              <section className="settings-diagnose" aria-label="Diagnose">
                <DiagnosticsPanel />
              </section>
            </div>
          </ErrorBoundary>
        ) : (
          <ErrorBoundary label="Der Arbeitsbereich">
            <div className="goal-passthrough" key="workspace-area" id="goal-panel" role="tabpanel" aria-labelledby={`goal-tab-${goal}`}>
              <TabBar
                sessions={sessions}
                activeSessionId={activeSessionId}
                splitOpen={splitVisible}
                splitEnabled={sessions.length > 1 && showTerminal}
                onSelect={handleSelectSession}
                onClose={handleCloseTab}
                onToggleSplit={() => {
                  if (splitVisible) {
                    setSplitOpen(false);
                    setSplitSessionId(null);
                    setSplitPrimary(true);
                    return;
                  }
                  // The second pane opens on the neighbouring tab, which is the
                  // one the user was most likely looking at before this one.
                  const index = sessions.findIndex(
                    (session) => session.sessionId === activeSessionId,
                  );
                  const other =
                    sessions[index + 1] ??
                    sessions[index - 1] ??
                    sessions.find((session) => session.sessionId !== activeSessionId);
                  if (!other || other.sessionId === activeSessionId) return;
                  setSplitSessionId(other.sessionId);
                  setSplitPrimary(true);
                  setSplitOpen(true);
                }}
                onNew={openPicker}
                newDisabled={spawning}
              />
              {activeWorker ? (
                <div className="detailbar">
                  <span className="detailbar-branch" title={activeWorker.worktreePath}>
                    {activeWorker.branch}
                  </span>
                  <span className="detailbar-spacer" />
                  <div
                    className="segmented"
                    role="tablist"
                    aria-label="Worker view"
                    onKeyDown={(event) =>
                      handleTablistKey(
                        event,
                        DETAIL_VIEWS.findIndex((entry) => entry.id === detailView),
                        DETAIL_VIEWS.length,
                        (index) => selectDetailView(DETAIL_VIEWS[index].id),
                      )
                    }
                  >
                    {DETAIL_VIEWS.map((entry, index) => (
                      <button
                        key={entry.id}
                        id={`detail-tab-${entry.id}`}
                        type="button"
                        role="tab"
                        aria-selected={detailView === entry.id}
                        aria-controls="detail-panel"
                        tabIndex={tabStop(
                          detailView === entry.id,
                          index,
                          DETAIL_VIEWS.some((candidate) => candidate.id === detailView),
                        )}
                        className={`segment${detailView === entry.id ? " segment-active" : ""}`}
                        onClick={() => selectDetailView(entry.id)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div
                className={`terminal-area${splitVisible ? " terminal-area-split" : ""}`}
                id="detail-panel"
                role="tabpanel"
                aria-labelledby={`detail-tab-${detailView}`}
              >
                {showHistory && activeWorker ? (
                  <HistoryView key={activeWorker.id} workerId={activeWorker.id} />
                ) : showDiff && activeWorker ? (
                  <DiffView
                    key={activeWorker.id}
                    workerId={activeWorker.id}
                    branch={activeWorker.branch}
                  />
                ) : splitVisible ? (
                  // Each side keeps its own session. Focusing a pane swaps which
                  // id is called "active", never what either pane shows.
                  paneSessions.map((pane, index) => (
                    <div
                      key={pane?.sessionId ?? `empty-${index}`}
                      className={`terminal-pane${
                        pane !== null && pane.sessionId === activeSessionId
                          ? " terminal-pane-active"
                          : ""
                      }`}
                      onClick={() => {
                        if (pane !== null) handleSelectSession(pane.sessionId);
                      }}
                    >
                      {pane ? (
                        <TerminalView
                          key={pane.sessionId}
                          sessionId={pane.sessionId}
                          onError={setError}
                        />
                      ) : null}
                    </div>
                  ))
                ) : activeSession ? (
                  <TerminalView
                    key={activeSession.sessionId}
                    sessionId={activeSession.sessionId}
                    onError={setError}
                  />
                ) : restoreWorker && restoreWorker.sessionId === null ? (
                  <SessionRestorePanel
                    worker={restoreWorker}
                    busy={busyWorkerId === restoreWorker.id}
                    onRespawn={() => handleRespawnWorker(restoreWorker)}
                  />
                ) : (
                  <div className="empty-state">
                    {!activeProject ? (
                      <p>Wähle ein Projekt oder erstelle eines über das + in der Sidebar.</p>
                    ) : goal === "review" && !activeWorker ? (
                      <p>Kein Diff — eine Task aus der Board-Leiste oder Attention wählen.</p>
                    ) : (
                      <p>No terminal sessions.</p>
                    )}
                    <div className="empty-actions">
                      {activeProject ? (
                        <button type="button" className="empty-action" onClick={openWorkerDialog}>
                          New worker
                        </button>
                      ) : null}
                      <button type="button" className="empty-action-ghost" onClick={openPicker}>
                        Ad-hoc session
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ErrorBoundary>
        )}
        {/* Sits above the status bar so it never covers the terminal. The
            dialog view has the same conversation full-size, so the bar would
            only be a second composer there. */}
        {goal === "work" && workSurface === "dialog" ? null : (
          <CommandChat
            chat={chat}
            projectId={activeProjectId}
            onOpenConversation={() => {
              setWorkSurface("dialog");
              setGoal("work");
            }}
          />
        )}
        <StatusBar
          session={activeSession}
          sessionCount={sessions.length}
          error={error}
          attentionCount={attentionCount}
          onOpenBoard={() => {
            setWorkSurface("board");
            setGoal("work");
          }}
          onDismissError={() => setError(null)}
          onOpenProviders={() => setProviderDialogOpen(true)}
        />
      </main>
      {pickerOpen ? (
        <ProfilePicker
          profiles={profiles}
          loading={profilesLoading}
          error={profilesError}
          onPick={handlePick}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
      {workerDialogOpen && activeProject ? (
        <NewWorkerDialog
          projectId={activeProject.id}
          projectName={activeProject.name}
          // A disabled profile cannot be spawned, so offering it here would
          // only grow an error after the fact.
          profiles={profiles.filter((profile) => profile.enabled)}
          profilesLoading={profilesLoading}
          error={workerDialogError ?? profilesError}
          busy={creatingWorker}
          onSubmit={handleCreateWorker}
          onClose={() => setWorkerDialogOpen(false)}
        />
      ) : null}
      {providerDialogOpen ? (
        <ProviderDialog onClose={() => setProviderDialogOpen(false)} />
      ) : null}
    </div>
  );
}

/**
 * The app-wide net: a render error that escapes a view slot's own boundary
 * lands here and leaves a calm surface with a reload instead of a white
 * window. The default export keeps the name `App`, so main.tsx is untouched.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
