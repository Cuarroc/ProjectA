import { Button } from "../../design/controls/Button";
import { HonestState } from "../../design/data/HonestState";
import "../../design/inputs/inputs.css";
import { Avatar } from "../../design/inputs/Avatar";
import { StateMark } from "../../design/state/StateMark";
import type { BoardCard } from "../../types";
import { ageText, cardForm, initials, toneFor } from "./leitstand";
import { T } from "./texts";

export interface AgentCardProps {
  card: BoardCard;
  /** Display name of the card's profile; the profile id when it is unknown. */
  name: string;
  /** Unix seconds, passed in so the age text is testable. */
  now: number;
  onOpen: (card: BoardCard) => void;
}

/** One running agent. The proof slot stays an honest "not connected" until V2-B9 delivers gates. */
export function AgentCard({ card, name, now, onOpen }: AgentCardProps) {
  const { worker } = card;
  return (
    <article className="g-glass ls-card">
      <div className="ls-row">
        <StateMark form={cardForm(card)} />
        <span className="ls-time">{ageText(worker.createdAt, now)}</span>
      </div>
      <div className="ls-who">
        <Avatar initials={initials(name)} tone={toneFor(worker.profileId)} />
        <div className="ls-who-t">
          <h3 title={name}>{name}</h3>
          <p title={worker.branch}>{worker.branch}</p>
        </div>
      </div>
      <p className="ls-task" title={worker.task}>{worker.task}</p>
      <div className="ls-foot">
        <HonestState kind="offline" title={T.proofTitle} />
        <Button size="sm" aria-label={T.openLabel(name)} onClick={() => onOpen(card)}>{T.open}</Button>
      </div>
    </article>
  );
}
