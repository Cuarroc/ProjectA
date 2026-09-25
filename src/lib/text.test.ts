import { describe, expect, it } from "vitest";

import { shortTask } from "./text";

describe("shortTask", () => {
  it("uses the trimmed first line and clips it to the requested length", () => {
    expect(shortTask("  Implement the complete dashboard\\nIgnore this line", 14)).toBe(
      "Implement the…",
    );
  });
});
