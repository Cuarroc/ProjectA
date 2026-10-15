import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "../../../design/controls/Button";
import { ErrorDetails } from "../../../errors/ErrorDetails";
import { userError } from "../../../errors/texts";
import { HonestState } from "../../../design/data/HonestState";
import { Textarea } from "../../../design/inputs/Input";
import { roleLabel, type OrchestratorChat } from "../../../lib/orchestratorChat";
import { formatClock, formatDayMonth } from "../../../lib/time";
import "../../../design/glass.css";
import { T } from "./texts";
import "./verlauf.css";

export interface VerlaufChatProps {
  /** The one chat object the app already owns; this view starts no poller and calls no IPC. */
  chat: OrchestratorChat;
  /** Only read to notice a project switch: an unsent draft must not follow the user into another project. */
  projectId: string | null;
}

/** German 24-hour clock time of a message, with day and month when it is not from today. */
function messageTime(seconds: number): string {
  const at = new Date(seconds * 1000);
  if (!Number.isFinite(seconds) || seconds <= 0 || Number.isNaN(at.getTime())) return "";
  const time = formatClock(at);
  if (at.toDateString() === new Date().toDateString()) return time;
  return `${formatDayMonth(at)} ${time}`;
}

/**
 * The Verlauf of the Leitstand: the conversation with the project's orchestrator and its composer.
 * Layout follows the glass board Core.dc.html: the input row of the "Frag den Core" pane (:548-553)
 * and the `.msg` card, accent-tinted for the orchestrator's answers (:319-320).
 */
export function VerlaufChat({ chat, projectId }: VerlaufChatProps) {
  const [draft, setDraft] = useState("");
  const recipientHintId = useId();
  // Counts project switches: a send that finishes after a switch must not clear the new project's draft.
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setDraft("");
  }, [projectId]);

  const stream = useRef<HTMLDivElement>(null);
  // A streamed answer grows the last message without adding one, so its length is a scroll trigger too.
  const lastLength = chat.messages[chat.messages.length - 1]?.content.length ?? 0;
  const stuck = useRef(true);
  useEffect(() => {
    const el = stream.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, lastLength]);
  const onScroll = () => {
    const el = stream.current;
    if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  };

  const canSend = !chat.disabled && !chat.sending && draft.trim() !== "";
  // `sending` only flips after the parent re-renders, so a second Enter or click can slip in before it.
  const inFlight = useRef(false);
  const submit = async () => {
    if (!canSend || inFlight.current) return;
    inFlight.current = true;
    const started = generation.current;
    try {
      const sent = await chat.send(draft);
      if (sent && generation.current === started) setDraft("");
    } finally {
      inFlight.current = false;
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    void submit();
  };

  let body;
  if (chat.disabled) body = <HonestState kind="locked" title={T.noProject} hint={T.noProjectHint} />;
  else if (chat.messages.length === 0 && chat.loading) body = <p className="vc-note">{T.loading}</p>;
  else if (chat.messages.length === 0) body = <HonestState kind="empty" title={T.empty} hint={T.emptyHint} />;
  else
    body = chat.messages.map((m) => (
      <article key={m.id} className={`vc-msg vc-msg--${m.role}`}>
        <div className="vc-who">
          <b>{roleLabel(m.role)}</b>
          <span>{messageTime(m.createdAt)}</span>
        </div>
        <p>{m.content}</p>
      </article>
    ));

  return (
    <section className="g-glass vc" aria-labelledby="vc-title">
      <h2 id="vc-title">{T.title}</h2>
      <div className="vc-stream" ref={stream} onScroll={onScroll} role="log" aria-label={T.list}>
        {body}
      </div>
      {chat.error !== null && (
        <div role="alert">
          <HonestState kind="offline" title={T.errorTitle} hint={userError(chat.error).text} action={{ label: T.errorHide, onClick: chat.clearError }} />
          <ErrorDetails raw={userError(chat.error).detail} />
          <Button size="sm" variant="tint" onClick={chat.reload}>{T.errorRetry}</Button>
        </div>
      )}
      <p className="vc-note" id={recipientHintId}>
        {chat.disabled ? T.noProjectHint : (
          <>{T.recipient}{chat.orchestratorId === null && <> {T.firstSendHint}</>}</>
        )}
      </p>
      <div className="vc-compose">
        <Textarea
          name="verlauf-message"
          aria-label={T.inputLabel}
          aria-describedby={recipientHintId}
          placeholder={chat.disabled ? T.noProject : T.placeholder}
          rows={2}
          value={draft}
          disabled={chat.disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button variant="primary" disabled={!canSend} onClick={() => void submit()}>
          {chat.sending ? T.sending : T.send}
        </Button>
      </div>
      <p className="vc-note">{T.keys}</p>
    </section>
  );
}
