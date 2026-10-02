import { useCallback, useEffect, useRef, useState } from "react";

import {
  approveLearning,
  approveRoleVariant,
  describeError,
  getVerdictToken,
  listLearnings,
  listRoleVariants,
  rejectLearning,
  rejectRoleVariant,
} from "../lib/ipc";
import { handleTablistKey, tabStop } from "../lib/tabs";
import type { Learning, RoleVariant } from "../types";

interface LearningsPanelProps {
  /** `null` means there is no active project and nothing to review. */
  projectId: string | null;
}

/** How long a confirmation stays on screen before it stops being news. */
const NOTICE_MS = 6_000;

/** Critics file their findings outside this webview, so poll the list as well. */
const POLL_MS = 15_000;

/** Which inbox is on screen; both are polled either way. */
type PanelTab = "learnings" | "roles";
const LEARN_TABS: readonly PanelTab[] = ["learnings", "roles"];

/**
 * A draft per learning id. It is the user's text, not the core's, so a poll
 * may only drop the entries whose learning is gone — never rewrite a live one.
 */
type Drafts = ReadonlyMap<string, string>;

/**
 * The critic's inbox: what the agents learned on their last runs and which
 * specialised roles it wants to carve out of them, each waiting for a human to
 * take it into the playbook or throw it away.
 */
