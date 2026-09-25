import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { listRoleVariants, getRoutingStatus } from "../lib/ipc";
import { blockedLabel, isBlocked, useQuotaState } from "../lib/quota";
import { packLabel, useProjectSkillPacks } from "../lib/skills";
import {
  composeWithMasterPrompt,
  isCategoryActive,
  isMasterPromptEnabled,
  loadMasterPrompt,
  pickSpawnProfile,
} from "../lib/settings";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useSharpening } from "../lib/useSharpening";
import { OpenQuestion } from "./QuestionsView";
import { variantLabel } from "./ProfilePicker";
import type { AgentProfile, RoleVariant } from "../types";

interface NewWorkerDialogProps {
  projectId: string;
  projectName: string;
  profiles: AgentProfile[];
  profilesLoading: boolean;
  /** Profile-load or worker-creation failure; the dialog stays open on error. */
  error: string | null;
  busy: boolean;
  /**
   * `roleVariantId` is only passed when the user picked a curated role; a
   * plain profile spawn must reach the core exactly as it did before.
   */
  onSubmit: (task: string, profileId: string, roleVariantId?: string) => void;
  onClose: () => void;
}

/** Marks a variant as belonging to the profile above it inside the select. */
const VARIANT_MARKER = "└ ";

/** Option values are one namespace, so a variant needs its own prefix. */
const VARIANT_VALUE_PREFIX = "variant:";

