import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { describeError, getLandingPage } from "../lib/ipc";
import { markdownToHtml, openPreviewLink } from "../lib/markdown";

interface DesignStudioProps {
  projectId: string | null;
}

/**
 * F2: stored landing-page markdown, read-only. The editor and save path are
 * gone so the UI cannot lose the source (F0-6 copied the HTML projection).
 * Writing still exists on `pa project landing-page` and the store.
 */
export default function DesignStudio({ projectId }: DesignStudioProps) {
  const [markdown, setMarkdown] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Guards a slow load against a project the user already left.
  const loadToken = useRef(0);

  useEffect(() => {
    const token = ++loadToken.current;
    setError(null);
    setCopied(false);
    if (projectId === null) {
      setMarkdown("");
      setLoaded(true);
      setLoadingError(null);
      return;
    }
    setMarkdown("");
    setLoaded(false);
    setLoadingError(null);
    let cancelled = false;
    void (async () => {
      try {
        const savedMarkdown = await getLandingPage(projectId);
        if (cancelled || loadToken.current !== token) return;
        setMarkdown(savedMarkdown ?? "");
        setLoaded(true);
        setLoadingError(null);
      } catch (cause) {
        if (cancelled || loadToken.current !== token) return;
        setLoadingError(describeError(cause));
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const previewHtml = useMemo(() => markdownToHtml(markdown), [markdown]);

  const handleCopyMarkdown = useCallback(() => {
    if (navigator.clipboard === undefined) return;
    void navigator.clipboard
      .writeText(markdown)
      .then(() => {
        setCopied(true);
        setError(null);
      })
      .catch((cause: unknown) => setError(describeError(cause)));
  }, [markdown]);

  if (projectId === null) {
    return (
      <div className="design-studio">
        <div className="empty-state">
          <p>Projekt auswählen</p>
        </div>
      </div>
    );
  }

  return (
    <div className="design-studio">
      <section className="design-preview-pane" aria-label="Landing Page">
        <div className="design-toolbar design-toolbar-static">
          <h2 className="section-title">Landing Page</h2>
          <span className="design-readonly-hint">nur lesen — Schreiben über pa</span>
        </div>
        <div className="design-preview-scroll">
          {!loaded ? (
            <p className="design-preview-empty">Laden…</p>
          ) : previewHtml === "" ? (
            <p className="design-preview-empty">Noch kein Inhalt.</p>
          ) : (
            <div
              className="design-preview-html"
              onClick={openPreviewLink}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
        </div>
      </section>
      <div className="design-actions">
        <button
          type="button"
          className="button-ghost"
          disabled={!loaded || markdown.trim() === ""}
          onClick={handleCopyMarkdown}
        >
          {copied ? "Markdown kopiert" : "Markdown kopieren"}
        </button>
        {loadingError ? <span className="design-error">{loadingError}</span> : null}
        {error ? <span className="design-error">{error}</span> : null}
      </div>
    </div>
  );
}
