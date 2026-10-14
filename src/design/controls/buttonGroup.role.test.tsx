import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, ButtonGroup } from "./Button";

describe("ButtonGroup", () => {
  it("keeps the button group role when the caller passes another role", () => {
    render(
      <ButtonGroup role="presentation" aria-label="Aktionen">
        <Button>A</Button>
      </ButtonGroup>,
    );
    expect(screen.getByRole("group", { name: "Aktionen" })).toHaveClass("g-btn-group");
    expect(screen.getByRole("button", { name: "A" })).toBeInTheDocument();
  });
});
