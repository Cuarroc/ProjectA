import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { formatMessageTime, roleLabel, type OrchestratorChat } from "../lib/orchestratorChat";
import { useSharpening } from "../lib/useSharpening";
import type { WorkerMessage } from "../types";

interface ConversationViewProps {
  chat: OrchestratorChat;
  /** The active project, or `null`; preflight questions are filed under it. */
  projectId: string | null;
  /** Name of the active project, or `null` when none is selected. */
  projectName: string | null;
  /** Open the orchestrator's own terminal, for when the dialog is not enough. */
  onOpenOrchestrator: () => void;
  /** Switch to the Fragen tab, where a sharpening round's questions wait. */
  onOpenQuestions: () => void;
  /**
   * Der Attention-Eintrag des aktiven Orchestrators, fertig formuliert vom
   * Kern (`status.rs`, `ReasonCode`): Ursache und nächster Schritt in einem
   * Satz. Der Dialog rendert ihn und sonst nichts — er erfindet keinen Grund,
   * hängt keinen Ratschlag an und kann ihn nicht wegklicken.
   */
  runtimeAttention?: string | null;
}

/**
 * The main surface of Variant B: the conversation with the project's
 * orchestrator, with the composer under it.
 *
 * Everything the fleet reports arrives here as one stream — what the user
 * asked for, what the orchestrator answered, what the system noticed. The
 * board next to it says which workers exist; this says what is going on.
 */
export default function ConversationView({
  chat,
  projectId,
  projectName,
  onOpenOrchestrator,
  onOpenQuestions,
  runtimeAttention = null,
}: ConversationViewProps) {
  const [text, setText] = useState("");
  /**
   * Sharpening is a conversation (Phase 21 P1): a vague draft comes back as
   * preflight questions in the Fragen tab, and the composer only gets its text
   * once they are answered. Nothing is ever sent by itself — here as before,
   * the user reads the final prompt and presses Senden.
   */
  const sharpening = useSharpening(projectId, setText);

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
  }, [chat.messages.length]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 30;
    userScrolledUp.current = !nearBottom;
  }, []);

  const handleSend = useCallback(async () => {
    const sent = await chat.send(text);
    if (sent) setText("");
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

  /**
   * Sharpening rewrites the draft in place, so the user reads what will be
   * sent before it goes out. It never sends by itself.
   */
  const handleSharpen = useCallback(() => {
    sharpening.start(text);
  }, [sharpening, text]);

  const busy = chat.sending || sharpening.active;
  const canSend = !chat.disabled && !busy && text.trim() !== "";

  return (
    <div className="convo">
      <header className="convo-head">
        <span className="convo-title">{projectName ?? "Kein Projekt"}</span>
        <span className="convo-spacer" />
        <button
          type="button"
          className="convo-action"
          onClick={onOpenOrchestrator}
          disabled={chat.disabled}
          title="Terminal des Orchestrators öffnen"
        >
          Terminal
        </button>
      </header>

      <div className="convo-stream" ref={scrollRef} onScroll={handleScroll}>
        <div className="convo-thread">
          {chat.disabled ? (
            <p className="convo-empty">
              Wähle links ein Projekt, um mit seinem Orchestrator zu sprechen.
            </p>
          ) : chat.messages.length === 0 && chat.loading ? (
            // The history read is still out — "noch keine Nachrichten" would
            // claim a thread was empty that simply was never read.
            <p className="convo-empty">Verlauf wird geladen…</p>
          ) : chat.messages.length === 0 ? (
            <p className="convo-empty">
              Noch keine Nachrichten. Sag unten, was als Nächstes passieren soll — der
              Orchestrator verteilt die Arbeit auf Worker.
            </p>
          ) : (
            chat.messages.map((message) => <Bubble key={message.id} message={message} />)
          )}
        </div>
      </div>

      <div className="convo-composer">
        {/* Kein Ausblenden: der Eintrag verschwindet, wenn der Kern ihn
            zurücknimmt, und nur dann. Ein Dismiss würde einen Blocker aus der
            Anzeige nehmen, ohne dass sich etwas geändert hat — und ein
            „gesehen" wäre Zustand am Eintrag, nicht am Dialog (F3). */}
        {runtimeAttention ? (
          <div className="convo-error" role="alert">
            {runtimeAttention}
          </div>
        ) : null}
        {chat.error ? (
          <div role="alert">
            <button
              type="button"
              className="convo-error"
              onClick={chat.clearError}
              title="Ausblenden"
              aria-label={`Fehler ausblenden: ${chat.error}`}
            >
              {chat.error}
            </button>
          </div>
        ) : null}
        {sharpening.error ? (
          <div role="alert">
            <button
              type="button"
              className="convo-error"
              onClick={sharpening.clearError}
              title="Ausblenden"
              aria-label={`Fehler ausblenden: ${sharpening.error}`}
            >
              {sharpening.error}
            </button>
          </div>
        ) : null}
        {/* The questions are ordinary preflight rows, so the tab is where they
            are answered — this composer only says that they are there and
            waits for the answers to come back as the final prompt. */}
        {sharpening.phase === "waiting" ? (
          <p className="convo-sharpen-note" aria-live="polite">
            {sharpening.open.length === 1
              ? "Eine Rückfrage wartet im Fragen-Tab. "
              : `${sharpening.open.length} Rückfragen warten im Fragen-Tab. `}
            <button type="button" className="convo-sharpen-link" onClick={onOpenQuestions}>
              Beantworten
            </button>
            {" · "}
            <button type="button" className="convo-sharpen-link" onClick={sharpening.cancel}>
              Schärfung abbrechen
            </button>
          </p>
        ) : null}
        <div className="convo-composer-row">
          <textarea
            ref={inputRef}
            className="convo-input"
            aria-label="Nachricht an den Orchestrator"
            rows={2}
            value={text}
            placeholder={
              chat.disabled
                ? "Kein Projekt aktiv"
                : "Sag dem Orchestrator, was als Nächstes passieren soll …"
            }
            disabled={chat.disabled || busy}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="convo-composer-actions">
            <button
              type="button"
              className="convo-send"
              disabled={!canSend}
              onClick={() => void handleSend()}
            >
              {chat.sending ? "Sendet …" : "Senden"}
            </button>
            <button
              type="button"
              className="convo-sharpen"
              disabled={chat.disabled || busy || text.trim() === ""}
              onClick={handleSharpen}
              title={
                "Den Entwurf vom Prompt-Master schärfen lassen — sendet nicht. Bei einer " +
                "vagen Aufgabe kommen erst Rückfragen zurück, die im Fragen-Tab landen."
              }
            >
              {
                {
                  idle: "Schärfen",
                  thinking: "Schärft …",
                  waiting: "Wartet auf dich …",
                  finishing: "Baut Prompt …",
                }[sharpening.phase]
              }
            </button>
          </div>
        </div>
        <p className="convo-hint">
          Enter sendet · Shift+Enter neue Zeile · „Schärfen“ schreibt den Entwurf um, bevor er
          rausgeht
        </p>
      </div>
    </div>
  );
}

/** One turn of the conversation. */
function Bubble({ message }: { message: WorkerMessage }) {
  return (
    <article className={`convo-msg convo-msg-${message.role}`}>
      <div className="convo-msg-who">
        <span className="convo-msg-role">{roleLabel(message.role)}</span>
        <span className="convo-msg-time">{formatMessageTime(message.createdAt)}</span>
      </div>
      <p className="convo-msg-body">{message.content}</p>
    </article>
  );
}
