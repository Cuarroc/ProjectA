import { useRef, useState } from "react";

import { HonestState } from "../../../design/data/HonestState";
import { StateGlyph } from "../../../design/state/StateMark";
import { fill } from "../leitstand";
import { Ask } from "./Ask";
import { classifyQuestion } from "./classify";
import { DecisionLane, LANES } from "./DecisionLane";
import { useT } from "../../../i18n/useT";
import type { QuestionsState } from "../../../lib/useQuestions";
import type { Worker } from "../../../types";
import "../../../design/glass.css";
import "./needs.css";

/** How many "answered" lines stay under the list. */
const SAID_LIMIT = 20;

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

  const classes = open.map((q) => classifyQuestion(q.question));
  const others = open.filter((_, i) => classes[i] === "other");

  // The lanes show their rule only once the list was read; an empty list says "Nichts offen" once, in the body.
  const listRead = open.length > 0 || (error === null && !loading);

  let body;
  if (error !== null && open.length === 0) body = <HonestState kind="offline" hint={t("needs.offlineHint")} />;
  else if (loading && open.length === 0) body = <p className="n-note">{t("needs.loading")}</p>;
  else if (open.length === 0) body = <HonestState kind="empty" title={t("needs.emptyTitle")} hint={t("needs.emptyHint")} />;
  else if (others.length > 0)
    body = (
      <ul className="n-list" aria-label={t("state.need")}>
        {others.map((q) => (
          <Ask key={q.id} q={q} worker={workers.find((w) => w.id === q.workerId)} onAnswer={onAnswer} />
        ))}
      </ul>
    );

  return (
    <aside className="g-glass n-pane" aria-labelledby="n-title">
      <div className="n-head">
        <StateGlyph form="need" />
        <h2 id="n-title">{t("state.need")}</h2>
        {open.length > 0 && <span className="n-count">{fill(t("needs.open"), { n: open.length })}</span>}
      </div>
      {listRead &&
        LANES.map((lane) => (
          <DecisionLane key={lane} lane={lane} questions={open.filter((_, i) => classes[i] === lane)} anyOpen={open.length > 0} workers={workers} onAnswer={onAnswer} />
        ))}
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
