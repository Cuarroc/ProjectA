import { useEffect, useRef, useState } from "react";
import { Button, ButtonGroup } from "../../../design/controls/Button";
import { T } from "./texts";
import { HonestState } from "../../../design/data/HonestState";
import { StateGlyph } from "../../../design/state/StateMark";
import { fill } from "../leitstand";
import { Ask } from "./Ask";
import { ClosedHistory } from "./ClosedHistory";
import { HISTORY_TEXT } from "./history/texts";
import { classifyQuestion } from "./classify";
import { DecisionLane, LANES } from "./DecisionLane";
import { useT } from "../../../i18n/useT";
import type { QuestionsState } from "../../../lib/useQuestions";
import type { Worker } from "../../../types";
import "../../../design/glass.css";
import "./needs.css";

export interface NeedsYouProps {
  questions: QuestionsState;
  /** The workers the questions can be resolved against (name and task). */
  workers: Worker[];
  projectId?: string | null;
  projectNames?: ReadonlyMap<string, string> | null;
}

/** The "Braucht dich" area of the Leitstand: open questions with an inline answer. */
export function NeedsYou({ questions, workers, projectId, projectNames }: NeedsYouProps) {
  const t = useT();
  const { open, history, loading, error, answer, scope, setScope } = questions;
  const noProject = scope === "project" && projectId === null;
  const [confirmation, setConfirmation] = useState("");
  const lifetime = useRef(0);
  // The hook's answer identity changes with project/scope, never with a poll.
  useEffect(() => {
    setConfirmation("");
    return () => { lifetime.current += 1; };
  }, [answer]);

  const confirmAnswer = (id: string, text: string) => {
    const current = lifetime.current;
    setConfirmation("");
    return answer(id, text, (stored) => {
      if (current === lifetime.current && stored.id === id && stored.status === "answered" && stored.answer?.trim()) {
        setConfirmation(fill(HISTORY_TEXT.confirmed, { text: stored.answer }));
      }
    });
  };

  const classes = open.map((q) => classifyQuestion(q.question));
  const others = open.filter((_, i) => classes[i] === "other");

  // The lanes show their rule only once the list was read; an empty list says "Nichts offen" once, in the body.
  const listRead = !noProject && (open.length > 0 || (error === null && !loading));

  let body;
  if (noProject) body = <p className="n-note">{t("leitstand.noProject")}</p>;
  else if (error !== null && open.length === 0) body = <HonestState kind="offline" hint={t("needs.offlineHint")} />;
  else if (loading && open.length === 0) body = <p className="n-note">{t("needs.loading")}</p>;
  else if (open.length === 0) body = <HonestState kind="empty" title={t("needs.emptyTitle")} hint={t("needs.emptyHint")} />;
  else if (others.length > 0)
    body = (
      <ul className="n-list" aria-label={t("state.need")}>
        {others.map((q) => (
          <Ask key={q.id} fleet={scope === "all"} projectNames={projectNames} q={q} worker={workers.find((w) => w.id === q.workerId)} onAnswer={confirmAnswer} />
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
      <ButtonGroup aria-label={T.scope}>
        <Button size="sm" aria-pressed={scope === "project"} onClick={() => setScope("project")}>{T.project}</Button>
        <Button size="sm" aria-pressed={scope === "all"} onClick={() => setScope("all")}>{T.all}</Button>
      </ButtonGroup>
      {listRead &&
        LANES.map((lane) => (
          <DecisionLane key={lane} fleet={scope === "all"} projectNames={projectNames} lane={lane} questions={open.filter((_, i) => classes[i] === lane)} anyOpen={open.length > 0} workers={workers} onAnswer={confirmAnswer} />
        ))}
      {body}
      {!noProject && <p className="n-note" role="status" aria-live="polite" aria-atomic="true">{confirmation}</p>}
      <ClosedHistory history={history} />
    </aside>
  );
}
