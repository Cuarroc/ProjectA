import { useEffect, useMemo, useRef, useState } from "react";
import "../../../design/glass.css";
import "../../../design/controls/controls.css";
import { Chip } from "../../../design/controls/Chip";
import { HonestState } from "../../../design/data/HonestState";
import { getDevelopmentPlan } from "../../../lib/ipc";
import type { DevelopmentPlanProjection } from "../../../types";
import { layoutPlan, type PlanNode } from "./planGraph";
import { T } from "./texts";
import "./plan.css";

export interface PlanGraphProps {
  projectId: string;
  planId?: string;
}

type Read = { kind: "loading" } | { kind: "ready"; plan: DevelopmentPlanProjection } | { kind: "unimported" } | { kind: "failed" };

/** Plan graph: one column per Ebene and the critical path, read-only. Never imports; not mounted yet. */
export function PlanGraph({ projectId, planId = "main" }: PlanGraphProps) {
  const [read, setRead] = useState<Read>({ kind: "loading" });
  // One token per project/plan change: a reply only counts while its token is still the newest.
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    setRead({ kind: "loading" });
    getDevelopmentPlan(projectId, planId).then(
      (r) => generation.current === mine && setRead({ kind: "ready", plan: r.projection }),
      (e) => {
        if (generation.current !== mine) return;
        const text = String(e instanceof Error ? e.message : e);
        setRead({ kind: text.includes(T.unimportedMarker) ? "unimported" : "failed" });
      },
    );
  }, [projectId, planId]);

  const layout = useMemo(() => (read.kind === "ready" ? layoutPlan(read.plan.packages) : null), [read]);
  const onPath = new Set(layout?.critical);
  const card = (n: PlanNode) => (
    <li key={n.id} className="pg-card">
      <span className="pg-id">{n.id}</span>
      <span className="pg-title">{n.title}</span>
      {n.dependencyIds.length > 0 && <span className="pg-note">{T.after(n.dependencyIds)}</span>}
      {n.unknown.length > 0 && <span className="pg-note pg-warn">{T.unknown(n.unknown)}</span>}
      {(onPath.has(n.id) || n.noNewDispatch) && (
        <span className="pg-chips">
          {onPath.has(n.id) && <Chip size="sm">{T.critical}</Chip>}
          {n.noNewDispatch && <Chip size="sm">{T.noDispatch}</Chip>}
        </span>
      )}
    </li>
  );
  const column = (name: string, nodes: PlanNode[], hint?: string) => (
    <section key={name} className="g-glass pg-col" aria-label={name}>
      <h3 className="pg-h">{name}</h3>
      {hint && <p className="pg-note">{hint}</p>}
      <ul className="pg-list">{nodes.map(card)}</ul>
    </section>
  );

  return (
    <div className="pg-root">
      {read.kind === "loading" && <p className="pg-note">{T.loading}</p>}
      {read.kind === "unimported" && <HonestState kind="empty" title={T.unimported} hint={T.unimportedHint} />}
      {read.kind === "failed" && <HonestState kind="offline" title={T.unreadable} hint={T.unreadableHint} />}
      {read.kind === "ready" && layout && (
        <>
          <p className="pg-note">{T.source(read.plan.sourcePath, read.plan.sourceRevision.slice(0, 7), read.plan.projectionRevision)}</p>
          {layout.removed > 0 && <p className="pg-note">{T.removed(layout.removed)}</p>}
          {layout.levels.length === 0 && layout.cycle.length === 0 && <HonestState kind="empty" title={T.empty} />}
          <div className="pg-board">
            {layout.levels.map((nodes, i) => column(T.level(i), nodes))}
            {layout.cycle.length > 0 && column(T.cycle, layout.cycle, T.cycleHint)}
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
