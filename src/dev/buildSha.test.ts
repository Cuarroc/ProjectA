import { expect, it } from "vitest";
import { buildSha } from "./buildSha";

it("selects the environment SHA before git and then the local fallback", () => {
  expect(buildSha("abcdef123456", "7654321")).toBe("abcdef123456");
  expect(buildSha("abcdef123456", undefined)).toBe("abcdef123456");
  expect(buildSha(undefined, "7654321")).toBe("7654321");
  expect(buildSha("", "7654321")).toBe("7654321");
  expect(buildSha(undefined, undefined)).toBe("local");
  expect(buildSha("", "")).toBe("local");
});
