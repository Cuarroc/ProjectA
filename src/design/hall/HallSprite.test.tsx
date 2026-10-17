import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { SAMPLE_HALL } from "./fixtures";
import { Hall } from "./Hall";

// R1663-K2: an atlas that lacks an id (stale or newer sheet) must not take the hall down.
vi.mock("./sprites/hall-tiles.json", async (orig) => {
  const { default: map } = await orig<{ default: Record<string, number[]> }>();
  return { default: Object.fromEntries(Object.entries(map).filter(([id]) => id !== "piece-crate-0")) };
});

it("a sprite id missing from the atlas renders nothing instead of throwing", () => {
  const { container } = render(<Hall scene={SAMPLE_HALL} />);
  expect(container.querySelectorAll('[data-sprite="piece-crate-0"]')).toHaveLength(0);
  expect(container.querySelectorAll('[data-sprite="gate-hall-0"]')).toHaveLength(1);
});
