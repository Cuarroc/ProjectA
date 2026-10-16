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

  return (
    <div className="g-lr">
      <div className="g-lr-head"><h1>{t("nav.betrieb")}</h1></div>
      {profilesFailed && <div role="status"><HonestState kind="offline" title={t("leitstand.profilesFailed")} hint={t("betrieb.profilesHint")} /></div>}
      {projectId !== null
        ? <BetriebPanel projectId={projectId} profiles={profiles} />
        : <div role="status"><HonestState kind="empty" title={t("leitstand.noProject")} hint={t("leitstand.noProjectHint")} /></div>}
    </div>
  );
}
