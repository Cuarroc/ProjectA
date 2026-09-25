import {
  Fragment,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import GitHubLinkDialog from "./GitHubLinkDialog";
import SkillPackDialog from "./SkillPackDialog";
import { archiveWorker, describeError, listWorkers } from "../lib/ipc";
import { isMasterPromptEnabled, loadMasterPrompt } from "../lib/settings";
import { useSharpening } from "../lib/useSharpening";
import type { Project } from "../types";

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  loading: boolean;
  error: string | null;
  /** Resolves `true` when the project was created and the form may reset. */
  onCreate: (name: string, repoPath: string) => Promise<boolean>;
  onSelect: (projectId: string) => void;
  onRemove: (projectId: string) => void;
  /** Focus the project's orchestrator terminal, starting one if needed. */
  onOpenOrchestrator: (projectId: string) => void;
  /**
   * Sends a prompt into the running orchestrator's terminal, where the agent
   * submits it as if typed. Rejects while no orchestrator session is live.
   */
  onSendToOrchestrator?: (projectId: string, text: string) => Promise<void>;
  /**
   * Projects whose orchestrator the UI knows to be live. Only the active
   * project's workers are loaded, so the others simply stay unlit.
   */
  liveOrchestratorProjectIds: string[];
  /** Project with a `create_orchestrator` call in flight. */
  busyOrchestratorProjectId: string | null;
  /** Reloads the project list, e.g. after a GitHub remote was linked. */
  onRefreshProjects: () => void;
  /** The worker panel for the active project. */
  children?: ReactNode;
}

/**
 * Project list, add-project form and (as children) the worker panel of the
 * active project.
 */
