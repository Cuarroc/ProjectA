import { describe, expect, it } from "vitest";

import { explainError, workerStatusLabel } from "./plainText";

describe("workerStatusLabel", () => {
  it("names every worker status in plain German", () => {
    expect(workerStatusLabel("running")).toBe("Läuft");
    expect(workerStatusLabel("exited")).toBe("Beendet");
    expect(workerStatusLabel("archived")).toBe("Archiviert");
  });

  it("falls back to the raw value for a status it does not know", () => {
    expect(workerStatusLabel("something-new")).toBe("something-new");
  });
});

describe("explainError", () => {
  it("keeps the original text and adds what happened and what to do", () => {
    const e = explainError("connect ECONNREFUSED 127.0.0.1:4000");
    expect(e.raw).toBe("connect ECONNREFUSED 127.0.0.1:4000");
    expect(e.what).toMatch(/nicht erreichbar/);
    expect(e.todo.length).toBeGreaterThan(0);
  });

  it("recognises permission problems", () => {
    expect(explainError("EACCES: permission denied").what).toMatch(/Berechtigung/);
  });

  it("gives an unknown error a generic but honest explanation", () => {
    const e = explainError("kaputt 42");
    expect(e.what).toMatch(/Fehler/);
    expect(e.raw).toBe("kaputt 42");
  });
});
