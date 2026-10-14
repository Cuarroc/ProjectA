import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { ProofChip, type GateTick } from "./ProofChip";

const UNKNOWN = "ghost";

it("paints an unknown gate tick as none and does not invent a class", () => {
  const { container } = render(
    <ProofChip
      gates={["pass", UNKNOWN] as unknown as readonly GateTick[]}
      verdict={{ tone: "yes", text: "Freigegeben" }}
      sha="7c1e0b3a9f"
      href="#proof"
    />,
  );
  const link = screen.getByRole("link");
  expect(link).toHaveAttribute("href", "#proof");
  expect(link).toHaveTextContent("Gates 1/2");
  expect(within(link).getByText("Freigegeben")).toHaveClass("g-proof__yes");
  expect(within(link).getByText("7c1e0b3")).toBeInTheDocument();

  const ticks = container.querySelectorAll(".g-proof__ticks i");
  expect(ticks).toHaveLength(2);
  expect(ticks[0]).toHaveClass("g-proof__t--pass");
  expect(ticks[1]).toHaveClass("g-proof__t--none");
  expect(ticks[1]?.className).toBe("g-proof__t--none");
  expect(container.querySelector(`.g-proof__t--${UNKNOWN}`)).toBeNull();
  for (const el of container.querySelectorAll("[class]")) {
    expect(String(el.className)).not.toContain(UNKNOWN);
  }
});
