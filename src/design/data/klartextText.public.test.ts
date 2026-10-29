import { expect, it } from "vitest";
import { formatKlartext, type KlartextTextInput } from "../../i18n/klartextTemplates";
import type { KlartextInput } from "./klartext";

it("formats twenty word data sentences without invented counts or proof", () => {
  const source = { id: "fixture-run", identity: "fixture-head", checkedAt: "2026-10-29T04:00:00Z" };
  const beleg = { sourceId: source.id, identity: source.identity, observedAt: "2026-10-29T03:59:00Z", freshness: "fresh" } as const;
  const observation: KlartextInput = { operatingStatus: "running", evidenceStatus: "bewiesen", boardForm: "rev", source, beleg };
  const boundCounts = { n: 0, m: 2, sourceId: source.id, identity: source.identity, observedAt: beleg.observedAt };
  const work: KlartextTextInput = { kind: "work", Agent: "Root", Paket: "Paket", observation, boundCounts };
  const states: readonly KlartextInput[] = [
    observation, { ...observation, operatingStatus: "quiet", evidenceStatus: "vorgeschlagen", needsUser: true },
    { ...observation, operatingStatus: "error" }, { ...observation, operatingStatus: "completed" },
    { ...observation, operatingStatus: "quiet" }, { ...observation, operatingStatus: "unknown" },
    { ...observation, stopConfirmed: true }, { ...observation, operatingStatus: "completed", beleg: undefined },
  ];
  const matrix = [
    ["Root baut gerade Paket; 0 von 2 Schritten sind fertig.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt."],
    ["Der Stand ist unbekannt.", "Root wartet bei Paket auf deine Entscheidung.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt."],
    ["Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Root meldet ein Problem bei Paket.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt."],
    ["Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Root hat Paket mit Beleg abgeschlossen.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Der Stand ist unbekannt.", "Das Ergebnis ist unbelegt."],
  ];
  for (const [row, kind] of ["work", "decision", "problem", "result"].entries())
    for (const [column, observation] of states.entries())
      expect(formatKlartext({ ...work, kind, observation })).toBe(matrix[row][column]);
  const cases: readonly (readonly [Partial<KlartextTextInput>, string])[] = [
    [{}, "Root baut gerade Paket; 0 von 2 Schritten sind fertig."],
    [{ boundCounts: { ...boundCounts, n: 2 } }, "Root baut gerade Paket; 2 von 2 Schritten sind fertig."],
    [{ boundCounts: { ...boundCounts, n: 12, m: 12 } }, "Root baut gerade Paket; 12 von 12 Schritten sind fertig."],
    [{ boundCounts: { ...boundCounts, m: 0 } }, "Root baut gerade Paket; 0 von 0 Schritten sind fertig."],
    [{ observation: { ...observation, stopRequested: true, modelClaim: "completed" } }, "Root baut gerade Paket; 0 von 2 Schritten sind fertig."],
    [{ Agent: "  Root   Nord  ", Paket: " Paket\u00a0Neu " }, "Root Nord baut gerade Paket Neu; 0 von 2 Schritten sind fertig."],
    [{ Paket: "eins zwei drei vier fünf sechs sieben acht neun zehn elf" }, "Root baut gerade eins zwei drei vier fünf sechs sieben acht neun zehn elf; 0 von 2 Schritten sind fertig."],
    [{ Agent: "Root Nord", Paket: "eins zwei drei vier fünf sechs sieben acht neun zehn elf" }, "Der Stand ist unbekannt; der Satz überschreitet die Wortgrenze."],
    [{ Paket: "eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf" }, "Der Stand ist unbekannt."],
    [{ kind: "__proto__" }, "Der Stand ist unbekannt."],
    [{ observation: { ...observation, evidenceStatus: "unknown" } }, "Der Stand ist unbekannt."],
    [{ boundCounts: undefined }, "Der Fortschritt ist unbekannt."],
    [{ boundCounts: {} }, "Der Fortschritt ist unbekannt."],
    [{ boundCounts: { n: 0, m: 2 } }, "Der Fortschritt ist unbekannt."],
    [{ boundCounts: { ...boundCounts, sourceId: "other" } }, "Der Fortschritt ist unbekannt."],
    [{ boundCounts: { ...boundCounts, identity: "other" } }, "Der Fortschritt ist unbekannt."],
    [{ boundCounts: { ...boundCounts, observedAt: source.checkedAt } }, "Der Fortschritt ist unbekannt."],
    [{ boundCounts: { ...boundCounts, observedAt: undefined } }, "Der Fortschritt ist unbekannt."],
    [{ boundCounts: { ...boundCounts, sourceId: undefined } }, "Der Fortschritt ist unbekannt."],
    [{ boundCounts: { ...boundCounts, identity: undefined } }, "Der Fortschritt ist unbekannt."],
    [{ boundCounts: { ...boundCounts, n: Number.MAX_SAFE_INTEGER, m: Number.MAX_SAFE_INTEGER } }, "Root baut gerade Paket; 9007199254740991 von 9007199254740991 Schritten sind fertig."],
  ];
  for (const [patch, expected] of cases) expect(formatKlartext({ ...work, ...patch })).toBe(expected);
  for (const invalid of [undefined, null, NaN, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
    for (const field of ["n", "m"])
      expect(formatKlartext({ ...work, boundCounts: { ...boundCounts, [field]: invalid } })).toBe("Der Fortschritt ist unbekannt.");
  expect(formatKlartext({ ...work, boundCounts: { ...boundCounts, n: 3 } })).toBe("Der Fortschritt ist unbekannt.");
  const unusable: readonly KlartextInput[] = [
    { ...observation, beleg: undefined }, { ...observation, source: undefined },
    { ...observation, beleg: { ...beleg, freshness: "stale" } },
    { ...observation, beleg: { ...beleg, freshness: "unknown" } },
    { ...observation, source: { ...source, id: "other" } },
    { ...observation, source: { ...source, identity: "other" } },
    { ...observation, source: { ...source, identity: "unknown" } },
    { ...observation, source: { ...source, checkedAt: "unknown" } },
    { ...observation, beleg: { ...beleg, observedAt: "unknown" } },
    { ...observation, beleg: { ...beleg, observedAt: "2026-10-29T04:01:00Z" } },
    { ...observation, evidenceStatus: "gemeldet", modelClaim: "Fertig mit Beleg" },
  ];
  for (const observation of unusable) {
    expect(formatKlartext({ ...work, observation })).toBe("Das Ergebnis ist unbelegt.");
    expect(formatKlartext({ ...work, kind: "result", observation: { ...observation, operatingStatus: "completed" } })).toBe("Das Ergebnis ist unbelegt.");
  }
  for (const label of ["", "123", "x".repeat(101), "<b>Root</b>", "https://example.invalid", "www.example.invalid", "../file", "C:\\file", "a@b", "a=b", "a:b", "a\nb", "a\tb", "a\u0000b", "a\u202eb", "a\u2066b", "password", "passwd", "secret", "token", "credential", "bearer", "apikey", "api-key", "sk-fixture", "ghp_fixture"])
    for (const field of ["Agent", "Paket"])
      expect(formatKlartext({ ...work, [field]: label })).toBe("Der Stand ist unbekannt.");
  expect(formatKlartext({ ...work, Agent: "A B C D E" })).toBe("Der Stand ist unbekannt.");
  expect(formatKlartext({ ...work, Agent: "x".repeat(49) })).toBe("Der Stand ist unbekannt.");
  const decision = { ...work, kind: "decision", observation: states[1], Agent: "A B C D", Paket: "x".repeat(100) };
  expect(formatKlartext(decision)).toBe("A B C D wartet bei xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx auf deine Entscheidung.");
  expect(formatKlartext({ ...decision, Agent: "x".repeat(48), Paket: "A-1.2" })).toBe("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx wartet bei A-1.2 auf deine Entscheidung.");
  expect(formatKlartext({ ...work, Agent: "Tokenizer" })).toBe("Tokenizer baut gerade Paket; 0 von 2 Schritten sind fertig.");
  expect(formatKlartext({ ...decision, Agent: "𐐀".repeat(48), Paket: "Paket" })).toBe("𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀𐐀 wartet bei Paket auf deine Entscheidung.");
  const hostile = { ...work, secret: "synthetic-only", modelClaim: "done", toJSON() { throw new Error("extra accessed"); },
    get password() { throw new Error("extra accessed"); }, get rights() { throw new Error("extra accessed"); } };
  expect(formatKlartext(Object.freeze(hostile))).toBe("Root baut gerade Paket; 0 von 2 Schritten sind fertig.");
});
