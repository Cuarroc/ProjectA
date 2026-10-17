import { COLUMN_FORM, type StateForm } from "../../../design/state/states";
import type { BoardCard } from "../../../types";
import { ageText, fill } from "../leitstand";
import { T } from "./texts";

export type LampKind = "working" | "blocked" | "failed" | "done" | "idle" | "unknown";

/** The one map from lamp kind to the design system's form. `unknown` has none: the mark then draws its neutral shape. */
export const LAMP_FORM: Record<LampKind, StateForm | undefined> = { working: "run", blocked: "need", failed: "bad", done: "done", idle: "need", unknown: undefined };

/**
 * One lamp per card, mapped into the six forms of `states.ts` by `LAMP_FORM`. `proof` is
 * the caller's word that the card's test passed; this function does not judge it.
 * A done column without proof is shown as blocked, never as done. The done word
 * names only that test and its age (`testedAt`), not which head it covered.
 */
export function lampFor(card: BoardCard, proof: boolean, now: number): { lamp: LampKind; form: StateForm | undefined; word: string } {
  if (card.column === "done") {
    if (!proof) return { lamp: "blocked", form: LAMP_FORM.blocked, word: T.unproven };
    return { lamp: "done", form: LAMP_FORM.done, word: card.testedAt == null ? T.passed : fill(T.passedAt, { age: ageText(card.testedAt, now) }) };
  }
  if (card.column === "needs_you" || card.attentionGrade === "blocking" || card.worker.pausedReason || card.attentionCode === "quota_blocked") {
    return { lamp: "blocked", form: LAMP_FORM.blocked, word: T.blocked };
  }
  if (card.worker.status === "exited" || card.worker.status === "archived" || card.attentionCode === "idle_at_prompt") {
    return { lamp: "idle", form: LAMP_FORM.idle, word: T.idle };
  }
  // A column or worker status the app does not know is not proof that work runs.
  return Object.hasOwn(COLUMN_FORM, card.column) && card.worker.status === "running" ? { lamp: "working", form: LAMP_FORM.working, word: T.working } : { lamp: "unknown", form: LAMP_FORM.unknown, word: T.unknown };
}

/** The lamp of a card as every surface draws it: a done card is proven by a passed test. */
export const cardLamp = (card: BoardCard, now: number) => lampFor(card, card.testStatus === "pass", now);
