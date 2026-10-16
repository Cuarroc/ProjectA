import { useEffect, useState } from "react";

import { readActiveProjectId, subscribeActiveProject } from "../../lib/activeProject";
import { listAgentProfiles } from "../../lib/ipc";
import { useBoard } from "../../lib/useBoard";
import { useQuestions } from "../../lib/useQuestions";
import { HonestState } from "../../design/data/HonestState";
import "../../design/inputs/inputs.css";
import { useT } from "../../i18n/useT";
import type { AgentProfile } from "../../types";
import { LeitstandCards } from "./LeitstandCards";
import { FlowTab } from "./flow/FlowTab";
import { NeedsYou } from "./needs/NeedsYou";
import { BETRIEB_ROUTE, FABRIK_PATH, TOOLS_PATH, trim } from "../../shell/mount/routing";

export const MAIN_PATH = "/leitstand";
export const CLASSIC_PATH = "/leitstand/klassisch";

/** The first steps only navigate: adding a project lives in the old sidebar on Werkzeuge, the queue form on Betrieb; nothing starts here (DS-T-05). */
const go = (target: string) => void (window.location.hash = `#${target}`);

/** Relative ages ("seit 4 min") move on minute scale. */
const TICK_MS = 30_000;

/** The classic view and its persistent tools stay reachable beside Haupt and Fabrik. */
export function LeitstandTabs({ path }: { path: string }) {
  const t = useT();
  const tab = (target: string, label: string) => (
    <a href={`#${target}`} aria-current={target === trim(path) ? "page" : undefined}>{label}</a>
  );
  return <nav className="g-shell-tabs" aria-label={t("leitstand.tabs")}>{tab(MAIN_PATH, t("tab.main"))}{tab(FABRIK_PATH, t("leitstand.tab.fabrik"))}{tab(TOOLS_PATH, t("leitstand.tab.tools"))}{tab(CLASSIC_PATH, t("leitstand.tab.classic"))}</nav>;
}

/** The new Leitstand (V2-S01a): agent cards with filter chips and "Braucht dich" on Haupt, the flow graph on Fabrik; Betrieb has its own area (NAV-2b). */
export default function LeitstandRoute({ path = MAIN_PATH }: { path?: string }) {
  const here = trim(path);
  const fabrik = here === FABRIK_PATH || here === "/leitstand/fluss";
  const t = useT();
  const [projectId, setProjectId] = useState(readActiveProjectId);
  // The picker and the old app publish a choice through the module's event.
  useEffect(() => {
    setProjectId(readActiveProjectId());
    return subscribeActiveProject(setProjectId);
  }, []);
  const board = useBoard(projectId, true);
  const questions = useQuestions(projectId, !fabrik);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [profilesFailed, setProfilesFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    let live = true;
    listAgentProfiles().then(
      (list) => live && setProfiles(list),
      () => live && setProfilesFailed(true),
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
      {/* Without a project neither list can be read, so neither may claim it is empty. */}
      {projectId === null ? <div role="status"><HonestState kind="empty" title={t("leitstand.noProject")} hint={t("leitstand.noProjectHintMain")} action={{ label: t("leitstand.addProject"), onClick: () => go(TOOLS_PATH) }} /></div> : (
        <div className="g-lr-body">
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
          <div className="g-lr-side">
            <NeedsYou questions={questions} workers={board.cards.map((c) => c.worker)} />
          </div>
        </div>
      )}
    </div>
  );
}
