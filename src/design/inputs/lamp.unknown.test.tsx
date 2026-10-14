import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Lamp } from "./Lamp";

it("draws an unknown lamp state as the plain ok lamp", () => {
  render(
    <>
      <Lamp state={"nope" as "ok"} label="Status" />
      <Lamp state="warn" label="Warn" />
    </>,
  );
  const status = screen.getByRole("img", { name: "Status" });
  expect(status).toHaveClass("g-lamp");
  expect(status.className.split(/\s+/).filter(Boolean).some((name) => name.startsWith("g-lamp--"))).toBe(false);
  expect(screen.getByRole("img", { name: "Warn" })).toHaveClass("g-lamp--warn");
});
