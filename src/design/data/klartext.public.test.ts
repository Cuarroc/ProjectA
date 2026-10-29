import { expect, it, vi } from "vitest";
import { formForColumn } from "../state/states";
import { projectKlartext, type KlartextInput, type KlartextProjection } from "./klartext";

it("projects claims without evidence as Unbelegt and preserves independent board state", () => {
  const source = Object.freeze({ id: "fixture-run", identity: "fixture-head", checkedAt: "2026-10-29T04:00:00Z" });
  const beleg = Object.freeze({ sourceId: "fixture-run", identity: "fixture-head",
    observedAt: "2026-10-29T03:59:00Z", freshness: "fresh" as const });
  const completed: KlartextInput = Object.freeze({ operatingStatus: "completed", evidenceStatus: "bewiesen",
    boardForm: "rev", source, modelClaim: "Fertig mit Beleg" });
  const network = vi.spyOn(globalThis, "fetch");
  try {
    const missing = projectKlartext(completed);
    expect(missing.zustand).toBe("Unbelegt");
    expect(missing.belegGrund).toBe("Kein nutzbarer Beleg.");
    expect(missing.beleg).toBeUndefined();
    expect(missing.raw).toBe(completed);
    expect(missing.raw.boardForm).toBe("rev");
    expect(missing.operatingStatus).toBe("completed");
    expect(missing.evidenceStatus).toBe("bewiesen");

    const proven = projectKlartext({ ...completed, beleg });
    expect(proven).toMatchObject({ zustand: "Fertig mit Beleg", label: "Fertig mit Beleg", shape: "check-circle", beleg });
    expect(proven.belegGrund).toBeUndefined();
    type AssignsProjection<T> = [T] extends [KlartextProjection] ? true : false;
    const rejectsDoneWithoutProof: AssignsProjection<{
      raw: KlartextInput; operatingStatus: "completed"; evidenceStatus: "bewiesen";
      zustand: "Fertig mit Beleg"; label: "Fertig mit Beleg"; shape: "check-circle"; beleg: undefined;
    }> = false;
    const rejectsStateWithoutProofOrReason: AssignsProjection<{
      raw: KlartextInput; operatingStatus: "quiet"; evidenceStatus: "gemeldet";
      zustand: "Ruhig"; label: "Ruhig"; shape: "pause-circle";
    }> = false;
    void rejectsDoneWithoutProof; void rejectsStateWithoutProofOrReason;

    const denied: readonly KlartextInput[] = [
      { ...completed, beleg: { ...beleg, freshness: "stale" } },
      { ...completed, beleg: { ...beleg, freshness: "unknown" } },
      { ...completed, beleg, source: undefined },
      { ...completed, beleg, source: { ...source, id: "other-run" } },
      { ...completed, beleg, source: { ...source, identity: "other-head" } },
      { ...completed, beleg, source: { ...source, identity: "unknown" } },
      { ...completed, beleg, source: { ...source, checkedAt: "unknown" } },
      { ...completed, beleg: { ...beleg, observedAt: "unknown" } },
      { ...completed, beleg: { ...beleg, observedAt: "2026-10-29T04:01:00Z" } },
      { ...completed, beleg: { ...beleg, identity: "" } },
      { ...completed, beleg, evidenceStatus: "gemeldet" },
      { ...completed, beleg, evidenceStatus: "vorgeschlagen", needsUser: true },
      { ...completed, beleg, evidenceStatus: "unbekannt" },
      { ...completed, beleg, evidenceStatus: "Fertig mit Beleg" },
      { ...completed, beleg, evidenceStatus: "__proto__" },
      { ...completed, beleg, operatingStatus: "Fertig mit Beleg" },
      { ...completed, beleg: {} as KlartextInput["beleg"] },
      { ...completed, beleg: { ...beleg, observedAt: null } as unknown as KlartextInput["beleg"] },
    ];
    for (const input of denied) {
      const result = projectKlartext(Object.freeze(input));
      expect(result.zustand, JSON.stringify(input)).toBe("Unbelegt");
      expect(result.beleg).toBeUndefined();
      expect(result.belegGrund).toEqual(expect.any(String));
      expect(result.raw).toBe(input);
    }
    const quiet = { operatingStatus: "quiet", evidenceStatus: "gemeldet", boardForm: "unknown" };
    const matrix = [
      [{ ...quiet, operatingStatus: "running" }, "Läuft", "Läuft", "open-arc"],
      [{ ...quiet, operatingStatus: "error" }, "Problem", "Problem", "problem-triangle"],
      [quiet, "Ruhig", "Ruhig", "pause-circle"],
      [{ ...quiet, evidenceStatus: "vorgeschlagen", needsUser: true }, "Wartet auf dich", "Wartet auf dich", "diamond-dot"],
      [{ ...quiet, evidenceStatus: "vorgeschlagen" }, "Ruhig", "Ruhig", "pause-circle"],
      [{ ...quiet, operatingStatus: "running", stopRequested: true }, "Läuft", "Stopp angefordert", "open-arc"],
      [{ ...quiet, operatingStatus: "running", stopRequested: true, stopConfirmed: true }, "Ruhig", "gestoppt", "pause-circle"],
      [{ ...quiet, operatingStatus: "unknown" }, "Unbelegt", "unbekannt", "dashed-circle"],
      [{ ...quiet, operatingStatus: "new-status" }, "Unbelegt", "unbekannt", "dashed-circle"],
      [{ ...quiet, evidenceStatus: "unbekannt" }, "Unbelegt", "unbekannt", "dashed-circle"],
    ] as const;
    for (const [input, zustand, label, shape] of matrix) {
      const result = projectKlartext(input as KlartextInput);
      expect(result).toMatchObject({ zustand, label, shape, raw: input });
      expect(result.belegGrund).toEqual(expect.any(String));
    }
    const unknown = projectKlartext({ ...completed, operatingStatus: "future", evidenceStatus: "future" });
    expect(unknown).toMatchObject({ operatingStatus: "unknown", evidenceStatus: "unbekannt", zustand: "Unbelegt", label: "unbekannt" });
    expect(unknown.raw).toMatchObject({ operatingStatus: "future", evidenceStatus: "future" });
    expect([formForColumn("working"), formForColumn("needs_you"), formForColumn("in_review"),
      formForColumn("ready_to_merge"), formForColumn("done")]).toEqual(["run", "need", "rev", "ok", "done"]);
    expect(completed).toEqual({ operatingStatus: "completed", evidenceStatus: "bewiesen", boardForm: "rev", source, modelClaim: "Fertig mit Beleg" });
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
