import { useEffect, useRef, useState } from "react";
import "../../../design/glass.css";
import { HonestState } from "../../../design/data/HonestState";
import { StateMark } from "../../../design/state/StateMark";
import { kindIcon } from "../../../lib/board";
import { getBoardState, getBudgets, listAgentProfiles, type BoardStateResult } from "../../../lib/ipc";
import { shortTask } from "../../../lib/text";
import type { AgentProfile, Budget, BoardCard, WorkerKind } from "../../../types";
import { agentCards, cardForm } from "../../leitstand/leitstand";
import { T } from "./texts";
import "./organigramm.css";

interface Reads {
  board: BoardStateResult | null;
  profiles: readonly AgentProfile[] | null;
  budgets: readonly Budget[] | null;
}

// Keyed by plain string: the backend may send a kind this build does not know yet.
const kindNames = new Map<string, string>(Object.entries(T.kind));

/** The badge for a coordinator kind; none when the kind is unknown or the label already says it. */
export function KindBadge({ kind, label }: { kind: WorkerKind; label: string }) {
  const name = kindNames.get(kind);
  if (name === undefined || label.toLowerCase() === name.toLowerCase()) return null;
  return <span className="og-kind">{`${kindIcon(kind)} ${name}`.trim()}</span>;
}

const pctText = (pct: number | null) => (pct === null ? T.noLimit : T.percent(pct));

/** The three reads fail on their own, so each failure names only its own words (`null` = read failed). */
function budgetLine(budgets: readonly Budget[] | null, profileId: string): string {
  if (budgets === null) return T.budgetUnreadable;
  const b = budgets.find((x) => x.profileId === profileId);
  if (!b) return T.budgetNone;
  return T.windows(pctText(b.fiveHourPct), pctText(b.sevenDayPct));
}

function AgentNode({ card, reads }: { card: BoardCard; reads: Reads }) {
  const id = card.worker.profileId;
  return (
    <li className="og-agent">
      <StateMark form={cardForm(card)} />
      <span className="og-task" title={card.worker.task}>{shortTask(card.worker.task, 60)}</span>
      <span className="og-persona">{reads.profiles?.find((p) => p.id === id)?.name ?? id}</span>
      <span className="og-budget">{budgetLine(reads.budgets, id)}</span>
    </li>
  );
}

function Agents({ cards, reads }: { cards: readonly BoardCard[]; reads: Reads }) {
  return cards.length === 0 ? <p className="og-note">{T.noAgents}</p> : (
    <ul className="og-list">{cards.map((c) => <AgentNode key={c.worker.id} card={c} reads={reads} />)}</ul>
  );
}

/** Organigramm: the live team of one project as a tree, read-only. Nothing here edits or enforces a budget; not mounted yet. */
export function Organigramm({ projectId }: { projectId: string }) {
  // `undefined` = not read yet; a failed read is `null` inside `Reads`.
  const [reads, setReads] = useState<Reads | undefined>(undefined);
  // One token per project change; a reply only lands while its own token is still current.
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    setReads(undefined);
    void Promise.allSettled([getBoardState(projectId), listAgentProfiles(), getBudgets()]).then(([board, profiles, budgets]) => {
      if (generation.current !== mine) return;
      setReads({
        board: board.status === "fulfilled" ? board.value : null,
        profiles: profiles.status === "fulfilled" ? profiles.value : null,
        budgets: budgets.status === "fulfilled" ? budgets.value : null,
      });
    });
  }, [projectId]);

  const board = reads?.board;
  const agents = board ? agentCards(board.cards) : [];
  const known = new Set(board?.coordinators.map((c) => c.workerId));
  const direct = agents.filter((c) => c.controlledBy === null || !known.has(c.controlledBy.workerId));

  return (
    <div className="og-root">
      <section className="g-glass og-card" aria-label={T.team}>
        <h2 className="og-h">{T.team}</h2>
        {reads === undefined ? <p className="og-note">{T.loading}</p> : !board ? (
          <HonestState kind="offline" title={T.offline} hint={T.offlineHint} />
        ) : agents.length === 0 && board.coordinators.length === 0 ? (
          <HonestState kind="empty" title={T.empty} hint={T.emptyHint} />
        ) : (
          <ul className="og-tree">
            <li className="og-node">
              <h3 className="og-title">{T.you}</h3>
              <ul className="og-list">
                {board.coordinators.map((co) => (
                  <li key={co.workerId} className="og-node">
                    <h4 className="og-title">{co.label}</h4>
                    <KindBadge kind={co.kind} label={co.label} />
                    <Agents cards={agents.filter((c) => c.controlledBy?.workerId === co.workerId)} reads={reads} />
                  </li>
                ))}
                {direct.length > 0 && (
                  <li className="og-node">
                    <h4 className="og-title">{T.direct}</h4>
                    <Agents cards={direct} reads={reads} />
                  </li>
                )}
              </ul>
            </li>
          </ul>
        )}
      </section>
      <section className="g-glass og-card" aria-label={T.departments}>
        <h2 className="og-h">{T.departments}</h2>
        <HonestState kind="offline" title={T.departmentsOffline} />
        <p className="og-note">{T.departmentsPackage}</p>
      </section>
    </div>
  );
}
