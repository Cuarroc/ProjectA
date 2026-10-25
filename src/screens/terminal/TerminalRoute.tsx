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
import "../../design/layout/layout.css";
import "./terminal.css";

// A missing profile list only costs the label; it must not block opening the session.
const loadProfiles = () => listAgentProfiles().catch((): AgentProfile[] => []);

/** A route owns viewers only; sessions and their PTYs outlive navigation. */
export default function TerminalRoute() {
  const { sessions, activeSessionId, select, close, openWorker, showRestore } = useSessions();
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
  const fonts = loadFontSettings();
  const active = sessions.find((session) => session.sessionId === activeSessionId) ?? sessions[0];
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
          {!restore && active ? <Button size="sm" onClick={() => {
            // A close supersedes route lookup/restart results, just like manual selection.
            request.current = Symbol(); setOpening(false); setRestarting(false); setError(null);
            focusAfterClose.current = true;
            close(active.sessionId);
            window.history.replaceState(window.history.state, "", "#/leitstand/terminal");
            setHash(window.location.hash);
          }}>{de["terminal.closeTab"]}</Button> : null}
        </div>
        {sessions.map((session) => (
          <TabPanel key={session.sessionId} idBase="terminal" id={session.sessionId}
            active={!restore && session.sessionId === active?.sessionId}>
            {!restore && session.sessionId === active?.sessionId ? <TerminalView sessionId={session.sessionId} onError={setError}
              font={fonts.terminalFont} fontSize={fonts.terminalFontSize} /> : null}
          </TabPanel>
        ))}
      </> : !restore && !opening && !error && <div className="g-terminal-empty"><HonestState kind="empty" title={de["terminal.empty"]} hint={de["terminal.launchHint"]}
        action={{ label: de["leitstand.tab.classic"], onClick: () => { window.location.hash = "#/leitstand/klassisch"; } }} /><TerminalLauncher /></div>}
      {restore ? <TabPanel idBase="terminal" id={`restore:${restore.id}`} active><SessionRestorePanel key={restore.id} worker={restore} busy={restarting} onRespawn={() => {
        const token = request.current;
        setRestarting(true); setError(null);
        void Promise.all([respawnWorker(restore.id), loadProfiles()]).then(([worker, profiles]) => {
          if (request.current === token) enterWorker(worker, profiles);
        }).catch((cause) => { if (request.current === token) setError(describeError(cause)); })
          .finally(() => { if (request.current === token) setRestarting(false); });
      }} /></TabPanel> : null}
    </section>
  );
}
