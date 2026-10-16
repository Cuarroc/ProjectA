import { COLUMN_FORM } from "../../../design/state/states";
import type { BoardCard } from "../../../types";
import { ageText } from "../leitstand";
import { T } from "./texts";

export type LampKind = "working" | "blocked" | "done" | "idle" | "unknown";

/**
 * One lamp per card, beside the six-form dictionary of `states.ts`. `proof` is
 * the caller's word that the card's test passed; this function does not judge it.
 * A done column without proof is shown as blocked, never as done. The done word
 * names only that test and its age (`testedAt`), not which head it covered.
 */
export function lampFor(card: BoardCard, proof: boolean, now: number): { lamp: LampKind; word: string } {
  if (card.column === "done") {
    if (!proof) return { lamp: "blocked", word: T.unproven };
    return { lamp: "done", word: card.testedAt == null ? T.passed : `${T.passed}, ${ageText(card.testedAt, now)}` };
  }
  if (card.column === "needs_you" || card.attentionGrade === "blocking" || card.worker.pausedReason || card.attentionCode === "quota_blocked") {
    return { lamp: "blocked", word: T.blocked };
  }
  if (card.worker.status === "exited" || card.worker.status === "archived" || card.attentionCode === "idle_at_prompt") {
    return { lamp: "idle", word: T.idle };
  }
  // A column or worker status the app does not know is not proof that work runs.
  return Object.hasOwn(COLUMN_FORM, card.column) && card.worker.status === "running" ? { lamp: "working", word: T.working } : { lamp: "unknown", word: T.unknown };
}
