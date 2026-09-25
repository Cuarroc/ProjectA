import { useEffect, useRef, useState, type FormEvent } from "react";

import { createGithubRepo, describeError, linkGithubRemote } from "../lib/ipc";
import { handleTablistKey, tabStop } from "../lib/tabs";
import { useFocusTrap } from "../lib/useFocusTrap";
import type { Project } from "../types";

/** The two ways to bring a project onto GitHub. */
type Mode = "create" | "link";
const GH_MODES: readonly Mode[] = ["create", "link"];

interface GitHubLinkDialogProps {
  project: Project;
  /** Called after a successful create or link, so the sidebar refreshes. */
  onLinked: () => void;
  onClose: () => void;
}

/**
 * Connects a project to GitHub: either a fresh repository is created or an
 * existing one is linked. Backend failures surface as a red line in the
 * dialog, never as an alert.
 */
export default function GitHubLinkDialog({ project, onLinked, onClose }: GitHubLinkDialogProps) {
  const [mode, setMode] = useState<Mode>("create");
  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };
  const [name, setName] = useState(project.name);
  const [isPrivate, setIsPrivate] = useState(true);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown after "create" succeeded; the dialog closes itself shortly after.
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  // Handlers always see the latest props without re-binding: a parent
  // re-render must neither kill the auto-close timer nor arm a second one.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // While a create/link is in flight the dialog stays: closing it would
      // strand the request and invite a duplicate submit.
      if (event.key === "Escape" && !busyRef.current) onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef);

  const canCreate = name.trim() !== "" && !busy && createdUrl === null;
  const canLink = url.trim() !== "" && !busy;

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const repoUrl = await createGithubRepo({
        projectId: project.id,
        name: name.trim(),
        private: isPrivate,
      });
      setCreatedUrl(repoUrl);
      onLinked();
      closeTimer.current = window.setTimeout(() => onCloseRef.current(), 1600);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!canLink) return;
    setBusy(true);
    setError(null);
    try {
      await linkGithubRemote(project.id, url.trim());
      onLinked();
      onClose();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={() => {
        // Same guard as Escape: a click beside the dialog must not strand an
        // in-flight create/link.
        if (!busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`GitHub — ${project.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-title">GitHub — {project.name}</div>
        <div className="modal-body">
          {createdUrl !== null ? (
            <>
              <div className="modal-note modal-success">
                Repository erstellt:{" "}
                <span className="gh-url">{createdUrl}</span>
              </div>
              <div className="modal-note">Wird geschlossen…</div>
            </>
          ) : (
            <>
              <div
                className="segmented"
                role="tablist"
                aria-label="GitHub-Modus"
                onKeyDown={(event) =>
                  handleTablistKey(event, GH_MODES.indexOf(mode), GH_MODES.length, (index) =>
                    switchMode(GH_MODES[index]),
                  )
                }
              >
                <button
                  id="gh-tab-create"
                  type="button"
                  role="tab"
                  aria-selected={mode === "create"}
                  aria-controls="gh-panel"
                  tabIndex={tabStop(mode === "create", 0, true)}
                  className={`segment${mode === "create" ? " segment-active" : ""}`}
                  onClick={() => switchMode("create")}
                >
                  Neu erstellen
                </button>
                <button
                  id="gh-tab-link"
                  type="button"
                  role="tab"
                  aria-selected={mode === "link"}
                  aria-controls="gh-panel"
                  tabIndex={tabStop(mode === "link", 1, true)}
                  className={`segment${mode === "link" ? " segment-active" : ""}`}
                  onClick={() => switchMode("link")}
                >
                  Bestehendes verknüpfen
                </button>
              </div>

              {mode === "create" ? (
                <form
                  id="gh-panel"
                  role="tabpanel"
                  aria-labelledby="gh-tab-create"
                  className="gh-form"
                  onSubmit={(event) => void handleCreate(event)}
                >
                  <input
                    className="field"
                    placeholder="Repository-Name"
                    aria-label="Repository-Name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <label className="gh-check">
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(event) => setIsPrivate(event.target.checked)}
                    />
                    privat
                  </label>
                  <button type="submit" className="button-primary" disabled={!canCreate}>
                    {busy ? "Erstelle…" : "Erstellen"}
                  </button>
                </form>
              ) : (
                <form
                  id="gh-panel"
                  role="tabpanel"
                  aria-labelledby="gh-tab-link"
                  className="gh-form"
                  onSubmit={(event) => void handleLink(event)}
                >
                  <input
                    className="field gh-url-field"
                    placeholder="https://github.com/user/repo.git"
                    aria-label="Repository-URL"
                    value={url}
                    autoFocus
                    onChange={(event) => setUrl(event.target.value)}
                  />
                  <button type="submit" className="button-primary" disabled={!canLink}>
                    {busy ? "Verknüpfe…" : "Verknüpfen"}
                  </button>
                </form>
              )}
            </>
          )}

          {error ? <div className="modal-note modal-error">{error}</div> : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="button-ghost" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
