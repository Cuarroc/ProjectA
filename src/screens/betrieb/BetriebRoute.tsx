import { useEffect, useState } from "react";

import { readActiveProjectId, subscribeActiveProject } from "../../lib/activeProject";
import { listAgentProfiles } from "../../lib/ipc";
import { HonestState } from "../../design/data/HonestState";
import { useT } from "../../i18n/useT";
import type { AgentProfile } from "../../types";
import { BetriebPanel } from "../leitstand/betrieb/BetriebPanel";

/** The Betrieb area (NAV-2a): today's panel (queue, start check, watchdog) under its own route. */
export default function BetriebRoute() {
  const t = useT();
  const [projectId, setProjectId] = useState(readActiveProjectId);
  // The picker and the old app publish a choice through the module's event.
  useEffect(() => {
    setProjectId(readActiveProjectId());
    return subscribeActiveProject(setProjectId);
  }, []);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [profilesFailed, setProfilesFailed] = useState(false);
  useEffect(() => {
    let live = true;
    listAgentProfiles().then((list) => live && setProfiles(list), () => live && setProfilesFailed(true));
    return () => { live = false; };
  }, []);

  const notice = profilesFailed && <HonestState kind="offline" title={t("leitstand.profilesFailed")} hint={t("betrieb.profilesHint")} />;
  return (
    <div className="g-lr">
      <div className="g-lr-head"><h1>{t("nav.betrieb")}</h1></div>
      {projectId !== null
        ? <>
            {notice && <div role="status">{notice}</div>}
            <BetriebPanel projectId={projectId} profiles={profiles} />
          </>
        // One region says both facts, so a screen reader announces it once.
        : <div role="status">
            {notice}
            <HonestState kind="empty" title={t("leitstand.noProject")} hint={t("leitstand.noProjectHint")} />
          </div>}
    </div>
  );
}
