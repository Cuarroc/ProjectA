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

  it("both helpers ignore the host locale", async () => {
    const DateTimeFormat = Intl.DateTimeFormat;
    const timeString = Date.prototype.toLocaleTimeString;
    const dateString = Date.prototype.toLocaleDateString;
    vi.resetModules();
    try {
      vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locale, options) {
        return new DateTimeFormat(locale ?? "en-US", options);
      });
      vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (this: Date, locale, options) {
        return timeString.call(this, locale ?? "en-US", options);
      });
      vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (this: Date, locale, options) {
        return dateString.call(this, locale ?? "en-US", options);
      });
      const at = new Date(2026, 9, 2, 17, 5, 0);
      // Prove the hostile default before constructing the module's cached formatters.
      expect(new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit" }).format(at)).toBe("10/02");
      const helpers = await import("./time");
      expect(helpers.formatClock(at)).toBe("17:05");
      expect(helpers.formatDayMonth(at)).toBe("02.10.");
    } finally {
      vi.restoreAllMocks();
      vi.resetModules();
    }
  });
});
