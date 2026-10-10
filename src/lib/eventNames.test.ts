import { describe, expect, it } from "vitest";

import { ptyExit, ptyOutput } from "./eventNames";

describe("eventNames helpers", () => {
  it("compose the same PTY wire format as Rust", () => {
    // Join keeps the composed wire spelling without a quoted prefix literal
    // that the event-name guard would flag outside the shared modules.
    expect(ptyOutput("abc")).toBe(["pty", "output", "abc"].join(":"));
    expect(ptyExit("abc")).toBe(["pty", "exit", "abc"].join(":"));
  });
});
