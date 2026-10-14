import { useId, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { HonestState } from "../../../design/data/HonestState";
import { fill } from "../leitstand";
import type { FlowLayout, FlowNode } from "./layout";
import { REDUCED_QUERY, T } from "./texts";
import "../../../design/glass.css";
import "./flow.css";

export interface FlowLabel {
  task: string;
  branch: string;
}

export interface FlowGraphProps {
  layout: FlowLayout;
  /** Task and branch per node id; an id without a label falls back to the id. */
  labels: Record<string, FlowLabel>;
  /** Replaces only the inside of a node; the frame and the edges stay. */
  renderNode?: (node: FlowNode, label: FlowLabel) => ReactNode;
}

const NODE_W = 208;
const NODE_H = 76;
const GAP_X = 24;
const GAP_Y = 56;

/** Live "user asked for reduced motion"; without `matchMedia` (old webviews, tests) it never matches. */
function useReducedMotion(): boolean {
  const list = useMemo(() => (typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_QUERY) : null), []);
  return useSyncExternalStore(
    (notify) => {
      list?.addEventListener("change", notify);
      return () => list?.removeEventListener("change", notify);
    },
    () => list?.matches ?? false,
  );
}

const left = (node: FlowNode) => node.x * (NODE_W + GAP_X);
const top = (node: FlowNode) => node.y * (NODE_H + GAP_Y);

/** The agent flow on glass: one node per agent, an arrow from each parent to the child it started. */
export function FlowGraph({ layout, labels, renderNode }: FlowGraphProps) {
  const reduced = useReducedMotion();
  const arrow = useId();
  if (layout.nodes.length === 0) return <HonestState kind="empty" title={T.empty} />;

  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const labelOf = (id: string): FlowLabel => labels[id] ?? { task: id, branch: "" };
  const width = (Math.max(...layout.nodes.map((node) => node.x)) + 1) * (NODE_W + GAP_X) - GAP_X;
  const height = (Math.max(...layout.nodes.map((node) => node.y)) + 1) * (NODE_H + GAP_Y) - GAP_Y;

  return (
    <section className="fl-wrap" aria-label={T.label}>
      <div className="fl-canvas" style={{ width, height }}>
        <svg className="fl-edges" width={width} height={height}>
          <defs>
            <marker id={arrow} className="fl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0 0L8 4L0 8z" />
            </marker>
          </defs>
          {layout.edges.map(({ from, to }) => {
            const parent = byId.get(from);
            const child = byId.get(to);
            if (!parent || !child) return null;
            const x1 = left(parent) + NODE_W / 2;
            const y1 = top(parent) + NODE_H;
            const x2 = left(child) + NODE_W / 2;
            const y2 = top(child);
            const mid = (y1 + y2) / 2;
            return (
              <path
                key={`${from}>${to}`}
                data-flow-edge=""
                data-from={from}
                data-to={to}
                className={reduced ? "fl-edge" : "fl-edge fl-edge--moving"}
                d={`M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`}
                markerEnd={`url(#${arrow})`}
              >
                <title>{fill(T.edge, { parent: labelOf(from).task, child: labelOf(to).task })}</title>
              </path>
            );
          })}
        </svg>
        {layout.nodes.map((node) => {
          const label = labelOf(node.id);
          return (
            <div
              key={node.id}
              className="fl-node"
              role="group"
              aria-label={label.task}
              style={{ left: left(node), top: top(node), width: NODE_W, height: NODE_H }}
            >
              {renderNode ? (
                renderNode(node, label)
              ) : (
                <>
                  <span className="fl-task">{label.task}</span>
                  <span className="fl-branch">{label.branch}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
