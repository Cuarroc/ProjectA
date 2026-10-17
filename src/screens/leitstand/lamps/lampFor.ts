import { COLUMN_FORM, type StateForm } from "../../../design/state/states";
import type { BoardCard } from "../../../types";
import { ageText, fill } from "../leitstand";
import { T } from "./texts";

export type LampKind = "working" | "blocked" | "done" | "idle" | "unknown";

/** Skeleton for the red commit: no kind has a form yet. */
export const LAMP_FORM: Record<LampKind, StateForm | undefined> = { working: undefined, blocked: undefined, done: undefined, idle: undefined, unknown: undefined };

/**
 * One lamp per card, beside the six-form dictionary of `states.ts`. `proof` is
 * the caller's word that the card's test passed; this function does not judge it.
 * A done column without proof is shown as blocked, never as done. The done word
 * names only that test and its age (`testedAt`), not which head it covered.
 */
export function lampFor(card: BoardCard, proof: boolean, now: number): { lamp: LampKind; form: StateForm | undefined; word: string } {
  if (card.column === "done") {
    if (!proof) return { lamp: "blocked", form: undefined, word: T.unproven };
    return { lamp: "done", form: undefined, word: card.testedAt == null ? T.passed : fill(T.passedAt, { age: ageText(card.testedAt, now) }) };
  }
  if (card.column === "needs_you" || card.attentionGrade === "blocking" || card.worker.pausedReason || card.attentionCode === "quota_blocked") {
    return { lamp: "blocked", form: undefined, word: T.blocked };
  }
  if (card.worker.status === "exited" || card.worker.status === "archived" || card.attentionCode === "idle_at_prompt") {
    return { lamp: "idle", form: undefined, word: T.idle };
  }
  // A column or worker status the app does not know is not proof that work runs.
  return Object.hasOwn(COLUMN_FORM, card.column) && card.worker.status === "running" ? { lamp: "working", form: undefined, word: T.working } : { lamp: "unknown", form: undefined, word: T.unknown };
}