export default function LearningsPanel({ projectId }: LearningsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<PanelTab>("learnings");
  const [entries, setEntries] = useState<Learning[]>([]);
  const [variants, setVariants] = useState<RoleVariant[]>([]);
  // "Keine offenen …" is a claim each inbox earns separately: only its own
  // first successful read turns the quiet panel into an empty one.
  const [learningsLoaded, setLearningsLoaded] = useState(false);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>(() => new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * Ids whose prompt addition is folded away; unfolded is the default (KI-1).
   * A verdict is made blind if the addition a variant would carry into every
   * future spawn is not on screen already - folding it behind a click that a
   * reviewer must remember to make is how that happens.
   */
  const [collapsedPrompts, setCollapsedPrompts] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  /**
   * The verdict token, once the user asked to see it. Fetched on demand and
   * never on load: it is the key to the four review routes, and a key that is
   * on screen by default is one that gets read over a shoulder.
   */
  const [verdictToken, setVerdictToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (projectId === null) return;
    try {
      const next = (await listLearnings(projectId)).filter(
        (entry) => entry.status === "pending",
      );
      setEntries(next);
      setDrafts((current) => {
        const merged = new Map<string, string>();
        for (const entry of next) {
          // Someone may be mid-sentence in this box: their text wins, and only
          // a learning that has vanished loses its draft.
          merged.set(entry.id, current.get(entry.id) ?? entry.content);
        }
        return merged;
      });
      setError(null);
      setLearningsLoaded(true);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [projectId]);

  const refreshRoles = useCallback(async () => {
    if (projectId === null) return;
    try {
      const next = (await listRoleVariants(projectId)).filter(
        (variant) => variant.status === "pending",
      );
      setVariants(next);
      // A proposal that is gone must not keep its fold state alive.
      setCollapsedPrompts((current) => {
        const kept = new Set<string>();
        for (const variant of next) if (current.has(variant.id)) kept.add(variant.id);
        return kept;
      });
      setRoleError(null);
      setRolesLoaded(true);
    } catch (cause) {
      setRoleError(describeError(cause));
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId === null) {
      setEntries([]);
      setVariants([]);
      setLearningsLoaded(false);
      setRolesLoaded(false);
      setDrafts(new Map());
      setCollapsedPrompts(new Set());
      setNotice(null);
      setError(null);
      setRoleError(null);
      setVerdictToken(null);
      return;
    }
    setLearningsLoaded(false);
    setRolesLoaded(false);
    void refresh();
    void refreshRoles();
    // Both inboxes are polled whichever tab is open, so the count in the head
    // stays honest about the tab the user is not looking at.
    const interval = window.setInterval(() => {
      void refresh();
      void refreshRoles();
    }, POLL_MS);
    return () => window.clearInterval(interval);
  }, [projectId, refresh, refreshRoles]);

  // A confirmation is only worth the space for as long as it is still recent.
  const noticeTimer = useRef<number | null>(null);
  useEffect(() => {
    if (notice === null) return;
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    };
  }, [notice]);

  if (projectId === null) return null;

  const editText = (id: string, text: string) =>
    setDrafts((current) => new Map(current).set(id, text));

  const togglePromptCollapsed = (id: string) =>
    setCollapsedPrompts((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const handleShowVerdictToken = () => {
    if (verdictToken !== null) {
      setVerdictToken(null);
      return;
    }
    void (async () => {
      try {
        setVerdictToken(await getVerdictToken());
        setNotice(null);
      } catch (cause) {
        setError(describeError(cause));
      }
    })();
  };

  const handleApprove = (entry: Learning) => {
    const text = (drafts.get(entry.id) ?? entry.content).trim();
    if (text === "") return;
    void (async () => {
      setBusyId(entry.id);
      setError(null);
      try {
        await approveLearning(entry.id, text);
        setNotice("Ins Playbook übernommen.");
        await refresh();
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setBusyId(null);
      }
    })();
  };

  const handleReject = (entry: Learning) => {
    void (async () => {
      setBusyId(entry.id);
      setError(null);
      try {
        await rejectLearning(entry.id);
        setNotice("Verworfen.");
        await refresh();
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setBusyId(null);
      }
    })();
  };

  const handleApproveVariant = (variant: RoleVariant) => {
    void (async () => {
      setBusyId(variant.id);
      setRoleError(null);
      try {
        await approveRoleVariant(variant.id);
        setNotice("Rolle angenommen.");
        await refreshRoles();
      } catch (cause) {
        setRoleError(describeError(cause));
      } finally {
        setBusyId(null);
      }
    })();
  };

  const handleRejectVariant = (variant: RoleVariant) => {
    void (async () => {
      setBusyId(variant.id);
      setRoleError(null);
      try {
        await rejectRoleVariant(variant.id);
        setNotice("Verworfen.");
        await refreshRoles();
      } catch (cause) {
        setRoleError(describeError(cause));
      } finally {
        setBusyId(null);
      }
    })();
  };

  // One count for both inboxes: a role proposal must not go unseen just
  // because the other tab happens to be open.
  const openCount = entries.length + variants.length;

  return (
    <section className="sidebar-section learn-section">
      <div className="section-head">
        <div
          className="panel-tabs"
          role="tablist"
          aria-label="Review-Bereiche"
          onKeyDown={(event) =>
            handleTablistKey(event, LEARN_TABS.indexOf(tab), LEARN_TABS.length, (index) =>
              setTab(LEARN_TABS[index]),
            )
          }
        >
          <button
            type="button"
            role="tab"
            className={`panel-tab${tab === "learnings" ? " panel-tab-active" : ""}`}
            aria-selected={tab === "learnings"}
            tabIndex={tabStop(tab === "learnings", 0, true)}
            onClick={() => setTab("learnings")}
          >
            Learnings
            {entries.length > 0 ? <span className="panel-tab-count">{entries.length}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            className={`panel-tab${tab === "roles" ? " panel-tab-active" : ""}`}
            aria-selected={tab === "roles"}
            tabIndex={tabStop(tab === "roles", 1, true)}
            onClick={() => setTab("roles")}
          >
            Rollen
            {variants.length > 0 ? (
              <span className="panel-tab-count">{variants.length}</span>
            ) : null}
          </button>
        </div>
        {openCount > 0 ? (
          <span
            className="badge badge-learn-new"
            title={`${entries.length} offene Learnings, ${variants.length} offene Rollen-Vorschläge`}
          >
            {openCount}
          </span>
        ) : null}
        <button
          type="button"
          className="section-action"
          aria-expanded={!collapsed}
          title={collapsed ? "Review anzeigen" : "Review einklappen"}
          aria-label={collapsed ? "Review anzeigen" : "Review einklappen"}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>

      {collapsed ? null : (
        <>
          {notice ? <div className="sidebar-note learn-notice">{notice}</div> : null}
          {tab === "learnings" && error ? (
            <div className="sidebar-note sidebar-error">{error}</div>
          ) : null}
          {tab === "roles" && roleError ? (
            <div className="sidebar-note sidebar-error">{roleError}</div>
          ) : null}

          {tab === "learnings" ? (
            entries.length === 0 ? (
              learningsLoaded && error === null ? (
                <div className="sidebar-note learn-empty">Keine offenen Learnings.</div>
              ) : null
            ) : (
              <ul className="learn-list">
                {entries.map((entry) => {
                  const draft = drafts.get(entry.id) ?? entry.content;
                  const pending = busyId === entry.id;
                  return (
                    <li key={entry.id} className="learn-card">
                      {entry.patternLabel === null ? null : (
                        <div className="learn-meta">
                          <span
                            className="badge badge-pattern"
                            title={`Muster: ${entry.patternLabel}`}
                          >
                            {entry.patternLabel}
                          </span>
                        </div>
                      )}
                      {/* In full: what goes into the playbook has to be read
                          first, and a clipped insight cannot be judged. */}
                      <p className="learn-content">{entry.content}</p>
                      <textarea
                        className="field field-textarea learn-edit"
                        rows={3}
                        aria-label="Learning vor der Übernahme bearbeiten"
                        value={draft}
                        disabled={pending}
                        onChange={(event) => editText(entry.id, event.target.value)}
                      />
                      <div className="learn-actions">
                        <button
                          type="button"
                          className="worker-action learn-approve"
                          disabled={pending || draft.trim() === ""}
                          title="Ins Playbook übernehmen"
                          onClick={() => handleApprove(entry)}
                        >
                          {pending ? "…" : "Annehmen"}
                        </button>
                        <button
                          type="button"
                          className="worker-action learn-reject"
                          disabled={pending}
                          title="Learning verwerfen"
                          onClick={() => handleReject(entry)}
                        >
                          Verwerfen
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : variants.length === 0 ? (
            rolesLoaded && roleError === null ? (
              <div className="sidebar-note learn-empty">Keine offenen Rollen-Vorschläge.</div>
            ) : null
          ) : (
            <ul className="learn-list">
              {variants.map((variant) => {
                const pending = busyId === variant.id;
                const open = !collapsedPrompts.has(variant.id);
                return (
                  <li key={variant.id} className="learn-card role-card">
                    <div className="role-name">{variant.name}</div>
                    <div className="learn-meta">
                      <span
                        className="badge badge-base-profile"
                        title={`Basis-Profil: ${variant.baseProfileId}`}
                      >
                        {variant.baseProfileId}
                      </span>
                      {variant.patternLabel === "" ? null : (
                        <span
                          className="badge badge-pattern"
                          title={`Muster: ${variant.patternLabel}`}
                        >
                          {variant.patternLabel}
                        </span>
                      )}
                      <span className="badge badge-version" title={`Version ${variant.version}`}>
                        v{variant.version}
                      </span>
                      {/* A second version replaces one that is already in use —
                          that has to be visible before, not after, approving. */}
                      {variant.version > 1 ? (
                        <span
                          className="badge badge-role-newer"
                          title="Löst die bisherige Version dieser Rolle ab"
                        >
                          neue Version
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="worker-action role-prompt-toggle"
                      aria-expanded={open}
                      aria-controls={open ? `role-prompt-${variant.id}` : undefined}
                      title={open ? "Prompt-Zusatz einklappen" : "Prompt-Zusatz anzeigen"}
                      onClick={() => togglePromptCollapsed(variant.id)}
                    >
                      {open ? "− Prompt-Zusatz" : "+ Prompt-Zusatz"}
                    </button>
                    {/* Unfolded by default (KI-1): this is what the variant
                        would add to every future spawn's system prompt, so it
                        has to be read before the verdict, not after it - the
                        toggle only lets a reviewer put it away once read, it
                        must not be what first reveals it. */}
                    {open ? (
                      <pre
                        id={`role-prompt-${variant.id}`}
                        className="role-prompt"
                        role="region"
                        tabIndex={0}
                        aria-label="Prompt-Zusatz der Rolle"
                      >
                        {variant.systemPromptAddition}
                      </pre>
                    ) : null}
                    <div className="learn-actions">
                      <button
                        type="button"
                        className="worker-action learn-approve"
                        disabled={pending}
                        title="Rolle für neue Worker freigeben"
                        onClick={() => handleApproveVariant(variant)}
                      >
                        {pending ? "…" : "Annehmen"}
                      </button>
                      <button
                        type="button"
                        className="worker-action learn-reject"
                        disabled={pending}
                        title="Rollen-Vorschlag verwerfen"
                        onClick={() => handleRejectVariant(variant)}
                      >
                        Verwerfen
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Approving from here needs no token: a Tauri command cannot be
              reached from outside this window. Making the same decision in a
              terminal does — and this is the only place that token can be
              read off. */}
          <div className="learn-verdict-token">
            <button
              type="button"
              className="worker-action"
              aria-expanded={verdictToken !== null}
              title="Token für `pa learnings approve --verdict-token`"
              onClick={handleShowVerdictToken}
            >
              {verdictToken === null ? "Verdict-Token anzeigen" : "Verdict-Token verbergen"}
            </button>
            {verdictToken === null ? null : (
              <code className="learn-verdict-value">{verdictToken}</code>
            )}
          </div>
        </>
      )}
    </section>
  );
}
