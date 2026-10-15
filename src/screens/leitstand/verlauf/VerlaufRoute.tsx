import { useEffect, useState } from "react";

import { HonestState } from "../../../design/data/HonestState";
import { ErrorDetails } from "../../../errors/ErrorDetails";
import { userError } from "../../../errors/texts";
import { useT } from "../../../i18n/useT";
import { readActiveProjectId, subscribeActiveProject } from "../../../lib/activeProject";
import { describeError, listWorkers } from "../../../lib/ipc";
import { useOrchestratorChat } from "../../../lib/orchestratorChat";
import { resolveRoute } from "../../../shell/routes";
import { VerlaufChat } from "./VerlaufChat";
import { T } from "./texts";

function ProjectChat({ projectId }: { projectId: string | null }) {
  const [orchestratorId, setOrchestratorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(projectId !== null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const chat = useOrchestratorChat(projectId, orchestratorId);

  useEffect(() => {
    if (projectId === null) return;
    let current = true;
    setLoading(true);
    setError(null);
    void listWorkers(projectId).then((workers) => {
      if (!current) return;
      // Same selection as App: a live session wins, otherwise the last project row.
      const own = workers.filter((worker) => worker.kind === "orchestrator" && worker.projectId === projectId);
      const live = own.find((worker) => worker.status === "running" && worker.sessionId !== null);
      setOrchestratorId((live ?? own.at(-1))?.id ?? null);
    }).catch((cause: unknown) => {
      if (current) setError(describeError(cause));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [projectId, attempt]);

  if (loading) return <p role="status">{T.loading}</p>;
  if (error !== null) return (
    <div role="alert">
      <HonestState kind="offline" title={T.errorTitle} hint={userError(error).text}
        action={{ label: T.errorRetry, onClick: () => setAttempt((value) => value + 1) }} />
      <ErrorDetails raw={userError(error).detail} />
    </div>
  );
  return <VerlaufChat chat={chat} projectId={projectId} />;
}

/** Owns the chat only while this route is open; project changes discard pending reads and drafts. */
export default function VerlaufRoute() {
  const t = useT();
  const route = resolveRoute("/leitstand/verlauf");
  const [projectId, setProjectId] = useState(readActiveProjectId);
  useEffect(() => {
    setProjectId(readActiveProjectId());
    return subscribeActiveProject(setProjectId);
  }, []);
  return (
    <div className="g-lr">
      <nav className="g-shell-tabs" aria-label={t("tab.aria")}>
        {route?.route.tabs.map((tab) => (
          <a key={tab.path} href={`#${tab.path}`} aria-current={tab === route.tab ? "page" : undefined}>{tab.label}</a>
        ))}
      </nav>
      <ProjectChat key={projectId} projectId={projectId} />
    </div>
  );
}
