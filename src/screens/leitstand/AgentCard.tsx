import { useId, useRef, useState } from "react";
import { Button } from "../../design/controls/Button";
import "../../design/inputs/inputs.css";
import { Avatar } from "../../design/inputs/Avatar";
import { Lamp, type LampState } from "../../design/inputs/Lamp";
import { StateMark } from "../../design/state/StateMark";
import { archiveWorker, respawnWorker } from "../../lib/ipc";
import type { BoardCard } from "../../types";
import { useT } from "../../i18n/useT";
import { lampFor, type LampKind } from "./lamps/lampFor";
import { ageText, cardForm, fill, initials, modelText, toneFor } from "./leitstand";
import { ProofStrip } from "./proof/ProofStrip";

export interface AgentCardProps {
  card: BoardCard;
  /** Display name of the card's profile; the profile id when it is unknown. */
  name: string;
  /** Unix seconds, passed in so the age text is testable. */
  now: number;
  onOpen: (card: BoardCard) => void;
  /** Called after a restart or archive succeeded, so the owner can refetch the board (`useBoard().refresh`). */
  onChanged?: () => void;
}

type Action = "restart" | "archive";

const LAMP_STATE: Record<LampKind, LampState> = { working: "busy", blocked: "bad", done: "ok", idle: "off" };

/**
 * One running agent. The proof strip shows only what the card knows (the pull request); red-first,
 * gates and review stay "not connected" until V2-B9 delivers them.
 * Same rule as the old worker list: a running agent can be archived (after an inline confirmation),
 * an exited one can be restarted, an archived one is never respawned.
 */
export function AgentCard({ card, name, now, onOpen, onChanged }: AgentCardProps) {
  const t = useT();
  const { worker } = card;
  const model = modelText(card);
  // Same rule as the flow node: a done card is proven by a passed test, otherwise it reads "ohne Beweis".
  const lamp = lampFor(card, card.testStatus === "pass");
  const taskId = useId();
  const [expanded, setExpanded] = useState(false);
  const canExpand = worker.task.length > 160;
  const branch = worker.branch.length > 32 ? `…${worker.branch.slice(-32)}` : worker.branch;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [failed, setFailed] = useState<Action | null>(null);
  // A confirmation or error belongs to the card state it was opened in: a refresh
  // that changes the status or puts another worker in this slot must not keep
  // offering an action the new state no longer allows. A counter, not the
  // id:status string: a round trip back to the same pair must still void the
  // first visit's reply. The in-flight call keeps its worker id and must not
  // publish an error or stay busy on the card that replaced it.
  const cardState = `${worker.id}:${worker.status}`;
  const [seenCardState, setSeenCardState] = useState(cardState);
  const actionGeneration = useRef(0);
  if (seenCardState !== cardState) {
    actionGeneration.current += 1;
    setSeenCardState(cardState);
    setConfirming(false);
    setFailed(null);
    setBusy(null);
  }
  const run = async (action: Action) => {
    const started = actionGeneration.current;
    setConfirming(false);
    setFailed(null);
    setBusy(action);
    try {
      await (action === "restart" ? respawnWorker : archiveWorker)(worker.id);
      if (actionGeneration.current !== started) return;
      setBusy(null);
      onChanged?.();
    } catch {
      if (actionGeneration.current !== started) return;
      setBusy(null);
      setFailed(action);
    }
  };
  const openConfirm = () => {
    setFailed(null);
    setConfirming(true);
  };
  const act = (action: Action, label: string, busyText: string) => (
    <Button size="sm" variant="ghost" disabled={busy !== null} aria-label={fill(label, { name })} aria-busy={busy === action ? true : undefined} onClick={() => (action === "archive" ? openConfirm() : void run(action))}>
      {busy === action ? busyText : t(action === "restart" ? "leitstand.restart" : "leitstand.archive")}
    </Button>
  );
  return (
    <article className="g-glass ls-card">
      <div className="ls-row">
        <StateMark form={cardForm(card)} />
        <Lamp state={LAMP_STATE[lamp.lamp]} label={lamp.word} />
        <span className="ls-time">{ageText(worker.createdAt, now)}</span>
      </div>
      <div className="ls-who">
        <Avatar initials={initials(name)} tone={toneFor(worker.profileId)} />
        <div className="ls-who-t">
          <h3 title={name}>{name}</h3>
          <p className="ls-branch" title={worker.branch}>
            <span aria-hidden="true">{branch}</span>
            <span className="ls-sr-only">{worker.branch}</span>
          </p>
          {model !== null && <p title={model}>{model}</p>}
        </div>
      </div>
      {card.attentionReason != null && (
        <p className="ls-attention">
          <span>{card.attentionReason}</span>
          {card.attentionObservedAt != null && <span className="ls-attention-age">{ageText(card.attentionObservedAt, now)}</span>}
        </p>
      )}
      <p id={taskId} className={`ls-task${canExpand && !expanded ? " ls-task--collapsed" : ""}`}>
        {canExpand && !expanded ? `${worker.task.slice(0, 160)}…` : worker.task}
      </p>
      {canExpand && (
        <Button size="sm" variant="ghost" className="ls-task-toggle" aria-expanded={expanded} aria-controls={taskId} onClick={() => setExpanded(!expanded)}>
          {t(expanded ? "leitstand.taskLess" : "leitstand.taskShowAll")}
        </Button>
      )}
      <ProofStrip redFirst="unknown" gates={null} review={null} stale={false} pr={card.prUrl ? { href: card.prUrl, sha: null, command: null, exitCode: null } : null} />
      <div className="ls-foot">
        <Button size="sm" aria-label={fill(t("leitstand.openLabel"), { name })} onClick={() => onOpen(card)}>{t("leitstand.open")}</Button>
      </div>
      {confirming ? (
        <div className="ls-acts">
          <p className="ls-ask">{t("leitstand.archiveAsk")}</p>
          <Button size="sm" onClick={() => void run("archive")}>{t("leitstand.archiveYes")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{t("leitstand.cancel")}</Button>
        </div>
      ) : (
        (worker.status === "exited" || worker.status === "running") && (
          <div className="ls-acts">
            {worker.status === "exited"
              ? act("restart", t("leitstand.restartLabel"), t("leitstand.restarting"))
              : act("archive", t("leitstand.archiveLabel"), t("leitstand.archiving"))}
          </div>
        )
      )}
      {failed !== null && <p className="ls-err" role="alert">{t(failed === "restart" ? "leitstand.restartFailed" : "leitstand.archiveFailed")}</p>}
    </article>
  );
}
