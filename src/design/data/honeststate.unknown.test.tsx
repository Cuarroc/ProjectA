import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { de } from "../../i18n/de";
import { HonestState, type HonestKind } from "./HonestState";

const UNKNOWN = "phantom";

it("uses the empty word and the empty shape for an unknown kind", () => {
  const onClick = vi.fn();
  const { container } = render(
    <HonestState
      kind={UNKNOWN as HonestKind}
      title="Freier Platz"
      hint="Bitte später schauen"
      action={{ label: "Alle zeigen", onClick }}
    />,
  );
  const root = container.firstElementChild;
  expect(root).toHaveClass("g-hs", "g-hs--empty");
  expect(root?.className ?? "").not.toContain(UNKNOWN);
  expect(container.querySelector(".g-hs__title")).toHaveTextContent(de["honest.empty"]);
  expect(container.querySelector(".g-hs__hint")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(container.textContent ?? "").not.toMatch(/\d/);
  expect(container.textContent ?? "").not.toContain(UNKNOWN);
  expect(onClick).not.toHaveBeenCalled();
});
