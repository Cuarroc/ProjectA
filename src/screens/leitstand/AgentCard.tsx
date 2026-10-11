import { useState } from "react";
import { Button } from "../../design/controls/Button";
import { HonestState } from "../../design/data/HonestState";
import "../../design/inputs/inputs.css";
import { Avatar } from "../../design/inputs/Avatar";
import { StateMark } from "../../design/state/StateMark";
import { archiveWorker, respawnWorker } from "../../lib/ipc";
import type { BoardCard } from "../../types";
import { useT } from "../../i18n/useT";
import { ageText, cardForm, fill, initials, modelText, toneFor } from "./leitstand";

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

/**
 * One running agent. The proof slot stays an honest "not connected" until V2-B9 delivers gates.
 * Same rule as the old worker list: a running agent can be archived (after an inline confirmation),
 * an exited one can be restarted, an archived one is never respawned.
 */
export function AgentCard({ card, name, now, onOpen, onChanged }: AgentCardProps) {
  const t = useT();
  const { worker } = card;
  const model = modelText(card);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [failed, setFailed] = useState<Action | null>(null);
  const run = async (action: Action) => {
    setConfirming(false);
    setFailed(null);
    setBusy(action);
    try {
      await (action === "restart" ? respawnWorker : archiveWorker)(worker.id);
      setBusy(null);
      onChanged?.();
    } catch {
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
        <span className="ls-time">{ageText(worker.createdAt, now)}</span>
      </div>
      <div className="ls-who">
        <Avatar initials={initials(name)} tone={toneFor(worker.profileId)} />
        <div className="ls-who-t">
          <h3 title={name}>{name}</h3>
          <p title={worker.branch}>{worker.branch}</p>
          {model !== null && <p title={model}>{model}</p>}
        </div>
      </div>
      <p className="ls-task" title={worker.task}>{worker.task}</p>
      <div className="ls-foot">
        <div className="ls-proof"><HonestState kind="offline" title={t("leitstand.proofTitle")} /></div>
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
