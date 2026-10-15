import { useEffect, useState, type ReactNode } from "react";

import "../../../design/inputs/inputs.css";
import { Lamp, type LampState } from "../../../design/inputs/Lamp";
import { getBudgets, getQuotaState, listAgentProfiles } from "../../../lib/ipc";
import type { AgentProfile, BoardCard, Budget, QuotaState } from "../../../types";
import { lampFor, type LampKind } from "../lamps/lampFor";
import { quotaView, type QuotaView } from "../quota/forecast";
import { ProofStrip } from "../proof/ProofStrip";
import { QuotaMeter } from "../quota/QuotaMeter";
import { FlowGraph, type FlowLabel } from "./FlowGraph";
import { layoutFlow } from "./layout";

/** The board's own rhythm (useBoard): one interval for the three quota reads. */
const POLL_MS = 5000;

// The atoms of AgentCard.tsx, where this map is private: node and card show one lamp.
const LAMP_STATE: Record<LampKind, LampState> = { working: "busy", blocked: "bad", done: "ok", idle: "off" };

/** `null` = that read failed. A node then stays unmeasured instead of showing a zero. */
interface Reads { profiles: AgentProfile[] | null; quotas: QuotaState[] | null; budgets: Budget[] | null }

const settled = <T,>(read: PromiseSettledResult<T>) => (read.status === "fulfilled" ? read.value : null);
const readAll = () =>
  Promise.allSettled([listAgentProfiles(), getQuotaState(), getBudgets()]).then(
    ([profiles, quotas, budgets]): Reads => ({ profiles: settled(profiles), quotas: settled(quotas), budgets: settled(budgets) }),
  );

/** The quota reading of the profile behind one card; the fallback is named by its profile name, its id if the list has no such profile. */
function quotaFor(card: BoardCard, { profiles, quotas, budgets }: Reads): { view: QuotaView; name: string } {
  const id = card.worker.profileId;
  const own = profiles?.find((p) => p.id === id);
  const budget = budgets?.find((b) => b.profileId === id);
  const next = own?.fallback ?? null;
  return {
    name: own?.name ?? id,
    view: quotaView({
      state: quotas?.find((q) => q.profileId === id)?.state ?? null,
      fiveHourPct: budget?.fiveHourPct ?? null,
      sevenDayPct: budget?.sevenDayPct ?? null,
      fallbackName: next === null ? null : (profiles?.find((p) => p.id === next)?.name ?? next),
    }),
  };
}

/** The card's proof strip (AgentCard.tsx) from the same fields, in the one-line variant the node has room for: only the pull request is known, red-first, gates and review stay "noch nicht verbunden". */
const proofFor = (card: BoardCard) => (
  <ProofStrip compact redFirst="unknown" gates={null} review={null} stale={false} pr={card.prUrl ? { href: card.prUrl, sha: null, command: null, exitCode: null } : null} />
);

/** Inside of a flow node: task and branch as before, the lamp of the card, its quota and its proof strip. */
function FlowNodeBody({ label, lamp, quota, proof }: { label: FlowLabel; lamp?: ReturnType<typeof lampFor>; quota?: ReturnType<typeof quotaFor>; proof?: ReactNode }) {
  return (
    <>
      <span className="fl-task">{label.task}</span>
      <span className="fl-meta">
        <span className="ls-row">
          {lamp && <Lamp state={LAMP_STATE[lamp.lamp]} label={lamp.word} />}
          <span className="fl-branch">{label.branch}</span>
        </span>
        {quota && <QuotaMeter view={quota.view} name={quota.name} />}
      </span>
      {proof}
    </>
  );
}

/** The Fabrik tab: the flow graph of the board's agents, one lamp, one quota reading and the proof strip on every node. */
export function FlowTab({ cards }: { cards: readonly BoardCard[] }) {
  const [reads, setReads] = useState<Reads>({ profiles: null, quotas: null, budgets: null });
  useEffect(() => {
    let live = true;
    let latest = 0;
    const load = () => {
      const mine = ++latest;
      // A slow read must not overwrite a newer one.
      void readAll().then((next) => live && mine === latest && setReads(next));
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  const workers = cards.map((card) => card.worker);
  const labels = Object.fromEntries(workers.map((w) => [w.id, { task: w.task, branch: w.branch }]));
  // A passed test is the proof a done node needs; the card still passes false until the gates reach it.
  const lamps = new Map(cards.map((card) => [card.worker.id, lampFor(card, card.testStatus === "pass")]));
  const proofs = new Map(cards.map((card) => [card.worker.id, proofFor(card)]));
  const quotas = new Map(cards.map((card) => [card.worker.id, quotaFor(card, reads)]));
  return (
    <FlowGraph
      layout={layoutFlow(workers)}
      labels={labels}
      renderNode={(node, label) => <FlowNodeBody label={label} lamp={lamps.get(node.id)} quota={quotas.get(node.id)} proof={proofs.get(node.id)} />}
    />
  );
}
