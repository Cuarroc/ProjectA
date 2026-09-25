import type { AgentCategoryConfig, AgentCategoryId } from "../types";

/**
 * All UI settings live in `localStorage` under these keys. The Rust core is
 * not involved: settings are webview-local by design.
 */
const KEYS = {
  onboarding: "projecta.settings.onboarding",
  webPort: "projecta.settings.webPort",
  masterPrompt: "projecta.settings.masterPrompt",
  masterPromptEnabled: "projecta.settings.masterPromptEnabled",
  agentCategories: "projecta.settings.agentCategories",
  density: "projecta.settings.density",
} as const;

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage disabled — defaults apply.
  }
}

export type UiDensity = "comfortable" | "compact";

/** Layout preference for the native webview; unknown values keep the readable default. */
export function loadUiDensity(): UiDensity {
  return readString(KEYS.density) === "compact" ? "compact" : "comfortable";
}

export function saveUiDensity(density: UiDensity): void {
  writeString(KEYS.density, density === "compact" ? "compact" : null);
}

function writeString(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage disabled — nothing to persist.
  }
}

/** -- Allgemein -------------------------------------------------------------- */

/** Whether the first-use hints are shown. Defaults to shown. */
export function loadOnboardingHints(): boolean {
  return readString(KEYS.onboarding) !== "0";
}

export function saveOnboardingHints(show: boolean): void {
  writeString(KEYS.onboarding, show ? null : "0");
}

/**
 * The default port for the web interface, or `null` when none was stored.
 * Anything that does not parse stays unstored rather than lying about.
 */
