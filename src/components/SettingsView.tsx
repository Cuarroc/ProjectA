import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

import {
  describeError,
  deleteSessionBuffers,
  getBudgets,
  getDigestEnabled,
  getLearningSettings,
  getProjectSetupCommand,
  getRoutingStatus,
  getStuckAfterMinutes,
  listAgentProfiles,
  listLiveSessions,
  installUpdateWhenIdle,
  setBudget,
  setCategoryLearning,
  setDigestEnabled,
  setProductMode,
  setProfileEnabled,
  setProjectSetupCommand,
  setStuckAfterMinutes,
  type ProductMode,
  type RoutingStatus,
} from "../lib/ipc";
import {
  agentCategoryDescription,
  isMasterPromptEnabled,
  loadAgentCategories,
  loadMasterPrompt,
  loadWebPort,
  saveUiDensity,
  saveAgentCategories,
  saveMasterPrompt,
  saveWebPort,
  setMasterPromptEnabled,
  type UiDensity,
} from "../lib/settings";
import { handleTablistKey, tabStop } from "../lib/tabs";
import type { AgentCategoryConfig, AgentProfile, Budget, Project } from "../types";

type SettingsTab = "allgemein" | "masterprompt" | "agenten" | "updates";

const TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "allgemein", label: "Allgemein" },
  { id: "masterprompt", label: "Masterprompt" },
  { id: "agenten", label: "Agent-Kategorien" },
  { id: "updates", label: "Updates" },
];

const CATEGORY_LABELS: Record<AgentCategoryConfig["id"], string> = {
  worker: "Worker",
  queen: "Queen",
  employee: "Employee",
  scout: "Scout",
  orchestrator: "Orchestrator",
};

/**
 * The worker cap as the field shows it: an empty field is `null`, "no
 * project-owned limit". Zero is a value of its own and stays visible as `0`.
 */
function formatMaxWorkers(maxWorkers: number | null): string {
  return maxWorkers === null ? "" : String(maxWorkers);
}

/**
 * A budget ceiling as its input field shows it: an empty field is "no
 * ceiling", which is a different value from any number.
 */
function formatPercent(percent: number | null | undefined): string {
  return percent === null || percent === undefined ? "" : String(percent);
}

/**
 * One field's text back to what the core stores. `null` clears the ceiling;
 * the error is the field's own, because a bad number must not be sent and
 * must not silently become "no ceiling" either.
 */
function parsePercent(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const percent = Number.parseInt(trimmed, 10);
  return percent >= 1 && percent <= 100 ? percent : "invalid";
}

/**
 * The categories the core runs a learning critic for. `employee` is absent on
 * purpose: it has no critic, so it gets no switch to promise one.
 */
const LEARNING_CATEGORIES: ReadonlySet<AgentCategoryConfig["id"]> = new Set([
  "worker",
  "queen",
  "orchestrator",
  "scout",
]);

/**
 * Legacy updater token (pre-mirror): clean up old key from localStorage on mount.
 * The update feed is the public mirror repo `Cuarroc/ProjectA-updates` — the check
 * runs anonymously and never needs a GitHub token. Any stored token is a leftover
 * of the old private-release model.
 */
const LEGACY_UPDATER_TOKEN_KEY = "projecta.settings.updater.github_token";

/** The update flow as the Updates tab renders it. */
type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "up-to-date"; version: string | null }
  | { phase: "available"; version: string; notes: string | null; activeWorkers: number }
  | { phase: "installing"; version: string }
  | { phase: "ready"; version: string }
  | { phase: "error"; message: string };

interface SettingsViewProps {
  density: UiDensity;
  onDensityChange: (density: UiDensity) => void;
  /** What `list_agent_profiles` offers; the categories pick their default from it. */
  profiles: AgentProfile[];
  /**
   * The active project, or `null` when none is selected. The whole project is
   * passed rather than only its command: the section names the project it is
   * about, and without one it has nothing to edit at all.
   */
  project: Project | null;
  /** Persists the project's test command; `null` drops the gate. */
  onSaveTestCommand: (command: string | null) => Promise<void>;
  /** Persists the project's worker cap; `null` means default and `0` pauses dispatch. */
  onSaveMaxWorkers: (maxWorkers: number | null) => Promise<void>;
}

/**
 * The app's own settings, kept in the webview's localStorage — except the test
 * command, which belongs to the project and therefore lives in the core.
 */
