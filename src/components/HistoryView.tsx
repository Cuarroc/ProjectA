import { useCallback, useEffect, useRef, useState } from "react";

import { listWorkerMessages } from "../lib/ipc";
import type { WorkerMessage } from "../types";

interface HistoryViewProps {
  workerId: string;
}

const POLL_INTERVAL_MS = 10_000;
const MESSAGE_LIMIT = 200;

/** A quiet empty state that looks intentional, not broken. */
function EmptyHistory() {
  return (
    <div className="history-empty">
      <p>Hier erscheinen Nachrichten des Agenten: Aufgaben, Updates und Lebenszyklus-Ereignisse.</p>
    </div>
  );
}

/**
 * Worker message history. Oldest messages come first; we poll for updates and
 * reload when the worker changes. IPC failures are swallowed: the command may
 * not exist yet, and an empty state is better than a red error block.
 */
export default function HistoryView({ workerId }: HistoryViewProps) {
  const [messages, setMessages] = useState<WorkerMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Track whether the user has deliberately scrolled up; if so, new messages
  // must not steal the viewport.
  const userScrolledUp = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await listWorkerMessages(workerId, MESSAGE_LIMIT);
      setMessages(next);
    } catch {
      // The command may still be missing on the Rust side. Keep the previous
      // messages (if any) or stay in the quiet empty state.
    }
  }, [workerId]);

  useEffect(() => {
    setMessages([]);
    userScrolledUp.current = false;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [workerId, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Auto-scroll only when the user is already near the bottom.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (userScrolledUp.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages.length]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 30;
    userScrolledUp.current = !nearBottom;
  }, []);

  return (
    <div className="history-view">
      {messages.length === 0 && !loading ? (
        <EmptyHistory />
      ) : (
        <div className="history-list" ref={scrollRef} onScroll={handleScroll}>
          {messages.map((message) => (
            <div key={message.id} className={`history-entry history-entry-${message.role}`}>
              <span className="history-meta">
                <span className="history-role">{roleLabel(message.role)}</span>
                <span className="history-time">{formatMessageTime(message.createdAt)}</span>
              </span>
              <p className="history-content">{message.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function roleLabel(role: WorkerMessage["role"]): string {
  switch (role) {
    case "user":
      return "Nutzer";
    case "agent":
      return "Agent";
    case "system":
      return "System";
  }
}

/** Short local time; date only when it is not today. */
function formatMessageTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const at = new Date(seconds * 1000);
  if (Number.isNaN(at.getTime())) return "";

  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();

  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const day = at.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
  return `${day} ${time}`;
}
