import type { BoardCard } from "../../../types";
import { T } from "./texts";

export type LampKind = "working" | "blocked" | "done" | "idle";

/**
 * One lamp per card, beside the six-form dictionary of `states.ts`. `proof` is
 * the caller's word that evidence exists; this function does not judge it.
 * A done column without proof is shown as blocked, never as done.
 */
export function lampFor(card: BoardCard, proof: boolean): { lamp: LampKind; word: string } {
  if (card.column === "done") {
    return proof ? { lamp: "done", word: T.done } : { lamp: "blocked", word: T.unproven };
  }
  if (card.column === "needs_you" || card.attentionGrade === "blocking" || card.worker.pausedReason || card.attentionCode === "quota_blocked") {
    return { lamp: "blocked", word: T.blocked };
  }
  if (card.worker.status === "exited" || card.worker.status === "archived" || card.attentionCode === "idle_at_prompt") {
    return { lamp: "idle", word: T.idle };
  }
  return { lamp: "working", word: T.working };
}
