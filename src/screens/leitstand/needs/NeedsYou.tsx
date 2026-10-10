import { useRef, useState, type KeyboardEvent } from "react";

import { Button } from "../../../design/controls/Button";
import { HonestState } from "../../../design/data/HonestState";
import { Input } from "../../../design/inputs/Input";
import { StateGlyph } from "../../../design/state/StateMark";
import { fill } from "../leitstand";
import { useT } from "../../../i18n/useT";
import { describeError } from "../../../lib/ipc";
import type { QuestionsState } from "../../../lib/useQuestions";
import type { Question, Worker } from "../../../types";
import "../../../design/glass.css";
import "./needs.css";

/** How many "answered" lines stay under the list. */
const SAID_LIMIT = 20;

/** The asker's offered answers; a string that will not parse means none. */
function parseOptions(json: string | null): string[] {
  try {
    const value: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(value) ? value.filter((o): o is string => typeof o === "string" && o.trim() !== "") : [];
  } catch {
    return [];
  }
}

function age(createdAt: number, nowMs: number, t: ReturnType<typeof useT>): string {
  const minutes = Math.max(0, Math.floor((nowMs / 1000 - createdAt) / 60));
  if (minutes < 1) return t("needs.justNow");
  return minutes < 60 ? fill(t("needs.minutes"), { n: minutes }) : fill(t("needs.hours"), { n: Math.floor(minutes / 60) });
}

function Ask({ q, worker, onAnswer }: { q: Question; worker?: Worker; onAnswer: (id: string, text: string) => Promise<void> }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preflight = q.scope === "preflight";

  const send = async (text: string) => {
    if (busy || text.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await onAnswer(q.id, text);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      // The card may outlive a successful answer until the next poll.
      setBusy(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") setDraft("");
    else if (e.key === "Enter") {
      e.preventDefault();
      void send(draft);
    }
  };

  return (
    <li className="n-ask">
      <div className="n-from">
        <b>{worker?.branch ?? (preflight ? t("needs.preflight") : t("needs.noAgent"))}</b>
        {worker?.task}
        <span className="n-age">{age(q.createdAt, Date.now(), t)}</span>
      </div>
      <p>{q.question}</p>
      <div className="n-opts">
        {parseOptions(q.optionsJson).map((option, i) => (
          <Button key={`${i}-${option}`} size="sm" disabled={busy} onClick={() => void send(option)}>
            {option}
          </Button>
        ))}
      </div>
      <div className="n-compose">
        <Input
          compact
          aria-label={t("needs.answerLabel")}
          aria-invalid={error !== null || undefined}
          placeholder={preflight ? t("needs.placeholderPreflight") : t("needs.placeholder")}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button size="sm" variant="tint" disabled={busy || draft.trim() === ""} onClick={() => void send(draft)}>
          {busy ? t("needs.sending") : t("needs.send")}
        </Button>
      </div>
      {error !== null && <p className="n-error" role="alert">{error}</p>}
      <p className="n-note">{preflight ? t("needs.keys") : `${t("needs.direct")} ${t("needs.keys")}`}</p>
    </li>
  );
}

export interface NeedsYouProps {
  questions: QuestionsState;
  /** The workers the questions can be resolved against (name and task). */
  workers: Worker[];
}

/** The "Braucht dich" area of the Leitstand: open questions with an inline answer. */
export function NeedsYou({ questions, workers }: NeedsYouProps) {
  const t = useT();
  const { open, loading, error, answer } = questions;
  // Answers given here, newest first: the stream line stays after the item left the list.
  // Capped, and keyed by a counter: the same question can be answered twice.
  const [said, setSaid] = useState<{ key: number; text: string }[]>([]);
  const seq = useRef(0);
  const onAnswer = async (id: string, text: string) => {
    await answer(id, text);
    setSaid((prev) => [{ key: seq.current++, text }, ...prev].slice(0, SAID_LIMIT));
  };

  let body;
  if (error !== null && open.length === 0) body = <HonestState kind="offline" hint={t("needs.offlineHint")} />;
  else if (loading && open.length === 0) body = <p className="n-note">{t("needs.loading")}</p>;
  else if (open.length === 0) body = <HonestState kind="empty" title={t("needs.emptyTitle")} hint={t("needs.emptyHint")} />;
  else
    body = (
      <ul className="n-list" aria-label={t("state.need")}>
        {open.map((q) => (
          <Ask key={q.id} q={q} worker={workers.find((w) => w.id === q.workerId)} onAnswer={onAnswer} />
        ))}
      </ul>
    );

  return (
    <aside className="g-glass n-pane" aria-labelledby="n-title">
      <div className="n-head">
        <StateGlyph form="need" />
        <h2 id="n-title">{t("state.need")}</h2>
        <span className="n-count">{open.length > 0 ? fill(t("needs.open"), { n: open.length }) : t("needs.none")}</span>
      </div>
      {body}
      {said.map((s) => (
        <p key={s.key} className="n-answered" role="status">
          <StateGlyph form="done" />
          {fill(t("needs.answered"), { text: s.text })}
        </p>
      ))}
    </aside>
  );
}
