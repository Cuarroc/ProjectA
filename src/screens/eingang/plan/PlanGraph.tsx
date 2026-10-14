import { useCallback, useMemo } from "react";
import "../../../design/glass.css";
import "../../../design/controls/controls.css";
import { Chip } from "../../../design/controls/Chip";
import { HonestState } from "../../../design/data/HonestState";
import { getDevelopmentPlan } from "../../../lib/ipc";
import { useRetryableRead } from "../../../lib/useRetryableRead";
import { layoutPlan, type PlanNode } from "./planGraphModel";
import { T } from "./texts";
import "./plan.css";

export interface PlanGraphProps {
  projectId: string;
  planId?: string;
}

/** Plan graph: one column per Ebene and the critical path, read-only. Never imports; not mounted yet. */
export function PlanGraph({ projectId, planId = "main" }: PlanGraphProps) {
  const readPlan = useCallback(() => getDevelopmentPlan(projectId, planId), [projectId, planId]);
  const { status, data, error, retry } = useRetryableRead(readPlan);
  const plan = status === "ok" ? data?.projection : undefined;
  const failure = status === "error" ? (String(error instanceof Error ? error.message : error).includes(T.unimportedMarker) ? "unimported" : "failed") : null;

  const layout = useMemo(() => (plan ? layoutPlan(plan.packages) : null), [plan]);
  const onPath = new Set(layout?.critical);
  const card = (n: PlanNode) => (
    <li key={n.id} className="pg-card">
      <span className="pg-id">{n.id}</span>
      <span className="pg-title">{n.title}</span>
      {n.dependencyIds.length > 0 && <span className="pg-note">{T.after(n.dependencyIds)}</span>}
      {n.removedDeps.length > 0 && <span className="pg-note pg-warn">{T.removedDep(n.removedDeps)}</span>}
      {n.unknown.length > 0 && <span className="pg-note pg-warn">{T.unknown(n.unknown)}</span>}
      {(onPath.has(n.id) || n.noNewDispatch) && (
        <span className="pg-chips">
          {onPath.has(n.id) && <Chip size="sm">{T.critical}</Chip>}
          {n.noNewDispatch && <Chip size="sm">{T.noDispatch}</Chip>}
        </span>
      )}
    </li>
  );
  const column = (name: string, nodes: PlanNode[]) => (
    <section key={name} className="g-glass pg-col" aria-label={name}>
      <h3 className="pg-h">{name}</h3>
      <ul className="pg-list">{nodes.map(card)}</ul>
    </section>
  );

  return (
    <div className="pg-root">
      {status === "loading" && <p className="pg-note">{T.loading}</p>}
      {failure === "unimported" && <HonestState kind="empty" title={T.unimported} hint={T.unimportedHint} action={{ label: T.retry, onClick: retry }} />}
      {failure === "failed" && <HonestState kind="offline" title={T.unreadable} hint={T.unreadableHint} action={{ label: T.retry, onClick: retry }} />}
      {plan && layout && (
        <>
          <p className="pg-note">{T.source(plan.sourcePath, plan.sourceRevision.slice(0, 7), plan.projectionRevision)}</p>
          {layout.removed > 0 && <p className="pg-note">{T.removed(layout.removed)}</p>}
          {layout.levels.length + layout.cycle.length === 0 && (layout.removed > 0
            ? <HonestState kind="empty" title={T.allRemoved} hint={T.allRemovedHint} />
            : <HonestState kind="empty" title={T.empty} hint={T.emptyHint} />)}
          <div className="pg-board">
            {layout.levels.map((nodes, i) => column(T.level(i), nodes))}
            {layout.cycle.length > 0 && column(T.cycle, layout.cycle)}
          </div>
        </>
      )}
      <section className="g-glass pg-col" aria-label={T.forecast}>
        <h3 className="pg-h">{T.forecast}</h3>
        <HonestState kind="empty" title={T.forecastTitle} hint={T.forecastHint} />
      </section>
      <section className="g-glass pg-col" aria-label={T.decisions}>
        <h3 className="pg-h">{T.decisions}</h3>
        <HonestState kind="offline" title={T.decisionsTitle} hint={T.decisionsHint} />
      </section>
    </div>
  );
}