export default function SettingsView({
  density,
  onDensityChange,
  profiles,
  project,
  onSaveTestCommand,
  onSaveMaxWorkers,
}: SettingsViewProps) {
  const [tab, setTab] = useState<SettingsTab>("allgemein");

  // -- Allgemein -------------------------------------------------------------
  const [portInput, setPortInput] = useState(() => {
    const port = loadWebPort();
    return port === null ? "" : String(port);
  });
  const [portError, setPortError] = useState<string | null>(null);

  const handleSavePort = () => {
    const raw = portInput.trim();
    if (raw === "") {
      setPortError(null);
      saveWebPort(null);
      return;
    }
    const port = Number.parseInt(raw, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setPortError("Bitte eine Portnummer zwischen 1 und 65535 angeben.");
      return;
    }
    setPortError(null);
    saveWebPort(port);
  };

  // The digest switch is the core's too: the hourly thread that reads it runs
  // there, and a per-webview copy would be a second, quieter truth.
  const [digestEnabled, setDigestEnabledState] = useState(true);
  const [digestError, setDigestError] = useState<string | null>(null);

  useEffect(() => {
    void getDigestEnabled()
      .then(setDigestEnabledState)
      .catch((cause: unknown) => setDigestError(describeError(cause)));
  }, []);

  const handleToggleDigest = (enabled: boolean) => {
    const previous = digestEnabled;
    // Optimistic, like the learning switches: only a failing write takes the
    // box back, with the reason beside it.
    setDigestEnabledState(enabled);
    setDigestError(null);
    void setDigestEnabled(enabled)
      .then(() => flashSaved(enabled ? "Digest an." : "Digest aus."))
      .catch((cause: unknown) => {
        setDigestEnabledState(previous);
        setDigestError(describeError(cause));
      });
  };

  // The stuck threshold belongs to the core, like the learning switches: the
  // tick that reads it runs there. An empty field means "the core's default",
  // which is a value of its own and not the same as any number.
  const [stuckInput, setStuckInput] = useState("");
  const [stuckError, setStuckError] = useState<string | null>(null);
  const [savingStuck, setSavingStuck] = useState(false);

  useEffect(() => {
    void getStuckAfterMinutes()
      .then((minutes) => setStuckInput(minutes === null ? "" : String(minutes)))
      .catch((cause: unknown) => setStuckError(describeError(cause)));
  }, []);

  const handleSaveStuck = () => {
    const raw = stuckInput.trim();
    let minutes: number | null = null;
    if (raw !== "") {
      if (!/^\d+$/.test(raw)) {
        setStuckError("Bitte eine ganze Zahl in Minuten angeben — leer heißt Standard.");
        return;
      }
      minutes = Number.parseInt(raw, 10);
    }
    setSavingStuck(true);
    setStuckError(null);
    void setStuckAfterMinutes(minutes)
      .then(() =>
        flashSaved(
          minutes === null
            ? "Stuck-Schwelle: Standard."
            : `Stuck-Schwelle: ${minutes} min.`,
        ),
      )
      .catch((cause: unknown) => setStuckError(describeError(cause)))
      .finally(() => setSavingStuck(false));
  };

  const [routing, setRouting] = useState<RoutingStatus | null>(null);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [savingRouting, setSavingRouting] = useState(false);

  useEffect(() => {
    void getRoutingStatus()
      .then(setRouting)
      .catch((cause: unknown) => setRoutingError(describeError(cause)));
  }, []);

  const handleProductMode = (mode: ProductMode) => {
    const previous = routing;
    setRouting((current) => (current ? { ...current, mode } : current));
    setRoutingError(null);
    setSavingRouting(true);
    void setProductMode(mode)
      .then(() => getRoutingStatus())
      .then((next) => {
        setRouting(next);
        flashSaved(`Routing: ${mode}.`);
      })
      .catch((cause: unknown) => {
        setRouting(previous);
        setRoutingError(describeError(cause));
      })
      .finally(() => setSavingRouting(false));
  };

  const [testCommandInput, setTestCommandInput] = useState(project?.testCommand ?? "");
  const [testCommandError, setTestCommandError] = useState<string | null>(null);
  const [savingTestCommand, setSavingTestCommand] = useState(false);

  // Switching projects — or a save landing — must not leave the previous
  // project's command sitting in the field. The saving lock resets too: a
  // late answer of the old project's save must not hold or lift the new
  // project's button (review-F4-r9, sibling of the setup field).
  useEffect(() => {
    setTestCommandInput(project?.testCommand ?? "");
    setTestCommandError(null);
    setSavingTestCommand(false);
  }, [project?.id, project?.testCommand]);

  // The cap goes through a prop like the test command does: the core is not
  // the only reader. The project list in App carries `maxWorkers`, and the
  // effect below feeds this field from it, so a write that only reached the
  // core would be overwritten by the stale prop on the next project switch.
  const [maxWorkersInput, setMaxWorkersInput] = useState(() =>
    formatMaxWorkers(project?.maxWorkers ?? null),
  );
  const [maxWorkersError, setMaxWorkersError] = useState<string | null>(null);
  const [savingMaxWorkers, setSavingMaxWorkers] = useState(false);

  useEffect(() => {
    setMaxWorkersInput(formatMaxWorkers(project?.maxWorkers ?? null));
    setMaxWorkersError(null);
  }, [project?.id, project?.maxWorkers]);

  // A save outlives a project switch: the sidebar stays on screen next to this
  // view, so the answer can arrive after the user moved on. Every late write
  // checks whose project is on screen now — otherwise one project's cap lands
  // in another project's field, and the next click would store it there.
  const shownProjectId = useRef<string | null>(project?.id ?? null);
  useEffect(() => {
    shownProjectId.current = project?.id ?? null;
  }, [project?.id]);

  const handleSaveMaxWorkers = () => {
    if (project === null) return;
    const raw = maxWorkersInput.trim();
    // Empty is `null` — the default — and that is a different value from 0.
    let limit: number | null = null;
    if (raw !== "") {
      // Digits only: this rejects negatives, decimals and a stray sign before
      // the core ever sees them.
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number.parseInt(raw, 10))) {
        setMaxWorkersError("Bitte eine ganze Zahl ab 0 angeben — leer bedeutet Standard.");
        return;
      }
      limit = Number.parseInt(raw, 10);
    }
    const { id: projectId, name: projectName, maxWorkers: previous } = project;
    setSavingMaxWorkers(true);
    setMaxWorkersError(null);
    void onSaveMaxWorkers(limit)
      .then(() => {
        flashSaved(
          limit === null
            ? `Worker-Limit: Standard — ${projectName}.`
            : limit === 0
              ? `Worker-Limit: Dispatcher aus — ${projectName}.`
              : `Worker-Limit: ${limit} — ${projectName}.`,
        );
        // The prop now carries what was stored, so the field only needs the
        // written value in its canonical spelling — "007" becomes "7".
        if (shownProjectId.current !== projectId) return;
        setMaxWorkersInput(formatMaxWorkers(limit));
      })
      .catch((cause: unknown) => {
        if (shownProjectId.current !== projectId) {
          // The field below now belongs to another project; putting this error
          // there would blame the wrong one. Say it once, by name, instead.
          flashSaved(`Worker-Limit für ${projectName} nicht gespeichert.`);
          return;
        }
        // Back to what the project had; a failed write must not leave a number
        // on screen that nothing stored.
        setMaxWorkersInput(formatMaxWorkers(previous));
        setMaxWorkersError(describeError(cause));
      })
      .finally(() => setSavingMaxWorkers(false));
  };

  const handleSaveTestCommand = () => {
    if (project === null) return;
    const { id: projectId, name: projectName } = project;
    const trimmed = testCommandInput.trim();
    setSavingTestCommand(true);
    setTestCommandError(null);
    void onSaveTestCommand(trimmed === "" ? null : trimmed)
      .then(() => {
        flashSaved(
          trimmed === ""
            ? `Test-Gate entfernt — ${projectName}.`
            : `Test-Kommando gespeichert — ${projectName}.`,
        );
      })
      .catch((cause: unknown) => {
        if (shownProjectId.current !== projectId) {
          flashSaved(`Test-Kommando für ${projectName} nicht gespeichert.`);
          return;
        }
        setTestCommandError(describeError(cause));
      })
      .finally(() => {
        if (shownProjectId.current === projectId) setSavingTestCommand(false);
      });
  };

  // The setup command is not part of the Project wire (unlike the test
  // command), so the field reads it back from the core on every project
  // switch instead of trusting a prop. Until the read for the *current*
  // project has landed, field and save button stay dead — otherwise a fast
  // project switch could save the previous project's command into this one
  // (review-F4-r4, Sonnet Fund 1).
  const [setupCommandInput, setSetupCommandInput] = useState("");
  const [setupCommandOriginal, setSetupCommandOriginal] = useState("");
  const [setupCommandLoadedFor, setSetupCommandLoadedFor] = useState<string | null>(null);
  const [setupCommandError, setSetupCommandError] = useState<string | null>(null);
  const [savingSetupCommand, setSavingSetupCommand] = useState(false);
  // Bump to reload after a failed read — otherwise a transient error (DB
  // lock) would lock the field until the user switches projects
  // (review-F4-r16, Opus Fund 6).
  const [setupLoadAttempt, setSetupLoadAttempt] = useState(0);
  const setupProjectId = project?.id ?? null;

  useEffect(() => {
    setSetupCommandError(null);
    setSetupCommandInput("");
    setSetupCommandLoadedFor(null);
    setSavingSetupCommand(false);
    if (setupProjectId === null) {
      return;
    }
    let cancelled = false;
    void getProjectSetupCommand(setupProjectId)
      .then((command) => {
        if (cancelled) return;
        setSetupCommandInput(command ?? "");
        setSetupCommandOriginal(command ?? "");
        setSetupCommandLoadedFor(setupProjectId);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setSetupCommandError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [setupProjectId, setupLoadAttempt]);

  const handleSaveSetupCommand = () => {
    if (project === null || setupCommandLoadedFor !== project.id) return;
    // A save outlives a project switch (same discipline as the worker cap
    // below): the callbacks name the project they wrote to instead of
    // flashing a bare success under another project's field (review-F4-r7).
    const { id: projectId, name: projectName } = project;
    const trimmed = setupCommandInput.trim();
    setSavingSetupCommand(true);
    setSetupCommandError(null);
    void setProjectSetupCommand(projectId, trimmed === "" ? null : trimmed)
      .then(() => {
        flashSaved(
          trimmed === ""
            ? setupCommandOriginal === ""
              ? // Empty over empty removes nothing — say so (r22, Opus B6).
                `Setup-Kommando unverändert leer — ${projectName}.`
              : `Setup-Kommando entfernt — ${projectName}.`
            : trimmed === setupCommandOriginal
              ? `Setup-Kommando gespeichert, unverändert — ${projectName}.`
              : `Setup-Kommando gespeichert, bisherige Freigabe verfallen — ${projectName}.`,
        );
        // An idempotent save voids nothing — the store keeps the grant — so
        // the toast must not claim otherwise (r21, Opus B4). The baseline
        // update obeys the same switch discipline as every other write in
        // this handler: a late answer of another project must not poison it
        // (r22, k3 Fund 2).
        if (shownProjectId.current === projectId) setSetupCommandOriginal(trimmed);
      })
      .catch((cause: unknown) => {
        if (shownProjectId.current !== projectId) {
          // The field below now belongs to another project; putting this
          // error there would blame the wrong one. Say it once, by name.
          flashSaved(`Setup-Kommando für ${projectName} nicht gespeichert.`);
          return;
        }
        setSetupCommandError(describeError(cause));
      })
      .finally(() => {
        // A late answer of the previous project's save must not unlock the
        // field the current project is looking at (review-F4-r8).
        if (shownProjectId.current === projectId) setSavingSetupCommand(false);
      });
  };

  // -- Updates ---------------------------------------------------------------
  // The running version comes from the app itself; the core has no version
  // IPC, and outside the desktop app (plain Vite) there is no answer at all.
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [versionFailed, setVersionFailed] = useState(false);

  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch(() => setVersionFailed(true));
    // Clean up pre-mirror leftover token (NT-6 follow-up).
    try {
      localStorage.removeItem(LEGACY_UPDATER_TOKEN_KEY);
    } catch {
      // storage disabled — ignore.
    }
  }, []);

  const [updateState, setUpdateState] = useState<UpdateState>({ phase: "idle" });
  // The update object is the core's download handle, not something to render.
  const pendingUpdate = useRef<Update | null>(null);
  const [relaunchFailed, setRelaunchFailed] = useState(false);

  const handleCheckUpdates = () => {
    setUpdateState({ phase: "checking" });
    void (async () => {
      try {
        // The update feed is the public mirror repo Cuarroc/ProjectA-updates —
        // the check runs anonymously and never sends an Authorization header.
        const update = await check();
        if (update === null || !update.available) {
          pendingUpdate.current = null;
          setUpdateState({ phase: "up-to-date", version: update?.currentVersion ?? appVersion });
          return;
        }
        pendingUpdate.current = update;
        // PTY/worker safety (Sanierungsplan §2.1.7): applying an update means
        // a relaunch, and a relaunch kills every agent session — so even the
        // download is only offered while nothing runs. Measured by live PTY
        // sessions (processes), not worker status: after a restart a worker
        // can claim "running" without any process behind it.
        const liveSessions = await listLiveSessions();
        setUpdateState({
          phase: "available",
          version: update.version,
          notes: update.body !== undefined && update.body.trim() !== "" ? update.body : null,
          activeWorkers: liveSessions.length,
        });
      } catch (cause: unknown) {
        pendingUpdate.current = null;
        setUpdateState({ phase: "error", message: describeError(cause) });
      }
    })();
  };

  const handleInstallUpdate = () => {
    const update = pendingUpdate.current;
    if (update === null || updateState.phase !== "available") return;
    const version = updateState.version;
    setUpdateState({ phase: "installing", version });
    void (async () => {
      try {
        // Last-moment re-check: a session may have started between the update
        // check and this click, and the download must not start into a
        // running fleet either.
        const liveSessions = await listLiveSessions();
        if (liveSessions.length > 0) {
          setUpdateState({
            phase: "available",
            version,
            notes: update.body !== undefined && update.body.trim() !== "" ? update.body : null,
            activeWorkers: liveSessions.length,
          });
          return;
        }
        await installUpdateWhenIdle(update.rid);
        pendingUpdate.current = null;
        setRelaunchFailed(false);
        setUpdateState({ phase: "ready", version });
      } catch (cause: unknown) {
        setUpdateState({ phase: "error", message: describeError(cause) });
      }
    })();
  };

  const handleRelaunch = () => {
    // `relaunch()` from @tauri-apps/plugin-process is a one-line wrapper around
    // this command; calling it directly keeps the maybe-absent npm package out
    // of the build. Without the process plugin in the running core the invoke
    // rejects and the user restarts by hand — the update applies either way.
    void invoke("plugin:process|restart").catch(() => setRelaunchFailed(true));
  };

  // -- Masterprompt ----------------------------------------------------------
  const [masterPrompt, setMasterPrompt] = useState(loadMasterPrompt);
  const [masterEnabled, setMasterEnabled] = useState(isMasterPromptEnabled);

  const [savedNote, setSavedNote] = useState<string | null>(null);

  const handleSaveMasterPrompt = () => {
    saveMasterPrompt(masterPrompt);
    if (masterPrompt.trim() === "") {
      // The toggle is meaningless without a prompt to send.
      setMasterEnabled(false);
      setMasterPromptEnabled(false);
    }
    flashSaved("Masterprompt gespeichert.");
  };

  const handleToggleMaster = (enabled: boolean) => {
    if (enabled && masterPrompt.trim() === "") {
      // Nothing to attach yet: turning the toggle on would promise what the
      // stored prompt cannot deliver.
      flashSaved("Kein Masterprompt vorhanden — erst Text speichern.");
      return;
    }
    setMasterEnabled(enabled);
    setMasterPromptEnabled(enabled);
    flashSaved(enabled ? "Masterprompt wird angehängt." : "Masterprompt aus.");
  };

  // -- Agent-Kategorien -------------------------------------------------------
  const [categories, setCategories] = useState<AgentCategoryConfig[]>(loadAgentCategories);

  const handleCategoryChange = (
    id: AgentCategoryConfig["id"],
    patch: Partial<Omit<AgentCategoryConfig, "id">>,
  ) => {
    const next = categories.map((category) =>
      category.id === id ? { ...category, ...patch } : category,
    );
    setCategories(next);
    saveAgentCategories(next);
  };

  // The learning switches live in the core's database, not in localStorage:
  // the critic that reads them runs there, and a per-webview copy would be a
  // second, quieter truth. A key the core has never written means the default.
  const [learning, setLearning] = useState<Record<string, boolean>>({});
  const [learningError, setLearningError] = useState<string | null>(null);

  useEffect(() => {
    void getLearningSettings()
      .then(setLearning)
      .catch((cause: unknown) => setLearningError(describeError(cause)));
  }, []);

  const handleToggleLearning = (id: AgentCategoryConfig["id"], enabled: boolean) => {
    const previous = learning[id];
    // Optimistic: the switch answers the click, and only a failing write
    // takes it back — with the reason next to it.
    setLearning((current) => ({ ...current, [id]: enabled }));
    setLearningError(null);
    void setCategoryLearning(id, enabled)
      .then(() => flashSaved(enabled ? "Lernen an." : "Lernen aus."))
      .catch((cause: unknown) => {
        setLearning((current) => {
          const reverted = { ...current };
          if (previous === undefined) delete reverted[id];
          else reverted[id] = previous;
          return reverted;
        });
        setLearningError(describeError(cause));
      });
  };

  // The profile roster is the prop's, until this view changes one: after a
  // write it re-reads the core rather than guessing what the core stored.
  const [profileList, setProfileList] = useState<AgentProfile[]>(profiles);
  const [profileBusyId, setProfileBusyId] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    setProfileList(profiles);
  }, [profiles]);

  const handleToggleProfile = (profile: AgentProfile, enabled: boolean) => {
    setProfileBusyId(profile.id);
    setProfileError(null);
    setProfileList((current) =>
      current.map((entry) => (entry.id === profile.id ? { ...entry, enabled } : entry)),
    );
    void setProfileEnabled(profile.id, enabled)
      .then(async () => {
        setProfileList(await listAgentProfiles());
        flashSaved(enabled ? `${profile.name} aktiv.` : `${profile.name} deaktiviert.`);
      })
      .catch((cause: unknown) => {
        setProfileList((current) =>
          current.map((entry) =>
            entry.id === profile.id ? { ...entry, enabled: profile.enabled } : entry,
          ),
        );
        setProfileError(describeError(cause));
      })
      .finally(() => setProfileBusyId(null));
  };

  // The budget ceilings live in the core's settings table for the same reason
  // the learning switches do: the watcher that reads them runs there. The
  // fields below are text until they are saved, so a half-typed number never
  // reaches the core.
  const [budgetInputs, setBudgetInputs] = useState<Record<string, { five: string; seven: string }>>(
    {},
  );
  const [budgetBusyId, setBudgetBusyId] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const applyBudgets = (rows: Budget[]) => {
    const next: Record<string, { five: string; seven: string }> = {};
    for (const row of rows) {
      next[row.profileId] = {
        five: formatPercent(row.fiveHourPct),
        seven: formatPercent(row.sevenDayPct),
      };
    }
    setBudgetInputs(next);
  };

  useEffect(() => {
    void getBudgets()
      .then(applyBudgets)
      .catch((cause: unknown) => setBudgetError(describeError(cause)));
  }, []);

  const budgetOf = (profileId: string) =>
    budgetInputs[profileId] ?? { five: "", seven: "" };

  const handleBudgetChange = (profileId: string, patch: { five?: string; seven?: string }) => {
    setBudgetInputs((current) => ({
      ...current,
      [profileId]: { ...budgetOf(profileId), ...patch },
    }));
  };

  const handleSaveBudget = (profile: AgentProfile) => {
    const { five, seven } = budgetOf(profile.id);
    const fiveHour = parsePercent(five);
    const sevenDay = parsePercent(seven);
    if (fiveHour === "invalid" || sevenDay === "invalid") {
      setBudgetError(
        "Budget-Schwellen sind ganze Zahlen von 1 bis 100 — ein leeres Feld heißt „keine Schwelle“.",
      );
      return;
    }
    setBudgetBusyId(profile.id);
    setBudgetError(null);
    void setBudget(profile.id, fiveHour, sevenDay)
      .then((stored) => {
        // Read back what the core stored rather than trusting the field: this
        // is the value the watcher will act on.
        handleBudgetChange(stored.profileId, {
          five: formatPercent(stored.fiveHourPct),
          seven: formatPercent(stored.sevenDayPct),
        });
        flashSaved(
          stored.fiveHourPct === null && stored.sevenDayPct === null
            ? `${profile.name}: kein Budget mehr.`
            : `${profile.name}: Budget gespeichert.`,
        );
      })
      .catch((cause: unknown) => setBudgetError(describeError(cause)))
      .finally(() => setBudgetBusyId(null));
  };

  const flashSaved = (note: string) => {
    setSavedNote(note);
    window.setTimeout(() => setSavedNote((current) => (current === note ? null : current)), 2500);
  };

  return (
    <div className="settings-view">
      <div className="settings-tabs">
        <div
          className="segmented"
          role="tablist"
          aria-label="Settings section"
          onKeyDown={(event) =>
            handleTablistKey(
              event,
              TABS.findIndex((entry) => entry.id === tab),
              TABS.length,
              (index) => setTab(TABS[index].id),
            )
          }
        >
          {TABS.map((entry, index) => (
            <button
              key={entry.id}
              id={`settings-tab-${entry.id}`}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              aria-controls="settings-panel"
              tabIndex={tabStop(tab === entry.id, index, true)}
              className={`segment${tab === entry.id ? " segment-active" : ""}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {savedNote ? (
          <span className="settings-saved" role="status">
            {savedNote}
          </span>
        ) : null}
      </div>

      <div
        className="settings-body"
        id="settings-panel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
      >
        {tab === "allgemein" ? (
          <>
            <fieldset className="settings-field settings-density">
              <legend className="field-label">Darstellungsdichte</legend>
              <div className="settings-density-options">
                {(["comfortable", "compact"] as const).map((value) => (
                  <label className="settings-check" key={value}>
                    <input
                      type="radio"
                      name="settings-density"
                      value={value}
                      checked={density === value}
                      onChange={() => {
                        saveUiDensity(value);
                        onDensityChange(value);
                      }}
                    />
                    <span>{value === "comfortable" ? "Komfortabel" : "Kompakt"}</span>
                  </label>
                ))}
              </div>
              <p className="settings-hint">Passt Abstände und Bedienelemente in der App an.</p>
            </fieldset>
            <div className="settings-field">
              <label className="field-label" htmlFor="settings-web-port">
                Default Port Web-Interface
              </label>
              <div className="settings-port-row">
                <input
                  id="settings-web-port"
                  className="field"
                  inputMode="numeric"
                  placeholder="z. B. 8787"
                  value={portInput}
                  onChange={(event) => setPortInput(event.target.value)}
                />
                <button type="button" className="button-primary" onClick={handleSavePort}>
                  Speichern
                </button>
              </div>
              {portError ? <span className="settings-error">{portError}</span> : null}
            </div>

            <label className="settings-check">
              <input
                type="checkbox"
                checked={digestEnabled}
                onChange={(event) => handleToggleDigest(event.target.checked)}
              />
              <span>Tages-Digest schreiben</span>
            </label>
            <p className="settings-hint">
              Schreibt einmal pro Stunde für den Tag, der bereits vorbei ist, eine
              Markdown-Seite nach <code>&lt;repo&gt;/.pa/memory/digests/</code> — Board-Stand,
              Tagesverlauf, Worker-Aktivität, Quota und Budget. Kein Agent, keine Tokens:
              alles kommt aus Daten, die ProjectA ohnehin hat. <code>.pa/</code> ist
              gitignored, die Seiten sind Lesestoff für den Vault.
            </p>
              {digestError ? <span className="settings-error">{digestError}</span> : null}

            <SessionBufferDelete />

            <div className="settings-field">
              <label className="field-label" htmlFor="settings-stuck-minutes">
                Stuck-Diagnose (Minuten)
              </label>
              <div className="settings-port-row">
                <input
                  id="settings-stuck-minutes"
                  className="field"
                  inputMode="numeric"
                  placeholder="Standard: 10"
                  value={stuckInput}
                  onChange={(event) => setStuckInput(event.target.value)}
                />
                <button
                  type="button"
                  className="button-primary"
                  disabled={savingStuck}
                  onClick={handleSaveStuck}
                >
                  {savingStuck ? "…" : "Speichern"}
                </button>
              </div>
              <p className="settings-hint">
                Wie lange ein laufender Worker <em>gleichzeitig</em> ohne Terminal-Ausgabe
                und ohne Änderung in seinem Worktree bleiben darf, bevor die Karte als
                „vermutlich festgefahren“ auf needs_you landet. Beides zusammen ist der
                Punkt: wer liest und denkt, schreibt nichts ins Terminal; wer kompiliert,
                schreibt keine Dateien. Ein leeres Feld nimmt den Standard.
              </p>
              {stuckError ? <span className="settings-error">{stuckError}</span> : null}
            </div>

            <fieldset className="settings-field" disabled={savingRouting}>
              <legend className="field-label" id="settings-product-mode-label">
                Produktmodus (OmniRoute)
              </legend>
              <div
                className="settings-mode-row"
                role="radiogroup"
                aria-labelledby="settings-product-mode-label"
                aria-describedby={
                  routing && !routing.reviewIndependent
                    ? "settings-review-block"
                    : undefined
                }
              >
                {(
                  [
                    ["reliable", "Reliable"],
                    ["cheap", "Cheap"],
                    ["review", "Review"],
                  ] as const
                ).map(([value, label]) => (
                  <label className="settings-check" key={value}>
                    <input
                      type="radio"
                      name="settings-product-mode"
                      value={value}
                      checked={(routing?.mode ?? "cheap") === value}
                      onChange={() => handleProductMode(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <p className="settings-hint">
                Reliable zielt auf die kompatible Erfolgsrate, Cheap auf geringere
                Kosten, Review auf eine unabhängige Prüfer-Familie. Review fällt
                nie still auf das Autoren-Modell zurück.
              </p>
              {routing && !routing.reviewIndependent ? (
                <p
                  id="settings-review-block"
                  className="settings-error"
                  role="status"
                  aria-live="polite"
                  aria-label="Review-Blockade"
                >
                  Review ist blockiert: {routing.reviewDetail || "keine unabhängige Prüfer-Familie."}
                  {routing.mode === "review"
                    ? " Spawn und Respawn werden verweigert, bis ein unabhängiges Combo verfügbar ist."
                    : " Der Modus bleibt wählbar; ein Spawn als Review wird verweigert."}
                </p>
              ) : null}
              {routingError ? <span className="settings-error">{routingError}</span> : null}
            </fieldset>

            <div className="settings-field">
              <label className="field-label" htmlFor="settings-test-command">
                Test-Kommando{project === null ? "" : ` — ${project.name}`}
              </label>
              <div className="settings-command-row">
                <input
                  id="settings-test-command"
                  className="field"
                  placeholder="z. B. npm test"
                  disabled={project === null}
                  value={testCommandInput}
                  onChange={(event) => setTestCommandInput(event.target.value)}
                />
                <button
                  type="button"
                  className="button-primary"
                  disabled={project === null || savingTestCommand}
                  onClick={handleSaveTestCommand}
                >
                  {savingTestCommand ? "…" : "Speichern"}
                </button>
              </div>
              <p className="settings-hint">
                Das Kommando läuft im Worktree eines Workers, sobald du auf seiner
                Board-Karte „Tests“ drückst; das Ergebnis erscheint dort als Badge. Beim
                Anlegen eines Projekts wird es automatisch erkannt. Ein leeres Feld
                entfernt das Gate — dann gibt es weder Button noch Badge.
              </p>
              {project === null ? (
                <span className="settings-hint">Kein Projekt ausgewählt.</span>
              ) : null}
              {testCommandError ? (
                <span className="settings-error">{testCommandError}</span>
              ) : null}
            </div>

            <div className="settings-field">
              <label className="field-label" htmlFor="settings-setup-command">
                Setup-Kommando{project === null ? "" : ` — ${project.name}`}
              </label>
              <div className="settings-command-row">
                <input
                  id="settings-setup-command"
                  className="field"
                  placeholder="z. B. npm ci"
                  disabled={project === null || setupCommandLoadedFor !== project.id}
                  value={setupCommandInput}
                  onChange={(event) => setSetupCommandInput(event.target.value)}
                />
                <button
                  type="button"
                  className="button-primary"
                  disabled={
                    project === null ||
                    savingSetupCommand ||
                    setupCommandLoadedFor !== project.id
                  }
                  onClick={handleSaveSetupCommand}
                >
                  {savingSetupCommand ? "…" : "Speichern"}
                </button>
              </div>
              <p className="settings-hint">
                Das Kommando bereitet den wegwerfbaren Merge-Kandidaten vor, bevor das
                Test-Gate dort läuft. Es startet erst, nachdem du Befehl, Basis und
                deklarierte Inputs in der Review-Ansicht freigegeben hast — die Freigabe
                gilt für genau diesen Merge-Kandidaten, jede Änderung am Kommando oder am
                Baum lässt sie verfallen. Ein leeres Feld schaltet das Setup ab. Achtung: Das
                Kommando darf diese deklarierten Inputs nicht umschreiben (daher{" "}
                <code>npm ci</code> statt <code>npm install</code>) — sonst verwirft die
                Validierung jeden Lauf, weil der getestete Baum nicht mehr der
                Merge-Tree ist.
              </p>
              {setupCommandError ? (
                <span className="settings-error">
                  {setupCommandError}{" "}
                  {project !== null && setupCommandLoadedFor !== project.id ? (
                    <button
                      type="button"
                      className="worker-action"
                      onClick={() => setSetupLoadAttempt((n) => n + 1)}
                    >
                      Erneut versuchen
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>

            <div className="settings-field">
              <label className="field-label" htmlFor="settings-max-workers">
                Maximale Worker{project === null ? "" : ` — ${project.name}`}
              </label>
              <div className="settings-command-row">
                <input
                  id="settings-max-workers"
                  className="field"
                  inputMode="numeric"
                  placeholder="leer = Standard, 0 = aus"
                  disabled={project === null || savingMaxWorkers}
                  value={maxWorkersInput}
                  onChange={(event) => setMaxWorkersInput(event.target.value)}
                />
                <button
                  type="button"
                  className="button-primary"
                  disabled={project === null || savingMaxWorkers}
                  onClick={handleSaveMaxWorkers}
                >
                  {savingMaxWorkers ? "…" : "Speichern"}
                </button>
              </div>
              <p className="settings-hint">
                Wie viele Worker dieses Projekts gleichzeitig laufen dürfen. Orchestrator,
                Queen und Scout zählen nicht mit. Ein leeres Feld verwendet den Standard der
                Warteschlange. <strong>0</strong> hält den Dispatcher für dieses Projekt an;
                eingereihte Aufgaben bleiben bereit, bis das Limit wieder erhöht oder geleert
                wird. Negative Zahlen sind nicht erlaubt.
              </p>
              {project === null ? (
                <span className="settings-hint">Kein Projekt ausgewählt.</span>
              ) : null}
              {maxWorkersError ? (
                <span className="settings-error">{maxWorkersError}</span>
              ) : null}
            </div>
          </>
        ) : tab === "masterprompt" ? (
          <>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={masterEnabled}
                onChange={(event) => handleToggleMaster(event.target.checked)}
              />
              <span>Masterprompt für alle Agenten verwenden</span>
            </label>

            <div className="settings-field">
              <label className="field-label" htmlFor="settings-masterprompt">
                Globaler Masterprompt
              </label>
              <textarea
                id="settings-masterprompt"
                className="field field-textarea"
                rows={10}
                placeholder="Gemeinsame Regeln und Kontext für alle Agenten…"
                value={masterPrompt}
                onChange={(event) => setMasterPrompt(event.target.value)}
              />
              <div>
                <button type="button" className="button-primary" onClick={handleSaveMasterPrompt}>
                  Speichern
                </button>
              </div>
            </div>

            <div className="settings-field">
              <span className="field-label">Vorschau</span>
              <pre className="masterprompt-preview">
                {masterPrompt.trim() === ""
                  ? "(kein Masterprompt gesetzt)"
                  : `${masterPrompt}\n\n---\n\n<Aufgabe des Agenten>`}
              </pre>
            </div>
          </>
        ) : tab === "updates" ? (
          <>
            <div className="settings-field">
              <span className="field-label">Current version</span>
              <p className="settings-hint">
                {versionFailed
                  ? "Not available outside the desktop app."
                  : `ProjectA ${appVersion ?? "…"}`}
              </p>
            </div>

            <div className="settings-field">
              <span className="field-label">Update check</span>
              <p className="settings-hint">
                The update feed is the public mirror repository
                Cuarroc/ProjectA-updates — update checks run anonymously and
                never need a GitHub token.
              </p>
              <div>
                <button
                      type="button"
                      className="button-primary"
                      disabled={updateState.phase === "checking"}
                      onClick={handleCheckUpdates}
                    >
                      {updateState.phase === "checking" ? "Checking…" : "Check for updates"}
                    </button>
                  </div>
                  {updateState.phase === "up-to-date" ? (
                    <p className="settings-hint">
                      ProjectA is up to date
                      {updateState.version === null ? "." : ` (${updateState.version}).`}
                    </p>
                  ) : null}
                  {updateState.phase === "available" ? (
                    <>
                      <p className="settings-hint">
                        Version {updateState.version} is available
                        {appVersion === null ? "." : ` (current: ${appVersion}).`}
                      </p>
                      {updateState.notes === null ? null : (
                        <pre className="masterprompt-preview">{updateState.notes}</pre>
                      )}
                      {updateState.activeWorkers > 0 ? (
                        <p className="settings-hint">
                          {updateState.activeWorkers}{" "}
                          {updateState.activeWorkers === 1 ? "worker is" : "workers are"}{" "}
                          active — updates install only when no workers are running.
                        </p>
                      ) : (
                        <div>
                          <button
                            type="button"
                            className="button-primary"
                            onClick={handleInstallUpdate}
                          >
                            Download and install
                          </button>
                        </div>
                      )}
                    </>
                  ) : null}
                  {updateState.phase === "installing" ? (
                    <p className="settings-hint">
                      Downloading and installing {updateState.version}…
                    </p>
                  ) : null}
                  {updateState.phase === "ready" ? (
                    <>
                      <p className="settings-hint">
                        Version {updateState.version} is installed — restart to apply.
                      </p>
                      {relaunchFailed ? (
                        <p className="settings-hint">
                          Please restart ProjectA to apply the update.
                        </p>
                      ) : (
                        <div>
                          <button
                            type="button"
                            className="button-primary"
                            onClick={handleRelaunch}
                          >
                            Restart to apply
                          </button>
                        </div>
                      )}
                    </>
                  ) : null}
                  {updateState.phase === "error" ? (
                    <span className="settings-error">{updateState.message}</span>
                  ) : null}
            </div>
          </>
        ) : (
          <>
          {learningError ? <span className="settings-error">{learningError}</span> : null}
          <ul className="category-list">
            {categories
              .filter((category) => category.id !== "employee")
              .map((category) => {
                const historical = category.id === "queen";
                return (
              <li
                key={category.id}
                className={`category-row${
                  historical ? "" : category.active ? "" : " category-row-off"
                }`}
              >
                <div className="category-main">
                  <span className="category-name">{CATEGORY_LABELS[category.id]}</span>
                  <span className="category-desc">{agentCategoryDescription(category.id)}</span>
                </div>
                {historical ? (
                  <span
                    className="settings-check category-toggle"
                    aria-label="Queen historisch"
                  >
                    Historisch
                  </span>
                ) : (
                  <label className="settings-check category-toggle">
                    <input
                      type="checkbox"
                      checked={category.active}
                      onChange={(event) =>
                        handleCategoryChange(category.id, { active: event.target.checked })
                      }
                    />
                    <span>Aktiv</span>
                  </label>
                )}
                {/* A category without a critic keeps the column empty rather
                    than offering a switch that would control nothing. */}
                {LEARNING_CATEGORIES.has(category.id) ? (
                  <label className="settings-check category-toggle category-learning">
                    <input
                      type="checkbox"
                      checked={learning[category.id] ?? true}
                      onChange={(event) =>
                        handleToggleLearning(category.id, event.target.checked)
                      }
                    />
                    <span>Lernen</span>
                  </label>
                ) : (
                  <span className="category-learning category-learning-none" aria-hidden="true" />
                )}
                <select
                  className="field category-profile"
                  aria-label={`Default Profile für ${CATEGORY_LABELS[category.id]}`}
                  value={category.defaultProfileId ?? ""}
                  disabled={historical || !category.active || profiles.length === 0}
                  onChange={(event) =>
                    handleCategoryChange(category.id, {
                      defaultProfileId: event.target.value === "" ? null : event.target.value,
                    })
                  }
                >
                  <option value="">Default Profile …</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </li>
                );
              })}
          </ul>

          <div className="settings-field profile-field">
            <span className="field-label">Profile</span>
            <p className="settings-hint">
              Ein deaktiviertes Profil bleibt gespeichert, wird aber keinem neuen
              Agenten mehr zugeteilt.
            </p>
            <p className="settings-hint">
              Budget: ab welchem Prozentsatz des 5-Stunden- bzw. 7-Tage-Fensters
              dieses Profil pausiert wird. Erreicht ein Fenster seine Schwelle,
              überspringt der Dispatcher das Profil und laufende Agenten werden
              gestoppt — die Worktrees bleiben liegen, ein Respawn holt sie
              zurück. Leeres Feld heißt „keine Schwelle“.
            </p>
            {profileError ? <span className="settings-error">{profileError}</span> : null}
            {budgetError ? <span className="settings-error">{budgetError}</span> : null}
            {profileList.length === 0 ? (
              <span className="settings-hint">Keine Profile vorhanden.</span>
            ) : (
              <ul className="profile-list">
                {profileList.map((profile) => (
                  <li
                    key={profile.id}
                    className={`profile-row${profile.enabled ? "" : " profile-row-off"}`}
                  >
                    <div className="profile-main">
                      <span className="profile-name">{profile.name}</span>
                      <span className="profile-id">{profile.id}</span>
                    </div>
                    <label className="settings-check profile-toggle">
                      <input
                        type="checkbox"
                        checked={profile.enabled}
                        disabled={profileBusyId === profile.id}
                        onChange={(event) => handleToggleProfile(profile, event.target.checked)}
                      />
                      <span>Aktiv</span>
                    </label>
                    <div className="profile-budget">
                      <label htmlFor={`budget-5h-${profile.id}`}>5 h</label>
                      <input
                        id={`budget-5h-${profile.id}`}
                        className="field profile-budget-input"
                        inputMode="numeric"
                        placeholder="—"
                        value={budgetOf(profile.id).five}
                        onChange={(event) =>
                          handleBudgetChange(profile.id, { five: event.target.value })
                        }
                      />
                      <label htmlFor={`budget-7d-${profile.id}`}>7 T.</label>
                      <input
                        id={`budget-7d-${profile.id}`}
                        className="field profile-budget-input"
                        inputMode="numeric"
                        placeholder="—"
                        value={budgetOf(profile.id).seven}
                        onChange={(event) =>
                          handleBudgetChange(profile.id, { seven: event.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="button-primary"
                        disabled={budgetBusyId === profile.id}
                        onClick={() => handleSaveBudget(profile)}
                      >
                        {budgetBusyId === profile.id ? "…" : "Budget"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}

function SessionBufferDelete() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      setError(null);
      setNote(null);
      return;
    }
    setBusy(true);
    setError(null);
    void deleteSessionBuffers()
      .then((dropped) => {
        setNote(
          dropped === 0
            ? "Keine Sitzungspuffer vorhanden."
            : `${dropped} Sitzungspuffer gelöscht.`,
        );
        setConfirming(false);
      })
      .catch((cause: unknown) => setError(describeError(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="settings-field">
      <p className="field-label">Sitzungspuffer</p>
      <p className="settings-hint">
        Scrollback und Composer-Drafts, höchstens sieben Tage oder 2&nbsp;MB je
        Session. Archive und Merge löschen sie automatisch; hier ist der
        manuelle DSAR-Pfad. Laufende Sitzungen schreiben ihren Puffer beim
        Beenden erneut — sie erst beenden, dann löschen.
      </p>
      <div className="settings-port-row">
        <button
          type="button"
          className="button-primary"
          disabled={busy}
          onClick={handleDelete}
        >
          {busy
            ? "…"
            : confirming
              ? "Wirklich alle Sitzungspuffer löschen"
              : "Sitzungspuffer löschen"}
        </button>
      </div>
      {note ? (
        <span className="settings-saved" role="status">
          {note}
        </span>
      ) : null}
      {error ? <span className="settings-error">{error}</span> : null}
    </div>
  );
}