export function loadWebPort(): number | null {
  const raw = readString(KEYS.webPort);
  if (raw === null) return null;
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function saveWebPort(port: number | null): void {
  writeString(KEYS.webPort, port === null ? null : String(port));
}

/** -- Masterprompt ----------------------------------------------------------- */

export function loadMasterPrompt(): string {
  return readString(KEYS.masterPrompt) ?? "";
}

export function saveMasterPrompt(prompt: string): void {
  writeString(KEYS.masterPrompt, prompt.trim() === "" ? null : prompt);
}

/** Whether the master prompt rides along on every agent task. Off by default. */
export function isMasterPromptEnabled(): boolean {
  return readString(KEYS.masterPromptEnabled) === "1";
}

export function setMasterPromptEnabled(enabled: boolean): void {
  writeString(KEYS.masterPromptEnabled, enabled ? "1" : "0");
}

/**
 * Die Marker, die im fertigen Agenten-Prompt die einzige Struktur sind: der
 * Playbook-Block und die Grenze zur eigentlichen Task. Wortgleich mit
 * `FORBIDDEN_MARKERS` in `src-tauri/src/learnings.rs` — dort verboten, wo ein
 * Learning in das Playbook eingeht, hier verboten, wo der Masterprompt vor die
 * Task tritt. Zwei Wege in denselben Prompt, dieselbe Grenze.
 */
export const FORBIDDEN_PROMPT_MARKERS = [
  "--- PROJEKT-PLAYBOOK ---",
  "--- TASK ---",
] as const;

/** Der erste Marker, den `text` trägt, oder `null`. */
export function forbiddenPromptMarker(text: string): string | null {
  return FORBIDDEN_PROMPT_MARKERS.find((marker) => text.includes(marker)) ?? null;
}

/**
 * Streicht jede Zeile, die einen der Marker trägt.
 *
 * Zeilenweise und nicht als Textersatz, weil es die *Zeile* ist, die die
 * Grenze fälscht: der Konsument des Prompts ist ein Sprachmodell, kein Parser,
 * und ein Marker, der eine Zeile eröffnet, beendet den Playbook-Block. Was
 * daneben stand, war dann ohnehin Teil der Fälschung.
 *
 * Der Rest bleibt unangetastet. Der Approve-Pfad in `learnings.rs` lehnt das
 * ganze Learning ab; hier wäre das die falsche Antwort — ein stillschweigend
 * ganz fallengelassener Masterprompt ist eine Einstellung, die sichtbar an ist
 * und unsichtbar nichts tut.
 */
function stripForbiddenMarkers(prompt: string): string {
  return prompt
    .split("\n")
    .filter((line) => forbiddenPromptMarker(line) === null)
    .join("\n");
}

/**
 * Prepends the stored master prompt to a task. Whether it should ride along
 * at all is the caller's decision: every surface calling this owns its own
 * "Masterprompt anhaengen" checkbox, and `isMasterPromptEnabled` only seeds
 * that box's initial state. Re-checking the flag here would silently drop a
 * prompt the user had just ticked on.
 *
 * Der Masterprompt kommt aus `localStorage` und damit an jeder Prüfung des
 * Kerns vorbei (C-6, `.pa/report_f0.md` §3): er wird hier vor die Task gesetzt
 * und landet ungefiltert in `workers.task`. Deshalb gilt die Marker-Sperre auf
 * diesem Weg genauso wie auf dem Approve-Pfad.
 */
export function composeWithMasterPrompt(task: string): string {
  const master = stripForbiddenMarkers(loadMasterPrompt());
  if (master.trim() === "" || task.trim() === "") return task;
  return `${master}\n\n---\n\n${task}`;
}

/** -- Agent-Kategorien -------------------------------------------------------- */

const DEFAULT_AGENT_CATEGORIES: ReadonlyArray<AgentCategoryConfig> = [
  { id: "worker", active: true, defaultProfileId: null },
  { id: "queen", active: true, defaultProfileId: null },
  { id: "employee", active: true, defaultProfileId: null },
  { id: "scout", active: true, defaultProfileId: null },
  { id: "orchestrator", active: true, defaultProfileId: null },
];

const CATEGORY_DESCRIPTIONS: Record<AgentCategoryId, string> = {
  worker: "Ein Agent pro Task, in seinem eigenen Git-Worktree.",
  queen: "Historisch: bestehende Queens bleiben lesbar, neue werden nicht mehr gestartet.",
  employee: "Langlaufender Allzweck-Agent mit festem Zuständigkeitsbereich.",
  scout: "Recherche und Vorschläge, ohne am Code zu arbeiten.",
  orchestrator: "Projektweiter Koordinator, der Workers verteilt und prüft.",
};

export function agentCategoryDescription(id: AgentCategoryId): string {
  return CATEGORY_DESCRIPTIONS[id];
}

/**
 * The stored configuration merged over the defaults: unknown ids are dropped,
 * missing ones (added later) appear with their defaults, so callers always see
 * a complete list.
 */
export function loadAgentCategories(): AgentCategoryConfig[] {
  let stored: Partial<Record<AgentCategoryId, Omit<AgentCategoryConfig, "id">>> = {};
  try {
    const raw = JSON.parse(readString(KEYS.agentCategories) ?? "{}") as typeof stored;
    if (raw && typeof raw === "object") stored = raw;
  } catch {
    // Unusable payload — fall through to defaults.
  }
  return DEFAULT_AGENT_CATEGORIES.map((fallback) => {
    const saved = stored[fallback.id];
    return {
      id: fallback.id,
      active: typeof saved?.active === "boolean" ? saved.active : fallback.active,
      defaultProfileId:
        typeof saved?.defaultProfileId === "string" && saved.defaultProfileId !== ""
          ? saved.defaultProfileId
          : null,
    };
  });
}

/** Replaces the whole category configuration at once. */
export function saveAgentCategories(categories: AgentCategoryConfig[]): void {
  const record: Record<string, Omit<AgentCategoryConfig, "id">> = {};
  for (const category of categories) {
    record[category.id] = {
      active: category.active,
      defaultProfileId: category.defaultProfileId,
    };
  }
  writeString(KEYS.agentCategories, JSON.stringify(record));
}

/** Whether this category is offered for new spawns. Missing ids default on. */
export function isCategoryActive(id: AgentCategoryId): boolean {
  return loadAgentCategories().find((category) => category.id === id)?.active ?? true;
}

/** Stored default profile, or `null` when the category has none. */
export function defaultProfileIdFor(id: AgentCategoryId): string | null {
  return loadAgentCategories().find((category) => category.id === id)?.defaultProfileId ?? null;
}

/**
 * Profile a new agent of `category` should start with. `null` means the
 * category is switched off or no listed profile is usable.
 */
export function pickSpawnProfile(
  category: AgentCategoryId,
  profiles: ReadonlyArray<{ id: string }>,
  blockedIds: ReadonlySet<string> = new Set(),
): string | null {
  if (!isCategoryActive(category)) return null;
  const usable = (id: string): boolean =>
    profiles.some((profile) => profile.id === id) && !blockedIds.has(id);
  const preferred = defaultProfileIdFor(category);
  if (preferred !== null && usable(preferred)) return preferred;
  return profiles.find((profile) => usable(profile.id))?.id ?? null;
}
