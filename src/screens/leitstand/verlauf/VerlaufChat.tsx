import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "../../../design/controls/Button";
import { HonestState } from "../../../design/data/HonestState";
import { Textarea } from "../../../design/inputs/Input";
import { formatMessageTime, roleLabel, type OrchestratorChat } from "../../../lib/orchestratorChat";
import "../../../design/glass.css";
import { T } from "./texts";
import "./verlauf.css";

export interface VerlaufChatProps {
  /** The one chat object the app already owns; this view starts no poller and calls no IPC. */
  chat: OrchestratorChat;
  /** Only read to notice a project switch: an unsent draft must not follow the user into another project. */
  projectId: string | null;
}

/**
 * The Verlauf of the Leitstand: the conversation with the project's orchestrator and its composer.
 * Layout follows the glass board Core.dc.html: the input row of the "Frag den Core" pane (:548-553)
 * and the `.msg` card, accent-tinted for the orchestrator's answers (:319-320). Not mounted yet.
 */
export function VerlaufChat({ chat, projectId }: VerlaufChatProps) {
  const [draft, setDraft] = useState("");
  // Counts project switches: a send that finishes after a switch must not clear the new project's draft.
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setDraft("");
  }, [projectId]);

  const stream = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useEffect(() => {
    const el = stream.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length]);
  const onScroll = () => {
    const el = stream.current;
    if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  };

  const canSend = !chat.disabled && !chat.sending && draft.trim() !== "";
  const submit = async () => {
    if (!canSend) return;
    const started = generation.current;
    const sent = await chat.send(draft);
    if (sent && generation.current === started) setDraft("");
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
          <span>{formatMessageTime(m.createdAt)}</span>
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
          <HonestState kind="offline" title={T.errorTitle} hint={chat.error} action={{ label: T.errorHide, onClick: chat.clearError }} />
        </div>
      )}
      <div className="vc-compose">
        <Textarea
          aria-label={T.inputLabel}
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
