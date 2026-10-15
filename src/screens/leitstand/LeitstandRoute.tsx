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
import { BetriebPanel } from "./betrieb/BetriebPanel";
import { FlowTab } from "./flow/FlowTab";
import { NeedsYou } from "./needs/NeedsYou";
import { FABRIK_PATH, TOOLS_PATH, trim } from "../../shell/mount/routing";

export const MAIN_PATH = "/leitstand";
export const CLASSIC_PATH = "/leitstand/klassisch";
export const BETRIEB_PATH = "/leitstand/betrieb";

/** Relative ages ("seit 4 min") move on minute scale. */
const TICK_MS = 30_000;

/** The classic view and its persistent tools stay reachable beside Haupt, Fabrik and Betrieb. */
export function LeitstandTabs({ path }: { path: string }) {
  const t = useT();
  const tab = (target: string, label: string) => (
    <a href={`#${target}`} aria-current={target === trim(path) ? "page" : undefined}>{label}</a>
  );
  return <nav className="g-shell-tabs" aria-label={t("leitstand.tabs")}>{tab(MAIN_PATH, t("tab.main"))}{tab(FABRIK_PATH, t("leitstand.tab.fabrik"))}{tab(BETRIEB_PATH, t("leitstand.tab.betrieb"))}{tab(TOOLS_PATH, t("leitstand.tab.tools"))}{tab(CLASSIC_PATH, t("leitstand.tab.classic"))}</nav>;
}

/** The new Leitstand (V2-S01a): agent cards with filter chips and "Braucht dich" on Haupt, the flow graph on Fabrik, the read-only Betrieb panel beside it. */
export default function LeitstandRoute({ path = MAIN_PATH }: { path?: string }) {
  const here = trim(path);
  const betrieb = here === BETRIEB_PATH;
  const fabrik = here === FABRIK_PATH;
  const t = useT();
  const [projectId, setProjectId] = useState(readActiveProjectId);
  // The picker and the old app publish a choice through the module's event.
  useEffect(() => {
    setProjectId(readActiveProjectId());
    return subscribeActiveProject(setProjectId);
  }, []);
  const board = useBoard(projectId, !betrieb);
  const questions = useQuestions(projectId, !betrieb && !fabrik);
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

  if (betrieb) {
    return (
      <div className="g-lr">
        <div className="g-lr-head"><h1>{t("nav.leitstand")}</h1><LeitstandTabs path={BETRIEB_PATH} /></div>
        {/* No project yet: the subscription above picks it up as soon as a project is chosen. */}
        {projectId !== null && <BetriebPanel projectId={projectId} profiles={profiles} />}
      </div>
    );
  }

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

  return (
    <div className="g-lr">
      <div className="g-lr-head"><h1>{t("nav.leitstand")}</h1><LeitstandTabs path={MAIN_PATH} /></div>
      <div className="g-lr-body">
        <div className="g-lr-main">
          {profilesFailed && <div role="status"><HonestState kind="offline" title={t("leitstand.profilesFailed")} hint={t("leitstand.profilesHint")} /></div>}
          <LeitstandCards
            cards={board.cards}
            profiles={profiles}
            now={now}
            onOpen={({ worker }) => void (window.location.hash = `#/leitstand/terminal?worker=${encodeURIComponent(worker.id)}`)}
          />
        </div>
        <div className="g-lr-side">
          <NeedsYou questions={questions} workers={board.cards.map((c) => c.worker)} />
        </div>
      </div>
    </div>
  );
}