export default function Sidebar({
  projects,
  activeProjectId,
  loading,
  error,
  onCreate,
  onSelect,
  onRemove,
  onOpenOrchestrator,
  onSendToOrchestrator,
  liveOrchestratorProjectIds,
  busyOrchestratorProjectId,
  onRefreshProjects,
  children,
}: SidebarProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Removal is confirmed inline, on the row itself.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // The project whose skill packs are being edited, or `null`.
  const [settingsId, setSettingsId] = useState<string | null>(null);
  // The project being connected to GitHub, or `null`.
  const [githubId, setGithubId] = useState<string | null>(null);
  // The project whose orchestrator prompt panel is open, or `null`.
  const [orchestratorPanelId, setOrchestratorPanelId] = useState<string | null>(null);
  // Draft prompts per project; the global master prompt integration comes later.
  const [orchestratorPrompts, setOrchestratorPrompts] = useState<Record<string, string>>({});
  // Project whose orchestrator prompt is being typed into the PTY.
  const [sendingProjectId, setSendingProjectId] = useState<string | null>(null);
  const [orchestratorError, setOrchestratorError] = useState<string | null>(null);
  // Project whose orchestrator stop is in flight, and the last stop failure
  // per project — shown under the toggle itself, since no panel is open then.
  const [stoppingProjectId, setStoppingProjectId] = useState<string | null>(null);
  const [stopErrors, setStopErrors] = useState<ReadonlyMap<string, string>>(() => new Map());

  const canSubmit = name.trim() !== "" && repoPath.trim() !== "" && !submitting;
  // The row's gear is only a handle; the dialog belongs to the project itself.
  const settingsProject = projects.find((project) => project.id === settingsId) ?? null;
  // Same for the GitHub dialog: it survives the row's buttons.
  const githubProject = projects.find((project) => project.id === githubId) ?? null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    const created = await onCreate(name.trim(), repoPath.trim());
    setSubmitting(false);
    if (!created) return;
    setName("");
    setRepoPath("");
    setFormOpen(false);
  };

  /**
   * Flipping the switch ON opens the prompt panel; flipping it OFF stops the
   * live orchestrator — the core archives it, which kills its session, and the
   * PTY exit event is what unlights the switch again. An empty draft starts on
   * the global master prompt, when there is one and it is switched on — the
   * toggle is then a starting point, not a locked template.
   */
  const handleOrchestratorToggle = (projectId: string, live: boolean) => {
    setOrchestratorError(null);
    if (live) {
      void stopOrchestrator(projectId);
      return;
    }
    if ((orchestratorPrompts[projectId] ?? "") === "") {
      const master = loadMasterPrompt();
      if (isMasterPromptEnabled() && master.trim() !== "") {
        setOrchestratorPrompts((prev) => ({ ...prev, [projectId]: master }));
      }
    }
    setOrchestratorPanelId((current) => (current === projectId ? null : projectId));
  };

  /**
   * Stops the project's live orchestrator by archiving it: the core kills the
   * session and retires the row, and a later flip ON simply creates a fresh
   * one — orchestrators are deliberately cheap to lose. The switch is driven
   * by the parent's worker list, so this only fires the archive; the killed
   * session's exit event flips the switch off.
   */
  const stopOrchestrator = async (projectId: string) => {
    if (stoppingProjectId !== null) return;
    setStoppingProjectId(projectId);
    setStopErrors((current) => {
      const next = new Map(current);
      next.delete(projectId);
      return next;
    });
    try {
      const workers = await listWorkers(projectId);
      const orchestrator = workers.find(
        (worker) =>
          worker.kind === "orchestrator" &&
          worker.status === "running" &&
          worker.sessionId !== null,
      );
      // The lit switch says one is live; if the snapshot was stale there is
      // simply nothing to stop, and the next worker refresh unlights it.
      if (orchestrator) await archiveWorker(orchestrator.id);
    } catch (cause) {
      setStopErrors((current) => new Map(current).set(projectId, describeError(cause)));
    } finally {
      setStoppingProjectId(null);
    }
  };

  /**
   * Only one orchestrator panel is open at a time, so one round is all this
   * needs — and it belongs to the panel that is open, which is also the
   * project its preflight questions are filed under. See
   * {@link useSharpening}: a vague draft comes back as questions in the Fragen
   * tab instead of a guessed prompt.
   */
  const sharpening = useSharpening(orchestratorPanelId, (prompt) => {
    if (orchestratorPanelId === null) return;
    setOrchestratorPrompts((prev) => ({ ...prev, [orchestratorPanelId]: prompt }));
  });

  const handleSharpenPrompt = (projectId: string) => {
    sharpening.start(orchestratorPrompts[projectId] ?? "");
  };

  const handlePromptChange = (projectId: string, event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setOrchestratorPrompts((prev) => ({ ...prev, [projectId]: value }));
  };

  const handleSendPrompt = async (projectId: string) => {
    const draft = (orchestratorPrompts[projectId] ?? "").trim();
    if (draft === "" || !onSendToOrchestrator || sendingProjectId !== null) return;
    setSendingProjectId(projectId);
    setOrchestratorError(null);
    try {
      await onSendToOrchestrator(projectId, draft);
      // Delivered — the draft has done its job for this orchestrator.
      setOrchestratorPrompts((prev) => ({ ...prev, [projectId]: "" }));
      setOrchestratorPanelId(null);
    } catch (cause) {
      setOrchestratorError(describeError(cause));
    } finally {
      setSendingProjectId(null);
    }
  };

  return (
    <aside className="sidebar" aria-label="Projekte und Panels">
      <h1 className="sidebar-brand">ProjectA</h1>

      <section className="sidebar-section">
        <div className="section-head">
          <h2 className="section-title">Projects</h2>
          <button
            type="button"
            className="section-action"
            aria-expanded={formOpen}
            title={formOpen ? "Cancel" : "Add project"}
            aria-label={formOpen ? "Cancel" : "Add project"}
            onClick={() => setFormOpen((open) => !open)}
          >
            {formOpen ? "×" : "+"}
          </button>
        </div>

        {formOpen ? (
          <form className="project-form" onSubmit={(event) => void handleSubmit(event)}>
            <input
              className="field"
              placeholder="Name"
              aria-label="Name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className="field"
              placeholder="Repo path"
              aria-label="Repo path"
              value={repoPath}
              onChange={(event) => setRepoPath(event.target.value)}
            />
            <button type="submit" className="button-primary" disabled={!canSubmit}>
              {submitting ? "Adding…" : "Add project"}
            </button>
          </form>
        ) : null}

        {loading ? <div className="sidebar-note">Loading…</div> : null}
        {error ? <div className="sidebar-note sidebar-error" role="alert">{error}</div> : null}
        {!loading && projects.length === 0 ? (
          <div className="sidebar-note">No projects yet.</div>
        ) : null}

        <ul className="project-list">
          {projects.map((project) => {
            const active = project.id === activeProjectId;
            const confirming = confirmingId === project.id;
            const orchestratorLive = liveOrchestratorProjectIds.includes(project.id);
            const orchestratorBusy = busyOrchestratorProjectId === project.id;
            const orchestratorPanelOpen = orchestratorPanelId === project.id;
            const orchestratorStopping = stoppingProjectId === project.id;
            const stopError = stopErrors.get(project.id) ?? null;
            // The switch reads ON while its panel is open, so the user's flip
            // sticks even before any orchestrator is actually running.
            const orchestratorEngaged = orchestratorLive || orchestratorPanelOpen;
            return (
              <Fragment key={project.id}>
                <li className={`project-row${active ? " project-row-active" : ""}`}>
                  <button
                    type="button"
                    className="project-button"
                    title={project.repoPath}
                    onClick={() => onSelect(project.id)}
                  >
                    <span className="project-name">{project.name}</span>
                    <span className="project-path">{project.repoPath}</span>
                  </button>
                  {project.githubRemote !== true ? (
                    <button
                      type="button"
                      className="project-github"
                      aria-label={`GitHub of ${project.name}`}
                      title="Mit GitHub verknüpfen"
                      onClick={() => setGithubId(project.id)}
                    >
                      GH+
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="project-gear"
                    aria-label={`Skill-Packs of ${project.name}`}
                    title="Skill-Packs"
                    onClick={() => setSettingsId(project.id)}
                  >
                    ⚙
                  </button>
                  {confirming ? (
                    <span className="confirm">
                      <button
                        type="button"
                        className="confirm-yes"
                        onClick={() => {
                          setConfirmingId(null);
                          onRemove(project.id);
                        }}
                      >
                        remove
                      </button>
                      <button
                        type="button"
                        className="confirm-no"
                        onClick={() => setConfirmingId(null)}
                      >
                        keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="project-remove"
                      aria-label={`Remove ${project.name}`}
                      title="Remove project"
                      onClick={() => setConfirmingId(project.id)}
                    >
                      ×
                    </button>
                  )}
                </li>
                <li className="orchestrator-row">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={orchestratorEngaged}
                    className={`orchestrator-toggle${
                      orchestratorEngaged ? " orchestrator-toggle-on" : ""
                    }`}
                    title={
                      orchestratorLive
                        ? `Stop the ${project.name} orchestrator`
                        : `Start the ${project.name} orchestrator`
                    }
                    disabled={orchestratorBusy || orchestratorStopping}
                    onClick={() => handleOrchestratorToggle(project.id, orchestratorLive)}
                  >
                    <span className="orchestrator-track" aria-hidden="true">
                      <span className="orchestrator-thumb" />
                    </span>
                    <span className="orchestrator-label">Orchestrator</span>
                    {orchestratorBusy ? (
                      <span className="orchestrator-note">starting…</span>
                    ) : orchestratorStopping ? (
                      <span className="orchestrator-note">stopping…</span>
                    ) : null}
                  </button>
                </li>
                {stopError === null ? null : (
                  <li className="orchestrator-panel">
                    <div className="sidebar-error">{stopError}</div>
                  </li>
                )}
                {orchestratorPanelOpen ? (
                  <li className="orchestrator-panel">
                    <textarea
                      className="field field-textarea"
                      placeholder="Optionaler Prompt (leer = nur starten)…"
                      aria-label="Prompt für den Orchestrator"
                      rows={3}
                      value={orchestratorPrompts[project.id] ?? ""}
                      onChange={(event) => handlePromptChange(project.id, event)}
                    />
                    {orchestratorError !== null ? (
                      <div className="sidebar-error" role="alert">{orchestratorError}</div>
                    ) : null}
                    {sharpening.error !== null ? (
                      <div className="sidebar-error">{sharpening.error}</div>
                    ) : null}
                    {/* Ordinary preflight rows: the Fragen tab is where they
                        get answered, and the prompt lands in the field above
                        once they are. */}
                    {sharpening.phase === "waiting" ? (
                      <div className="sidebar-note">
                        {sharpening.open.length === 1
                          ? "Eine Rückfrage wartet im Fragen-Tab. "
                          : `${sharpening.open.length} Rückfragen warten im Fragen-Tab. `}
                        <button type="button" className="link-button" onClick={sharpening.cancel}>
                          Abbrechen
                        </button>
                      </div>
                    ) : null}
                    <div className="orchestrator-panel-actions">
                      <button
                        type="button"
                        className="button-subtle"
                        title="Den Entwurf von einem Agenten schärfen lassen — bei einer vagen Aufgabe kommen erst Rückfragen zurück"
                        disabled={
                          (orchestratorPrompts[project.id] ?? "").trim() === "" ||
                          sharpening.active
                        }
                        onClick={() => handleSharpenPrompt(project.id)}
                      >
                        {
                          {
                            idle: "Prompt schärfen",
                            thinking: "schärft…",
                            waiting: "wartet auf dich…",
                            finishing: "baut Prompt…",
                          }[sharpening.phase]
                        }
                      </button>
                      {onSendToOrchestrator && orchestratorLive ? (
                        <button
                          type="button"
                          className="button-primary"
                          title="Den Prompt an den laufenden Orchestrator senden"
                          disabled={(orchestratorPrompts[project.id] ?? "").trim() === "" || sendingProjectId !== null}
                          onClick={() => void handleSendPrompt(project.id)}
                        >
                          {sendingProjectId === project.id ? "Sendet…" : "Senden"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="button-primary"
                        title={
                          sharpening.active
                            ? "Die Schärfung läuft noch — Starten würde ihre Rückfragen verwerfen"
                            : "Orchestrator starten"
                        }
                        disabled={sharpening.active}
                        onClick={() => {
                          // An active round owns the prompt: starting now
                          // would close the panel and drop its final prompt.
                          if (sharpening.active) return;
                          setOrchestratorPanelId(null);
                          onOpenOrchestrator(project.id);
                        }}
                      >
                        Starten
                      </button>
                    </div>
                  </li>
                ) : null}
              </Fragment>
            );
          })}
        </ul>
      </section>

      {children}

      {settingsProject ? (
        <SkillPackDialog project={settingsProject} onClose={() => setSettingsId(null)} />
      ) : null}

      {githubProject ? (
        <GitHubLinkDialog
          project={githubProject}
          onLinked={onRefreshProjects}
          onClose={() => setGithubId(null)}
        />
      ) : null}
    </aside>
  );
}
