import { QUOTA_POLL_MS, useQuotaState } from "../lib/quota";
import type { TerminalSession } from "../types";

interface StatusBarProps {
  session: TerminalSession | null;
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
          <span className="status-item" title={session.sessionId}>
            {session.profileName}
          </span>
          {session.exited ? (
            <span className="status-item status-exit">
              beendet{session.exitCode === null ? "" : ` (Code ${session.exitCode})`}
            </span>
          ) : (
            <span className="status-item status-running">läuft</span>
          )}
        </>
      ) : (
        <span className="status-item status-muted">keine Sitzung</span>
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
      {quota.omniRouteOnline === true ? (
        <span className="status-item status-omni" title="OmniRoute online">
          <span className="omni-dot omni-dot-online" aria-hidden="true" />
          OmniRoute
        </span>
      ) : null}
    </footer>
  );
}
