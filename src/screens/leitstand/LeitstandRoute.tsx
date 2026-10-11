import { useEffect, useState } from "react";

import { listAgentProfiles } from "../../lib/ipc";
import { useBoard } from "../../lib/useBoard";
import { useQuestions } from "../../lib/useQuestions";
import { HonestState } from "../../design/data/HonestState";
import { useT } from "../../i18n/useT";
import type { AgentProfile } from "../../types";
import { LeitstandCards } from "./LeitstandCards";
import { BetriebPanel } from "./betrieb/BetriebPanel";
import { NeedsYou } from "./needs/NeedsYou";

export const MAIN_PATH = "/leitstand";
export const CLASSIC_PATH = "/leitstand/klassisch";
export const BETRIEB_PATH = "/leitstand/betrieb";

/** Same key the old app writes; the Glass shell has no project picker yet. */
const ACTIVE_PROJECT_KEY = "projecta.activeProjectId";
const readProjectId = () => {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
};
/** The old app, mounted behind this route, writes the key once it has picked a project. */
const PROJECT_POLL_MS = 500;
/** Relative ages ("seit 4 min") move on minute scale. */
const TICK_MS = 30_000;

/** Haupt, Betrieb and Klassisch: the old Work view stays reachable until S01a-3 retires it. */
export function LeitstandTabs({ path }: { path: string }) {
  const t = useT();
  const tab = (target: string, label: string) => (
    <a href={`#${target}`} aria-current={target === path ? "page" : undefined}>{label}</a>
  );
  return <nav className="g-shell-tabs" aria-label={t("leitstand.tabs")}>{tab(MAIN_PATH, t("tab.main"))}{tab(BETRIEB_PATH, t("leitstand.tab.betrieb"))}{tab(CLASSIC_PATH, t("leitstand.tab.classic"))}</nav>;
}

/** The new Leitstand (V2-S01a): agent cards with filter chips and "Braucht dich" on Haupt, the read-only Betrieb panel beside it. */
export default function LeitstandRoute({ path = MAIN_PATH }: { path?: string }) {
  const betrieb = path === BETRIEB_PATH;
  const t = useT();
  const [projectId, setProjectId] = useState(readProjectId);
  useEffect(() => {
    if (projectId !== null) return;
    const timer = window.setInterval(() => setProjectId(readProjectId()), PROJECT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [projectId]);
  const board = useBoard(projectId, !betrieb);
  const questions = useQuestions(projectId, !betrieb);
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
        {/* No project yet: the poll above picks it up as soon as the old app has chosen one. */}
        {projectId !== null && <BetriebPanel projectId={projectId} profiles={profiles} />}
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
            onOpen={() => void (window.location.hash = `#${CLASSIC_PATH}`)}
          />
        </div>
        <div className="g-lr-side">
          <NeedsYou questions={questions} workers={board.cards.map((c) => c.worker)} />
        </div>
      </div>
    </div>
  );
}
