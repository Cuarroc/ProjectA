import "../../../design/inputs/inputs.css";
import { Lamp, type LampState } from "../../../design/inputs/Lamp";
import type { BoardCard } from "../../../types";
import { lampFor, type LampKind } from "../lamps/lampFor";
import { FlowGraph, type FlowLabel } from "./FlowGraph";
import { layoutFlow } from "./layout";

// The atoms of AgentCard.tsx, where this map is private: node and card show one lamp.
const LAMP_STATE: Record<LampKind, LampState> = { working: "busy", blocked: "bad", done: "ok", idle: "off" };

/** Inside of a flow node: task and branch as before, plus the lamp of the card. No gates reach the card yet, so a done node reads "ohne Beweis". */
function FlowNodeBody({ label, lamp }: { label: FlowLabel; lamp?: ReturnType<typeof lampFor> }) {
  return (
    <>
      <span className="fl-task">{label.task}</span>
      <span className="ls-row">
        {lamp && <Lamp state={LAMP_STATE[lamp.lamp]} label={lamp.word} />}
        <span className="fl-branch">{label.branch}</span>
      </span>
    </>
  );
}

/** The Fluss tab: the flow graph of the board's agents, one lamp on every node. */
export function FlowTab({ cards }: { cards: readonly BoardCard[] }) {
  const workers = cards.map((card) => card.worker);
  const labels = Object.fromEntries(workers.map((w) => [w.id, { task: w.task, branch: w.branch }]));
  const lamps = new Map(cards.map((card) => [card.worker.id, lampFor(card, false)]));
  return <FlowGraph layout={layoutFlow(workers)} labels={labels} renderNode={(node, label) => <FlowNodeBody label={label} lamp={lamps.get(node.id)} />} />;
}
