import { useCallback, useEffect, useRef, useState } from "react";
import TerminalLauncher from "./TerminalLauncher";
import TerminalView from "../../components/TerminalView";
import SessionRestorePanel from "../../components/SessionRestorePanel";
import { Button } from "../../design/controls/Button";
import { HonestState } from "../../design/data/HonestState";
import { TabPanel, Tabs } from "../../design/layout/Tabs";
import { de } from "../../i18n/de";
import { loadFontSettings } from "../../lib/settings";
import { useSessions } from "../../sessions/SessionProvider";
import { describeError, listAgentProfiles, listWorkers, respawnWorker } from "../../lib/ipc";
import { shortTask } from "../../lib/text";
import type { AgentProfile, Worker } from "../../types";
import { splitTexts } from "./split/texts";
import "../../design/layout/layout.css";
import "./terminal.css";

// A missing profile list only costs the label; it must not block opening the session.
const loadProfiles = () => listAgentProfiles().catch((): AgentProfile[] => []);

/** A route owns viewers only; sessions and their PTYs outlive navigation. */
export default function TerminalRoute() {
  const { sessions, activeSessionId, splitOpen, splitSessionId, splitPrimary,
    toggleSplit, select, close, openWorker, showRestore } = useSessions();
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState(window.location.hash);
  const [restore, setRestore] = useState<Worker | null>(null);
  const [opening, setOpening] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const request = useRef(Symbol());
  const section = useRef<HTMLElement>(null);
  const focusAfterClose = useRef(false);
  useEffect(() => {
    if (!focusAfterClose.current) return;
    if (!sessions.length) focusAfterClose.current = false;
    section.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"], .g-hs button')?.focus();
  }, [sessions, activeSessionId]);
  const enterWorker = useCallback((worker: Worker, profiles: AgentProfile[]) => {
    if (!worker.sessionId || worker.status !== "running") {
      showRestore(worker.id); setRestore(worker); return;
    }
    openWorker({ sessionId: worker.sessionId, workerId: worker.id, projectId: worker.projectId,
      profileId: worker.profileId, profileName: profiles.find((profile) => profile.id === worker.profileId)?.name ?? "", kind: worker.kind,
      title: shortTask(worker.task), exited: false, exitCode: null });
    setRestore(null);
  }, [openWorker, showRestore]);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const token = Symbol();
    request.current = token;
    const workerId = new URLSearchParams(hash.split("?")[1]).get("worker");
    setOpening(false); setRestarting(false); setError(null); setRestore(null);
    if (!workerId) return;
    setOpening(true);
    void Promise.all([listWorkers(), loadProfiles()]).then(([workers, profiles]) => {
      if (request.current !== token) return;
      const worker = workers.find((entry) => entry.id === workerId);
      if (!worker) { setError(de["needs.noAgent"]); return; }
      enterWorker(worker, profiles);
    }).catch((cause) => { if (request.current === token) setError(describeError(cause)); })
      .finally(() => { if (request.current === token) setOpening(false); });
    return () => { request.current = Symbol(); };
  }, [hash, enterWorker]);
  const launchSessions = useRef<Set<string> | null>(null);
  const launchRestart = useRef<{ sessionId: string | null } | null>(null);
  const [launchPending, setLaunchPending] = useState(false);
  const trackLaunch = () => {
    launchRestart.current = null;
    launchSessions.current = new Set(sessions.map((session) => session.sessionId));
    setLaunchPending(true);
    return () => setLaunchPending(false);
  };
  useEffect(() => {
    const inserted = sessions.some((session) => !session.workerId &&
      launchSessions.current && !launchSessions.current.has(session.sessionId));
    if (!inserted) {
      if (!launchPending) launchSessions.current = null;
      return;
    }
    launchSessions.current = null;
    // An explicit restart owns its newer restore route and must finish unchanged.
    if (launchRestart.current) {
      if (launchRestart.current.sessionId) select(launchRestart.current.sessionId);
      return;
    }
    if (restarting) return;
    // Insertion precedes exit subscription settlement; fence the old worker lookup now.
    request.current = Symbol(); setOpening(false); setError(null); setRestore(null);
    window.history.replaceState(window.history.state, "", "#/leitstand/terminal");
    setHash(window.location.hash);
  }, [sessions, launchPending, restarting, select]);
  const fonts = loadFontSettings();
  const active = sessions.find((session) => session.sessionId === activeSessionId) ?? sessions[0];
  const other = sessions.find((session) => session.sessionId === splitSessionId);
  const panes = !restore && !opening && splitOpen && active && other && active.sessionId !== other.sessionId
    ? (splitPrimary ? [active, other] : [other, active]) : [];
  return (
    <section ref={section} className="g-terminal" aria-label={de["terminal.title"]}
      onPointerDownCapture={() => { focusAfterClose.current = false; }}
      onKeyDownCapture={() => { focusAfterClose.current = false; }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) focusAfterClose.current = false;
      }}
      onFocusCapture={(event) => {
        // The remaining viewer focuses asynchronously; preserve the close target until user input.
        if (focusAfterClose.current && event.target.closest('[role="tabpanel"]')) {
          focusAfterClose.current = false;
          section.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
        }
      }}>
      {error ? <p role="alert">{error}</p> : null}
      {active || restore ? <>
        <div className="g-terminal-actions">
          <Tabs idBase="terminal" aria-label={de["terminal.sessions"]}
            tabs={[...sessions.map((session) => ({ id: session.sessionId, label: session.title })),
              ...(restore ? [{ id: `restore:${restore.id}`, label: shortTask(restore.task) }] : [])]}
            value={restore ? `restore:${restore.id}` : active.sessionId} onChange={(id) => {
              if (id === `restore:${restore?.id}`) return;
              request.current = Symbol(); setOpening(false); setRestarting(false); setError(null); setRestore(null); select(id);
              window.history.replaceState(window.history.state, "", "#/leitstand/terminal");
              setHash(window.location.hash);
            }} />
          <Button size="sm" aria-pressed={panes.length === 2} onClick={toggleSplit}
            disabled={!!restore || opening || sessions.length < 2}>
            {splitOpen ? splitTexts.close : splitTexts.open}
          </Button>
          {!restore && active ? <Button size="sm" onClick={() => {
            // A close supersedes route lookup/restart results, just like manual selection.
            request.current = Symbol(); setOpening(false); setRestarting(false); setError(null);
            focusAfterClose.current = true;
            close(active.sessionId);
            window.history.replaceState(window.history.state, "", "#/leitstand/terminal");
            setHash(window.location.hash);
          }}>{de["terminal.closeTab"]}</Button> : null}
          {(restore || (active && !active.exited)) && !opening && !restarting && !error ? <TerminalLauncher onLaunch={trackLaunch} /> : null}
        </div>
        {panes.length === 2 ? <>
          <div className="g-terminal-split">
            {panes.map((pane, side) => (
              <div key={side} className="g-terminal-pane"
                onPointerDown={() => select(pane.sessionId)} onFocusCapture={() => select(pane.sessionId)}>
                <TabPanel idBase="terminal" id={pane.sessionId} active>
                  <TerminalView key={pane.sessionId} sessionId={pane.sessionId} onError={setError}
                    autoFocus={pane.sessionId === active.sessionId}
                    font={fonts.terminalFont} fontSize={fonts.terminalFontSize} />
                </TabPanel>
              </div>
            ))}
          </div>
          {sessions.filter((session) => !panes.includes(session)).map((session) => (
            <TabPanel key={session.sessionId} idBase="terminal" id={session.sessionId} active={false} />
          ))}
        </> : sessions.map((session) => (
          <TabPanel key={session.sessionId} idBase="terminal" id={session.sessionId}
            active={!restore && session.sessionId === active?.sessionId}>
            {!restore && session.sessionId === active?.sessionId ? <TerminalView sessionId={session.sessionId} onError={setError}
              font={fonts.terminalFont} fontSize={fonts.terminalFontSize} /> : null}
          </TabPanel>
        ))}
      </> : !restore && !opening && !error && <div className="g-terminal-empty"><HonestState kind="empty" title={de["terminal.empty"]} hint={de["terminal.launchHint"]}
        action={{ label: de["leitstand.tab.classic"], onClick: () => { window.location.hash = "#/leitstand/klassisch"; } }} /><TerminalLauncher onLaunch={trackLaunch} /></div>}
      {restore ? <TabPanel idBase="terminal" id={`restore:${restore.id}`} active><SessionRestorePanel key={restore.id} worker={restore} busy={restarting} onRespawn={() => {
        const token = request.current;
        const owner = { sessionId: null as string | null };
        if (launchSessions.current) launchRestart.current = owner;
        setRestarting(true); setError(null);
        void Promise.all([respawnWorker(restore.id), loadProfiles()]).then(([worker, profiles]) => {
          if (request.current === token) {
            if (worker.status === "running") owner.sessionId = worker.sessionId;
            enterWorker(worker, profiles);
          }
        }).catch((cause) => { if (request.current === token) setError(describeError(cause)); })
          .finally(() => { if (request.current === token) setRestarting(false); });
      }} /></TabPanel> : null}
    </section>
  );
}
