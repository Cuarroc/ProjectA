import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { de } from "../../../i18n/de";
import { ProofStrip, type ProofStripProps } from "./ProofStrip";
import { T } from "./texts";

const full: ProofStripProps = {
  redFirst: "pass",
  gates: ["pass", "pass", "wip"],
  review: { tone: "yes", text: "Freigegeben" },
  pr: { href: "https://example.test/pr/1", sha: "7c1e0b3a9f", command: "gates lane prepush", exitCode: 0 },
  stale: false,
};

it("shows red-first as not connected instead of a pass tick", () => {
  const { container } = render(<ProofStrip {...full} redFirst="unknown" gates={null} review={null} pr={null} />);
  expect(screen.getAllByText(T.notConnected)).toHaveLength(4);
  expect(container.querySelector(".g-proof__yes")).toBeNull();
  expect(screen.queryByText(T.redFirstPass)).toBeNull();
});

it("labels the missing gates badge with the gates word", () => {
  render(<ProofStrip {...full} gates={null} />);
  expect(screen.getByText(de["proof.gates"])).toHaveClass("ps__label");
});

it("marks every badge stale when the proof was invalidated", () => {
  const { container } = render(<ProofStrip {...full} stale />);
  expect(screen.getByRole("group", { name: new RegExp(T.stale) })).toBeInTheDocument();
  expect(container.querySelectorAll(".ps__badge")).toHaveLength(4);
  expect(container.querySelectorAll(".ps__stale")).toHaveLength(4);
});

it("keeps a fresh full strip free of the stale word", () => {
  render(<ProofStrip {...full} />);
  expect(screen.queryByText(T.stale)).toBeNull();
  expect(screen.getByRole("group", { name: T.strip })).toBeInTheDocument();
  expect(screen.getByText("Gates 2/3")).toBeInTheDocument();
  expect(screen.getByText("7c1e0b3")).toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute("href", full.pr?.href);
});

it("does not link a pull request href that is not a web address", () => {
  render(<ProofStrip {...full} pr={{ ...full.pr!, href: "javascript:alert(1)" }} />);
  expect(screen.queryByRole("link")).toBeNull();
});

// COMP-4-3: the one-line variant for the flow node.
it("draws the compact strip as one row of four cells and never a pass mark without data", () => {
  const { container } = render(<ProofStrip {...full} redFirst="unknown" gates={null} review={null} pr={null} compact />);
  const strip = screen.getByRole("group", { name: T.strip });
  expect(strip).toHaveClass("ps--compact");
  expect(strip.children).toHaveLength(4);
  expect(container.querySelectorAll(".ps__badge")).toHaveLength(4);
  // The mark is a dash; the words stay for assistive tech.
  expect(screen.getAllByText(T.notConnected)).toHaveLength(4);
  expect(container.querySelector(".g-proof__yes")).toBeNull();
});

it("keeps the words of every compact value for assistive tech and the tooltip", () => {
  render(<ProofStrip {...full} compact />);
  expect(screen.getByText(T.redFirstPass)).toHaveClass("sr-only");
  expect(screen.getByText(T.redFirstShort).parentElement).toHaveAttribute("title", T.redFirst);
  expect(screen.getByText("2/3")).toBeInTheDocument();
  expect(screen.getByText(full.review!.text)).toHaveClass("sr-only");
  expect(screen.getByRole("link", { name: T.open })).toHaveAttribute("title", "7c1e0b3 gates lane prepush Exit 0");
  expect(screen.queryByText("gates lane prepush Exit 0")).toBeNull();
});
