import { describe, expect, it } from "vitest";

import type { BoardCard, BoardColumn } from "../../../types";
import { STATE_FORMS, type StateForm } from "../../../design/state/states";
import { lampFor, type LampKind } from "./lampFor";

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
    expect(lampFor(card({ column: "done" }), false, NOW)).toEqual({ lamp: "blocked", form: "need", word: "ohne Beweis" });
  });

  it("shows the done lamp when the column is done and proof is present", () => {
    expect(lampFor(card({ column: "done" }), true, NOW)).toEqual({ lamp: "done", form: "done", word: "Test bestanden" });
  });

  it("blocks on needs_you, a blocking grade, a pause or a quota block", () => {
    const blocked = { lamp: "blocked", form: "need", word: "Blockiert" };
    expect(lampFor(card({ column: "needs_you" }), false, NOW)).toEqual(blocked);
    expect(lampFor(card({ attentionGrade: "blocking" }), false, NOW)).toEqual(blocked);
    expect(lampFor(card({}, { pausedReason: "budget" }), false, NOW)).toEqual(blocked);
  });

  it("is idle when the worker is gone or sits at the prompt", () => {
    const idle = { lamp: "idle", form: "need", word: "Untätig" };
    expect(lampFor(card({}, { status: "exited" }), false, NOW)).toEqual(idle);
    expect(lampFor(card({}, { status: "archived" }), false, NOW)).toEqual(idle);
    expect(lampFor(card({ attentionCode: "idle_at_prompt" }), false, NOW)).toEqual(idle);
  });

  it("blocks before idle and ignores proof outside the done column", () => {
    expect(lampFor(card({ column: "needs_you" }, { status: "exited" }), true, NOW).lamp).toBe("blocked");
    expect(lampFor(card({ attentionCode: "idle_at_prompt", attentionGrade: "blocking" }), true, NOW).lamp).toBe("blocked");
  });

  it("works while running in the working column", () => {
    expect(lampFor(card(), true, NOW)).toEqual({ lamp: "working", form: "run", word: "Läuft" });
  });

  it("a running card in review reads rev and one ready to merge reads ok", () => {
    expect(lampFor(card({ column: "in_review" }), true, NOW)).toEqual({ lamp: "working", form: "rev", word: "In Prüfung" });
    expect(lampFor(card({ column: "ready_to_merge" }), true, NOW)).toEqual({ lamp: "working", form: "ok", word: "Bereit zum Mergen" });
  });

  it("a failure reason reads bad even when blocking", () => {
    const failed = { lamp: "failed", form: "bad", word: "Fehler" };
    expect(lampFor(card({ attentionCode: "agent_exited" }), false, NOW)).toEqual(failed);
    expect(lampFor(card({ column: "in_review", attentionCode: "agent_exited", attentionGrade: "blocking" }), false, NOW)).toEqual(failed);
    expect(lampFor(card({ attentionCode: "quota_blocked" }), false, NOW)).toEqual(failed);
    expect(lampFor(card({ attentionCode: "delivery_failed" }, { status: "exited" }), false, NOW)).toEqual(failed);
  });

  it("a done column wins over a failure reason", () => {
    expect(lampFor(card({ column: "done", attentionCode: "agent_exited" }), true, NOW).form).toBe("done");
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
    const samples: Record<LampKind, [BoardCard, StateForm | undefined]> = {
      working: [card(), "run"],
      blocked: [card({ column: "needs_you" }), "need"],
      failed: [card({ attentionCode: "agent_stalled" }), "bad"],
      done: [card({ column: "done" }), "done"],
      idle: [card({}, { status: "exited" }), "need"],
      unknown: [card({ column: "parked" as BoardColumn }), undefined],
    };
    for (const kind of Object.keys(samples) as LampKind[]) {
      const [sample, form] = samples[kind];
      const shown = lampFor(sample, true, NOW);
      expect(shown.lamp).toBe(kind);
      // `unknown` is the one kind without a form: the mark then draws the neutral unknown shape.
      expect(shown.form).toBe(form);
      if (form) expect(STATE_FORMS).toContain(shown.form);
    }
  });
});
