import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { formatMessageTime, roleLabel, type OrchestratorChat } from "../lib/orchestratorChat";

interface CommandChatProps {
  chat: OrchestratorChat;
  /**
   * The project this bar is talking about. Not read for its own sake - only
   * to notice a switch (KI-3): a draft typed here is the user's text for
   * *this* project, and carrying it into another one's box would send it to
   * that project's orchestrator on the next Enter. `ConversationView`
   * discards its draft the same way, just via `key={activeProjectId}` at its
   * call site; this bar has no such key, so it resets itself instead.
   */
  projectId: string | null;
  /** Jump to the full conversation, where the same thread has room to breathe. */
  onOpenConversation: () => void;
}

/** A quiet empty state that looks intentional, not broken. */
function EmptyChat() {
  return (
    <div className="command-chat-empty">
      <p>Noch keine Nachrichten. Schick dem Orchestrator eine Aufgabe.</p>
    </div>
  );
}

/**
 * The command bar under the main area: one prompt goes to the project's
 * orchestrator, and the collapsible panel above it shows what came back.
 *
 * Since Variant B the conversation has a view of its own, and this bar is what
 * keeps it reachable from the others — the terminal, the settings, the board.
 * Both read the same `OrchestratorChat`, which lives in `App`, so a view
 * switch never drops the thread.
 */
export default function CommandChat({ chat, projectId, onOpenConversation }: CommandChatProps) {
  const [text, setText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  // Counts project switches. A send remembers the count it started under and
  // only clears the box if no switch happened since: the text alone cannot
  // tell a new draft from the one in flight when both read the same
  // (Review W1-09 Runde 3, kimi-k2.6 P2).
  const draftGeneration = useRef(0);

  // KI-3: a project switch must not hand the new project's box the old
  // project's unsent draft.
  useEffect(() => {
    draftGeneration.current += 1;
    setText("");
  }, [projectId]);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Track whether the user has deliberately scrolled up; if so, new messages
  // must not steal the viewport.
  const userScrolledUp = useRef(false);

  // Auto-scroll only when the user is already near the bottom.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (userScrolledUp.current) return;
    container.scrollTop = container.scrollHeight;
  }, [chat.messages.length, historyOpen]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 30;
    userScrolledUp.current = !nearBottom;
  }, []);

  const handleSend = useCallback(async () => {
    const generation = draftGeneration.current;
    const sent = await chat.send(text);
    // Clear only what was sent: a project switch while the send was in
    // flight may already have put a new draft in the box (KI-3) - even one
    // that reads exactly like the text just sent.
    if (sent && draftGeneration.current === generation) {
      setText((current) => (current === text ? "" : current));
    }
    // The user is mid-conversation; the caret belongs back in the field.
    inputRef.current?.focus();
  }, [chat, text]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      void handleSend();
    },
    [handleSend],
  );

  const disabled = chat.disabled;
  const canSend = !disabled && !chat.sending && text.trim() !== "";

  return (
    <div className="command-chat">
      {historyOpen ? (
        <div className="command-chat-history">
          {chat.messages.length === 0 ? (
            <EmptyChat />
          ) : (
            <div className="command-chat-list" ref={scrollRef} onScroll={handleScroll}>
              {chat.messages.map((message) => (
                <div
                  key={message.id}
                  className={`command-chat-entry command-chat-entry-${message.role}`}
                >
                  <span className="command-chat-meta">
                    <span className="command-chat-role">{roleLabel(message.role)}</span>
                    <span className="command-chat-time">
                      {formatMessageTime(message.createdAt)}
                    </span>
                  </span>
                  <p className="command-chat-content">{message.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {chat.error ? <p className="command-chat-error">{chat.error}</p> : null}
      {disabled ? (
        <p className="command-chat-hint">Kein Projekt aktiv — wähle links ein Projekt.</p>
      ) : null}
      <div className="command-chat-bar">
        <button
          type="button"
          className="command-chat-toggle"
          onClick={() => setHistoryOpen((open) => !open)}
          disabled={disabled}
          aria-expanded={historyOpen}
          title="Verlauf des Orchestrators"
        >
          <span className="command-chat-chevron">{historyOpen ? "▾" : "▸"}</span>
          Verlauf
        </button>
        <textarea
          ref={inputRef}
          className="command-chat-input"
          aria-label="Aufgabe an den Orchestrator"
          rows={2}
          value={text}
          placeholder="Aufgabe an den Orchestrator … (Enter sendet, Shift+Enter neue Zeile)"
          disabled={disabled || chat.sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="command-chat-expand"
          onClick={onOpenConversation}
          title="Im Dialog öffnen"
          aria-label="Im Dialog öffnen"
        >
          ⤢
        </button>
        <button
          type="button"
          className="command-chat-send"
          disabled={!canSend}
          onClick={() => void handleSend()}
        >
          {chat.sending ? "Sendet …" : "Senden"}
        </button>
      </div>
    </div>
  );
}
