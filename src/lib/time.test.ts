import { describe, expect, it, vi } from "vitest";

import { formatClock, formatDayMonth } from "./time";

describe("German time helpers", () => {
  it("formatClock renders a 24-hour clock without AM/PM", () => {
    expect(formatClock(new Date(2026, 9, 2, 17, 5, 0))).toBe("17:05");
    expect(formatClock(new Date(2026, 9, 2, 5, 31, 0))).toBe("05:31");
    expect(formatClock(new Date(2026, 9, 2, 0, 5, 0))).toBe("00:05");
    expect(formatClock(new Date(2026, 9, 2, 12, 0, 0))).not.toMatch(/AM|PM/i);
  });

  it("formatDayMonth renders dd.mm. with leading zeros", () => {
    expect(formatDayMonth(new Date(2026, 0, 3, 9, 0, 0))).toBe("03.01.");
    expect(formatDayMonth(new Date(2026, 11, 24, 9, 0, 0))).toBe("24.12.");
  });

  it("both helpers ignore the host locale", () => {
    const original = Date.prototype.toLocaleTimeString;
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (
      this: Date,
      _locale,
      options,
    ) {
      return original.call(this, "en-US", options);
    });
    expect(formatClock(new Date(2026, 9, 2, 17, 5, 0))).toBe("17:05");
    expect(formatDayMonth(new Date(2026, 9, 2, 17, 5, 0))).toBe("02.10.");
    vi.restoreAllMocks();
  });
});
