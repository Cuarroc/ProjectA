import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

import {
  describeError,
  getBudgets,
  getDigestEnabled,
  getLearningSettings,
  getProjectSetupCommand,
  getRoutingStatus,
  getStuckAfterMinutes,
  listAgentProfiles,
  listLiveSessions,
  installUpdateWhenIdle,
  getUpdaterState,
  setUpdaterState,
  setBudget,
  setCategoryLearning,
  setDigestEnabled,
  setProductMode,
  setProfileEnabled,
  setProjectSetupCommand,
  setStuckAfterMinutes,
  type ProductMode,
  type RoutingStatus,
  type UpdaterState,
} from "../lib/ipc";
import {
  agentCategoryDescription,
  isMasterPromptEnabled,
  loadAgentCategories,
  loadMasterPrompt,
  loadWebPort,
  type FontSettings,
  saveAgentCategories,
  saveMasterPrompt,
  saveWebPort,
  setMasterPromptEnabled,
  type UiDensity,
} from "../lib/settings";
import GeneralTab from "./settings/GeneralTab";
import MasterPromptTab from "./settings/MasterPromptTab";
import UpdatesTab from "./settings/UpdatesTab";
import ProfileBudgetFields from "./settings/ProfileBudgetFields";
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

// SettingsView is conditionally mounted. A process-wide generation prevents
// async work owned by an older view from publishing after a newer view mounts.
let latestUpdaterViewGeneration = 0;

interface SettingsViewProps {
  density: UiDensity;
  onDensityChange: (density: UiDensity) => void;
  fonts: FontSettings;
  onFontsChange: (fonts: FontSettings) => void;
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
  fonts,
  onFontsChange,
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

  const [updateState, setUpdateState] = useState<UpdaterState>({ phase: "idle" });
  const updaterGeneration = useRef(0);
  const updaterTransitioned = useRef(false);
  const updaterPublish = useRef(Promise.resolve());
  const publishUpdateState = (state: UpdaterState) => {
    const generation = updaterGeneration.current;
    if (generation !== latestUpdaterViewGeneration) return;
    updaterTransitioned.current = true;
    setUpdateState(state);
    updaterPublish.current = updaterPublish.current
      .then(() => generation === latestUpdaterViewGeneration
        ? setUpdaterState(state)
        : undefined)
      .catch(() => undefined);
  };
  useEffect(() => {
    const generation = ++latestUpdaterViewGeneration;
    updaterGeneration.current = generation;
    void getUpdaterState()
      .then((state) => {
        if (generation === latestUpdaterViewGeneration && !updaterTransitioned.current) {
          setUpdateState(state);
        }
      })
      .catch(() => undefined);
    return () => {
      if (generation === latestUpdaterViewGeneration) latestUpdaterViewGeneration += 1;
    };
  }, []);
  // The update object is the core's download handle, not something to render.
  const pendingUpdate = useRef<Update | null>(null);
  const [relaunchFailed, setRelaunchFailed] = useState(false);

  const handleCheckUpdates = () => {
    publishUpdateState({ phase: "checking" });
    void (async () => {
      try {
        // The update feed is the public mirror repo Cuarroc/ProjectA-updates —
        // the check runs anonymously and never sends an Authorization header.
        const update = await check();
        if (update === null || !update.available) {
          pendingUpdate.current = null;
          publishUpdateState({ phase: "up-to-date", version: update?.currentVersion ?? appVersion });
          return;
        }
        pendingUpdate.current = update;
        // PTY/worker safety (Sanierungsplan §2.1.7): applying an update means
        // a relaunch, and a relaunch kills every agent session — so even the
        // download is only offered while nothing runs. Measured by live PTY
        // sessions (processes), not worker status: after a restart a worker
        // can claim "running" without any process behind it.
        const liveSessions = await listLiveSessions();
        publishUpdateState({
          phase: "available",
          version: update.version,
          notes: update.body !== undefined && update.body.trim() !== "" ? update.body : null,
          activeWorkers: liveSessions.length,
        });
      } catch (cause: unknown) {
        pendingUpdate.current = null;
        publishUpdateState({ phase: "error", message: describeError(cause) });
      }
    })();
  };

  const handleInstallUpdate = () => {
    const update = pendingUpdate.current;
    if (update === null || updateState.phase !== "available") return;
    const version = updateState.version;
    publishUpdateState({ phase: "installing", version });
    void (async () => {
      try {
        // Last-moment re-check: a session may have started between the update
        // check and this click, and the download must not start into a
        // running fleet either.
        const liveSessions = await listLiveSessions();
        if (liveSessions.length > 0) {
          publishUpdateState({
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
        publishUpdateState({ phase: "ready", version });
      } catch (cause: unknown) {
        publishUpdateState({ phase: "error", message: describeError(cause) });
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
          <GeneralTab
            density={density}
            onDensityChange={onDensityChange}
            fonts={fonts}
            onFontsChange={onFontsChange}
            project={project}
            portInput={portInput}
            setPortInput={setPortInput}
            portError={portError}
            handleSavePort={handleSavePort}
            digestEnabled={digestEnabled}
            handleToggleDigest={handleToggleDigest}
            digestError={digestError}
            stuckInput={stuckInput}
            setStuckInput={setStuckInput}
            savingStuck={savingStuck}
            handleSaveStuck={handleSaveStuck}
            stuckError={stuckError}
            routing={routing}
            savingRouting={savingRouting}
            routingError={routingError}
            handleProductMode={handleProductMode}
            testCommandInput={testCommandInput}
            setTestCommandInput={setTestCommandInput}
            savingTestCommand={savingTestCommand}
            handleSaveTestCommand={handleSaveTestCommand}
            testCommandError={testCommandError}
            setupCommandInput={setupCommandInput}
            setSetupCommandInput={setSetupCommandInput}
            setupCommandLoadedFor={setupCommandLoadedFor}
            savingSetupCommand={savingSetupCommand}
            handleSaveSetupCommand={handleSaveSetupCommand}
            setupCommandError={setupCommandError}
            setSetupLoadAttempt={setSetupLoadAttempt}
            maxWorkersInput={maxWorkersInput}
            setMaxWorkersInput={setMaxWorkersInput}
            savingMaxWorkers={savingMaxWorkers}
            handleSaveMaxWorkers={handleSaveMaxWorkers}
            maxWorkersError={maxWorkersError}
          />
        ) : tab === "masterprompt" ? (
          <MasterPromptTab
            masterPrompt={masterPrompt}
            setMasterPrompt={setMasterPrompt}
            masterEnabled={masterEnabled}
            handleToggleMaster={handleToggleMaster}
            handleSaveMasterPrompt={handleSaveMasterPrompt}
          />
        ) : tab === "updates" ? (
          <UpdatesTab
            appVersion={appVersion}
            versionFailed={versionFailed}
            updateState={updateState}
            relaunchFailed={relaunchFailed}
            handleCheckUpdates={handleCheckUpdates}
            handleInstallUpdate={handleInstallUpdate}
            handleRelaunch={handleRelaunch}
          />
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
                    <ProfileBudgetFields
                      profile={profile}
                      budget={budgetOf(profile.id)}
                      busy={budgetBusyId === profile.id}
                      onChange={handleBudgetChange}
                      onSave={handleSaveBudget}
                    />
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
