import type { Question, Worker } from "../../../types";
import { Ask } from "./Ask";
import type { QuestionClass } from "./classify";
import { T } from "./texts";

export const LANES = ["money", "install", "delete"] as const satisfies readonly Exclude<QuestionClass, "other">[];
export type Lane = (typeof LANES)[number];

/** One always-visible decision row; its questions are answered with the same field as the list. */
export function DecisionLane({
  lane,
  questions,
  anyOpen,
  workers,
  onAnswer,
}: {
  lane: Lane;
  questions: Question[];
  /** Any question is open, in any lane: only then is "none here" news; an empty list says it once itself. */
  anyOpen: boolean;
  workers: Worker[];
  onAnswer: (id: string, text: string) => Promise<void>;
}) {
  return (
    <section className="n-lane" aria-labelledby={`n-lane-${lane}`}>
      <h3 id={`n-lane-${lane}`}>{T[lane].title}</h3>
      <p className="n-note">{T[lane].rule}</p>
      {questions.length === 0 ? (
        anyOpen && <p className="n-note">{T.none}</p>
      ) : (
        <ul className="n-list">
          {questions.map((q) => (
            <Ask key={q.id} q={q} worker={workers.find((w) => w.id === q.workerId)} onAnswer={onAnswer} />
          ))}
        </ul>
      )}
    </section>
  );
}
