import { QUOTA_POLL_MS, useQuotaState } from "../lib/quota";
import type { TerminalSession } from "../types";

interface StatusBarProps {
  session: TerminalSession | null;
  sessionCount: number;
  error: string | null;
  /** Workers in `needs_you`; `0` hides the pill entirely. */
  attentionCount: number;
  /** Where the attention pill leads: the board, where a card can be acted on. */
  onOpenBoard: () => void;
  onDismissError: () => void;
  onOpenProviders: () => void;
}

export default function StatusBar({
  session,
  sessionCount,
  error,
  attentionCount,
  onOpenBoard,
  onDismissError,
  onOpenProviders,
}: StatusBarProps) {
  // The status bar is the app's one long-lived quota reader: it polls, and the
  // New-worker dialog just reads once when it opens.
  const quota = useQuotaState(QUOTA_POLL_MS);

  return (
    <footer className="statusbar">
      {session ? (
        <>
          <span className="status-item status-session" title={session.sessionId}>
            {session.sessionId}
          </span>
          <span className="status-item">{session.profileName}</span>
          {session.exited ? (
            <span className="status-item status-exit">
              exited{session.exitCode === null ? "" : ` (code ${session.exitCode})`}
            </span>
          ) : (
            <span className="status-item status-running">running</span>
          )}
        </>
      ) : (
        <span className="status-item status-muted">no session</span>
      )}
      <span className="status-spacer" />
      {attentionCount > 0 ? (
        <button
          type="button"
          className="status-item status-attention"
          onClick={onOpenBoard}
          title="Worker, die auf dich warten — zum Board"
        >
          {attentionCount} warte{attentionCount === 1 ? "t" : "n"} auf dich
        </button>
      ) : null}
      <button
        type="button"
        className="status-action status-provider-action"
        onClick={onOpenProviders}
        title="Provider-Übersicht öffnen"
        aria-label="Provider-Übersicht öffnen"
      >
        <span aria-hidden="true">🔌</span>
      </button>
      {error ? (
        <button
          type="button"
          className="status-error"
          onClick={onDismissError}
          title={error}
          aria-label={`Fehler ausblenden: ${error}`}
        >
          {error}
        </button>
      ) : null}
      {quota.blockedCount > 0 ? (
        <span className="status-item status-blocked" title="Agent-Profile ohne Kontingent">
          {quota.blockedCount} blockiert
        </span>
      ) : null}
      <span
        className="status-item status-omni"
        title={
          quota.omniRouteOnline === null
            ? "OmniRoute-Status unbekannt"
            : `OmniRoute ${quota.omniRouteOnline ? "online" : "offline"}`
        }
      >
        <span
          className={`omni-dot${quota.omniRouteOnline === true ? " omni-dot-online" : ""}`}
          aria-hidden="true"
        />
        OmniRoute
      </span>
      <span className="status-item status-muted">
        {sessionCount} session{sessionCount === 1 ? "" : "s"}
      </span>
    </footer>
  );
}