/** Task + agent profile, the two things `create_worker` needs. */
export default function NewWorkerDialog({
  projectId,
  projectName,
  profiles,
  profilesLoading,
  error,
  busy,
  onSubmit,
  onClose,
}: NewWorkerDialogProps) {
  const [task, setTask] = useState("");
  const [profileId, setProfileId] = useState("");
  /** The curated role on top of `profileId`, or `null` for a plain spawn. */
  const [variantId, setVariantId] = useState<string | null>(null);
  const [variants, setVariants] = useState<RoleVariant[]>([]);
  const [reviewBlocked, setReviewBlocked] = useState<string | null>(null);
  /** The draft as it was before the last enhancement, or `null` if untouched. */
  const [draftBeforeEnhance, setDraftBeforeEnhance] = useState<string | null>(null);

  /**
   * Sharpening is a conversation now, not a call (Phase 21 P1): a vague task
   * comes back as questions, and the prompt only arrives once they are
   * answered. The draft is swapped for the final prompt whenever that is —
   * three minutes or half an hour later.
   */
  const sharpening = useSharpening(projectId, (prompt) => {
    setDraftBeforeEnhance(task);
    setTask(prompt);
  });

  // The master prompt is read once per open; editing it happens in settings.
  const hasMasterPrompt = loadMasterPrompt().trim() !== "";
  const [attachMaster, setAttachMaster] = useState(
    () => hasMasterPrompt && isMasterPromptEnabled(),
  );

  // The dialog is mounted on open, so one fetch per open is enough; the status
  // bar owns the polling.
  const quota = useQuotaState();
  // Read-only: which packs the agent will start with is a project setting,
  // changed from the gear in the sidebar rather than from here.
  const skills = useProjectSkillPacks(projectId);
  // Approved roles are read once per open, like the profiles themselves. They
  // are an extra on top of the roster, so a core that cannot answer yet leaves
  // the dialog as it was rather than blocking the spawn.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await listRoleVariants(projectId);
        // A proposal is not a tool: it is reviewed in the roles tab, not here.
        if (!cancelled) setVariants(next.filter((entry) => entry.status === "approved"));
      } catch {
        if (!cancelled) setVariants([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void getRoutingStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.mode === "review" && !status.reviewIndependent) {
          setReviewBlocked(
            status.reviewDetail ||
              "Review ist blockiert: keine unabhängige Prüfer-Familie.",
          );
        } else {
          setReviewBlocked(null);
        }
      })
      .catch(() => {
        if (!cancelled) setReviewBlocked(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const quotaFor = (id: string) => quota.byProfile.get(id);
  const blockedProfiles = profiles.filter((profile) => isBlocked(quotaFor(profile.id)));
  const workerCategoryOn = isCategoryActive("worker");

  // Default to the category overlay, then the first profile the user may
  // actually spawn; step off a profile that turns out to be blocked.
  useEffect(() => {
    if (profiles.length === 0) return;
    const blockedIds = new Set(
      profiles.filter((profile) => isBlocked(quota.byProfile.get(profile.id))).map((profile) => profile.id),
    );
    const currentOk = profiles.some((profile) => profile.id === profileId && !blockedIds.has(profile.id));
    if (currentOk) return;
    // Category-off or every profile blocked still needs a visible selection;
    // `canSubmit` is what refuses the spawn.
    const picked = pickSpawnProfile("worker", profiles, blockedIds);
    const next =
      picked ??
      profiles.find((profile) => !blockedIds.has(profile.id))?.id ??
      profiles[0]?.id ??
      "";
    if (next === profileId) return;
    setProfileId(next);
    setVariantId(null);
  }, [profiles, profileId, quota.byProfile]);

  // The select carries one value for two things, so a role is namespaced and
  // resolved back into its base profile the moment it is chosen.
  const selectValue = variantId === null ? profileId : `${VARIANT_VALUE_PREFIX}${variantId}`;

  const handleSelectProfile = (value: string) => {
    if (!value.startsWith(VARIANT_VALUE_PREFIX)) {
      setProfileId(value);
      setVariantId(null);
      return;
    }
    const id = value.slice(VARIANT_VALUE_PREFIX.length);
    const variant = variants.find((entry) => entry.id === id);
    if (variant === undefined) return;
    setProfileId(variant.baseProfileId);
    setVariantId(variant.id);
  };

  /**
   * When the dialog refuses to go away.
   *
   * `busy` is the `create_worker` call: there is a worker being made, and
   * unmounting here would throw away the one place its error is rendered.
   * A sharpening round counts too, but only for the two ways out that are
   * accidents — see the Cancel button, which ends the round instead of the
   * dialog. A round can last as long as it takes somebody to answer three
   * questions, and a modal that ignores Escape for half an hour is a trap.
   */
  const locked = busy || sharpening.active;
  // Closing mid-call throws the running call away and unmounts the one place
  // its error is rendered, so all three ways out ask the same question first.
  const requestClose = useCallback(() => {
    if (locked) return;
    onClose();
  }, [locked, onClose]);

  /**
   * Cancel, which during a round is a cancel of the round.
   *
   * Only `busy` disables this button: leaving the dialog is how a person gets
   * out of a sharpening they no longer want, and the draft they typed is still
   * in the field afterwards — „ohne Schärfung starten“ is one click further.
   */
  const handleCancel = useCallback(() => {
    if (sharpening.active) {
      sharpening.cancel();
      return;
    }
    requestClose();
  }, [requestClose, sharpening]);

  const dialogRef = useRef<HTMLFormElement | null>(null);
  useFocusTrap(dialogRef);

  // Sits below `requestClose` because it closes over it at render time.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  // With every profile blocked the select has nothing usable to fall back to,
  // so the create button must refuse rather than spawn into a blocked quota.
  const selectedBlocked = isBlocked(quotaFor(profileId));
  const canSubmit =
    workerCategoryOn &&
    task.trim() !== "" &&
    profileId !== "" &&
    !selectedBlocked &&
    !locked &&
    reviewBlocked === null;
  const canEnhance = task.trim() !== "" && !locked;

  /** What the sharpen button says about where the round is. */
  const enhanceLabel = {
    idle: "Prompt schärfen",
    thinking: "Schärfe…",
    waiting: "Wartet auf dich…",
    finishing: "Baue Prompt…",
  }[sharpening.phase];

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const finalTask = attachMaster ? composeWithMasterPrompt(task.trim()) : task.trim();
    onSubmit(finalTask, profileId, variantId ?? undefined);
  };

  const handleEnhance = () => {
    if (!canEnhance) return;
    sharpening.start(task, profileId === "" ? undefined : profileId);
  };

  const handleRestoreDraft = () => {
    if (draftBeforeEnhance === null) return;
    setTask(draftBeforeEnhance);
    setDraftBeforeEnhance(null);
    sharpening.clearError();
  };

  return (
    <div className="modal-backdrop" onMouseDown={requestClose}>
      <form
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="New worker"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="modal-title">New worker — {projectName}</div>
        <div className="modal-body">
          <div className="field-header">
            <label className="field-label" htmlFor="worker-task">
              Task
            </label>
            <button
              type="button"
              className="button-subtle"
              onClick={handleEnhance}
              disabled={!canEnhance}
              title="Vage Aufgaben beantwortet der Prompt-Master mit Rückfragen statt mit Raten"
            >
              {enhanceLabel}
            </button>
          </div>
          <textarea
            id="worker-task"
            className="field field-textarea"
            rows={4}
            autoFocus
            placeholder="What should this agent do?"
            value={task}
            disabled={locked}
            onChange={(event) => setTask(event.target.value)}
          />

          {skills.enabled !== null ? (
            <div className="skill-chips">
              <span className="skill-chips-label">Skills:</span>
              {skills.enabled.length === 0 ? (
                <span className="skill-chips-empty">keine</span>
              ) : (
                skills.enabled.map((packId) => (
                  <span key={packId} className="badge badge-skill" title={packId}>
                    {packLabel(skills.packs, packId)}
                  </span>
                ))
              )}
            </div>
          ) : null}

          {hasMasterPrompt ? (
            <label className="queue-sharpen master-attach">
              <input
                type="checkbox"
                checked={attachMaster}
                disabled={locked}
                onChange={(event) => setAttachMaster(event.target.checked)}
              />
              <span>Masterprompt anhängen</span>
            </label>
          ) : null}

          {sharpening.running ? (
            <div className="modal-note" aria-live="polite">
              Ein Agent-Aufruf läuft — das kann bis zu ~3 Minuten dauern.
            </div>
          ) : null}

          {/* The rows below are the same preflight questions the Fragen tab is
              showing right now. This dialog is a modal, so it has to bring
              them here rather than send the user to a tab it is covering — the
              card is the tab's own, and an answer given there closes the same
              row within a poll. */}
          {sharpening.phase === "waiting" ? (
            <div className="modal-note sharpen-note" aria-live="polite">
              <span>
                {sharpening.open.length === 1
                  ? "Eine Rückfrage — sie steht auch im Fragen-Tab"
                  : `${sharpening.open.length} Rückfragen — sie stehen auch im Fragen-Tab`}
              </span>
              <span className="sharpen-note-hint">
                Antworten, dann wird der Prompt daraus gebaut. „Schärfung abbrechen“ lässt
                den Entwurf stehen — er ist danach ohne Schärfung startbar.
              </span>
            </div>
          ) : null}
          {sharpening.phase === "waiting"
            ? sharpening.open.map((question) => (
                <OpenQuestion
                  key={question.id}
                  question={question}
                  worker={null}
                  project={null}
                  now={Math.floor(Date.now() / 1000)}
                  onOpenWorker={() => undefined}
                  onAnswer={sharpening.answer}
                />
              ))
            : null}

          {!sharpening.active && draftBeforeEnhance !== null ? (
            <div className="modal-note enhance-note">
              <span>Geschärfter Prompt — prüfen und anpassen</span>
              <button type="button" className="link-button" onClick={handleRestoreDraft}>
                Original zurückholen
              </button>
            </div>
          ) : null}

          {sharpening.error ? (
            <div className="modal-note modal-error">{sharpening.error}</div>
          ) : null}

          <label className="field-label" htmlFor="worker-profile">
            Agent profile
          </label>
          <select
            id="worker-profile"
            className="field"
            value={selectValue}
            disabled={locked || profilesLoading || profiles.length === 0}
            onChange={(event) => handleSelectProfile(event.target.value)}
          >
            {profilesLoading ? <option value="">Loading profiles…</option> : null}
            {!profilesLoading && profiles.length === 0 ? (
              <option value="">No agent profiles configured</option>
            ) : null}
            {profiles.map((profile) => {
              const entry = quotaFor(profile.id);
              const blocked = isBlocked(entry);
              const note = blocked && entry ? blockedLabel(entry) : null;
              const own = variants.filter((variant) => variant.baseProfileId === profile.id);
              return (
                <Fragment key={profile.id}>
                  <option value={profile.id} disabled={blocked} title={note ?? undefined}>
                    {note === null ? profile.name : `${profile.name} — blockiert (${note})`}
                  </option>
                  {/* Right under the profile they specialise, marked so the
                      relationship reads even in a flat option list. A role
                      runs on its base profile, so it shares its quota. */}
                  {own.map((variant) => {
                    const label = `${VARIANT_MARKER}${variantLabel(profile, variant)}`;
                    return (
                      <option
                        key={variant.id}
                        value={`${VARIANT_VALUE_PREFIX}${variant.id}`}
                        className="profile-option-variant"
                        disabled={blocked}
                        title={note ?? (variant.patternLabel === "" ? undefined : variant.patternLabel)}
                      >
                        {note === null ? label : `${label} — blockiert (${note})`}
                      </option>
                    );
                  })}
                </Fragment>
              );
            })}
          </select>

          {blockedProfiles.length > 0 ? (
            <div className="quota-blocked" aria-live="polite">
              {blockedProfiles.map((profile) => {
                const note = blockedLabel(quotaFor(profile.id)!);
                return (
                  <span
                    key={profile.id}
                    className="badge badge-blocked"
                    title={`${profile.name} — ${note}`}
                  >
                    {profile.name}: {note}
                  </span>
                );
              })}
            </div>
          ) : null}

          {!workerCategoryOn ? (
            <div className="modal-note modal-error" role="status">
              Worker-Kategorie ist aus — es wird kein neuer Worker gestartet.
            </div>
          ) : null}

          {reviewBlocked ? (
            <div
              className="modal-note modal-error"
              role="status"
              aria-live="polite"
              aria-label="Review-Blockade"
            >
              {reviewBlocked} Spawn als Review fällt nicht auf das Autoren-Modell
              zurück. In Einstellungen → Allgemein einen anderen Produktmodus wählen.
            </div>
          ) : null}

          {error ? <div className="modal-note modal-error">{error}</div> : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="button-ghost" onClick={handleCancel} disabled={busy}>
            {sharpening.active ? "Schärfung abbrechen" : "Cancel"}
          </button>
          <button type="submit" className="button-primary" disabled={!canSubmit}>
            {busy ? "Creating…" : "Create worker"}
          </button>
        </div>
      </form>
    </div>
  );
}
