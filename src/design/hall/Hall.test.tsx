import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { de } from "../../i18n/de";
import { STATE_UNKNOWN_WORD } from "../state/states";
import { EMPTY_HALL, SAMPLE_HALL } from "./fixtures";
import { Hall } from "./Hall";

const sprites = (c: HTMLElement, part: string) => [...c.querySelectorAll(`[data-sprite*="${part}"]`)];

it("every hall view shows the Beispieldaten label", () => {
  for (const scene of [SAMPLE_HALL, EMPTY_HALL, undefined]) {
    const { unmount } = render(<Hall scene={scene} />);
    expect(screen.getByText(de["hall.sample"])).toBeVisible();
    unmount();
  }
});

it("an empty hall says so in words and shows no figure in the work pose", () => {
  const { container } = render(<Hall scene={EMPTY_HALL} />);
  expect(screen.getByText(de["hall.empty"])).toBeVisible();
  expect(sprites(container, "fig-")).toHaveLength(4);
  expect(sprites(container, "-run-")).toEqual([]);
  expect(sprites(container, "piece-")).toEqual([]);
});

it("an unread hall says it is not read yet", () => {
  const { container } = render(<Hall scene={undefined} />);
  expect(screen.getByText(de["hall.unread"])).toBeVisible();
  expect(screen.queryByText(de["hall.empty"])).toBeNull();
  expect(sprites(container, "fig-")).toEqual([]);
});

it("a missing state shows the unknown pose", () => {
  const { container } = render(<Hall scene={{ pieces: [{ id: "probe-x", name: "hall.piece.a", role: "build" }] }} />);
  expect(sprites(container, "fig-build-unknown-0")).toHaveLength(1);
  expect(screen.getByText(STATE_UNKNOWN_WORD)).toBeVisible();
  // A role without a piece has no observed run: the configured profile stands ready.
  expect(sprites(container, "fig-plan-ready-0")).toHaveLength(1);
});

it("three work pieces each carry a text name", () => {
  const { container } = render(<Hall scene={SAMPLE_HALL} />);
  expect(SAMPLE_HALL.pieces).toHaveLength(3);
  for (const piece of SAMPLE_HALL.pieces) {
    expect(piece.id).toMatch(/^probe-/);
    expect(screen.getByText(de[piece.name])).toBeVisible();
  }
  expect(sprites(container, "piece-")).toHaveLength(3);
  expect(sprites(container, "gate-hall-0")).toHaveLength(1);
  expect(sprites(container, "prop-stamp-0")).toHaveLength(1);
  expect(screen.getByText(de["hall.gate"])).toBeVisible();
  expect(screen.getByText(de["hall.prop.stamp"])).toBeVisible();
});
