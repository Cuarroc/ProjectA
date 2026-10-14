import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Avatar, type AvatarTone } from "./Avatar";

it("draws an unknown avatar tone with no tone class", () => {
  render(
    <>
      <Avatar initials="ZZ" tone={"nope" as AvatarTone} />
      <Avatar initials="OO" tone={0 as AvatarTone} />
      <Avatar initials="SS" tone={7 as AvatarTone} />
      <Avatar initials="TH" tone={3} />
      <Avatar initials="LD" tone="lead" />
    </>,
  );
  for (const initials of ["ZZ", "OO", "SS"]) {
    const node = screen.getByText(initials);
    expect(node).toHaveTextContent(initials);
    expect(node.className).not.toContain("g-ava--");
  }
  expect(screen.getByText("TH")).toHaveTextContent("TH");
  expect(screen.getByText("TH")).toHaveClass("g-ava--c3");
  expect(screen.getByText("LD")).toHaveTextContent("LD");
  expect(screen.getByText("LD")).toHaveClass("g-ava--lead");
});
