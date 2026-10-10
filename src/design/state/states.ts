import { de } from "../../i18n/de";
import type { BoardColumn } from "../../types";

// V2-F3: six state forms and one dictionary (word, shape, color). Not
// imported by the app yet. Every status value of `src-tauri/src/status.rs`
// (the five board columns and the closed ReasonCode set) maps to exactly one
// form; `states.test.ts` reads status.rs and fails when a value has none.

export type StateForm = "run" | "need" | "rev" | "ok" | "done" | "bad";

/** Display order of the board's filter chips. */
export const STATE_FORMS: readonly StateForm[] = ["run", "need", "rev", "ok", "done", "bad"];

/** The word of each form — single source: `src/i18n/de.ts`. */
export const STATE_WORDS: Record<StateForm, string> = {
  run: de["state.run"],
  need: de["state.need"],
  rev: de["state.rev"],
  ok: de["state.ok"],
  done: de["state.done"],
  bad: de["state.bad"],
};

/** `status.rs` COL_* values. `bad` has no column: it marks a reason, not a place. */
export const COLUMN_FORM: Record<BoardColumn, StateForm> = {
  working: "run",
  needs_you: "need",
  in_review: "rev",
  ready_to_merge: "ok",
  done: "done",
};

/** `status.rs` ReasonCode::code() values, keyed by the wire name. */
export const REASON_FORM = {
  approval_required: "need",
  quota_blocked: "bad",
  delivery_failed: "bad",
  agent_exited: "bad",
  agent_stalled: "bad",
  decision_pending: "need",
  agent_reported: "need",
  idle_at_prompt: "need",
  changes_requested: "need",
  review_pending: "rev",
  review_approved: "ok",
  approved_but_draft: "rev",
  checks_pending: "rev",
  review_draft: "rev",
  pull_request_merged: "done",
} as const satisfies Record<string, StateForm>;

export type ReasonName = keyof typeof REASON_FORM;

export function formForColumn(column: BoardColumn): StateForm {
  return COLUMN_FORM[column];
}

/** Unknown codes (a newer core) give `undefined`, never a guessed form. */
export function formForReason(code: string): StateForm | undefined {
  return Object.hasOwn(REASON_FORM, code) ? REASON_FORM[code as ReasonName] : undefined;
}
