import { handleTablistKey, tabStop } from "../lib/tabs";
import type { TerminalSession } from "../types";

interface TabBarProps {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  splitOpen: boolean;
  splitEnabled: boolean;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onToggleSplit: () => void;
  onNew: () => void;
  newDisabled: boolean;
}

export default function TabBar({
  sessions,
  activeSessionId,
  splitOpen,
  splitEnabled,
  onSelect,
  onClose,
  onToggleSplit,
  onNew,
  newDisabled,
}: TabBarProps) {
  // Orchestrators are the project's home base, so they keep the leftmost
  // slots; `sort` is stable, so workers keep the order they were opened in.
  const ordered = [...sessions].sort(
    (a, b) => Number(b.kind === "orchestrator") - Number(a.kind === "orchestrator"),
  );

  const activeIndex = ordered.findIndex((session) => session.sessionId === activeSessionId);

  return (
    <div
      className="tabbar"
      role="tablist"
      aria-label="Terminal-Sitzungen"
      onKeyDown={(event) =>
        handleTablistKey(event, activeIndex, ordered.length, (index) =>
          onSelect(ordered[index].sessionId),
        )
      }
    >
      {ordered.map((session, index) => {
        const active = session.sessionId === activeSessionId;
        return (
          <div
            key={session.sessionId}
            role="presentation"
            className={`tab${active ? " tab-active" : ""}${session.exited ? " tab-exited" : ""}${
              session.kind === "orchestrator" ? " tab-orchestrator" : ""
            }`}
            title={`${session.title} — ${session.profileName} — ${session.sessionId}`}
          >
            {/* The tab itself is a real button. The close control beside it is
                for the pointer only (tabIndex -1): a tablist may hold nothing
                but tabs in the tab order, so the keyboard closes with Delete. */}
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={tabStop(active, index, activeIndex >= 0)}
              className="tab-select"
              aria-keyshortcuts="Delete"
              onClick={() => onSelect(session.sessionId)}
              onKeyDown={(event) => {
                if (event.key !== "Delete") return;
                event.preventDefault();
                onClose(session.sessionId);
              }}
            >
              <span className="tab-label">{session.title}</span>
              {session.exited ? <span className="tab-badge">exited</span> : null}
            </button>
            <button
              type="button"
              className="tab-close"
              tabIndex={-1}
              aria-label={`${session.workerId ? "Detach" : "Close"} ${session.title}`}
              title={session.workerId ? "Detach tab (the agent keeps running)" : "Close session"}
              onClick={() => onClose(session.sessionId)}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className={`tab-split${splitOpen ? " tab-split-active" : ""}`}
        aria-label={splitOpen ? "Split schließen" : "Terminal teilen"}
        aria-pressed={splitOpen}
        title={
          splitEnabled
            ? splitOpen
              ? "Split schließen"
              : "Terminal teilen"
            : "Zweite Session nötig, um zu teilen"
        }
        disabled={!splitOpen && !splitEnabled}
        onClick={onToggleSplit}
      >
        ⧉
      </button>
      <button
        type="button"
        className="tab-new"
        aria-label="New session"
        title="New session"
        disabled={newDisabled}
        onClick={onNew}
      >
        +
      </button>
    </div>
  );
}
