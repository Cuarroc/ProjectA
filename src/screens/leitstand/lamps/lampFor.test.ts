import { describe, expect, it } from "vitest";

import type { BoardCard, BoardColumn } from "../../../types";
import { STATE_FORMS } from "../../../design/state/states";
import { lampFor, LAMP_FORM, type LampKind } from "./lampFor";

const NOW = 1_760_000_000;

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
    expect(lampFor(card({ column: "done" }), false, NOW)).toEqual({ lamp: "blocked", word: "ohne Beweis" });
  });

  it("shows the done lamp when the column is done and proof is present", () => {
    expect(lampFor(card({ column: "done" }), true, NOW)).toEqual({ lamp: "done", word: "Test bestanden" });
  });

  it("blocks on needs_you, a blocking grade, a pause or a quota block", () => {
    const blocked = { lamp: "blocked", word: "Blockiert" };
    expect(lampFor(card({ column: "needs_you" }), false, NOW)).toEqual(blocked);
    expect(lampFor(card({ attentionGrade: "blocking" }), false, NOW)).toEqual(blocked);
    expect(lampFor(card({}, { pausedReason: "budget" }), false, NOW)).toEqual(blocked);
    expect(lampFor(card({ attentionCode: "quota_blocked" }), false, NOW)).toEqual(blocked);
  });

  it("is idle when the worker is gone or sits at the prompt", () => {
    const idle = { lamp: "idle", word: "Untätig" };
    expect(lampFor(card({}, { status: "exited" }), false, NOW)).toEqual(idle);
    expect(lampFor(card({}, { status: "archived" }), false, NOW)).toEqual(idle);
    expect(lampFor(card({ attentionCode: "idle_at_prompt" }), false, NOW)).toEqual(idle);
  });

  it("blocks before idle and ignores proof outside the done column", () => {
    expect(lampFor(card({ column: "needs_you" }, { status: "exited" }), true, NOW).lamp).toBe("blocked");
    expect(lampFor(card({ attentionCode: "idle_at_prompt", attentionGrade: "blocking" }), true, NOW).lamp).toBe("blocked");
  });

  it("works while running, also in review and ready to merge", () => {
    for (const column of ["working", "in_review", "ready_to_merge"] as BoardColumn[]) {
      expect(lampFor(card({ column }), true, NOW)).toEqual({ lamp: "working", word: "Läuft" });
    }
  });

  it("returns unknown for a column the map does not know", () => {
    expect(lampFor(card({ column: "parked" as BoardColumn }), true, NOW)).toEqual({ lamp: "unknown", word: "Unbekannt" });
  });

  it("returns unknown for a worker status it does not know", () => {
    expect(lampFor(card({}, { status: "paused" as BoardCard["worker"]["status"] }), false, NOW)).toEqual({ lamp: "unknown", word: "Unbekannt" });
  });

  it("a passed test is worded as a test result", () => {
    expect(lampFor(card({ column: "done", testedAt: null }), true, NOW).word).toBe("Test bestanden");
    expect(lampFor(card({ column: "done", testedAt: NOW - 300 }), true, NOW).word).toBe("Test bestanden, seit 5 min");
  });

  it("returns a StateForm for every lamp kind", () => {
    const samples: Record<LampKind, BoardCard> = {
      working: card(),
      blocked: card({ column: "needs_you" }),
      done: card({ column: "done" }),
      idle: card({}, { status: "exited" }),
      unknown: card({ column: "parked" as BoardColumn }),
    };
    for (const kind of Object.keys(samples) as LampKind[]) {
      const shown = lampFor(samples[kind], true, NOW);
      expect(shown.lamp).toBe(kind);
      expect(shown.form).toBe(LAMP_FORM[kind]);
      // `unknown` is the one kind without a form: the mark then draws the neutral unknown shape.
      if (kind === "unknown") expect(shown.form).toBeUndefined();
      else expect(STATE_FORMS).toContain(shown.form);
    }
  });
});
