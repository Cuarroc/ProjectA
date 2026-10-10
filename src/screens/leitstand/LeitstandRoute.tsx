import { useEffect, useState } from "react";

import { listAgentProfiles } from "../../lib/ipc";
import { useBoard } from "../../lib/useBoard";
import { useQuestions } from "../../lib/useQuestions";
import type { AgentProfile } from "../../types";
import { LeitstandCards } from "./LeitstandCards";
import { NeedsYou } from "./needs/NeedsYou";

// Words of the route frame. Moves into the dictionary (src/i18n) once V2-F6 is on main.
const T = { title: "Leitstand", tabs: "Ansichten", main: "Haupt", classic: "Klassisch" } as const;

export const MAIN_PATH = "/leitstand";
export const CLASSIC_PATH = "/leitstand/klassisch";

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

/** Haupt and Klassisch: the old Work view stays reachable until S01a-3 retires it. */
export function LeitstandTabs({ path }: { path: string }) {
  const tab = (target: string, label: string) => (
    <a href={`#${target}`} aria-current={target === path ? "page" : undefined}>{label}</a>
  );
  return <nav className="g-shell-tabs" aria-label={T.tabs}>{tab(MAIN_PATH, T.main)}{tab(CLASSIC_PATH, T.classic)}</nav>;
}

/** The new Leitstand (V2-S01a): agent cards with filter chips and "Braucht dich", on the real board and question data. */
export default function LeitstandRoute() {
  const [projectId, setProjectId] = useState(readProjectId);
  useEffect(() => {
    if (projectId !== null) return;
    const timer = window.setInterval(() => setProjectId(readProjectId()), PROJECT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [projectId]);
  const board = useBoard(projectId, true);
  const questions = useQuestions(projectId, true);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    let live = true;
    listAgentProfiles().then((list) => live && setProfiles(list), () => {});
    const timer = window.setInterval(() => setNow(Date.now() / 1000), TICK_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="g-lr">
      <div className="g-lr-head"><h1>{T.title}</h1><LeitstandTabs path={MAIN_PATH} /></div>
      <div className="g-lr-body">
        <div className="g-lr-main">
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
