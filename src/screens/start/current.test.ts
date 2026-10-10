import { expect, it } from "vitest";

import { currentStepIndex } from "./current";

it("picks the first step that is still open", () => {
  expect(currentStepIndex(["ok", "done", "need", "need", "ok"])).toBe(2);
  expect(currentStepIndex(["ok", "run", "bad"])).toBe(1);
});

it("marks the last step as current when every step is done", () => {
  expect(currentStepIndex(["ok", "done", "done", "done", "done", "ok"])).toBe(5);
});
