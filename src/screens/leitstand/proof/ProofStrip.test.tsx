import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

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
  const { container } = render(<ProofStrip {...full} redFirst="unknown" gates={null} />);
  expect(screen.getAllByText(T.notConnected).length).toBeGreaterThanOrEqual(2);
  expect(container.querySelector(".g-proof__t--pass")).toBeNull();
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
