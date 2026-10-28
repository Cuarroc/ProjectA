import { useEffect, useRef, useState } from "react";

import { readActiveProjectId, subscribeActiveProject, writeActiveProjectId } from "../../lib/activeProject";
import { listAgentProfiles, listProjects } from "../../lib/ipc";
import { useBoard } from "../../lib/useBoard";
import { useQuestions } from "../../lib/useQuestions";
import { HonestState } from "../../design/data/HonestState";
import { TabLinks } from "../../design/layout/Tabs";
import "../../design/layout/layout.css";
import "../../design/inputs/inputs.css";
import { useT } from "../../i18n/useT";
import type { AgentProfile } from "../../types";
import { LeitstandCards } from "./LeitstandCards";
import { FlowTab } from "./flow/FlowTab";
import { NeedsYou } from "./needs/NeedsYou";
import { BETRIEB_ROUTE, FABRIK_PATH, TOOLS_PATH, trim } from "../../shell/mount/routing";
import { ProjectCreateSheet } from "../../shell/header/ProjectCreateSheet";

export const MAIN_PATH = "/leitstand";
export const CLASSIC_PATH = "/leitstand/klassisch";

/** The queue action navigates to Betrieb; project creation stays in this view. */
const go = (target: string) => void (window.location.hash = `#${target}`);

/** Relative ages ("seit 4 min") move on minute scale. */
const TICK_MS = 30_000;

/** The classic view and its persistent tools stay reachable beside Haupt and Fabrik. */
export function LeitstandTabs({ path }: { path: string }) {
  const t = useT();
  const tabs = [
    { id: MAIN_PATH, label: t("tab.main") },
    { id: FABRIK_PATH, label: t("leitstand.tab.fabrik") },
    { id: TOOLS_PATH, label: t("leitstand.tab.tools") },
    { id: CLASSIC_PATH, label: t("leitstand.tab.classic") },
  ].map((tab) => ({ ...tab, href: `#${tab.id}` }));
  return <TabLinks aria-label={t("leitstand.tabs")} tabs={tabs} value={trim(path)} />;
}

/** The new Leitstand (V2-S01a): agent cards with filter chips and "Braucht dich" on Haupt, the flow graph on Fabrik; Betrieb has its own area (NAV-2b). */
export default function LeitstandRoute({ path = MAIN_PATH }: { path?: string }) {
  const here = trim(path);
  const fabrik = here === FABRIK_PATH || here === "/leitstand/fluss";
  const t = useT();
  const [projectId, setProjectId] = useState(readActiveProjectId);
  const [creating, setCreating] = useState<number | null>(null);
  const selectionVersion = useRef(0);
  // The picker and the old app publish a choice through the module's event.
  useEffect(() => {
    setProjectId(readActiveProjectId());
    const unsubscribe = subscribeActiveProject((id) => {
      selectionVersion.current += 1;
      setCreating(null);
      setProjectId(id);
    });
    return () => {
      selectionVersion.current += 1;
      unsubscribe();
    };
  }, []);
  const board = useBoard(projectId, true);
  const questions = useQuestions(projectId, !fabrik);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [profilesFailed, setProfilesFailed] = useState(false);
  const [projectNames, setProjectNames] = useState<ReadonlyMap<string, string> | null>();
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    let live = true;
    listAgentProfiles().then(
      (list) => live && setProfiles(list),
      () => live && setProfilesFailed(true),
    );
    listProjects().then(
      (list) => live && setProjectNames((names) => new Map([...list.map((project) => [project.id, project.name] as const), ...(names ?? [])])),
      () => live && setProjectNames((names) => names ?? null),
    );
    const timer = window.setInterval(() => setNow(Date.now() / 1000), TICK_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  if (fabrik) {
    return (
      <div className="g-lr">
        <div className="g-lr-head"><h1>{t("nav.leitstand")}</h1><LeitstandTabs path={FABRIK_PATH} /></div>
        {/* An unread or unreadable board must not claim "no agents". */}
        {board.loading ? null : board.error !== null && board.cards.length === 0
          ? <div role="status"><HonestState kind="offline" /></div>
          : <FlowTab cards={board.cards} />}
      </div>
    );
  }

  // Only a read board may say "no agents": loading and unreadable are not empty (DS-T-01).
  const unread = board.cards.length === 0;
  return (
    <div className="g-lr">
      <div className="g-lr-head"><h1>{t("nav.leitstand")}</h1><LeitstandTabs path={MAIN_PATH} /></div>
      <div className="g-lr-body">
        {projectId === null ? <div role="status"><HonestState kind="empty" title={t("leitstand.noProject")} hint={t("leitstand.noProjectHintMain")} action={{ label: t("leitstand.addProject"), onClick: () => setCreating(selectionVersion.current) }} /></div> : (
          <div className="g-lr-main">
            {profilesFailed && <div role="status"><HonestState kind="offline" title={t("leitstand.profilesFailed")} hint={t("leitstand.profilesHint")} /></div>}
            {board.loading && unread ? <div className="ls-none" role="status"><p>{t("leitstand.loading")}</p></div>
              : board.error !== null && unread
                ? <div role="status"><HonestState kind="offline" hint={t("leitstand.offlineHint")} action={{ label: t("leitstand.retry"), onClick: board.refresh }} /></div>
                : <>
                    {/* shortcut: no age of the last good read; needs a read timestamp in useBoard (follow-up). */}
                    {board.error !== null && <p className="ls-err" role="status">{t("leitstand.refreshFailed")}</p>}
                    <LeitstandCards
                      cards={board.cards}
                      profiles={profiles}
                      now={now}
                      emptyAction={{ label: t("leitstand.queueTask"), onClick: () => go(BETRIEB_ROUTE) }}
                      onOpen={({ worker }) => void (window.location.hash = `#/leitstand/terminal?worker=${encodeURIComponent(worker.id)}`)}
                    />
                  </>}
          </div>
        )}
        <div className="g-lr-side">
          <NeedsYou key={`${projectId}:${questions.scope}`} projectId={projectId} projectNames={projectNames} questions={questions} workers={board.cards.map((c) => c.worker)} />
        </div>
      </div>
      {creating !== null && <ProjectCreateSheet onClose={() => setCreating(null)} onCreated={(project) => {
        // A newer choice or unmount invalidates this result, even if the choice returns to empty.
        if (creating !== selectionVersion.current) return;
        setCreating(null);
        setProjectNames((names) => new Map(names).set(project.id, project.name));
        writeActiveProjectId(project.id);
      }} />}
    </div>
  );
}
