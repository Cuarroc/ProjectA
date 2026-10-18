import { COLUMN_FORM, formForReason, STATE_WORDS, type StateForm } from "../../../design/state/states";
import type { BoardCard } from "../../../types";
import { ageText, fill } from "../leitstand";
import { T } from "./texts";

export type LampKind = "working" | "blocked" | "failed" | "done" | "idle" | "unknown";

/**
 * The one form of a card, used by its mark, the filter chips and the filter. The order:
 * done column (proven or not), failure reason, blocked, idle, then the column form of a running card.
 * A failure reason has no column, so it must win before blocked or idle can hide it; a running card in
 * review or ready to merge keeps its rev/ok form. `proof` is the caller's word that the test passed;
 * this function does not judge it. A done column without proof reads "need" (never "done"), and the
 * done word names only that test and its age (`testedAt`), not which head it covered.
 */
export function lampFor(card: BoardCard, proof: boolean, now: number): { lamp: LampKind; form: StateForm | undefined; word: string } {
  if (card.column === "done") {
    if (!proof) return { lamp: "blocked", form: "need", word: T.unproven };
    return { lamp: "done", form: "done", word: card.testedAt == null ? T.passed : fill(T.passedAt, { age: ageText(card.testedAt, now) }) };
  }
  if (formForReason(card.attentionCode ?? "") === "bad") return { lamp: "failed", form: "bad", word: STATE_WORDS.bad };
  if (card.column === "needs_you" || card.attentionGrade === "blocking" || card.worker.pausedReason) {
    return { lamp: "blocked", form: "need", word: T.blocked };
  }
  if (card.worker.status === "exited" || card.worker.status === "archived" || card.attentionCode === "idle_at_prompt") {
    return { lamp: "idle", form: "need", word: T.idle };
  }
  // A column or worker status the app does not know is not proof that work runs. The word is the form's own, so a
  // review or ready card never reads "Läuft" under a rev/ok mark.
  if (!Object.hasOwn(COLUMN_FORM, card.column) || card.worker.status !== "running") return { lamp: "unknown", form: undefined, word: T.unknown };
  const form = COLUMN_FORM[card.column];
  return { lamp: "working", form, word: form === "run" ? T.working : STATE_WORDS[form] };
}

/** The lamp of a card as every surface draws it: a done card is proven by a passed test. */
export const cardLamp = (card: BoardCard, now: number) => lampFor(card, card.testStatus === "pass", now);
