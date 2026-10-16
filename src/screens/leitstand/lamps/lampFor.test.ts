import { describe, expect, it } from "vitest";

import type { BoardCard, BoardColumn } from "../../../types";
import { lampFor } from "./lampFor";

const card = (over: Partial<BoardCard> = {}, worker: Partial<BoardCard["worker"]> = {}): BoardCard =>
  ({
    worker: { status: "running", pausedReason: null, ...worker },
    column: "working",
    attentionCode: null,
    attentionGrade: null,
    ...over,
  }) as BoardCard;

describe("lampFor", () => {
  it("withholds the done lamp when the column is done and proof is missing", () => {
    expect(lampFor(card({ column: "done" }), false)).toEqual({ lamp: "blocked", word: "ohne Beweis" });
  });

  it("shows the done lamp when the column is done and proof is present", () => {
    expect(lampFor(card({ column: "done" }), true)).toEqual({ lamp: "done", word: "Fertig" });
  });

  it("blocks on needs_you, a blocking grade, a pause or a quota block", () => {
    const blocked = { lamp: "blocked", word: "Blockiert" };
    expect(lampFor(card({ column: "needs_you" }), false)).toEqual(blocked);
    expect(lampFor(card({ attentionGrade: "blocking" }), false)).toEqual(blocked);
    expect(lampFor(card({}, { pausedReason: "budget" }), false)).toEqual(blocked);
    expect(lampFor(card({ attentionCode: "quota_blocked" }), false)).toEqual(blocked);
  });

  it("is idle when the worker is gone or sits at the prompt", () => {
    const idle = { lamp: "idle", word: "Untätig" };
    expect(lampFor(card({}, { status: "exited" }), false)).toEqual(idle);
    expect(lampFor(card({}, { status: "archived" }), false)).toEqual(idle);
    expect(lampFor(card({ attentionCode: "idle_at_prompt" }), false)).toEqual(idle);
  });

  it("blocks before idle and ignores proof outside the done column", () => {
    expect(lampFor(card({ column: "needs_you" }, { status: "exited" }), true).lamp).toBe("blocked");
    expect(lampFor(card({ attentionCode: "idle_at_prompt", attentionGrade: "blocking" }), true).lamp).toBe("blocked");
  });

  it("works while running, also in review and ready to merge", () => {
    for (const column of ["working", "in_review", "ready_to_merge"] as BoardColumn[]) {
      expect(lampFor(card({ column }), true)).toEqual({ lamp: "working", word: "Läuft" });
    }
  });

  it("returns unknown for a column the map does not know", () => {
    expect(lampFor(card({ column: "parked" as BoardColumn }), true)).toEqual({ lamp: "unknown", word: "Unbekannt" });
  });

  it("returns unknown for a worker status it does not know", () => {
    expect(lampFor(card({}, { status: "paused" as BoardCard["worker"]["status"] }), false)).toEqual({ lamp: "unknown", word: "Unbekannt" });
  });

  it("a passed test is worded as a test result", () => {
    expect(lampFor(card({ column: "done", testedAt: null }), true).word).toBe("Test bestanden");
  });
});
