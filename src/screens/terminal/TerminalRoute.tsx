import { useState } from "react";
import TerminalView from "../../components/TerminalView";
import { HonestState } from "../../design/data/HonestState";
import { TabPanel, Tabs } from "../../design/layout/Tabs";
import { de } from "../../i18n/de";
import { useSessions } from "../../sessions/SessionProvider";
import "../../design/layout/layout.css";
import "./terminal.css";

/** A route owns viewers only; sessions and their PTYs outlive navigation. */
export default function TerminalRoute() {
  const { sessions, activeSessionId, select } = useSessions();
  const [error, setError] = useState<string | null>(null);
  const active = sessions.find((session) => session.sessionId === activeSessionId);
  return (
    <section className="g-terminal" aria-label={de["terminal.title"]}>
      {active ? <>
        <Tabs idBase="terminal" aria-label={de["terminal.sessions"]}
          tabs={sessions.map((session) => ({ id: session.sessionId, label: session.title }))}
          value={active.sessionId} onChange={(id) => { setError(null); select(id); }} />
        {error ? <p role="alert">{error}</p> : null}
        {sessions.map((session) => (
          <TabPanel key={session.sessionId} idBase="terminal" id={session.sessionId}
            active={session.sessionId === active.sessionId}>
            {session.sessionId === active.sessionId ? <TerminalView sessionId={session.sessionId} onError={setError} /> : null}
          </TabPanel>
        ))}
      </> : <HonestState kind="empty" title={de["terminal.empty"]} hint={de["terminal.emptyHint"]} />}
    </section>
  );
}
