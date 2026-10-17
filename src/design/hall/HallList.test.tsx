import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { de } from "../../i18n/de";
import { STATE_UNKNOWN_WORD, STATE_WORDS, type StateForm } from "../state/states";
import { poseFor } from "./figures/poses";
import { SAMPLE_HALL } from "./fixtures";
import { Hall } from "./Hall";

afterEach(cleanup);

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";
const crates = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-sprite="piece-crate-0"]')];
const list = () => screen.getByRole("list", { name: de["hall.list.label"] });
const rowOf = (id: string) => list().querySelector<HTMLElement>(`[data-piece="${id}"]`)!;
const inspector = () => screen.getByRole("region", { name: de["hall.inspector.title"] });

it("list and scene show the same ids and states", () => {
  const { container } = render(<Hall scene={SAMPLE_HALL} />);
  const ids = SAMPLE_HALL.pieces.map((p) => p.id);
  expect(crates(container).map((c) => c.dataset.piece)).toEqual(ids);
  expect([...list().querySelectorAll<HTMLElement>("[data-piece]")].map((r) => r.dataset.piece)).toEqual(ids);
  for (const p of SAMPLE_HALL.pieces) {
    const word = p.state ? STATE_WORDS[p.state as StateForm] : STATE_UNKNOWN_WORD;
    expect(within(rowOf(p.id)).getByText(de[p.name])).toBeVisible();
    expect(within(rowOf(p.id)).getByText(word)).toBeVisible();
    expect(container.querySelectorAll(`[data-sprite="fig-${p.role}-${poseFor(p.state ?? "unknown")}-0"]`)).toHaveLength(1);
  }
});

it("selecting in the list selects in the scene", () => {
  const { container } = render(<Hall scene={SAMPLE_HALL} />);
  const [a, b] = SAMPLE_HALL.pieces;
  const selected = () => crates(container).filter((c) => c.dataset.selected === "true").map((c) => c.dataset.piece);
  expect(selected()).toEqual([]);
  fireEvent.click(rowOf(a.id));
  expect(selected()).toEqual([a.id]);
  expect(rowOf(a.id).getAttribute("aria-current")).toBe("true");
  // And back: a click on the scene piece moves the one selection; a second click clears it.
  fireEvent.click(crates(container)[1]);
  expect(selected()).toEqual([b.id]);
  expect(rowOf(a.id).hasAttribute("aria-current")).toBe(false);
  expect(rowOf(b.id).getAttribute("aria-current")).toBe("true");
  fireEvent.click(rowOf(b.id));
  expect(selected()).toEqual([]);
});

it("every work piece is reachable by keyboard exactly once", () => {
  const { container } = render(<Hall scene={SAMPLE_HALL} />);
  const stops = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
  expect(stops).toHaveLength(SAMPLE_HALL.pieces.length);
  for (const p of SAMPLE_HALL.pieces) expect(stops.filter((s) => s.dataset.piece === p.id)).toHaveLength(1);
  // The scene stays decorative: no stop inside it.
  expect(container.querySelector(".g-hall__scene")!.querySelectorAll(FOCUSABLE)).toHaveLength(0);
});

it("the inspector shows the task first and says when nothing is selected", () => {
  render(<Hall scene={SAMPLE_HALL} />);
  expect(within(inspector()).getByText(de["hall.inspector.none"])).toBeVisible();
  const piece = SAMPLE_HALL.pieces[0];
  fireEvent.click(rowOf(piece.id));
  const terms = [...inspector().querySelectorAll("dt")].map((t) => t.textContent);
  expect(terms).toEqual([de["hall.inspector.task"], de["hall.inspector.state"], de["hall.inspector.role"]]);
  const values = [...inspector().querySelectorAll("dd")].map((d) => d.textContent);
  expect(values).toEqual([de[piece.name], STATE_WORDS[piece.state as StateForm], de["hall.role.build"]]);
  expect(within(inspector()).queryByText(de["hall.inspector.none"])).toBeNull();
});
