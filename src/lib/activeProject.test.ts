import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readActiveProjectId, subscribeActiveProject, writeActiveProjectId } from "./activeProject";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe("active project", () => {
  it("writes and reads the key the old app uses", () => {
    expect(readActiveProjectId()).toBeNull();
    writeActiveProjectId("p-1");
    expect(localStorage.getItem("projecta.activeProjectId")).toBe("p-1");
    expect(readActiveProjectId()).toBe("p-1");
  });

  it("tells subscribers once per change until they unsubscribe", () => {
    const seen: Array<string | null> = [];
    const off = subscribeActiveProject((id) => seen.push(id));
    writeActiveProjectId("p-1");
    writeActiveProjectId("p-1");
    writeActiveProjectId("p-2");
    off();
    writeActiveProjectId("p-3");
    expect(seen).toEqual(["p-1", "p-2"]);
  });

  it("survives disabled storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    const cb = vi.fn();
    subscribeActiveProject(cb);
    expect(readActiveProjectId()).toBeNull();
    expect(() => writeActiveProjectId("p-1")).not.toThrow();
    expect(cb).toHaveBeenCalledWith("p-1");
  });
});
